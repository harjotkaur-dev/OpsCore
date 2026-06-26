/**
 * Unit tests for src/lib/jwt.ts
 *
 * Covers:
 *  - signAccessToken / verifyAccessToken round-trip
 *  - Access token payload claims (sub, org, role, permissions, exp, iat)
 *  - Access token TTL (~15 min)
 *  - verifyAccessToken rejects tampered / expired tokens
 *  - signRefreshToken returns opaque UUID with 7-day expiry
 *  - hashToken produces consistent SHA-256 hex digests
 */

import { jest, describe, it, expect, beforeAll } from '@jest/globals'
import { generateKeyPairSync } from 'node:crypto'
import { createHash } from 'node:crypto'

// ---------------------------------------------------------------------------
// Generate a real RSA-2048 key pair for tests so we don't depend on env vars.
// Must happen before @opscore/config is loaded.
// ---------------------------------------------------------------------------

const { privateKey, publicKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
})

// Mock @opscore/config before any module that imports it is loaded
jest.unstable_mockModule('@opscore/config', () => ({
  config: {
    NODE_ENV: 'test',
    DATABASE_URL: 'postgresql://test:test@localhost:5432/test',
    REDIS_URL: 'redis://localhost:6379',
    JWT_PRIVATE_KEY: privateKey,
    JWT_PUBLIC_KEY: publicKey,
    COOKIE_SECRET: 'test-cookie-secret-at-least-32-chars',
    CORS_ORIGIN: 'http://localhost:5173',
    PORT: 3000,
    WORKER_CONCURRENCY_WORKFLOW: 10,
    WORKER_CONCURRENCY_NOTIFICATIONS: 20,
    WORKER_CONCURRENCY_METRICS: 5,
    LOG_LEVEL: 'info',
  },
}))

// Dynamic import AFTER mock is registered
const jwtModule = await import('../jwt.js')
const { signAccessToken, verifyAccessToken, signRefreshToken, hashToken } = jwtModule
type AccessTokenPayload = Parameters<typeof signAccessToken>[0]
type DecodedAccessToken = ReturnType<typeof verifyAccessToken>

// Also get jsonwebtoken for error type checks
const jwt = (await import('jsonwebtoken')).default

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const samplePayload: AccessTokenPayload = {
  sub: 'user-uuid-1',
  org: 'org-uuid-1',
  role: 'admin',
  permissions: ['task:read', 'task:create', 'workflow:read'],
}

// ---------------------------------------------------------------------------
// signAccessToken / verifyAccessToken
// ---------------------------------------------------------------------------

describe('signAccessToken', () => {
  it('returns a non-empty string', () => {
    const token = signAccessToken(samplePayload)
    expect(typeof token).toBe('string')
    expect(token.length).toBeGreaterThan(0)
  })

  it('produces a three-segment JWT string', () => {
    const token = signAccessToken(samplePayload)
    expect(token.split('.')).toHaveLength(3)
  })

  it('embeds the correct application claims', () => {
    const token = signAccessToken(samplePayload)
    const decoded = verifyAccessToken(token)

    expect(decoded.sub).toBe(samplePayload.sub)
    expect(decoded.org).toBe(samplePayload.org)
    expect(decoded.role).toBe(samplePayload.role)
    expect(decoded.permissions).toEqual(samplePayload.permissions)
  })

  it('includes iat and exp registered claims', () => {
    const before = Math.floor(Date.now() / 1000)
    const token = signAccessToken(samplePayload)
    const after = Math.floor(Date.now() / 1000)
    const decoded = verifyAccessToken(token)

    expect(decoded.iat).toBeGreaterThanOrEqual(before)
    expect(decoded.iat).toBeLessThanOrEqual(after)
    expect(decoded.exp).toBeGreaterThan(decoded.iat)
  })

  it('sets expiry ~15 minutes (900 seconds) from issuance', () => {
    const token = signAccessToken(samplePayload)
    const decoded = verifyAccessToken(token)

    const ttl = decoded.exp - decoded.iat
    // Allow ±2 s tolerance for slow test environments
    expect(ttl).toBeGreaterThanOrEqual(898)
    expect(ttl).toBeLessThanOrEqual(902)
  })

  it('uses RS256 algorithm (verifiable from header)', () => {
    const token = signAccessToken(samplePayload)
    const header = JSON.parse(Buffer.from(token.split('.')[0]!, 'base64url').toString('utf8')) as {
      alg: string
    }
    expect(header.alg).toBe('RS256')
  })
})

