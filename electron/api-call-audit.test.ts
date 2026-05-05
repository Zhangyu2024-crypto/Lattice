// @vitest-environment node

import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { gunzipSync } from 'node:zlib'
import {
  configureApiCallAudit,
  flushApiCallAudit,
  recordApiCall,
  shutdownApiCallAudit,
} from './api-call-audit'

let auditDir: string | null = null

afterEach(async () => {
  await shutdownApiCallAudit()
  if (auditDir) {
    await rm(auditDir, { recursive: true, force: true })
    auditDir = null
  }
})

describe('api-call-audit', () => {
  it('writes redacted compressed ndjson batches', async () => {
    auditDir = await mkdtemp(path.join(tmpdir(), 'lattice-audit-'))
    configureApiCallAudit({
      dir: auditDir,
      enabled: true,
      flushIntervalMs: 10,
      maxBatchBytes: 1024,
    })

    recordApiCall({
      kind: 'llm.invoke',
      source: 'creator',
      operation: 'anthropic:test-model',
      status: 'ok',
      durationMs: 12,
      request: {
        apiKey: 'secret-key',
        messages: [{ role: 'user', content: 'long prompt body' }],
      },
      response: { usage: { inputTokens: 3, outputTokens: 5 } },
    })
    flushApiCallAudit()
    await shutdownApiCallAudit()

    const files = await readdir(auditDir)
    expect(files).toHaveLength(1)
    const raw = await readFile(path.join(auditDir, files[0]))
    const lines = gunzipSync(raw)
      .toString('utf8')
      .trim()
      .split('\n')
    expect(lines).toHaveLength(1)
    const event = JSON.parse(lines[0]) as Record<string, unknown>
    expect(event.kind).toBe('llm.invoke')
    expect(event.source).toBe('creator')
    expect(event.status).toBe('ok')
    expect(JSON.stringify(event)).not.toContain('secret-key')
    expect(JSON.stringify(event)).toContain('[redacted]')
  })
})
