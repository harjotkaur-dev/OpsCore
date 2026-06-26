/**
 * Unit tests for ExecutionService — Task 5.7
 *
 * Covers:
 *  - listExecutions with various filters
 *  - getExecution (found + not found)
 *  - listFailedJobs with filters
 *  - retryJob: success (failed → new queued)
 *  - retryJob: reject non-failed status (running, queued, completed)
 *  - retryJob: reject wrong org (execution not found)
 */

import { jest, describe, it, expect, beforeEach } from '@jest/globals'

// ---------------------------------------------------------------------------
// Prisma mocks
// ---------------------------------------------------------------------------

const mockExecutionFindFirst = jest.fn()
const mockExecutionFindMany = jest.fn()
const mockExecutionCreate = jest.fn()
const mockExecutionUpdate = jest.fn()
const mockAuditLogCreate = jest.fn().mockResolvedValue({})

jest.unstable_mockModule('../../lib/prisma.js', () => ({
  prisma: {
    execution: {
      findFirst: mockExecutionFindFirst,
      findMany: mockExecutionFindMany,
      create: mockExecutionCreate,
      update: mockExecutionUpdate,
    },
    auditLog: {
      create: mockAuditLogCreate,
    },
    $transaction: jest.fn(async (fn: (tx: unknown) => Promise<unknown>) =>
      fn({
        execution: {
          create: mockExecutionCreate,
          update: mockExecutionUpdate,
        },
      }),
    ),
  },
  PrismaClient: jest.fn(),
}))

// ---------------------------------------------------------------------------
// BullMQ queue mock
// ---------------------------------------------------------------------------

const mockQueueAdd = jest.fn()

jest.unstable_mockModule('../../lib/queue.js', () => ({
  workflowQueue: {
    add: mockQueueAdd,
    getJobCounts: jest.fn(),
  },
  notificationsQueue: {
    add: jest.fn(),
    getJobCounts: jest.fn().mockResolvedValue({ waiting: 0, active: 0, completed: 0, failed: 0, delayed: 0 }),
  },
  metricUpdatesQueue: {
    add: jest.fn(),
    getJobCounts: jest.fn().mockResolvedValue({ waiting: 0, active: 0, completed: 0, failed: 0, delayed: 0 }),
  },
  createQueue: jest.fn(),
}))

// ---------------------------------------------------------------------------
// Redis mock (for getQueueDepth cache)
// ---------------------------------------------------------------------------

const mockRedisGet = jest.fn()
const mockRedisSet = jest.fn()

jest.unstable_mockModule('../../lib/redis.js', () => ({
  redisClient: {
    get: mockRedisGet,
    set: mockRedisSet,
  },
  default: {
    get: mockRedisGet,
    set: mockRedisSet,
  },
  parseRedisConnectionOptions: jest.fn(),
}))

// ---------------------------------------------------------------------------
// Load module under test
// ---------------------------------------------------------------------------

const { ExecutionService } = await import('../ExecutionService.js')

// ---------------------------------------------------------------------------
// Sample data
// ---------------------------------------------------------------------------

const ORG_ID = 'org-1111-1111-1111-111111111111'
const OTHER_ORG_ID = 'org-9999-9999-9999-999999999999'
const EXECUTION_ID = 'exec-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
const WORKFLOW_VERSION_ID = 'wver-bbbb-bbbb-bbbb-bbbbbbbbbbbb'
const WORKFLOW_ID = 'wf-cccc-cccc-cccc-cccccccccccc'
const EVENT_ID = 'evt-dddd-dddd-dddd-dddddddddddd'

