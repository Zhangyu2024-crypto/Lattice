export interface AssistantErrorDisplay {
  title: string
  summary: string
  detail?: string
  statusCode?: string
  code?: string
  type?: string
  requestId?: string
}

interface ProviderErrorPayload {
  message?: string
  type?: string
  code?: string
  requestId?: string
}

export function parseAssistantErrorDisplay(content: string): AssistantErrorDisplay {
  const raw = content.trim()
  const body = raw.replace(/^error\s*:\s*/i, '').trim()
  const providerMatch = /^Provider error\s+(\d{3})(?:\s+[\u2013\u2014-]\s*([\s\S]+))?$/i.exec(
    body,
  )

  if (providerMatch) {
    const statusCode = providerMatch[1]
    const rawPayload = providerMatch[2]?.trim()
    const parsedPayload = parseProviderErrorPayload(rawPayload)
    return {
      title: `Provider error ${statusCode}`,
      summary:
        parsedPayload?.message ??
        providerErrorFallbackSummary(statusCode) ??
        'The model provider is unavailable.',
      detail: formatErrorDetail(rawPayload) ?? body,
      statusCode,
      code: parsedPayload?.code,
      type: parsedPayload?.type,
      requestId: parsedPayload?.requestId,
    }
  }

  const parsedPayload = parseProviderErrorPayload(body)
  if (parsedPayload) {
    return {
      title: 'Request failed',
      summary: parsedPayload.message ?? 'The request failed.',
      detail: formatErrorDetail(body) ?? body,
      code: parsedPayload.code,
      type: parsedPayload.type,
      requestId: parsedPayload.requestId,
    }
  }

  return {
    title: 'Request failed',
    summary: summarizeErrorLine(body || raw || 'The request failed.'),
    detail: body.length > 180 ? body : undefined,
  }
}

export function compactAssistantErrorToast(message: string): {
  title?: string
  body: string
  meta?: string
} {
  const parsed = parseAssistantErrorDisplay(message)
  if (isPlainRequestFailure(parsed, message)) {
    return { body: compactToastLine(message.trim() || message) }
  }
  return {
    title: parsed.title,
    body: parsed.summary,
    meta: [parsed.code, parsed.requestId ? `Request ${parsed.requestId}` : null]
      .filter(Boolean)
      .join(' · ') || undefined,
  }
}

function parseProviderErrorPayload(raw: string | undefined): ProviderErrorPayload | null {
  if (!raw) return null
  const json = extractJsonObject(raw)
  if (!json) return null
  const root = json as Record<string, unknown>
  const error =
    root.error && typeof root.error === 'object'
      ? (root.error as Record<string, unknown>)
      : root
  const message = valueToString(error.message)
  const type = valueToString(error.type)
  const code = valueToString(error.code)
  const requestId =
    valueToString(error.request_id) ??
    valueToString(error.requestId) ??
    valueToString(root.request_id) ??
    valueToString(root.requestId)
  if (!message && !type && !code && !requestId) return null
  return { message, type, code, requestId }
}

function formatErrorDetail(raw: string | undefined): string | undefined {
  if (!raw) return undefined
  const json = extractJsonObject(raw)
  return json ? JSON.stringify(json, null, 2) : raw
}

function extractJsonObject(raw: string): unknown | null {
  const trimmed = raw.trim()
  if (!trimmed) return null
  const start = trimmed.indexOf('{')
  const end = trimmed.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  try {
    return JSON.parse(trimmed.slice(start, end + 1))
  } catch {
    return null
  }
}

function valueToString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function providerErrorFallbackSummary(statusCode: string): string | undefined {
  if (statusCode === '502' || statusCode === '503' || statusCode === '504') {
    return 'The model service is temporarily unavailable. Please retry later.'
  }
  if (statusCode === '401' || statusCode === '403') {
    return 'The model provider rejected the current credential.'
  }
  if (statusCode === '429') {
    return 'The model provider is rate limiting this request.'
  }
  return undefined
}

function summarizeErrorLine(value: string): string {
  const firstLine = value.split(/\r?\n/, 1)[0]?.trim() ?? value
  if (firstLine.length <= 180) return firstLine
  return `${firstLine.slice(0, 177)}...`
}

function compactToastLine(value: string): string {
  const singleLine = value.replace(/\s+/g, ' ').trim()
  if (singleLine.length <= 220) return singleLine
  return `${singleLine.slice(0, 217)}...`
}

function isPlainRequestFailure(parsed: AssistantErrorDisplay, message: string): boolean {
  return (
    parsed.title === 'Request failed' &&
    !parsed.code &&
    !parsed.type &&
    !parsed.requestId &&
    !/^error\s*:/i.test(message.trim()) &&
    !message.includes('{')
  )
}
