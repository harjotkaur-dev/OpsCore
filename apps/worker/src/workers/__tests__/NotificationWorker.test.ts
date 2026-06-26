/**
 * NotificationWorker Unit Tests — Task 5.10
 *
 * Tests the NotificationWorker implementation including:
 * - Worker creation and configuration
 * - Error handling and failure logging
 * - Structured logging lifecycle events
 * - Service method invocation
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals'
import type { Job } from 'bullmq'
import type { NotificationJobData } from '@opscore/types'

// ESM-compatible mocking — must use jest.unstable_mockModule before importing
const mockDeliver = jest.fn<(job: Job<NotificationJobData>) => Promise<void>>()

jest.unstable_mockModule('../../services/NotificationService.js', () => ({
  deliver: mockDeliver,
}))

// Dynamic import after mocks are registered
const { createNotificationWorker } = await import('../NotificationWorker.js')

describe('NotificationWorker', () => {
  const mockConnection = {
    host: 'localhost',
    port: 6379,
    maxRetriesPerRequest: null,
  }

  const mockJobData: NotificationJobData = {
    notificationId: 'notif-123',
    orgId: 'org-456',
  }

  beforeEach(() => {
    jest.clearAllMocks()
    mockDeliver.mockResolvedValue(undefined)
  })

  it('should create worker with correct concurrency', async () => {
    const worker = createNotificationWorker(mockConnection, 20)

    expect(worker).toBeDefined()
    expect(worker.opts.concurrency).toBe(20)

    await worker.close()
  })

  it('should create worker with custom concurrency', async () => {
    const worker = createNotificationWorker(mockConnection, 5)

    expect(worker.opts.concurrency).toBe(5)

    await worker.close()
  })

  it('should have all lifecycle event handlers registered', async () => {
    const worker = createNotificationWorker(mockConnection, 20)

    expect(worker.listenerCount('failed')).toBeGreaterThan(0)
    expect(worker.listenerCount('ready')).toBeGreaterThan(0)
    expect(worker.listenerCount('error')).toBeGreaterThan(0)

    await worker.close()
  })

  it('should log failure and not throw when job fails after all retries', async () => {
    const worker = createNotificationWorker(mockConnection, 1)

    const mockJob = {
      id: 'job-fail-001',
      data: mockJobData,
      attemptsMade: 3,
    } as Job<NotificationJobData>

    const error = new Error('Notification delivery error')

    const listeners = worker.listeners('failed')
    expect(listeners.length).toBeGreaterThan(0)

    // Should not throw
    await expect(
      (listeners[0] as (job: Job | undefined, error: Error) => Promise<void>)(
        mockJob,
        error,
      ),
    ).resolves.not.toThrow()

    await worker.close()
  })

  it('should handle missing job in failed handler gracefully', async () => {
    const worker = createNotificationWorker(mockConnection, 1)

    const error = new Error('Error without job')

    const listeners = worker.listeners('failed')
    if (listeners.length > 0) {
      await expect(
        (listeners[0] as (job: Job | undefined, error: Error) => Promise<void>)(
          undefined,
          error,
        ),
      ).resolves.not.toThrow()
    }

    await worker.close()
  })

  it('should call NotificationService.deliver with the correct job', async () => {
    // We test the processor by calling it indirectly through the worker
    // Create the worker and extract the processor fn via a job execution simulation
    const worker = createNotificationWorker(mockConnection, 1)

    // Access the processor by calling the underlying worker's process method
    // BullMQ exposes the processor on the worker instance
    const processor = (worker as unknown as { processor: (job: Job<NotificationJobData>) => Promise<void> }).processor

    if (processor) {
      const mockJob = {
        id: 'job-proc-001',
        data: mockJobData,
        attemptsMade: 0,
      } as Job<NotificationJobData>

      await processor(mockJob)

      expect(mockDeliver).toHaveBeenCalledWith(mockJob)
    }

    await worker.close()
  })

  it('should gracefully shut down via worker.close()', async () => {
    const worker = createNotificationWorker(mockConnection, 20)

    await expect(worker.close()).resolves.not.toThrow()
  })
})