const sampleExecution = {
  id: EXECUTION_ID,
  organizationId: ORG_ID,
  workflowVersionId: WORKFLOW_VERSION_ID,
  eventId: EVENT_ID,
  jobId: EXECUTION_ID,
  queueName: 'workflow-exec',
  status: 'failed',
  attemptCount: 3,
  errorDetail: 'Timeout error: connection refused',
  startedAt: new Date('2024-06-01T10:00:00Z'),
  completedAt: new Date('2024-06-01T10:05:00Z'),
  createdAt: new Date('2024-06-01T10:00:00Z'),
  workflowVersion: {
    workflowId: WORKFLOW_ID,
    version: 1,
  },
}

const newQueuedExecution = {
  id: 'exec-new-new-new-new-newnewnewnew',
  organizationId: ORG_ID,
  workflowVersionId: WORKFLOW_VERSION_ID,
  eventId: EVENT_ID,
  jobId: 'exec-new-new-new-new-newnewnewnew',
  queueName: 'workflow-exec',
  status: 'queued',
  attemptCount: 0,
  errorDetail: null,
  startedAt: null,
  completedAt: null,
  createdAt: new Date('2024-06-01T11:00:00Z'),
}

// ---------------------------------------------------------------------------
// listExecutions
// ---------------------------------------------------------------------------

describe('ExecutionService.listExecutions', () => {
  beforeEach(() => jest.clearAllMocks())

  it('returns executions for the org with default limit', async () => {
    mockExecutionFindMany.mockResolvedValue([sampleExecution])

    const result = await ExecutionService.listExecutions(ORG_ID)

    expect(mockExecutionFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ organizationId: ORG_ID }),
        take: 21, // default 20 + 1 for has-more detection
        orderBy: { createdAt: 'desc' },
      }),
    )
    expect(result.data).toHaveLength(1)
    expect(result.meta.hasMore).toBe(false)
    expect(result.meta.nextCursor).toBeNull()
  })

  it('applies status filter', async () => {
    mockExecutionFindMany.mockResolvedValue([])

    await ExecutionService.listExecutions(ORG_ID, { status: 'failed' })

    expect(mockExecutionFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ status: 'failed' }),
      }),
    )
  })

  it('applies workflowId filter via workflowVersion relation', async () => {
    mockExecutionFindMany.mockResolvedValue([])

    await ExecutionService.listExecutions(ORG_ID, { workflowId: WORKFLOW_ID })

    expect(mockExecutionFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          workflowVersion: { workflowId: WORKFLOW_ID },
        }),
      }),
    )
  })

  it('applies date range filter', async () => {
    mockExecutionFindMany.mockResolvedValue([])

    const fromDate = new Date('2024-01-01')
    const toDate = new Date('2024-12-31')

    await ExecutionService.listExecutions(ORG_ID, { fromDate, toDate })

    expect(mockExecutionFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          createdAt: { gte: fromDate, lte: toDate },
        }),
      }),
    )
  })

  it('applies cursor pagination via after param', async () => {
    mockExecutionFindMany.mockResolvedValue([])

    await ExecutionService.listExecutions(ORG_ID, { after: EXECUTION_ID })

    expect(mockExecutionFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: { gt: EXECUTION_ID } }),
      }),
    )
  })

  it('clamps limit to max 100', async () => {
    mockExecutionFindMany.mockResolvedValue([])

    await ExecutionService.listExecutions(ORG_ID, { limit: 999 })

    expect(mockExecutionFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 101 }), // max 100 + 1
    )
  })

  it('sets hasMore=true and returns nextCursor when more results exist', async () => {
    // Return 21 items for a limit=20 query → triggers hasMore
    const items = Array.from({ length: 21 }, (_, i) => ({
      ...sampleExecution,
      id: `exec-${String(i).padStart(4, '0')}`,
    }))
    mockExecutionFindMany.mockResolvedValue(items)

    const result = await ExecutionService.listExecutions(ORG_ID, { limit: 20 })

    expect(result.data).toHaveLength(20)
    expect(result.meta.hasMore).toBe(true)
    expect(result.meta.nextCursor).toBe('exec-0019')
  })
})

