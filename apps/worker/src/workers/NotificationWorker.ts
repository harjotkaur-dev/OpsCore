/**
 * NotificationWorker — Task 5.10
 *
 * BullMQ Worker that processes notification delivery jobs from the 'notifications' queue.
 *
 * Lifecycle:
 * 1. Receive NotificationJobData from the queue
 * 2. Delegate to NotificationService.deliver (Phase 9 fan-out implementation)
 * 3. Emit structured lifecycle logs on every state transition
 *
 * Emits structured Pino logs on every state transition:
 * - { job_id, queue, transition, organization_id }
 *
 * Requirements: 6.2
 */

import { Worker, type Job } from 'bullmq'
import type { ConnectionOptions } from 'bullmq'
import { logger } from '@opscore/logger'
import { QueueName, type NotificationJobData } from '@opscore/types'
import { deliver } from '../services/NotificationService.js'

/**
 * Process a notification delivery job.
 *
 * Calls NotificationService.deliver which handles fan-out to team recipients (Phase 9).
 */
async function processNotificationJob(job: Job<NotificationJobData>): Promise<void> {
  const { notificationId, orgId } = job.data

  const jobLogger = logger.child({
    job_id: job.id,
    queue: QueueName.NOTIFICATIONS,
    organization_id: orgId,
    notificationId,
  })

  jobLogger.info({ transition: 'started' }, 'Notification job started')

  try {
    await deliver(job)
    jobLogger.info({ transition: 'completed' }, 'Notification job completed')
  } catch (error) {
    jobLogger.error(
      {
        transition: 'failed',
        err: error instanceof Error ? { message: error.message, stack: error.stack } : error,
      },
      'Notification job failed',
    )
    // Re-throw to trigger BullMQ retry mechanism
    throw error
  }
}

/**
 * Handle notification job failure after all retry attempts exhausted.
 *
 * Logs the final failure with full job context for observability.
 */
async function handleJobFailed(
  job: Job<NotificationJobData> | undefined,
  error: Error,
): Promise<void> {
  if (!job) {
    logger.error({ err: error }, 'Notification job failed but job object is undefined')
    return
  }

  const { notificationId, orgId } = job.data

  const jobLogger = logger.child({
    job_id: job.id,
    queue: QueueName.NOTIFICATIONS,
    organization_id: orgId,
    notificationId,
  })

  jobLogger.error(
    {
      transition: 'failed_final',
      attemptCount: job.attemptsMade,
      err: { message: error.message, stack: error.stack },
    },
    'Notification job failed after all retry attempts',
  )
}

/**
 * Create and configure the NotificationWorker.
 *
 * @param connection - Redis connection options
 * @param concurrency - Maximum concurrent jobs to process (default: WORKER_CONCURRENCY_NOTIFICATIONS = 20)
 * @returns Configured BullMQ Worker instance
 */
export function createNotificationWorker(
  connection: ConnectionOptions,
  concurrency: number,
): Worker<NotificationJobData> {
  const worker = new Worker<NotificationJobData>(
    QueueName.NOTIFICATIONS,
    processNotificationJob,
    {
      connection,
      concurrency,
    },
  )

  // Register failure handler
  worker.on('failed', handleJobFailed)

  // Log worker lifecycle events
  worker.on('ready', () => {
    logger.info(
      { queue: QueueName.NOTIFICATIONS, concurrency },
      'NotificationWorker ready',
    )
  })

  worker.on('error', (error) => {
    logger.error(
      { queue: QueueName.NOTIFICATIONS, err: error },
      'NotificationWorker error',
    )
  })

  return worker
}
