// @vitest-environment node
//
// Tier 3 · IPC tests for the compute-workspace handlers.
//
// Strategy: `vi.mock('electron', ...)` replaces the Electron runtime with
// an in-memory `ipcMain.handle` registry, `shell.showItemInFolder`, and
// `clipboard.writeText` — all spyable. Real fs access is permitted via a
// temporary directory so we exercise the caps + path-containment logic
// against actual stat / readFile calls.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

// ── electron mock ───────────────────────────────────────────────────
const handlers = new Map<
  string,
  (_e: unknown, req: unknown) => unknown | Promise<unknown>
>()
const showItemInFolder = vi.fn()
const writeText = vi.fn()

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, fn: (e: unknown, req: unknown) => unknown) => {
      handlers.set(channel, fn)
    },
  },
  shell: {
    showItemInFolder: (...args: Parameters<typeof showItemInFolder>) =>
      showItemInFolder(...args),
  },
  clipboard: {
    writeText: (...args: Parameters<typeof writeText>) => writeText(...args),
  },
}))

// Invoked for its side effect (registers the handlers with our mock).
import { registerComputeWorkspaceIpc } from './ipc-compute-workspace'

let rootDir: string

async function invoke<T>(channel: string, payload: unknown): Promise<T> {
  const fn = handlers.get(channel)
  if (!fn) throw new Error(`No handler for ${channel}`)
  return (await fn(null, payload)) as T
}

beforeEach(async () => {
  handlers.clear()
  registerComputeWorkspaceIpc()

  rootDir = await mkdtemp(path.join(tmpdir(), 'lattice-ipc-test-'))
  // Lay out a small tree:
  //   root/
  //     notes.txt           (20 B)
  //     structs/
  //       batio3.cif        (50 B)
  //     .hidden/
  //       secret.txt
  //     huge.bin            (intentionally > 8 MB for the cap test)
  await writeFile(path.join(rootDir, 'notes.txt'), 'hello from unit test\n')
  await mkdir(path.join(rootDir, 'structs'))
  await writeFile(
    path.join(rootDir, 'structs', 'batio3.cif'),
    'data_BaTiO3\n_cell_length_a 3.994\n',
  )
  await mkdir(path.join(rootDir, '.hidden'))
  await writeFile(path.join(rootDir, '.hidden', 'secret.txt'), 'nope')
})

afterEach(async () => {
  await rm(rootDir, { recursive: true, force: true })
  vi.clearAllMocks()
})

// ── compute:list-dir-at ─────────────────────────────────────────────

describe('compute:list-dir-at', () => {
  it('returns entries for a valid directory, skipping dotfiles', async () => {
    type ListOk = { ok: true; rootPath: string; entries: Array<{ name: string; isDirectory: boolean }> }
    const res = await invoke<ListOk>('compute:list-dir-at', { absPath: rootDir })
    expect(res.ok).toBe(true)
    // `.hidden` must not leak into the list.
    expect(res.entries.some((e) => e.name === '.hidden')).toBe(false)
    // `notes.txt` + `structs/` + `structs/batio3.cif` should appear.
    expect(res.entries.some((e) => e.name === 'notes.txt')).toBe(true)
    expect(res.entries.some((e) => e.name === 'structs' && e.isDirectory)).toBe(
      true,
    )
    expect(res.entries.some((e) => e.name === 'batio3.cif')).toBe(true)
  })

  it('rejects a non-absolute path', async () => {
    type ListErr = { ok: false; error: string }
    const res = await invoke<ListErr>('compute:list-dir-at', {
      absPath: 'relative/path',
    })
    expect(res.ok).toBe(false)
    expect(res.error).toMatch(/absolute/i)
  })

  it('returns a clear error when the path does not exist', async () => {
    type ListErr = { ok: false; error: string }
    const res = await invoke<ListErr>('compute:list-dir-at', {
      absPath: '/this/path/does/not/exist/abcxyz',
    })
    expect(res.ok).toBe(false)
    expect(res.error).toMatch(/cannot read|does not exist|not a directory/i)
  })
})

// ── compute:read-file-at ────────────────────────────────────────────

describe('compute:read-file-at', () => {
  it('returns file contents within the allowed root', async () => {
    type ReadOk = { ok: true; content: string; size: number }
    const res = await invoke<ReadOk>('compute:read-file-at', {
      rootPath: rootDir,
      relPath: 'notes.txt',
    })
    expect(res.ok).toBe(true)
    expect(res.content).toContain('hello from unit test')
  })

  it('rejects a path that escapes the root via ".."', async () => {
    type ReadErr = { ok: false; error: string }
    const res = await invoke<ReadErr>('compute:read-file-at', {
      rootPath: rootDir,
      relPath: '../../etc/passwd',
    })
    expect(res.ok).toBe(false)
    expect(res.error).toMatch(/escape|outside|compute folder/i)
  })

  it('refuses to read a directory', async () => {
    type ReadErr = { ok: false; error: string }
    const res = await invoke<ReadErr>('compute:read-file-at', {
      rootPath: rootDir,
      relPath: 'structs',
    })
    expect(res.ok).toBe(false)
    expect(res.error).toMatch(/directory/i)
  })

  it('rejects an empty relPath', async () => {
    type ReadErr = { ok: false; error: string }
    const res = await invoke<ReadErr>('compute:read-file-at', {
      rootPath: rootDir,
      relPath: '',
    })
    expect(res.ok).toBe(false)
    expect(res.error).toMatch(/required/i)
  })
})

// ── compute:copy-path-at & reveal-at ────────────────────────────────

describe('compute:copy-path-at', () => {
  it('writes the absolute path to the clipboard mock', async () => {
    const res = await invoke<{ ok: boolean }>('compute:copy-path-at', {
      absPath: '/absolute/example/path.txt',
    })
    expect(res.ok).toBe(true)
    expect(writeText).toHaveBeenCalledWith('/absolute/example/path.txt')
  })

  it('rejects an empty path', async () => {
    const res = await invoke<{ ok: boolean; error?: string }>(
      'compute:copy-path-at',
      { absPath: '' },
    )
    expect(res.ok).toBe(false)
    expect(res.error).toMatch(/required/i)
  })
})

describe('compute:reveal-at', () => {
  it('calls shell.showItemInFolder with the provided absolute path', async () => {
    const abs = path.join(rootDir, 'notes.txt')
    const res = await invoke<{ ok: boolean }>('compute:reveal-at', {
      absPath: abs,
    })
    expect(res.ok).toBe(true)
    expect(showItemInFolder).toHaveBeenCalledWith(abs)
  })

  it('rejects a relative path', async () => {
    const res = await invoke<{ ok: boolean; error?: string }>(
      'compute:reveal-at',
      { absPath: 'notes.txt' },
    )
    expect(res.ok).toBe(false)
    expect(res.error).toMatch(/absolute/i)
    expect(showItemInFolder).not.toHaveBeenCalled()
  })
})
