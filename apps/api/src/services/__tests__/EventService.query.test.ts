/**
 * Unit tests for EventService.listEvents and EventService.getEvent — Task 3.9
 */

import { jest, describe, it, expect, beforeEach } from '@jest/globals'

// ---------------------------------------------------------------------------
// Mock prisma
// ---------------------------------------------------------------------------

const mockEventFindMany = jest.fn()
const mockEventFindFirst = jest.fn()

jest.unstable_mockModule('../../lib/prisma.js', () => ({
  prisma: {
    event: {
      findMany: mockEventFindMany,
      findFirst: mockEventFindFirst,
    },
  },
  PrismaClient: jest.fn(),
}))

jest.unstable_mockModule('@prisma/client', () => ({
  Prisma: { JsonNull: 'JsonNull' },
}))

// Also mock idempotency and schemaValidator so EventService can be imported
jest.unstable_mockModule('../../lib/idempotency.js', () => ({
  checkKey: jest.fn(),
  setKeyInFlight: jest.fn(),
  setKeyCompleted: jest.fn(),
  computeSystemKey: jest.fn(),
}))

jest.unstable_mockModule('../../lib/schemaValidator.js', () => ({
  validate: jest.fn(),
  clearCache: jest.fn(),
  cacheSize: jest.fn(),
}))

jest.unstable_mockModule('@opscore/config', () => ({
  config: {
    NODE_ENV: 'test',
    DATABASE_URL: 'postgresql://test:test@localhost:5432/test',
    REDIS_URL: 'redis://localhost:6379',
    JWT_PRIVATE_KEY: 'test-private-key',
    JWT_PUBLIC_KEY: 'test-public-key',
    COOKIE_SECRET: 'test-cookie-secret-32-chars-long!!',
    CORS_ORIGIN: 'http://localhost:5173',
    PORT: 3000,
    WORKER_CONCURRENCY_WORKFLOW: 10,
    WORKER_CONCURRENCY_NOTIFICATIONS: 20,
    WORKER_CONCURRENCY_METRICS: 5,
    LOG_LEVEL: 'info',
  },
}))

jest.unstable_mockModule('../../lib/queue.js', () => ({
  workflowQueue: { add: jest.fn().mockResolvedValue({ id: 'job-1' }), getJobCounts: jest.fn() },
  notificationsQueue: { add: jest.fn(), getJobCounts: jest.fn() },
  metricUpdatesQueue: { add: jest.fn(), getJobCounts: jest.fn() },
  createQueue: jest.fn(),
}))

const { EventService } = await import('../EventService.js')

// ---------------------------------------------------------------------------
// Sample data
// ---------------------------------------------------------------------------

const ORG_ID = 'org-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
const ET_ID  = 'et-bbbb-bbbb-bbbb-bbbbbbbbbbbb'

function makeEvent(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    organizationId: ORG_ID,
    eventTypeId: ET_ID,
    source: 'api',
    payload: { qty: 5 },
    idempotencyKey: `key-${id}`,
    status: 'received',
    receivedAt: new Date('2024-01-15T10:00:00Z'),
    processedAt: null,
    ...overrides,
  }
}

const ev1 = makeEvent('ev-1111')
const ev2 = makeEvent('ev-2222', { source: 'webhook', status: 'processed' })
const ev3 = makeEvent('ev-3333', { eventTypeId: 'et-other' })

// ---------------------------------------------------------------------------
// listEvents — happy paths
// ---------------------------------------------------------------------------

