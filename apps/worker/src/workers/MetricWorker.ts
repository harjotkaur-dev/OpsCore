/**
 * MetricWorker — Task 5.10
 *
 * BullMQ Worker that processes metric recomputation jobs from the 'metric-updates' queue.
 *
 * Lifecycle:
 * 1. Receive MetricUpdateJobData from the queue
 * 2. Delegate to MetricService.recompute (Phase 8 metric aggregation implementation)
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
import { QueueName, type MetricUpdateJobData } from '@opscore/types'
import { recompute } from '../services/MetricService.js'

/**
 * Process a metric update job.
 *
 * Calls MetricService.recompute which handles metric aggregation and KPI recalculation (Phase 8).
 * recompute internally calls evaluateKPIs after updating the metric value.
 */
async function processMetricJob(job: Job<MetricUpdateJobData>): Promise<void> {
  const { metricName, orgId, triggeredBy } = job.data

  const jobLogger = logger.child({
    job_id: job.id,
    queue: QueueName.METRIC_UPDATES,
    organization_id: orgId,
    metricName,
    triggeredBy,
  })

  jobLogger.info({ transition: 'started' }, 'Metric update job started')

  try {
    // recompute handles metric aggregation + KPI evaluation (Req 11.1, 11.2, 11.4)
    await recompute(job)
    jobLogger.info({ transition: 'completed' }, 'Metric update job completed')
  } catch (error) {
    jobLogger.error(
      {
        transition: 'failed',
        err: error instanceof Error ? { message: error.message, stack: error.stack } : error,
      },
      'Metric update job failed',
    )
    // Re-throw to trigger BullMQ retry mechanism
    throw error
  }
}

/**
 * Handle metric update job failure after all retry attempts exhausted.
 *
 * Logs the final failure with full job context for observability.
 */
async function handleJobFailed(
  job: Job<MetricUpdateJobData> | undefined,
  error: Error,
): Promise<void> {
  if (!job) {
    logger.error({ err: error }, 'Metric job failed but job object is undefined')
    return
  }

  const { metricName, orgId, triggeredBy } = job.data

  const jobLogger = logger.child({
    job_id: job.id,
    queue: QueueName.METRIC_UPDATES,
    organization_id: orgId,
    metricName,
    triggeredBy,
  })

  jobLogger.error(
    {
      transition: 'failed_final',
      attemptCount: job.attemptsMade,
      err: { message: error.message, stack: error.stack },
    },
    'Metric update job failed after all retry attempts',
  )
}

/**
 * Create and configure the MetricWorker.
 *
 * @param connection - Redis connection options
 * @param concurrency - Maximum concurrent jobs to process (default: WORKER_CONCURRENCY_METRICS = 5)
 * @returns Configured BullMQ Worker instance
 */
export function createMetricWorker(
  connection: ConnectionOptions,
  concurrency: number,
): Worker<MetricUpdateJobData> {
  const worker = new Worker<MetricUpdateJobData>(
    QueueName.METRIC_UPDATES,
    processMetricJob,
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
      { queue: QueueName.METRIC_UPDATES, concurrency },
      'MetricWorker ready',
    )
  })

  worker.on('error', (error) => {
    logger.error(
      { queue: QueueName.METRIC_UPDATES, err: error },
      'MetricWorker error',
    )
  })

  return worker
}