// ---------------------------------------------------------------------------
// getExecution
// ---------------------------------------------------------------------------

describe('ExecutionService.getExecution', () => {
  beforeEach(() => jest.clearAllMocks())

  it('returns execution when found for the correct org', async () => {
    mockExecutionFindFirst.mockResolvedValue(sampleExecution)

    const result = await ExecutionService.getExecution(ORG_ID, EXECUTION_ID)

    expect(result).toMatchObject({ id: EXECUTION_ID, organizationId: ORG_ID })
    expect(mockExecutionFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: EXECUTION_ID, organizationId: ORG_ID },
      }),
    )
  })

  it('returns null when execution not found', async () => {
    mockExecutionFindFirst.mockResolvedValue(null)

    const result = await ExecutionService.getExecution(ORG_ID, 'missing-id')

    expect(result).toBeNull()
  })

  it('returns null when execution belongs to different org', async () => {
    // Prisma WHERE includes organizationId so it returns null for wrong org
    mockExecutionFindFirst.mockResolvedValue(null)

    const result = await ExecutionService.getExecution(OTHER_ORG_ID, EXECUTION_ID)

    expect(result).toBeNull()
    expect(mockExecutionFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: EXECUTION_ID, organizationId: OTHER_ORG_ID },
      }),
    )
  })
})

// ---------------------------------------------------------------------------
// listFailedJobs
// ---------------------------------------------------------------------------

describe('ExecutionService.listFailedJobs', () => {
  beforeEach(() => jest.clearAllMocks())

  it('always filters by status=failed', async () => {
    mockExecutionFindMany.mockResolvedValue([sampleExecution])

    await ExecutionService.listFailedJobs(ORG_ID)

    expect(mockExecutionFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ status: 'failed', organizationId: ORG_ID }),
      }),
    )
  })

  it('applies workflowId filter', async () => {
    mockExecutionFindMany.mockResolvedValue([])

    await ExecutionService.listFailedJobs(ORG_ID, { workflowId: WORKFLOW_ID })

    expect(mockExecutionFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          workflowVersion: { workflowId: WORKFLOW_ID },
        }),
      }),
    )
  })

  it('applies errorType partial match filter', async () => {
    mockExecutionFindMany.mockResolvedValue([])

    await ExecutionService.listFailedJobs(ORG_ID, { errorType: 'Timeout' })

    expect(mockExecutionFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          errorDetail: { contains: 'Timeout', mode: 'insensitive' },
        }),
      }),
    )
  })

  it('applies date range filter', async () => {
    mockExecutionFindMany.mockResolvedValue([])

    const fromDate = new Date('2024-01-01')
    const toDate = new Date('2024-06-30')

    await ExecutionService.listFailedJobs(ORG_ID, { fromDate, toDate })

    expect(mockExecutionFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          createdAt: { gte: fromDate, lte: toDate },
        }),
      }),
    )
  })

  it('returns paginated result with hasMore flag', async () => {
    const items = Array.from({ length: 21 }, (_, i) => ({
      ...sampleExecution,
      id: `exec-failed-${String(i).padStart(3, '0')}`,
    }))
    mockExecutionFindMany.mockResolvedValue(items)

    const result = await ExecutionService.listFailedJobs(ORG_ID, { limit: 20 })

    expect(result.data).toHaveLength(20)
    expect(result.meta.hasMore).toBe(true)
    expect(result.meta.nextCursor).toBe('exec-failed-019')
  })
})

// ---------------------------------------------------------------------------
// retryJob
// ---------------------------------------------------------------------------

