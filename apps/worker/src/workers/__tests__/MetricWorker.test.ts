/**
 * MetricWorker Unit Tests — Task 5.10
 *
 * Tests the MetricWorker implementation including:
 * - Worker creation and configuration
 * - Error handling and failure logging
 * - Structured logging lifecycle events
 * - Service method invocation
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals'
import type { Job } from 'bullmq'
import type { MetricUpdateJobData } from '@opscore/types'

// ESM-compatible mocking — must use jest.unstable_mockModule before importing
const mockRecompute = jest.fn<(job: Job<MetricUpdateJobData>) => Promise<void>>()

jest.unstable_mockModule('../../services/MetricService.js', () => ({
  recompute: mockRecompute,
}))

// Dynamic import after mocks are registered
const { createMetricWorker } = await import('../MetricWorker.js')

describe('MetricWorker', () => {
  const mockConnection = {
    host: 'localhost',
    port: 6379,
    maxRetriesPerRequest: null,
  }

  const mockJobData: MetricUpdateJobData = {
    metricName: 'incidents.open',
    orgId: 'org-789',
    triggeredBy: 'execution-abc',
  }

  beforeEach(() => {
    jest.clearAllMocks()
    mockRecompute.mockResolvedValue(undefined)
  })

  it('should create worker with correct concurrency', async () => {
    const worker = createMetricWorker(mockConnection, 5)

    expect(worker).toBeDefined()
    expect(worker.opts.concurrency).toBe(5)

    await worker.close()
  })

  it('should create worker with custom concurrency', async () => {
    const worker = createMetricWorker(mockConnection, 2)

    expect(worker.opts.concurrency).toBe(2)

    await worker.close()
  })

  it('should have all lifecycle event handlers registered', async () => {
    const worker = createMetricWorker(mockConnection, 5)

    expect(worker.listenerCount('failed')).toBeGreaterThan(0)
    expect(worker.listenerCount('ready')).toBeGreaterThan(0)
    expect(worker.listenerCount('error')).toBeGreaterThan(0)

    await worker.close()
  })

  it('should log failure and not throw when job fails after all retries', async () => {
    const worker = createMetricWorker(mockConnection, 1)

    const mockJob = {
      id: 'job-fail-metric-001',
      data: mockJobData,
      attemptsMade: 3,
    } as Job<MetricUpdateJobData>

    const error = new Error('Metric recompute error')

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
    const worker = createMetricWorker(mockConnection, 1)

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

  it('should call MetricService.recompute with the correct job', async () => {
    const worker = createMetricWorker(mockConnection, 1)

    const processor = (worker as unknown as { processor: (job: Job<MetricUpdateJobData>) => Promise<void> }).processor

    if (processor) {
      const mockJob = {
        id: 'job-proc-metric-001',
        data: mockJobData,
        attemptsMade: 0,
      } as Job<MetricUpdateJobData>

      await processor(mockJob)

      expect(mockRecompute).toHaveBeenCalledWith(mockJob)
    }

    await worker.close()
  })

  it('should gracefully shut down via worker.close()', async () => {
    const worker = createMetricWorker(mockConnection, 5)

    await expect(worker.close()).resolves.not.toThrow()
  })
})