describe('EventService.listEvents', () => {
  beforeEach(() => jest.clearAllMocks())

  it('returns data and pagination with no filters', async () => {
    mockEventFindMany.mockResolvedValue([ev1, ev2])

    const result = await EventService.listEvents(ORG_ID)

    expect(result.data).toHaveLength(2)
    expect(result.pagination.hasNextPage).toBe(false)
    expect(result.pagination.nextCursor).toBeNull()
    expect(result.pagination.limit).toBe(20)
    expect(mockEventFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ organizationId: ORG_ID }),
        orderBy: [{ receivedAt: 'desc' }, { id: 'desc' }],
        take: 21, // limit+1 for hasNextPage detection
      }),
    )
  })

  it('applies eventTypeId filter', async () => {
    mockEventFindMany.mockResolvedValue([ev1])

    await EventService.listEvents(ORG_ID, { eventTypeId: ET_ID })

    expect(mockEventFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ eventTypeId: ET_ID }),
      }),
    )
  })

  it('applies source filter', async () => {
    mockEventFindMany.mockResolvedValue([ev2])

    await EventService.listEvents(ORG_ID, { source: 'webhook' })

    expect(mockEventFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ source: 'webhook' }),
      }),
    )
  })

  it('applies status filter', async () => {
    mockEventFindMany.mockResolvedValue([ev2])

    await EventService.listEvents(ORG_ID, { status: 'processed' })

    expect(mockEventFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ status: 'processed' }),
      }),
    )
  })

  it('applies date range filter', async () => {
    const from = new Date('2024-01-01')
    const to = new Date('2024-01-31')
    mockEventFindMany.mockResolvedValue([ev1])

    await EventService.listEvents(ORG_ID, { fromDate: from, toDate: to })

    expect(mockEventFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          receivedAt: { gte: from, lte: to },
        }),
      }),
    )
  })

  it('respects custom limit', async () => {
    mockEventFindMany.mockResolvedValue([ev1, ev2])

    await EventService.listEvents(ORG_ID, {}, { limit: 5 })

    expect(mockEventFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 6 }), // 5 + 1
    )
  })

  it('caps limit at 100', async () => {
    mockEventFindMany.mockResolvedValue([])

    await EventService.listEvents(ORG_ID, {}, { limit: 999 })

    expect(mockEventFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 101 }), // 100 + 1
    )
  })

  it('detects hasNextPage when more results than limit exist', async () => {
    // Return limit+1 items to signal there is a next page
    const items = [ev1, ev2, ev3]
    mockEventFindMany.mockResolvedValue(items) // 3 returned for limit=2

    const result = await EventService.listEvents(ORG_ID, {}, { limit: 2 })

    expect(result.data).toHaveLength(2) // truncated to limit
    expect(result.pagination.hasNextPage).toBe(true)
    expect(result.pagination.nextCursor).toBe(ev2.id)
  })

  it('returns nextCursor as null when no more pages', async () => {
    mockEventFindMany.mockResolvedValue([ev1]) // fewer than limit

    const result = await EventService.listEvents(ORG_ID, {}, { limit: 20 })

    expect(result.pagination.hasNextPage).toBe(false)
    expect(result.pagination.nextCursor).toBeNull()
  })

  it('passes cursor and skip when "after" is provided', async () => {
    mockEventFindMany.mockResolvedValue([ev2])

    await EventService.listEvents(ORG_ID, {}, { after: ev1.id })

    expect(mockEventFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        cursor: { id: ev1.id },
        skip: 1,
      }),
    )
  })

  it('returns empty data array when no events match', async () => {
    mockEventFindMany.mockResolvedValue([])

    const result = await EventService.listEvents(ORG_ID)

    expect(result.data).toHaveLength(0)
    expect(result.pagination.hasNextPage).toBe(false)
    expect(result.pagination.nextCursor).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// getEvent
// ---------------------------------------------------------------------------

describe('EventService.getEvent', () => {
  beforeEach(() => jest.clearAllMocks())

  it('returns the event when found', async () => {
    mockEventFindFirst.mockResolvedValue(ev1)

    const result = await EventService.getEvent(ORG_ID, ev1.id)

    expect(result).toMatchObject({ id: ev1.id })
    expect(mockEventFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: ev1.id, organizationId: ORG_ID },
      }),
    )
  })

  it('returns null when event not found', async () => {
    mockEventFindFirst.mockResolvedValue(null)

    const result = await EventService.getEvent(ORG_ID, 'missing-id')

    expect(result).toBeNull()
  })

  it('returns null for another orgs event (tenant isolation)', async () => {
    // Tenant middleware + findFirst with organizationId filter means
    // other-org events return null
    mockEventFindFirst.mockResolvedValue(null)

    const result = await EventService.getEvent('other-org-id', ev1.id)

    expect(result).toBeNull()
    expect(mockEventFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: ev1.id, organizationId: 'other-org-id' },
      }),
    )
  })
})
