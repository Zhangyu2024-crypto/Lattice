// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, readFile, readdir, rm, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

let userDataDir = ''

vi.mock('electron', () => ({
  app: {
    getPath: (name: string) => {
      if (name === 'userData') return userDataDir
      if (name === 'downloads') return userDataDir
      return userDataDir
    },
  },
}))

import {
  clearAuditLogs,
  configureAudit,
  flushAuditEvents,
  getAuditLogDir,
  sanitizeAuditValue,
  summarizePayloadForAudit,
  writeAuditEvent,
} from './audit-writer'

async function readAuditLines(): Promise<unknown[]> {
  await flushAuditEvents()
  const dir = getAuditLogDir()
  const files = await readdir(dir).catch(() => [] as string[])
  const rows: unknown[] = []
  for (const file of files.filter((name) => name.endsWith('.jsonl'))) {
    const text = await readFile(path.join(dir, file), 'utf8')
    rows.push(
      ...text
        .trim()
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line) as unknown),
    )
  }
  return rows
}

beforeEach(async () => {
  userDataDir = await mkdtemp(path.join(tmpdir(), 'lattice-audit-test-'))
  configureAudit({
    enabled: false,
    acceptedAgreementVersion: null,
    currentAgreementVersion: '2026-05-05',
    retentionDays: 30,
  })
})

afterEach(async () => {
  configureAudit({
    enabled: false,
    acceptedAgreementVersion: null,
    currentAgreementVersion: '2026-05-05',
    retentionDays: 30,
  })
  await clearAuditLogs()
  await rm(userDataDir, { recursive: true, force: true })
})

describe('audit writer', () => {
  it('does not write logs until current agreement is accepted and logging is enabled', async () => {
    writeAuditEvent({
      category: 'llm',
      action: 'invoke',
      metadata: { model: 'test' },
    })
    expect(await readAuditLines()).toEqual([])

    configureAudit({
      enabled: true,
      acceptedAgreementVersion: 'old',
      currentAgreementVersion: '2026-05-05',
    })
    writeAuditEvent({
      category: 'llm',
      action: 'invoke',
      metadata: { model: 'test' },
    })
    expect(await readAuditLines()).toEqual([])
  })

  it('writes JSONL when enabled for the accepted agreement version', async () => {
    configureAudit({
      enabled: true,
      acceptedAgreementVersion: '2026-05-05',
      currentAgreementVersion: '2026-05-05',
    })

    writeAuditEvent({
      category: 'workspace',
      action: 'write',
      status: 'success',
      metadata: { relPath: 'creator/main.tex', bytes: 42 },
    })

    const rows = await readAuditLines()
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      category: 'workspace',
      action: 'write',
      status: 'success',
      metadata: { relPath: 'creator/main.tex', bytes: 42 },
    })
  })

  it('redacts sensitive keys and summarizes large strings', () => {
    const sanitized = sanitizeAuditValue({
      apiKey: 'sk-secret',
      authorization: 'Bearer abc',
      nested: { approvalToken: 'tok', ok: true },
      text: 'x'.repeat(4096),
    }) as Record<string, unknown>

    expect(sanitized.apiKey).toBe('[redacted]')
    expect(sanitized.authorization).toBe('[redacted]')
    expect(sanitized.nested).toMatchObject({ approvalToken: '[redacted]', ok: true })
    expect(sanitized.text).toMatchObject({
      type: 'text',
      length: 4096,
    })
  })

  it('summarizes payload text even when it is short', () => {
    expect(summarizePayloadForAudit({ prompt: 'hello' })).toMatchObject({
      prompt: {
        type: 'text',
        length: 5,
      },
    })
  })

  it('clears only the audit log directory', async () => {
    configureAudit({
      enabled: true,
      acceptedAgreementVersion: '2026-05-05',
      currentAgreementVersion: '2026-05-05',
    })
    writeAuditEvent({
      category: 'system',
      action: 'test',
      metadata: {},
    })
    await flushAuditEvents()

    const otherDir = path.join(userDataDir, 'logs', 'other')
    await mkdir(otherDir, { recursive: true })
    await writeFile(path.join(otherDir, 'keep.txt'), 'keep', 'utf8')

    await clearAuditLogs()

    expect(await readdir(getAuditLogDir()).catch(() => [] as string[])).toEqual([])
    expect(await readFile(path.join(otherDir, 'keep.txt'), 'utf8')).toBe('keep')
  })
})
