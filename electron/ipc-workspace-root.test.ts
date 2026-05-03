// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { EventEmitter } from 'node:events'

const userDataDir = path.join(tmpdir(), 'lattice-workspace-root-user-data')
const handlers = new Map<
  string,
  (_e: unknown, req: unknown) => unknown | Promise<unknown>
>()
const watchCalls: Array<{ watchedPath: string; options: { ignored?: unknown } }> = []

class MockWatcher extends EventEmitter {
  close = vi.fn(async () => undefined)
}

vi.mock('electron', () => ({
  app: {
    getPath: (name: string) => {
      if (name === 'userData') return userDataDir
      return tmpdir()
    },
  },
  BrowserWindow: class {},
  clipboard: {
    writeText: vi.fn(),
  },
  ipcMain: {
    handle: (channel: string, fn: (e: unknown, req: unknown) => unknown) => {
      handlers.set(channel, fn)
    },
  },
  shell: {
    openPath: vi.fn(async () => ''),
    showItemInFolder: vi.fn(),
  },
}))

vi.mock('chokidar', () => ({
  default: {
    watch: (watchedPath: string, options: { ignored?: unknown }) => {
      watchCalls.push({ watchedPath, options })
      return new MockWatcher()
    },
  },
}))

import {
  closeAllWorkspaceWatchers,
  registerWorkspaceRootIpc,
} from './ipc-workspace-root'

let rootDir: string

async function invoke<T>(channel: string, payload: unknown): Promise<T> {
  const fn = handlers.get(channel)
  if (!fn) throw new Error(`No handler for ${channel}`)
  return (await fn(
    { sender: { once: vi.fn(), isDestroyed: () => false } },
    payload,
  )) as T
}

beforeEach(async () => {
  handlers.clear()
  watchCalls.length = 0
  registerWorkspaceRootIpc(() => null)

  rootDir = await mkdtemp(path.join(tmpdir(), 'lattice-workspace-root-'))
  await writeFile(path.join(rootDir, 'notes.txt'), 'hello')
  await mkdir(path.join(rootDir, 'data'))
  await writeFile(path.join(rootDir, 'data', 'sample.xy'), '1 2')
  await mkdir(path.join(rootDir, 'node_modules'), { recursive: true })
  await writeFile(path.join(rootDir, 'node_modules', 'pkg.js'), '')
  await mkdir(path.join(rootDir, 'release'), { recursive: true })
  await writeFile(path.join(rootDir, 'release', 'installer.exe'), '')
  await mkdir(path.join(rootDir, 'resources', 'conda-env'), { recursive: true })
  await writeFile(path.join(rootDir, 'resources', 'conda-env', 'python.exe'), '')
  await mkdir(path.join(rootDir, '.cache'), { recursive: true })
  await writeFile(path.join(rootDir, '.cache', 'builder'), '')
})

afterEach(async () => {
  await closeAllWorkspaceWatchers()
  await rm(rootDir, { recursive: true, force: true })
  vi.clearAllMocks()
})

describe('workspace root IPC', () => {
  it('does not list generated directories in the explorer root', async () => {
    const setRes = await invoke<{ ok: boolean }>('workspace-root:set', {
      rootPath: rootDir,
    })
    expect(setRes.ok).toBe(true)

    const res = await invoke<{
      ok: true
      entries: Array<{ name: string; isDirectory: boolean }>
    }>('workspace:list', { rel: '' })

    expect(res.ok).toBe(true)
    const names = res.entries.map((entry) => entry.name)
    expect(names).toContain('data')
    expect(names).toContain('notes.txt')
    expect(names).toContain('resources')
    expect(names).not.toContain('node_modules')
    expect(names).not.toContain('release')
    expect(names).not.toContain('.cache')
  })

  it('does not list resources/conda-env', async () => {
    await invoke('workspace-root:set', { rootPath: rootDir })

    const res = await invoke<{
      ok: true
      entries: Array<{ name: string; isDirectory: boolean }>
    }>('workspace:list', { rel: 'resources' })

    expect(res.ok).toBe(true)
    expect(res.entries.map((entry) => entry.name)).not.toContain('conda-env')
  })

  it('passes source-level ignores to chokidar', async () => {
    await invoke('workspace-root:set', { rootPath: rootDir })

    const res = await invoke<{ ok: boolean; watchId?: string }>(
      'workspace:watch:start',
      { rel: '' },
    )
    expect(res.ok).toBe(true)
    expect(watchCalls).toHaveLength(1)

    const ignored = watchCalls[0]?.options.ignored
    expect(typeof ignored).toBe('function')
    const shouldIgnore = ignored as (candidatePath: string) => boolean
    expect(shouldIgnore(path.join(rootDir, 'release'))).toBe(true)
    expect(shouldIgnore(path.join(rootDir, 'resources', 'conda-env'))).toBe(true)
    expect(shouldIgnore(path.join(rootDir, 'data'))).toBe(false)
  })
})
