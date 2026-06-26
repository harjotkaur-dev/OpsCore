/**
 * WorkflowWorker Unit Tests — Task 5.1
 *
 * Tests the WorkflowWorker implementation including:
 * - Worker creation and configuration
 * - Error handling and failure recording
 * - Structured logging
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals'
import type { Job } from 'bullmq'
import { ExecutionStatus, type WorkflowJobData } from '@opscore/types'

// ESM-compatible mocking — must use jest.unstable_mockModule before importing
const mockExecutionUpdate = jest.fn<(args: unknown) => Promise<unknown>>()
const mockWorkflowVersionFindUnique = jest.fn<(args: unknown) => Promise<unknown>>()
const mockEventFindUnique = jest.fn<(args: unknown) => Promise<unknown>>()

jest.unstable_mockModule('@opscore/database', () => ({
  prisma: {
    workflowVersion: {
      findUnique: mockWorkflowVersionFindUnique,
    },
    event: {
      findUnique: mockEventFindUnique,
    },
    execution: {
      update: mockExecutionUpdate,
    },
  },
}))

jest.unstable_mockModule('../actionHandlers/index.js', () => ({
  executeAction: jest.fn<() => Promise<void>>(),
}))

// Dynamic import after mocks are registered
const { createWorkflowWorker } = await import('../WorkflowWorker.js')

describe('WorkflowWorker', () => {
  const mockConnection = {
    host: 'localhost',
    port: 6379,
    maxRetriesPerRequest: null,
  }

  const mockJobData: WorkflowJobData = {
    workflowVersionId: 'wv-123',
    workflowId: 'wf-123',
    eventId: 'evt-123',
    executionId: 'exec-123',
    orgId: 'org-123',
    requestId: 'req-123',
  }

  beforeEach(() => {
    jest.clearAllMocks()
    mockExecutionUpdate.mockResolvedValue({})
    mockWorkflowVersionFindUnique.mockResolvedValue(null)
    mockEventFindUnique.mockResolvedValue(null)
  })

  it('should create worker with correct configuration', async () => {
    const worker = createWorkflowWorker(mockConnection, 10)

    expect(worker).toBeDefined()
    expect(worker.opts.concurrency).toBe(10)

    await worker.close()
  })

  it('should record error details when job fails after all retries', async () => {
    const worker = createWorkflowWorker(mockConnection, 1)

    const mockJob = {
      id: 'job-789',
      data: mockJobData,
      attemptsMade: 3,
    } as Job<WorkflowJobData>

    const error = new Error('Fatal execution error')

    // Call the failed handler directly through the listener
    const listeners = worker.listeners('failed')
    if (listeners.length > 0) {
      await (listeners[0] as (job: Job | undefined, error: Error) => Promise<void>)(
        mockJob,
        error,
      )
    }

    // Give time for async operations
    await new Promise((resolve) => setTimeout(resolve, 100))

    await worker.close()

    // Verify execution was updated with failed status and error details
    expect(mockExecutionUpdate).toHaveBeenCalledWith({
      where: { id: mockJobData.executionId },
      data: expect.objectContaining({
        status: ExecutionStatus.FAILED,
        errorDetail: 'Fatal execution error',
        attemptCount: 3,
      }),
    })
  })

  it('should handle missing job in failed handler gracefully', async () => {
    const worker = createWorkflowWorker(mockConnection, 1)

    const error = new Error('Error without job')

    // Call the failed handler with undefined job
    const listeners = worker.listeners('failed')
    if (listeners.length > 0) {
      await (listeners[0] as (job: Job | undefined, error: Error) => Promise<void>)(
        undefined,
        error,
      )
    }

    await new Promise((resolve) => setTimeout(resolve, 50))

    await worker.close()

    // Should not throw and should not call update
    expect(mockExecutionUpdate).not.toHaveBeenCalled()
  })

  it('should handle execution update failure in failed handler', async () => {
    const worker = createWorkflowWorker(mockConnection, 1)

    const mockJob = {
      id: 'job-fail',
      data: mockJobData,
      attemptsMade: 2,
    } as Job<WorkflowJobData>

    const error = new Error('Job error')

    // Mock update to fail
    mockExecutionUpdate.mockRejectedValueOnce(new Error('DB update failed'))

    // Should not throw even if update fails
    const listeners = worker.listeners('failed')
    if (listeners.length > 0) {
      await expect(
        (listeners[0] as (job: Job | undefined, error: Error) => Promise<void>)(
          mockJob,
          error,
        ),
      ).resolves.not.toThrow()
    }

    await new Promise((resolve) => setTimeout(resolve, 50))

    await worker.close()
  })

  it('should have worker lifecycle event handlers registered', async () => {
    const worker = createWorkflowWorker(mockConnection, 5)

    // Verify event handlers are registered
    expect(worker.listenerCount('failed')).toBeGreaterThan(0)
    expect(worker.listenerCount('ready')).toBeGreaterThan(0)
    expect(worker.listenerCount('error')).toBeGreaterThan(0)

    await worker.close()
  })

  it('should set completedAt in the execution update when job fails', async () => {
    const worker = createWorkflowWorker(mockConnection, 1)

    const mockJob = {
      id: 'job-999',
      data: mockJobData,
      attemptsMade: 3,
    } as Job<WorkflowJobData>

    const error = new Error('Timeout error')

    const listeners = worker.listeners('failed')
    if (listeners.length > 0) {
      await (listeners[0] as (job: Job | undefined, error: Error) => Promise<void>)(
        mockJob,
        error,
      )
    }

    await new Promise((resolve) => setTimeout(resolve, 100))
    await worker.close()

    expect(mockExecutionUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          completedAt: expect.any(Date),
        }),
      }),
    )
  })
})
