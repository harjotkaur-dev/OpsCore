/**
 * Unit tests for EventService (Task 3.1)
 *
 * ESM-native mocking via jest.unstable_mockModule + dynamic imports.
 */

import { jest, describe, it, expect, beforeEach } from '@jest/globals'

// ---------------------------------------------------------------------------
// Prisma mocks
// ---------------------------------------------------------------------------

const mockEventTypeFindFirst = jest.fn()
const mockEventTypeCreate = jest.fn()
const mockEventTypeUpdate = jest.fn()
const mockAuditCreate = jest.fn().mockResolvedValue({})

const mockTransaction = jest.fn(async (fn: (tx: unknown) => Promise<unknown>) =>
  fn({
    eventType: { create: mockEventTypeCreate, update: mockEventTypeUpdate },
    auditLog: { create: mockAuditCreate },
  }),
)

jest.unstable_mockModule('../../lib/prisma.js', () => ({
  prisma: {
    eventType: {
      findFirst: mockEventTypeFindFirst,
      findMany: jest.fn().mockResolvedValue([]),
      update: mockEventTypeUpdate,
    },
    $transaction: mockTransaction,
  },
  PrismaClient: jest.fn(),
}))

jest.unstable_mockModule('@prisma/client', () => ({
  Prisma: { JsonNull: 'JsonNull' },
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
const USER_ID = 'user-cccc-cccc-cccc-cccccccccccc'

const sampleSchema = { type: 'object', properties: { qty: { type: 'number' } } }

const sampleEventType = {
  id: ET_ID,
  organizationId: ORG_ID,
  name: 'order.placed',
  description: null,
  payloadSchema: sampleSchema,
  source: 'api',
  status: 'active',
  version: 1,
  createdBy: USER_ID,
  createdAt: new Date('2024-01-01'),
  updatedAt: new Date('2024-01-01'),
}

// ---------------------------------------------------------------------------
// createEventType
// ---------------------------------------------------------------------------

describe('EventService.createEventType', () => {
  beforeEach(() => jest.clearAllMocks())

  it('creates an event type and writes an audit log', async () => {
    mockEventTypeFindFirst.mockResolvedValue(null)
    mockEventTypeCreate.mockResolvedValue(sampleEventType)

    const result = await EventService.createEventType(
      ORG_ID,
      { name: 'order.placed', payloadSchema: sampleSchema, source: 'api' },
      { requestId: 'req-1', actorId: USER_ID },
    )

    expect(result).toMatchObject({ id: ET_ID, name: 'order.placed', status: 'active' })
    expect(mockTransaction).toHaveBeenCalledTimes(1)
    expect(mockAuditCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: 'created', entityType: 'event' }),
      }),
    )
  })

  it('throws 409 when name+version already exists in org', async () => {
    mockEventTypeFindFirst.mockResolvedValue(sampleEventType)

    await expect(
      EventService.createEventType(
        ORG_ID,
        { name: 'order.placed', payloadSchema: sampleSchema, source: 'api' },
        { actorId: USER_ID },
      ),
    ).rejects.toMatchObject({ statusCode: 409 })

    expect(mockTransaction).not.toHaveBeenCalled()
  })

  it('throws when actorId is missing', async () => {
    await expect(
      EventService.createEventType(
        ORG_ID,
        { name: 'x', payloadSchema: sampleSchema, source: 'api' },
        {},
      ),
    ).rejects.toThrow('actorId is required')
  })
})

// ---------------------------------------------------------------------------
// updateEventType
// ---------------------------------------------------------------------------

