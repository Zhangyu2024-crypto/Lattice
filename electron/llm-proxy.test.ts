// @vitest-environment node

import { afterEach, describe, expect, it, vi } from 'vitest'
import { invoke, listModels, testConnection } from './llm-proxy'
import type { LlmInvokeRequest } from './llm-proxy'

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })

const baseOpenAiRequest = (): LlmInvokeRequest => ({
  provider: 'openai-compatible',
  apiKey: 'test-key',
  baseUrl: 'https://compat.example',
  model: 'test-model',
  systemPrompt: 'You are terse.',
  messages: [{ role: 'user', content: 'Ping' }],
  maxTokens: 128,
  temperature: 0.2,
})

const fetchCall = (
  fetchMock: ReturnType<typeof vi.fn>,
  index: number,
): [string, RequestInit] =>
  fetchMock.mock.calls[index] as unknown as [string, RequestInit]

describe('llm-proxy OpenAI-compatible transport', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('sends Responses API requests to OpenAI-compatible endpoints', async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({
        output: [
          {
            type: 'message',
            role: 'assistant',
            content: [{ type: 'output_text', text: 'Pong' }],
          },
        ],
        usage: { input_tokens: 11, output_tokens: 3 },
      }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const result = await invoke(baseOpenAiRequest())

    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.content).toBe('Pong')
      expect(result.usage).toEqual({ inputTokens: 11, outputTokens: 3 })
    }

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchCall(fetchMock, 0)
    expect(url).toBe('https://compat.example/v1/responses')
    expect(init.method).toBe('POST')
    expect(init.headers).toMatchObject({
      'content-type': 'application/json',
      authorization: 'Bearer test-key',
    })
    expect(JSON.parse(String(init.body))).toEqual({
      model: 'test-model',
      input: [
        {
          type: 'message',
          role: 'user',
          content: [{ type: 'input_text', text: 'Ping' }],
        },
      ],
      instructions: 'You are terse.',
      max_output_tokens: 128,
      temperature: 0.2,
    })
  })

  it('does not duplicate /v1 when the configured base URL already includes it', async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({
        output: [
          {
            type: 'message',
            role: 'assistant',
            content: [{ type: 'output_text', text: 'ok' }],
          },
        ],
        usage: {},
      }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const req = baseOpenAiRequest()
    req.baseUrl = 'https://api.openai.com/v1'

    await invoke(req)

    const [url] = fetchCall(fetchMock, 0)
    expect(url).toBe('https://api.openai.com/v1/responses')
  })

  it('translates neutral tool messages and schemas into Responses function-call items', async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({
        output: [
          {
            type: 'function_call',
            call_id: 'call_2',
            name: 'search_workspace',
            arguments: '{"query":"xrd"}',
          },
        ],
        usage: { input_tokens: 24, output_tokens: 7 },
      }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const result = await invoke({
      ...baseOpenAiRequest(),
      mode: 'agent',
      tools: [
        {
          name: 'search_workspace',
          description: 'Search workspace files',
          input_schema: {
            type: 'object',
            properties: {
              query: { type: 'string', description: 'Search query' },
            },
            required: ['query'],
          },
        },
      ],
      messages: [
        {
          role: 'assistant',
          content: [
            { type: 'text', text: 'I will search.' },
            {
              type: 'tool_use',
              id: 'call_1',
              name: 'search_workspace',
              input: { query: 'lattice' },
            },
          ],
        },
        {
          role: 'user',
          content: [
            {
              type: 'tool_result',
              tool_use_id: 'call_1',
              content: '{"matches":[]}',
            },
          ],
        },
      ],
    })

    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.content).toBe('')
      expect(result.toolCalls).toEqual([
        {
          id: 'call_2',
          name: 'search_workspace',
          input: { query: 'xrd' },
        },
      ])
    }

    const [, init] = fetchCall(fetchMock, 0)
    expect(JSON.parse(String(init.body))).toMatchObject({
      tools: [
        {
          type: 'function',
          name: 'search_workspace',
          description: 'Search workspace files',
          parameters: {
            type: 'object',
            properties: {
              query: { type: 'string', description: 'Search query' },
            },
            required: ['query'],
          },
        },
      ],
      tool_choice: 'auto',
      instructions: 'You are terse.',
      input: [
        {
          type: 'message',
          role: 'assistant',
          status: 'completed',
          content: [
            { type: 'output_text', text: 'I will search.', annotations: [] },
          ],
        },
        {
          type: 'function_call',
          call_id: 'call_1',
          name: 'search_workspace',
          arguments: '{"query":"lattice"}',
          status: 'completed',
        },
        {
          type: 'function_call_output',
          call_id: 'call_1',
          output: '{"matches":[]}',
        },
      ],
    })
  })

  it('uses OpenAI-compatible /v1/models for connection tests and model listing', async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({
        data: [
          { id: 'model-a', created: 1 },
          { id: 'model-b', created: 2 },
        ],
      }),
    )
    vi.stubGlobal('fetch', fetchMock)

    await expect(
      testConnection({
        provider: 'openai-compatible',
        apiKey: 'test-key',
        baseUrl: 'https://compat.example',
      }),
    ).resolves.toMatchObject({ success: true, modelCount: 2 })
    await expect(
      listModels({
        provider: 'openai-compatible',
        apiKey: 'test-key',
        baseUrl: 'https://compat.example/v1',
      }),
    ).resolves.toMatchObject({
      success: true,
      models: [
        { id: 'model-a', createdAt: 1 },
        { id: 'model-b', createdAt: 2 },
      ],
    })

    const [testUrl, testInit] = fetchCall(fetchMock, 0)
    const [listUrl, listInit] = fetchCall(fetchMock, 1)
    expect(testUrl).toBe('https://compat.example/v1/models')
    expect(listUrl).toBe('https://compat.example/v1/models')
    expect(testInit.headers).toMatchObject({ authorization: 'Bearer test-key' })
    expect(listInit.headers).toMatchObject({ authorization: 'Bearer test-key' })
  })
})
