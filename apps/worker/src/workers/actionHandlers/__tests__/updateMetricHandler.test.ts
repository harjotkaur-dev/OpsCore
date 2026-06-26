/**
 * updateMetricHandler unit tests
 *
 * Tests metric update job enqueueing, idempotent job IDs, and queue targeting.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals'
import type { ActionExecutionContext } from '../index.js'

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockQueueAdd = jest.fn<(name: string, data: unknown, opts?: unknown) => Promise<unknown>>()
const MockQueue = jest.fn().mockImplementation(() => ({ add: mockQueueAdd }))

jest.unstable_mockModule('bullmq', () => ({
  Queue: MockQueue,
}))

jest.unstable_mockModule('@opscore/config', () => ({
  config: { REDIS_URL: 'redis://localhost:6379' },
}))

// The moduleNameMapper strips .js → .ts so we mock the TS path
jest.unstable_mockModule('../../lib/redis', () => ({
  parseRedisConnectionOptions: jest.fn().mockReturnValue({ host: 'localhost', port: 6379 }),
}))

const { updateMetricHandler } = await import('../updateMetricHandler.js')

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeContext(overrides: Partial<ActionExecutionContext> = {}): ActionExecutionContext {
  return {
    actionType: 'update_metric',
    config: {
      metric_name: 'total_tasks_created',
      operation: 'increment',
      value: 1,
    },
    event: {
      id: 'evt-001',
      eventTypeId: 'et-001',
      payload: {},
      source: 'api',
    },
    executionId: 'exec-002',
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
// Tests
// ---------------------------------------------------------------------------

describe('updateMetricHandler', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockQueueAdd.mockResolvedValue({})
  })

  it('configures metric-updates queue with correct retry policy (attempts=2, fixed backoff 1000ms, removeOnFail=false)', async () => {
    const ctx = makeContext()
    await updateMetricHandler(ctx)

    // MockQueue was instantiated — check the defaultJobOptions passed to the constructor
    expect(MockQueue).toHaveBeenCalledWith(
      'metric-updates',
      expect.objectContaining({
        defaultJobOptions: expect.objectContaining({
          attempts: 2,
          backoff: { type: 'fixed', delay: 1000 },
          removeOnFail: false,
        }),
      }),
    )
  })

  it('enqueues a job to the metric-updates queue', async () => {
    const ctx = makeContext()
    await updateMetricHandler(ctx)

    expect(mockQueueAdd).toHaveBeenCalledWith(
      'update-metric',
      expect.objectContaining({ metricName: 'total_tasks_created', orgId: 'org-001' }),
      expect.anything(),
    )
  })

  it('uses a deterministic job id based on executionId and orderIndex', async () => {
    const ctx = makeContext()
    await updateMetricHandler(ctx)

    expect(mockQueueAdd).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ jobId: 'metric:exec-002:0' }),
    )
  })

  it('includes triggeredBy referencing the executionId', async () => {
    const ctx = makeContext()
    await updateMetricHandler(ctx)

    expect(mockQueueAdd).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        triggeredBy: 'workflow_action::exec-002',
      }),
      expect.anything(),
    )
  })

  it('passes operation and value in the job payload', async () => {
    const ctx = makeContext({
      config: {
        metric_name: 'custom_metric',
        operation: 'set',
        value: 42,
      },
    })
    await updateMetricHandler(ctx)

    expect(mockQueueAdd).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ operation: 'set', value: 42 }),
      expect.anything(),
    )
  })

  it('produces unique job IDs across different executions', async () => {
    const ctx1 = makeContext({ executionId: 'exec-A', orderIndex: 0 })
    const ctx2 = makeContext({ executionId: 'exec-B', orderIndex: 0 })

    await updateMetricHandler(ctx1)
    await updateMetricHandler(ctx2)

    const calls = mockQueueAdd.mock.calls
    const jobId1 = (calls[0]?.[2] as { jobId: string }).jobId
    const jobId2 = (calls[1]?.[2] as { jobId: string }).jobId
    expect(jobId1).not.toBe(jobId2)
  })
})
