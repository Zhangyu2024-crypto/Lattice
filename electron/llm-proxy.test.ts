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
  traceId: 'trace-test-1',
  module: 'creator',
  operation: 'creator_generate',
  sessionId: 'ses_1',
  artifactId: 'art_1',
  workspaceIdHash: 'workspace_hash',
  consentVersion: '2026-05-05',
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

  it('sends Chat Completions requests to OpenAI-compatible endpoints', async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({
        choices: [
          {
            message: {
              role: 'assistant',
              content: 'Pong',
            },
          },
        ],
        usage: { prompt_tokens: 11, completion_tokens: 3 },
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
    expect(url).toBe('https://compat.example/v1/chat/completions')
    expect(init.method).toBe('POST')
    expect(init.headers).toMatchObject({
      'content-type': 'application/json',
      authorization: 'Bearer test-key',
      'X-Lattice-Trace-Id': 'trace-test-1',
      'X-Lattice-Module': 'creator',
      'X-Lattice-Operation': 'creator_generate',
      'X-Lattice-Session-Id': 'ses_1',
      'X-Lattice-Artifact-Id': 'art_1',
      'X-Lattice-Workspace-Id-Hash': 'workspace_hash',
      'X-Lattice-Consent-Version': '2026-05-05',
    })
    expect(JSON.parse(String(init.body))).toEqual({
      model: 'test-model',
      messages: [
        { role: 'system', content: 'You are terse.' },
        {
          role: 'user',
          content: 'Ping',
        },
      ],
      max_tokens: 128,
      temperature: 0.2,
    })
  })

  it('does not duplicate /v1 when the configured base URL already includes it', async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({
        choices: [
          {
            message: {
              role: 'assistant',
              content: 'ok',
            },
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
    expect(url).toBe('https://api.openai.com/v1/chat/completions')
  })

  it('keeps official OpenAI on the Responses API', async () => {
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
    req.provider = 'openai'
    req.baseUrl = 'https://api.openai.com/v1'

    await invoke(req)

    const [url, init] = fetchCall(fetchMock, 0)
    expect(url).toBe('https://api.openai.com/v1/responses')
    expect(JSON.parse(String(init.body))).toMatchObject({
      input: [
        {
          type: 'message',
          role: 'user',
          content: [{ type: 'input_text', text: 'Ping' }],
        },
      ],
      instructions: 'You are terse.',
      max_output_tokens: 128,
    })
  })

  it('translates neutral tool messages and schemas into Chat Completions tool calls', async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({
        choices: [
          {
            message: {
              role: 'assistant',
              content: null,
              tool_calls: [
                {
                  id: 'call_2',
                  type: 'function',
                  function: {
                    name: 'search_workspace',
                    arguments: '{"query":"xrd"}',
                  },
                },
              ],
            },
          },
        ],
        usage: { prompt_tokens: 24, completion_tokens: 7 },
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
          function: {
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
        },
      ],
      tool_choice: 'auto',
      messages: [
        { role: 'system', content: 'You are terse.' },
        {
          role: 'assistant',
          content: 'I will search.',
          tool_calls: [
            {
              id: 'call_1',
              type: 'function',
              function: {
                name: 'search_workspace',
                arguments: '{"query":"lattice"}',
              },
            },
          ],
        },
        {
          role: 'tool',
          tool_call_id: 'call_1',
          content: '{"matches":[]}',
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
        traceId: 'trace-model-test',
        module: 'agent',
        operation: 'list_models',
      }),
    ).resolves.toMatchObject({ success: true, modelCount: 2 })
    await expect(
      listModels({
        provider: 'openai-compatible',
        apiKey: 'test-key',
        baseUrl: 'https://compat.example/v1',
        traceId: 'trace-model-list',
        module: 'agent',
        operation: 'list_models',
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
    expect(testInit.method).toBe('GET')
    expect(listInit.method).toBe('GET')
    expect(testInit.headers).toMatchObject({
      authorization: 'Bearer test-key',
      'X-Lattice-Trace-Id': 'trace-model-test',
      'X-Lattice-Module': 'agent',
      'X-Lattice-Operation': 'list_models',
    })
    expect(listInit.headers).toMatchObject({
      authorization: 'Bearer test-key',
      'X-Lattice-Trace-Id': 'trace-model-list',
      'X-Lattice-Module': 'agent',
      'X-Lattice-Operation': 'list_models',
    })
  })
})
