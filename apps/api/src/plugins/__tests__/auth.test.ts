/**
 * Unit tests for plugins/auth.ts
 *
 * Tests the auth preHandler hook in isolation by building a minimal Fastify
 * app and making synthetic requests.  The `verifyAccessToken` function from
 * lib/jwt is mocked so tests do not depend on real RSA keys.
 *
 * Covers:
 *  - 401 when Authorization header is absent
 *  - 401 when Authorization header is present but not in `Bearer <token>` form
 *  - 401 when verifyAccessToken throws (expired / tampered token)
 *  - Successful auth: userId, orgId, role, permissions attached to request
 */

import { jest, describe, it, expect, beforeEach } from '@jest/globals'

// ---------------------------------------------------------------------------
// Mock verifyAccessToken before importing the plugin
// ---------------------------------------------------------------------------

const mockVerifyAccessToken = jest.fn()

jest.unstable_mockModule('../../lib/jwt.js', () => ({
  verifyAccessToken: mockVerifyAccessToken,
  signAccessToken: jest.fn(),
  signRefreshToken: jest.fn(),
  hashToken: jest.fn(),
}))

// Dynamic imports after mock registration
const Fastify = (await import('fastify')).default
const fp = (await import('fastify-plugin')).default
const { default: authPlugin } = await import('../auth.js')

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a minimal Fastify app with the auth plugin and a test route. */
async function buildApp() {
  const app = Fastify({ logger: false })
  await app.register(authPlugin)

  // Test route that echoes back the auth claims attached by the plugin
  app.get('/protected', async (request) => {
    return {
      userId: request.userId,
      orgId: request.orgId,
      role: request.role,
      permissions: request.permissions,
    }
  })

  await app.ready()
  return app
}

const sampleDecoded = {
  sub: 'user-uuid-1',
  org: 'org-uuid-1',
  role: 'admin',
  permissions: ['task:read', 'workflow:create'],
  iat: 1700000000,
  exp: 1700000900,
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('auth plugin — preHandler hook', () => {
  let app: Awaited<ReturnType<typeof buildApp>>

  beforeEach(async () => {
    jest.clearAllMocks()
    app = await buildApp()
  })

  it('returns 401 when Authorization header is absent', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/protected',
    })

    expect(response.statusCode).toBe(401)
    const body = response.json<{ error: { code: string; message: string } }>()
    expect(body.error.code).toBe('UNAUTHORIZED')
  })

  it('returns 401 when Authorization header does not start with Bearer', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/protected',
      headers: { authorization: 'Basic dXNlcjpwYXNz' },
    })

    expect(response.statusCode).toBe(401)
    const body = response.json<{ error: { code: string } }>()
    expect(body.error.code).toBe('UNAUTHORIZED')
    expect(mockVerifyAccessToken).not.toHaveBeenCalled()
  })

  it('returns 401 when Authorization header is just "Bearer " with no token', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/protected',
      headers: { authorization: 'Bearer ' },
    })

    // An empty-string token will be passed to verifyAccessToken which will throw
    mockVerifyAccessToken.mockImplementation(() => { throw new Error('jwt malformed') })

    // The header starts with "Bearer " so it passes the prefix check, but verify throws
    // Re-build app to pick up the mock
    const freshApp = await buildApp()
    const res2 = await freshApp.inject({
      method: 'GET',
      url: '/protected',
      headers: { authorization: 'Bearer ' },
    })
    expect(res2.statusCode).toBe(401)
  })

  it('returns 401 when verifyAccessToken throws (expired token)', async () => {
    const error = new Error('TokenExpiredError')
    error.name = 'TokenExpiredError'
    mockVerifyAccessToken.mockImplementation(() => { throw error })

    const response = await app.inject({
      method: 'GET',
      url: '/protected',
      headers: { authorization: 'Bearer expired.token.here' },
    })

    expect(response.statusCode).toBe(401)
    const body = response.json<{ error: { code: string; message: string } }>()
    expect(body.error.code).toBe('UNAUTHORIZED')
    expect(body.error.message).toContain('Invalid or expired access token')
  })

  it('returns 401 when verifyAccessToken throws (invalid signature)', async () => {
    mockVerifyAccessToken.mockImplementation(() => {
      throw new Error('invalid signature')
    })

    const response = await app.inject({
      method: 'GET',
      url: '/protected',
      headers: { authorization: 'Bearer bad.token.sig' },
    })

    expect(response.statusCode).toBe(401)
    expect(mockVerifyAccessToken).toHaveBeenCalledWith('bad.token.sig')
  })

  it('attaches userId, orgId, role, permissions on successful verification', async () => {
    mockVerifyAccessToken.mockReturnValue(sampleDecoded)

    const response = await app.inject({
      method: 'GET',
      url: '/protected',
      headers: { authorization: 'Bearer valid.access.token' },
    })

    expect(response.statusCode).toBe(200)
    const body = response.json<{
      userId: string
      orgId: string
      role: string
      permissions: string[]
    }>()

    expect(body.userId).toBe(sampleDecoded.sub)
    expect(body.orgId).toBe(sampleDecoded.org)
    expect(body.role).toBe(sampleDecoded.role)
    expect(body.permissions).toEqual(sampleDecoded.permissions)
  })

  it('calls verifyAccessToken with the stripped bearer token (no "Bearer " prefix)', async () => {
    mockVerifyAccessToken.mockReturnValue(sampleDecoded)

    await app.inject({
      method: 'GET',
      url: '/protected',
      headers: { authorization: 'Bearer my.jwt.token' },
    })

    expect(mockVerifyAccessToken).toHaveBeenCalledWith('my.jwt.token')
    expect(mockVerifyAccessToken).not.toHaveBeenCalledWith('Bearer my.jwt.token')
  })

  it('includes request_id in the 401 error envelope', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/protected',
    })

    const body = response.json<{ error: { request_id: unknown } }>()
    expect(body.error).toHaveProperty('request_id')
  })
})
