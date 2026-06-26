/**
 * Unit tests for EventService.ingest — Task 3.5
 *
 * Tests cover:
 *  - Happy path: new event persisted, idempotency key stored
 *  - Duplicate completed key: original response returned, no re-processing
 *  - In-flight key (from checkKey): 409 thrown immediately
 *  - In-flight race (setKeyInFlight returns false): 409 thrown
 *  - Event type not found: 404 thrown
 *  - Deprecated event type: 422 thrown
 *  - Schema validation failure: 422 with validationErrors attached
 */

import { jest, describe, it, expect, beforeEach } from '@jest/globals'

// ---------------------------------------------------------------------------
// Mock prisma
// ---------------------------------------------------------------------------

const mockEventTypeFindFirst = jest.fn()
const mockEventCreate = jest.fn()
const mockAuditCreate = jest.fn().mockResolvedValue({})

const mockTransaction = jest.fn(async (fn: (tx: unknown) => Promise<unknown>) =>
  fn({
    event: { create: mockEventCreate },
    auditLog: { create: mockAuditCreate },
  }),
)

jest.unstable_mockModule('../../lib/prisma.js', () => ({
  prisma: {
    eventType: { findFirst: mockEventTypeFindFirst },
    workflowVersion: { findMany: jest.fn().mockResolvedValue([]) }, // no matching workflows
    execution: { update: jest.fn().mockResolvedValue({}) },
    $transaction: mockTransaction,
  },
  PrismaClient: jest.fn(),
}))

jest.unstable_mockModule('@prisma/client', () => ({
  Prisma: { JsonNull: 'JsonNull', InputJsonValue: {} },
}))

// ---------------------------------------------------------------------------
// Mock idempotency helpers
// ---------------------------------------------------------------------------

const mockCheckKey = jest.fn()
const mockSetKeyInFlight = jest.fn()
const mockSetKeyCompleted = jest.fn()
const mockComputeSystemKey = jest.fn().mockReturnValue('computed-system-key')

jest.unstable_mockModule('../../lib/idempotency.js', () => ({
  checkKey: mockCheckKey,
  setKeyInFlight: mockSetKeyInFlight,
  setKeyCompleted: mockSetKeyCompleted,
  computeSystemKey: mockComputeSystemKey,
}))

// ---------------------------------------------------------------------------
// Mock schema validator
// ---------------------------------------------------------------------------

const mockValidate = jest.fn()
const mockClearCache = jest.fn()

jest.unstable_mockModule('../../lib/schemaValidator.js', () => ({
  validate: mockValidate,
  clearCache: mockClearCache,
  cacheSize: jest.fn().mockReturnValue(0),
}))

// Mock ruleEvaluator and ExecutionService so matchWorkflows is a no-op in these tests
jest.unstable_mockModule('../../lib/ruleEvaluator.js', () => ({
  evaluateRule: jest.fn().mockReturnValue(false), // no rules pass → no executions
  validateExpression: jest.fn().mockReturnValue(true),
  ExpressionSyntaxError: class ExpressionSyntaxError extends Error {},
}))

jest.unstable_mockModule('../ExecutionService.js', () => ({
  ExecutionService: { enqueueJob: jest.fn().mockResolvedValue({}) },
}))

// Dynamic import AFTER all mocks
const { EventService } = await import('../EventService.js')

// ---------------------------------------------------------------------------
// Sample data
// ---------------------------------------------------------------------------

const ORG_ID = 'org-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
const ET_ID = 'et-bbbb-bbbb-bbbb-bbbbbbbbbbbb'
const USER_ID = 'user-cccc-cccc-cccc-cccccccccccc'

const sampleSchema = { type: 'object', properties: { qty: { type: 'number' } } }

const sampleEventType = {
  id: ET_ID,
  organizationId: ORG_ID,
  name: 'order.placed',
  payloadSchema: sampleSchema,
  source: 'api',
  status: 'active',
  version: 1,
}

const sampleEvent = {
  id: 'ev-dddd-dddd-dddd-dddddddddddd',
  organizationId: ORG_ID,
  eventTypeId: ET_ID,
  source: 'api',
  payload: { qty: 5 },
  idempotencyKey: 'computed-system-key',
  status: 'received',
  receivedAt: new Date('2024-01-01'),
  processedAt: null,
}

const baseInput = {
  eventTypeId: ET_ID,
  source: 'api' as const,
  payload: { qty: 5 },
}

// ---------------------------------------------------------------------------
// Happy path
// ---------------------------------------------------------------------------

