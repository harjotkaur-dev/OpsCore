/**
 * callWebhookHandler unit tests
 *
 * Tests HTTP request construction, Mustache template rendering,
 * env allowlist security, and error handling.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals'
import type { ActionExecutionContext } from '../index.js'

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockFetch = jest.fn<(url: string, opts?: Record<string, unknown>) => Promise<unknown>>()

jest.unstable_mockModule('node-fetch', () => ({
  default: mockFetch,
}))

const { callWebhookHandler, buildEnvView, WebhookError } = await import('../callWebhookHandler.js')

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeResponse(status: number, ok: boolean, body = ''): object {
  return {
    ok,
    status,
    statusText: ok ? 'OK' : 'Bad Request',
    text: jest.fn<() => Promise<string>>().mockResolvedValue(body),
  }
}

function makeContext(overrides: Partial<ActionExecutionContext> = {}): ActionExecutionContext {
  return {
    actionType: 'call_webhook',
    config: {
      url: 'https://hooks.example.com/notify',
      method: 'POST',
      body_template: '{"event_id":"{{event.id}}"}',
    },
    event: {
      id: 'evt-abc',
      eventTypeId: 'et-001',
      payload: { amount: 100 },
      source: 'api',
    },
    executionId: 'exec-001',
    orgId: 'org-001',
    orderIndex: 0,
    logger: {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
      child: jest.fn().mockReturnThis(),
    } as unknown as ActionExecutionContext['logger'],
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// Tests — buildEnvView (env allowlist)
// ---------------------------------------------------------------------------

describe('buildEnvView', () => {
  const originalEnv = process.env

  beforeEach(() => {
    process.env = { ...originalEnv }
  })

  afterEach(() => {
    process.env = originalEnv
  })

  it('includes env vars prefixed with WEBHOOK_ENV_', () => {
    process.env['WEBHOOK_ENV_MY_TOKEN'] = 'secret123'
    const view = buildEnvView()
    expect(view['MY_TOKEN']).toBe('secret123')
  })

  it('strips the WEBHOOK_ENV_ prefix from keys', () => {
    process.env['WEBHOOK_ENV_API_KEY'] = 'key-value'
    const view = buildEnvView()
    expect('WEBHOOK_ENV_API_KEY' in view).toBe(false)
    expect(view['API_KEY']).toBe('key-value')
  })

  it('does NOT expose env vars without the WEBHOOK_ENV_ prefix', () => {
    process.env['DATABASE_URL'] = 'postgres://secret'
    process.env['JWT_PRIVATE_KEY'] = 'supersecret'
    const view = buildEnvView()
    expect('DATABASE_URL' in view).toBe(false)
    expect('JWT_PRIVATE_KEY' in view).toBe(false)
  })

  it('returns an empty object when no WEBHOOK_ENV_ vars exist', () => {
    // Remove all WEBHOOK_ENV_ keys
    for (const key of Object.keys(process.env)) {
      if (key.startsWith('WEBHOOK_ENV_')) {
        delete process.env[key]
      }
    }
    const view = buildEnvView()
    const webhookKeys = Object.keys(view).filter(k => k.startsWith('WEBHOOK_ENV_'))
    expect(webhookKeys).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// Tests — callWebhookHandler
// ---------------------------------------------------------------------------

describe('callWebhookHandler', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockFetch.mockResolvedValue(makeResponse(200, true))
  })

  it('calls the configured URL with the configured HTTP method', async () => {
    const ctx = makeContext()
    await callWebhookHandler(ctx)

    expect(mockFetch).toHaveBeenCalledWith(
      'https://hooks.example.com/notify',
      expect.objectContaining({ method: 'POST' }),
    )
  })

  it('renders the body template with event data', async () => {
    const ctx = makeContext()
    await callWebhookHandler(ctx)

    const callOpts = (mockFetch.mock.calls[0]?.[1] ?? {}) as { body?: string }
    expect(callOpts.body).toBe('{"event_id":"evt-abc"}')
  })

  it('sends no body when body_template is not provided', async () => {
    const ctx = makeContext({
      config: { url: 'https://example.com/hook', method: 'POST' },
    })
    await callWebhookHandler(ctx)

    const callOpts = (mockFetch.mock.calls[0]?.[1] ?? {}) as { body?: string }
    expect(callOpts.body).toBeUndefined()
  })

  it('sets Content-Type: application/json by default', async () => {
    const ctx = makeContext()
    await callWebhookHandler(ctx)

    const callOpts = (mockFetch.mock.calls[0]?.[1] ?? {}) as { headers?: Record<string, string> }
    expect(callOpts.headers?.['Content-Type']).toBe('application/json')
  })

  it('includes custom headers from config', async () => {
    const ctx = makeContext({
      config: {
        url: 'https://example.com/hook',
        method: 'POST',
        headers: { 'X-Api-Key': 'static-key' },
      },
    })
    await callWebhookHandler(ctx)

    const callOpts = (mockFetch.mock.calls[0]?.[1] ?? {}) as { headers?: Record<string, string> }
    expect(callOpts.headers?.['X-Api-Key']).toBe('static-key')
  })

  it('resolves env.* tokens in header values from the allowlist', async () => {
    const originalEnv = process.env
    process.env = { ...originalEnv, WEBHOOK_ENV_SECRET: 'tok-xyz' }

    const ctx = makeContext({
      config: {
        url: 'https://example.com/hook',
        method: 'POST',
        headers: { Authorization: 'Bearer {{env.SECRET}}' },
      },
    })

    try {
      await callWebhookHandler(ctx)
      const callOpts = (mockFetch.mock.calls[0]?.[1] ?? {}) as { headers?: Record<string, string> }
      expect(callOpts.headers?.['Authorization']).toBe('Bearer tok-xyz')
    } finally {
      process.env = originalEnv
    }
  })

  it('throws WebhookError when the HTTP response is not ok', async () => {
    mockFetch.mockResolvedValue(makeResponse(500, false, 'Internal Server Error'))

    const ctx = makeContext()
    await expect(callWebhookHandler(ctx)).rejects.toThrow(WebhookError)
  })

  it('includes the HTTP status code in the WebhookError', async () => {
    mockFetch.mockResolvedValue(makeResponse(422, false, 'Unprocessable'))

    const ctx = makeContext()
    try {
      await callWebhookHandler(ctx)
      throw new Error('Expected WebhookError')
    } catch (err) {
      expect(err).toBeInstanceOf(WebhookError)
      expect((err as InstanceType<typeof WebhookError>).statusCode).toBe(422)
    }
  })

  it('supports GET method', async () => {
    const ctx = makeContext({
      config: { url: 'https://example.com/hook', method: 'GET' },
    })
    await callWebhookHandler(ctx)

    expect(mockFetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ method: 'GET' }),
    )
  })
})
