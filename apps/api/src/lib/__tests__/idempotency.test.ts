/**
 * Unit tests for idempotency helpers (Task 3.2)
 */

import { jest, describe, it, expect, beforeEach } from '@jest/globals'

// ---------------------------------------------------------------------------
// Mock ioredis
// ---------------------------------------------------------------------------

const mockGet = jest.fn()
const mockSet = jest.fn()

jest.unstable_mockModule('../../lib/redis.js', () => ({
  redisClient: { get: mockGet, set: mockSet },
  default: { get: mockGet, set: mockSet },
}))

// ---------------------------------------------------------------------------
// Mock Prisma
// ---------------------------------------------------------------------------

const mockIdempFindFirst = jest.fn()
const mockIdempUpsert = jest.fn()

jest.unstable_mockModule('../../lib/prisma.js', () => ({
  prisma: {
    idempotencyKey: {
      findFirst: mockIdempFindFirst,
      upsert: mockIdempUpsert,
    },
  },
  PrismaClient: jest.fn(),
}))

jest.unstable_mockModule('@prisma/client', () => ({
  Prisma: { InputJsonValue: {} },
}))

const { checkKey, setKeyInFlight, setKeyCompleted, computeSystemKey } =
  await import('../idempotency.js')

// ---------------------------------------------------------------------------
// checkKey
// ---------------------------------------------------------------------------

describe('checkKey', () => {
  beforeEach(() => jest.clearAllMocks())

  it('returns parsed record from Redis cache on hit', async () => {
    const stored = { status: 'completed', responseStatus: 201, responseBody: { id: 'x' } }
    mockGet.mockResolvedValue(JSON.stringify(stored))

    const result = await checkKey('org-1', 'key-abc')

    expect(result).toEqual(stored)
    expect(mockIdempFindFirst).not.toHaveBeenCalled()
  })

  it('falls back to DB when Redis misses', async () => {
    mockGet.mockResolvedValue(null)
    mockIdempFindFirst.mockResolvedValue({
      organizationId: 'org-1',
      key: 'key-abc',
      status: 'completed',
      responseStatus: 200,
      responseBody: { ok: true },
      expiresAt: new Date(Date.now() + 86400_000),
    })

    const result = await checkKey('org-1', 'key-abc')

    expect(result).toMatchObject({ status: 'completed', responseStatus: 200 })
    expect(mockIdempFindFirst).toHaveBeenCalledTimes(1)
  })

  it('returns null when neither Redis nor DB has the key', async () => {
    mockGet.mockResolvedValue(null)
    mockIdempFindFirst.mockResolvedValue(null)

    const result = await checkKey('org-1', 'missing-key')
    expect(result).toBeNull()
  })

  it('falls through to DB when Redis value is corrupt JSON', async () => {
    mockGet.mockResolvedValue('{not valid json')
    mockIdempFindFirst.mockResolvedValue(null)

    const result = await checkKey('org-1', 'key-bad')
    expect(result).toBeNull()
    expect(mockIdempFindFirst).toHaveBeenCalledTimes(1)
  })
})

// ---------------------------------------------------------------------------
// setKeyInFlight
// ---------------------------------------------------------------------------

describe('setKeyInFlight', () => {
  beforeEach(() => jest.clearAllMocks())

  it('returns true when Redis SET NX succeeds (key was free)', async () => {
    mockSet.mockResolvedValue('OK')
    const claimed = await setKeyInFlight('org-1', 'key-new')
    expect(claimed).toBe(true)
  })

  it('returns false when Redis SET NX fails (key already existed)', async () => {
    mockSet.mockResolvedValue(null)
    const claimed = await setKeyInFlight('org-1', 'key-exists')
    expect(claimed).toBe(false)
  })

  it('calls Redis SET with EX and NX flags', async () => {
    mockSet.mockResolvedValue('OK')
    await setKeyInFlight('org-1', 'my-key')
    expect(mockSet).toHaveBeenCalledWith(
      'idempotency:org-1:my-key',
      expect.any(String),
      'EX',
      86400,
      'NX',
    )
  })
})

// ---------------------------------------------------------------------------
// setKeyCompleted
// ---------------------------------------------------------------------------

describe('setKeyCompleted', () => {
  beforeEach(() => jest.clearAllMocks())

  it('upserts to DB and updates Redis cache', async () => {
    mockIdempUpsert.mockResolvedValue({})
    mockSet.mockResolvedValue('OK')

    await setKeyCompleted('org-1', 'key-done', 201, { id: 'event-1' })

    expect(mockIdempUpsert).toHaveBeenCalledTimes(1)
    expect(mockIdempUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { organizationId_key: { organizationId: 'org-1', key: 'key-done' } },
        create: expect.objectContaining({ responseStatus: 201, status: 'completed' }),
        update: expect.objectContaining({ responseStatus: 201, status: 'completed' }),
      }),
    )
    expect(mockSet).toHaveBeenCalledWith(
      'idempotency:org-1:key-done',
      expect.stringContaining('"completed"'),
      'EX',
      86400,
    )
  })
})

// ---------------------------------------------------------------------------
// computeSystemKey
// ---------------------------------------------------------------------------

describe('computeSystemKey', () => {
  it('returns a 64-char hex SHA-256 string', () => {
    const key = computeSystemKey('org-1', 'et-1', 'api', { qty: 5 })
    expect(key).toHaveLength(64)
    expect(/^[0-9a-f]{64}$/.test(key)).toBe(true)
  })

  it('is deterministic — same inputs always produce the same key', () => {
    const a = computeSystemKey('org-1', 'et-1', 'api', { qty: 5, name: 'x' })
    const b = computeSystemKey('org-1', 'et-1', 'api', { name: 'x', qty: 5 })
    expect(a).toBe(b)
  })

  it('produces different keys for different payloads', () => {
    const a = computeSystemKey('org-1', 'et-1', 'api', { qty: 5 })
    const b = computeSystemKey('org-1', 'et-1', 'api', { qty: 6 })
    expect(a).not.toBe(b)
  })

  it('produces different keys for different orgs', () => {
    const a = computeSystemKey('org-1', 'et-1', 'api', { qty: 5 })
    const b = computeSystemKey('org-2', 'et-1', 'api', { qty: 5 })
    expect(a).not.toBe(b)
  })

  it('sorts nested object keys for determinism', () => {
    const a = computeSystemKey('org', 'et', 'api', { z: { b: 1, a: 2 }, a: 3 })
    const b = computeSystemKey('org', 'et', 'api', { a: 3, z: { a: 2, b: 1 } })
    expect(a).toBe(b)
  })
})