describe('verifyAccessToken', () => {
  it('returns decoded payload for a valid token', () => {
    const token = signAccessToken(samplePayload)
    const decoded: DecodedAccessToken = verifyAccessToken(token)
    expect(decoded.sub).toBe(samplePayload.sub)
  })

  it('throws JsonWebTokenError for a structurally invalid token', () => {
    expect(() => verifyAccessToken('not.a.token')).toThrow(jwt.JsonWebTokenError)
  })

  it('throws for a tampered payload (signature mismatch)', () => {
    const token = signAccessToken(samplePayload)
    const [h, p, s] = token.split('.')
    const originalPayload = JSON.parse(Buffer.from(p!, 'base64url').toString('utf8')) as Record<string, unknown>
    const mutated = { ...originalPayload, sub: 'evil-user' }
    const tamperedPayload = Buffer.from(JSON.stringify(mutated)).toString('base64url')
    const tampered = `${h}.${tamperedPayload}.${s}`
    expect(() => verifyAccessToken(tampered)).toThrow(jwt.JsonWebTokenError)
  })

  it('throws JsonWebTokenError for a token signed with a different algorithm', () => {
    const hmacToken = jwt.sign({ sub: 'x' }, 'secret', { algorithm: 'HS256' })
    expect(() => verifyAccessToken(hmacToken)).toThrow(jwt.JsonWebTokenError)
  })

  it('throws TokenExpiredError for an already-expired token', () => {
    const freshToken = signAccessToken(samplePayload)
    expect(() =>
      jwt.verify(freshToken, publicKey, {
        algorithms: ['RS256'],
        // Pretend the current time is 20 minutes after issuance → expired
        clockTimestamp: Math.floor(Date.now() / 1000) + 20 * 60,
      }),
    ).toThrow(jwt.TokenExpiredError)
  })
})

// ---------------------------------------------------------------------------
// signRefreshToken
// ---------------------------------------------------------------------------

describe('signRefreshToken', () => {
  it('returns an object with token and expiresAt', () => {
    const result = signRefreshToken()
    expect(result).toHaveProperty('token')
    expect(result).toHaveProperty('expiresAt')
    expect(result.expiresAt).toBeInstanceOf(Date)
  })

  it('token looks like a UUID v4', () => {
    const { token } = signRefreshToken()
    const uuidV4Pattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    expect(uuidV4Pattern.test(token)).toBe(true)
  })

  it('expiresAt is approximately 7 days from now', () => {
    const before = Date.now()
    const { expiresAt } = signRefreshToken()
    const after = Date.now()

    const sevenDaysMs = 7 * 24 * 60 * 60 * 1000
    const diff = expiresAt.getTime() - before

    // Allow ±1000 ms tolerance
    expect(diff).toBeGreaterThanOrEqual(sevenDaysMs - 1000)
    expect(diff).toBeLessThanOrEqual(sevenDaysMs + (after - before) + 1000)
  })

  it('generates unique tokens on each call', () => {
    const tokens = Array.from({ length: 10 }, () => signRefreshToken().token)
    const unique = new Set(tokens)
    expect(unique.size).toBe(10)
  })
})

// ---------------------------------------------------------------------------
// hashToken
// ---------------------------------------------------------------------------

describe('hashToken', () => {
  it('returns a 64-character hex string (SHA-256)', () => {
    const digest = hashToken('some-token')
    expect(digest).toHaveLength(64)
    expect(/^[0-9a-f]{64}$/.test(digest)).toBe(true)
  })

  it('is deterministic — same input always produces same output', () => {
    const token = 'stable-input'
    expect(hashToken(token)).toBe(hashToken(token))
  })

  it('produces the correct SHA-256 digest', () => {
    const raw = 'hello-opscore'
    const expected = createHash('sha256').update(raw).digest('hex')
    expect(hashToken(raw)).toBe(expected)
  })

  it('different inputs produce different digests', () => {
    expect(hashToken('token-a')).not.toBe(hashToken('token-b'))
  })

  it('hashing a refresh token produces a stable 64-char hex string', () => {
    const { token } = signRefreshToken()
    const hash = hashToken(token)
    expect(hash).toHaveLength(64)
    expect(hashToken(token)).toBe(hash) // deterministic
  })
})