describe('ExecutionService.retryJob', () => {
  beforeEach(() => jest.clearAllMocks())

  it('creates a new queued execution and enqueues to BullMQ on success', async () => {
    mockExecutionFindFirst.mockResolvedValue(sampleExecution)
    mockExecutionCreate.mockResolvedValue(newQueuedExecution)
    mockQueueAdd.mockResolvedValue({ id: newQueuedExecution.id })
    mockExecutionUpdate.mockResolvedValue(newQueuedExecution)

    const result = await ExecutionService.retryJob(ORG_ID, EXECUTION_ID)

    // Should create a new execution with queued status and reset attempt count
    expect(mockExecutionCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          organizationId: ORG_ID,
          workflowVersionId: WORKFLOW_VERSION_ID,
          eventId: EVENT_ID,
          status: 'queued',
          attemptCount: 0,
          queueName: 'workflow-exec',
        }),
      }),
    )

    // Should enqueue to BullMQ with correct job data
    expect(mockQueueAdd).toHaveBeenCalledWith(
      'workflow-exec',
      expect.objectContaining({
        workflowVersionId: WORKFLOW_VERSION_ID,
        workflowId: WORKFLOW_ID,
        eventId: EVENT_ID,
        executionId: newQueuedExecution.id,
        orgId: ORG_ID,
      }),
      expect.objectContaining({ jobId: newQueuedExecution.id }),
    )

    expect(result).toMatchObject({ status: 'queued', attemptCount: 0 })
  })

  it('throws 404 when execution not found', async () => {
    mockExecutionFindFirst.mockResolvedValue(null)

    await expect(ExecutionService.retryJob(ORG_ID, 'missing-id')).rejects.toMatchObject({
      statusCode: 404,
    })

    expect(mockExecutionCreate).not.toHaveBeenCalled()
    expect(mockQueueAdd).not.toHaveBeenCalled()
  })

  it('throws 404 when execution belongs to a different org', async () => {
    // findFirst with wrong orgId returns null (enforced by WHERE clause)
    mockExecutionFindFirst.mockResolvedValue(null)

    await expect(ExecutionService.retryJob(OTHER_ORG_ID, EXECUTION_ID)).rejects.toMatchObject({
      statusCode: 404,
    })
  })

  it('throws 422 when status is running', async () => {
    mockExecutionFindFirst.mockResolvedValue({ ...sampleExecution, status: 'running' })

    await expect(ExecutionService.retryJob(ORG_ID, EXECUTION_ID)).rejects.toMatchObject({
      statusCode: 422,
    })

    expect(mockExecutionCreate).not.toHaveBeenCalled()
    expect(mockQueueAdd).not.toHaveBeenCalled()
  })

  it('throws 422 when status is queued', async () => {
    mockExecutionFindFirst.mockResolvedValue({ ...sampleExecution, status: 'queued' })

    await expect(ExecutionService.retryJob(ORG_ID, EXECUTION_ID)).rejects.toMatchObject({
      statusCode: 422,
    })
  })

  it('throws 422 when status is completed', async () => {
    mockExecutionFindFirst.mockResolvedValue({ ...sampleExecution, status: 'completed' })

    await expect(ExecutionService.retryJob(ORG_ID, EXECUTION_ID)).rejects.toMatchObject({
      statusCode: 422,
    })
  })

  it('error message for non-failed status mentions the current status', async () => {
    mockExecutionFindFirst.mockResolvedValue({ ...sampleExecution, status: 'running' })

    const err = await ExecutionService.retryJob(ORG_ID, EXECUTION_ID).catch((e) => e)

    expect(err.message).toContain('running')
  })

  it('preserves workflowVersionId and eventId from the original execution', async () => {
    mockExecutionFindFirst.mockResolvedValue(sampleExecution)
    mockExecutionCreate.mockResolvedValue(newQueuedExecution)
    mockQueueAdd.mockResolvedValue({ id: newQueuedExecution.id })
    mockExecutionUpdate.mockResolvedValue(newQueuedExecution)

    await ExecutionService.retryJob(ORG_ID, EXECUTION_ID)

    expect(mockExecutionCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          workflowVersionId: sampleExecution.workflowVersionId,
          eventId: sampleExecution.eventId,
        }),
      }),
    )
  })
})