describe('EventService.updateEventType', () => {
  beforeEach(() => jest.clearAllMocks())

  it('updates and returns the event type', async () => {
    const updated = { ...sampleEventType, description: 'new desc' }
    mockEventTypeFindFirst
      .mockResolvedValueOnce(sampleEventType) // load existing
      .mockResolvedValueOnce(null)            // name conflict check (skipped — no name change)
    mockEventTypeUpdate.mockResolvedValue(updated)

    const result = await EventService.updateEventType(
      ORG_ID,
      ET_ID,
      { description: 'new desc' },
      { actorId: USER_ID },
    )

    expect(result).toMatchObject({ description: 'new desc' })
    expect(mockTransaction).toHaveBeenCalledTimes(1)
    expect(mockAuditCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: 'updated' }),
      }),
    )
  })

  it('throws 404 when event type not found', async () => {
    mockEventTypeFindFirst.mockResolvedValue(null)

    await expect(
      EventService.updateEventType(ORG_ID, 'missing', { name: 'x' }),
    ).rejects.toMatchObject({ statusCode: 404 })

    expect(mockTransaction).not.toHaveBeenCalled()
  })

  it('throws 409 when new name conflicts', async () => {
    const conflict = { ...sampleEventType, id: 'other-id', name: 'taken' }
    mockEventTypeFindFirst
      .mockResolvedValueOnce(sampleEventType) // load existing
      .mockResolvedValueOnce(conflict)        // name conflict found

    await expect(
      EventService.updateEventType(ORG_ID, ET_ID, { name: 'taken' }),
    ).rejects.toMatchObject({ statusCode: 409 })

    expect(mockTransaction).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// deprecateEventType
// ---------------------------------------------------------------------------

describe('EventService.deprecateEventType', () => {
  beforeEach(() => jest.clearAllMocks())

  it('sets status to deprecated and writes audit log', async () => {
    const deprecated = { ...sampleEventType, status: 'deprecated' }
    mockEventTypeFindFirst.mockResolvedValue(sampleEventType)
    mockEventTypeUpdate.mockResolvedValue(deprecated)

    const result = await EventService.deprecateEventType(ORG_ID, ET_ID, { actorId: USER_ID })

    expect(result).toMatchObject({ status: 'deprecated' })
    expect(mockTransaction).toHaveBeenCalledTimes(1)
    expect(mockAuditCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: 'status_changed' }),
      }),
    )
  })

  it('is idempotent — returns current record when already deprecated', async () => {
    const already = { ...sampleEventType, status: 'deprecated' }
    mockEventTypeFindFirst.mockResolvedValue(already)

    const result = await EventService.deprecateEventType(ORG_ID, ET_ID)

    expect(result).toMatchObject({ status: 'deprecated' })
    expect(mockTransaction).not.toHaveBeenCalled()
  })

  it('throws 404 when event type not found', async () => {
    mockEventTypeFindFirst.mockResolvedValue(null)

    await expect(
      EventService.deprecateEventType(ORG_ID, 'missing'),
    ).rejects.toMatchObject({ statusCode: 404 })
  })
})

// ---------------------------------------------------------------------------
// listEventTypes
// ---------------------------------------------------------------------------

describe('EventService.listEventTypes', () => {
  beforeEach(() => jest.clearAllMocks())

  it('returns event types with no filter', async () => {
    const list = [sampleEventType, { ...sampleEventType, id: 'et2', status: 'deprecated' }]
    const mockFindMany = jest.fn().mockResolvedValue(list)
    // Override module-level mock for this test
    const prismaModule = await import('../../lib/prisma.js')
    ;(prismaModule.prisma.eventType as { findMany: typeof mockFindMany }).findMany = mockFindMany

    const result = await EventService.listEventTypes(ORG_ID)
    expect(result).toHaveLength(2)
  })
})

// ---------------------------------------------------------------------------
// getEventType
// ---------------------------------------------------------------------------

describe('EventService.getEventType', () => {
  beforeEach(() => jest.clearAllMocks())

  it('returns the event type when found', async () => {
    mockEventTypeFindFirst.mockResolvedValue(sampleEventType)

    const result = await EventService.getEventType(ORG_ID, ET_ID)

    expect(result).toMatchObject({ id: ET_ID })
    expect(mockEventTypeFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: ET_ID, organizationId: ORG_ID } }),
    )
  })

  it('returns null when not found', async () => {
    mockEventTypeFindFirst.mockResolvedValue(null)
    const result = await EventService.getEventType(ORG_ID, 'missing')
    expect(result).toBeNull()
  })
})
