/**
 * MetricHistoryCleanupWorker — Task 8.4
 *
 * Scheduled BullMQ job that deletes metric_history records older than 90 days.
 * Runs daily using a BullMQ repeatable job.
 *
 * Mechanism: BullMQ Queue + Worker with a repeatable job (metric-history-cleanup, every 24h).
 *   - Same pattern as OverdueWorker.ts.
 *   - repeat: { every: 24 * 60 * 60 * 1000 } (24 hours in ms)
 *   - removeOnComplete: { count: 7 } — keep last 7 completion records
 *   - removeOnFail: false — keep failed jobs for inspection
 *   - concurrency: 1 — only one cleanup at a time
 *
 * Requirements: 11.6
 */

import { Queue, Worker, type Job } from 'bullmq'
import type { ConnectionOptions } from 'bullmq'
import { prisma } from '@opscore/database'
import { logger } from '@opscore/logger'

const CLEANUP_QUEUE_NAME = 'metric-history-cleanup'
const CLEANUP_JOB_NAME = 'metric-history-cleanup'
const RETENTION_DAYS = 90

export { CLEANUP_QUEUE_NAME }

/**
 * Core logic: delete metric_history records where recorded_at < now() - 90 days.
 *
 * Returns the count of deleted records.
 */
export async function runMetricHistoryCleanup(): Promise<number> {
  const cutoffDate = new Date()
  cutoffDate.setDate(cutoffDate.getDate() - RETENTION_DAYS)

  logger.info(
    { queue: CLEANUP_QUEUE_NAME, cutoffDate: cutoffDate.toISOString(), retentionDays: RETENTION_DAYS },
    'Metric history cleanup started',
  )

  const result = await prisma.metricHistory.deleteMany({
    where: {
      recordedAt: { lt: cutoffDate },
    },
  })

  logger.info(
    { queue: CLEANUP_QUEUE_NAME, deletedCount: result.count, cutoffDate: cutoffDate.toISOString() },
    'Metric history cleanup completed',
  )

  return result.count
}

/**
 * Create and configure the BullMQ Queue + Worker for the metric-history-cleanup job.
 *
 * Registers a repeatable job that runs every 24 hours using BullMQ's job scheduler.
 *
 * @param connection  Redis connection options
 * @returns           Object with { queue, worker } for shutdown handling
 */
export function createMetricHistoryCleanupScheduler(connection: ConnectionOptions): {
  queue: Queue
  worker: Worker
} {
  const queue = new Queue(CLEANUP_QUEUE_NAME, { connection })

  // Register a daily repeatable job (BullMQ v5 API)
  void queue.add(
    CLEANUP_JOB_NAME,
    {},
    {
      repeat: { every: 24 * 60 * 60 * 1000 }, // 24 hours in milliseconds
      removeOnComplete: { count: 7 },
      removeOnFail: false,
    },
  )

  logger.info(
    { queue: CLEANUP_QUEUE_NAME, intervalMs: 24 * 60 * 60 * 1000 },
    'Metric history cleanup scheduler registered',
  )

  const worker = new Worker(
    CLEANUP_QUEUE_NAME,
    async (_job: Job) => {
      await runMetricHistoryCleanup()
    },
    {
      connection,
      concurrency: 1,
    },
  )

  worker.on('ready', () => {
    logger.info({ queue: CLEANUP_QUEUE_NAME }, 'MetricHistoryCleanupWorker ready')
  })

  worker.on('error', (error) => {
    logger.error({ queue: CLEANUP_QUEUE_NAME, err: error }, 'MetricHistoryCleanupWorker error')
  })

  return { queue, worker }
}
