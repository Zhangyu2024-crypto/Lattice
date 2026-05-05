import { describe, expect, it } from 'vitest'
import {
  compactAssistantErrorToast,
  parseAssistantErrorDisplay,
} from './assistant-error-display'

describe('assistant error display', () => {
  it('summarizes provider JSON errors without exposing raw payload inline', () => {
    const raw =
      'Provider error 502 — {"error":{"message":"模型服务暂时不可用，请稍后重试。","type":"server_error","code":"upstream_unavailable","request_id":"7d7f601ddbf13378686d2d6a"}}'

    const parsed = parseAssistantErrorDisplay(raw)
    expect(parsed.title).toBe('Provider error 502')
    expect(parsed.summary).toBe('模型服务暂时不可用，请稍后重试。')
    expect(parsed.statusCode).toBe('502')
    expect(parsed.code).toBe('upstream_unavailable')
    expect(parsed.type).toBe('server_error')
    expect(parsed.requestId).toBe('7d7f601ddbf13378686d2d6a')
    expect(parsed.detail).toContain('"request_id": "7d7f601ddbf13378686d2d6a"')

    const toast = compactAssistantErrorToast(raw)
    expect(toast).toEqual({
      title: 'Provider error 502',
      body: '模型服务暂时不可用，请稍后重试。',
      meta: 'upstream_unavailable · Request 7d7f601ddbf13378686d2d6a',
    })
  })
})