describe('EventService.ingest — happy path', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockCheckKey.mockResolvedValue(null)           // no existing key
    mockSetKeyInFlight.mockResolvedValue(true)     // claim succeeded
    mockEventTypeFindFirst.mockResolvedValue(sampleEventType)
    mockValidate.mockReturnValue({ valid: true, errors: [] })
    mockEventCreate.mockResolvedValue(sampleEvent)
    mockSetKeyCompleted.mockResolvedValue(undefined)
  })

  it('persists the event and returns the created record', async () => {
    const result = await EventService.ingest(ORG_ID, baseInput, { actorId: USER_ID })

    expect(result).toMatchObject({ id: sampleEvent.id, status: 'received' })
    expect(mockTransaction).toHaveBeenCalledTimes(1)
    expect(mockEventCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          organizationId: ORG_ID,
          eventTypeId: ET_ID,
          source: 'api',
          status: 'received',
        }),
      }),
    )
  })

  it('writes an audit log entry in the same transaction', async () => {
    await EventService.ingest(ORG_ID, baseInput, { actorId: USER_ID })

    expect(mockAuditCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          organizationId: ORG_ID,
          entityType: 'event',
          action: 'created',
        }),
      }),
    )
  })

  it('marks the idempotency key as completed after transaction', async () => {
    await EventService.ingest(ORG_ID, baseInput, { actorId: USER_ID })

    expect(mockSetKeyCompleted).toHaveBeenCalledWith(
      ORG_ID,
      'computed-system-key',
      201,
      sampleEvent,
    )
  })

  it('uses client-supplied idempotency key when provided', async () => {
    const clientKey = 'client-uuid-key-1234'
    await EventService.ingest(ORG_ID, { ...baseInput, idempotencyKey: clientKey }, {})

    // computeSystemKey should NOT be called when client key is present
    expect(mockComputeSystemKey).not.toHaveBeenCalled()
    // setKeyInFlight called with the client key
    expect(mockSetKeyInFlight).toHaveBeenCalledWith(ORG_ID, clientKey)
  })

  it('computes system key when no client key is provided', async () => {
    await EventService.ingest(ORG_ID, baseInput, {})

    expect(mockComputeSystemKey).toHaveBeenCalledWith(ORG_ID, ET_ID, 'api', baseInput.payload)
    expect(mockSetKeyInFlight).toHaveBeenCalledWith(ORG_ID, 'computed-system-key')
  })
})

// ---------------------------------------------------------------------------
// Idempotency — duplicate completed
// ---------------------------------------------------------------------------

describe('EventService.ingest — completed duplicate', () => {
  it('returns cached response body without re-processing when key is already completed', async () => {
    jest.clearAllMocks()
    mockCheckKey.mockResolvedValue({
      status: 'completed',
      responseStatus: 201,
      responseBody: sampleEvent,
    })

    const result = await EventService.ingest(ORG_ID, baseInput, { actorId: USER_ID })

    // Returns the cached event directly
    expect(result).toMatchObject({ id: sampleEvent.id })
    // No DB writes
    expect(mockTransaction).not.toHaveBeenCalled()
    expect(mockSetKeyInFlight).not.toHaveBeenCalled()
    expect(mockSetKeyCompleted).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// Idempotency — in-flight conflict
// ---------------------------------------------------------------------------

describe('EventService.ingest — in-flight conflict', () => {
  it('throws 409 when checkKey returns in-flight status', async () => {
    jest.clearAllMocks()
    mockCheckKey.mockResolvedValue({ status: 'in_flight' })

    await expect(EventService.ingest(ORG_ID, baseInput, {})).rejects.toMatchObject({
      statusCode: 409,
    })

    expect(mockSetKeyInFlight).not.toHaveBeenCalled()
    expect(mockTransaction).not.toHaveBeenCalled()
  })

  it('throws 409 when setKeyInFlight returns false (race condition)', async () => {
    jest.clearAllMocks()
    mockCheckKey.mockResolvedValue(null)
    mockSetKeyInFlight.mockResolvedValue(false) // lost the race

    await expect(EventService.ingest(ORG_ID, baseInput, {})).rejects.toMatchObject({
      statusCode: 409,
    })

    expect(mockTransaction).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// Event type validation
// ---------------------------------------------------------------------------

describe('EventService.ingest — event type validation', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockCheckKey.mockResolvedValue(null)
    mockSetKeyInFlight.mockResolvedValue(true)
  })

  it('throws 404 when event type is not found', async () => {
    mockEventTypeFindFirst.mockResolvedValue(null)

    await expect(EventService.ingest(ORG_ID, baseInput, {})).rejects.toMatchObject({
      statusCode: 404,
    })

    expect(mockTransaction).not.toHaveBeenCalled()
  })

  it('throws 422 when event type is deprecated', async () => {
    mockEventTypeFindFirst.mockResolvedValue({ ...sampleEventType, status: 'deprecated' })

    await expect(EventService.ingest(ORG_ID, baseInput, {})).rejects.toMatchObject({
      statusCode: 422,
    })

    expect(mockTransaction).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// Schema validation
// ---------------------------------------------------------------------------

describe('EventService.ingest — schema validation', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockCheckKey.mockResolvedValue(null)
    mockSetKeyInFlight.mockResolvedValue(true)
    mockEventTypeFindFirst.mockResolvedValue(sampleEventType)
  })

  it('throws 422 with validationErrors when payload fails schema', async () => {
    mockValidate.mockReturnValue({
      valid: false,
      errors: [{ field: '/qty', message: '/qty must be a number' }],
    })

    const err = await EventService.ingest(ORG_ID, baseInput, {}).catch((e) => e)

    expect(err.statusCode).toBe(422)
    expect(err.validationErrors).toHaveLength(1)
    expect(err.validationErrors[0].field).toBe('/qty')
    expect(mockTransaction).not.toHaveBeenCalled()
  })

  it('proceeds when payload passes schema validation', async () => {
    mockValidate.mockReturnValue({ valid: true, errors: [] })
    mockEventCreate.mockResolvedValue(sampleEvent)
    mockSetKeyCompleted.mockResolvedValue(undefined)

    await expect(EventService.ingest(ORG_ID, baseInput, {})).resolves.toMatchObject({
      id: sampleEvent.id,
    })

    expect(mockTransaction).toHaveBeenCalledTimes(1)
  })
})
