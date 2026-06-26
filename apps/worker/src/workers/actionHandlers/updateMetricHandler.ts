/**
 * updateMetricHandler — Task 5.2
 *
 * Enqueues a metric-update job to the `metric-updates` BullMQ queue.
 * The MetricWorker (Task 5.10) will consume and recompute the metric.
 *
 * Config schema (validated at workflow-publish time):
 *   {
 *     metric_name: string
 *     operation: "increment"|"decrement"|"set"
 *     value: number
 *   }
 *
 * Requirements: 5.4, 6.6
 */

import { Queue } from 'bullmq'
import { QueueName, type MetricUpdateJobData } from '@opscore/types'
import { config as appConfig } from '@opscore/config'
import { parseRedisConnectionOptions } from '../../lib/redis.js'
import type { ActionExecutionContext } from './index.js'

// ---------------------------------------------------------------------------
// Queue (lazy singleton per process)
// ---------------------------------------------------------------------------

let metricUpdatesQueue: Queue<MetricUpdateJobData> | null = null

function getMetricUpdatesQueue(): Queue<MetricUpdateJobData> {
  if (!metricUpdatesQueue) {
    const connection = parseRedisConnectionOptions(appConfig.REDIS_URL)
    metricUpdatesQueue = new Queue<MetricUpdateJobData>(QueueName.METRIC_UPDATES, {
      connection,
      defaultJobOptions: {
        removeOnComplete: { count: 100 },
        removeOnFail: false,
        attempts: 2,
        backoff: { type: 'fixed', delay: 1000 },
      },
    })
  }
  return metricUpdatesQueue
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export interface UpdateMetricConfig {
  metric_name: string
  operation: 'increment' | 'decrement' | 'set'
  value: number
}

export async function updateMetricHandler(context: ActionExecutionContext): Promise<void> {
  const { config, executionId, orgId, orderIndex, logger } = context
  const cfg = config as unknown as UpdateMetricConfig

  logger.info(
    { metricName: cfg.metric_name, operation: cfg.operation, value: cfg.value, executionId },
    'Enqueueing metric update via workflow action',
  )

  const queue = getMetricUpdatesQueue()

  // Use a deterministic job id for idempotency
  const jobId = `metric:${executionId}:${orderIndex}`

  await queue.add(
    'update-metric',
    {
      metricName: cfg.metric_name,
      orgId,
      triggeredBy: `workflow_action::${executionId}`,
      // Additional metadata for the MetricWorker
      operation: cfg.operation,
      value: cfg.value,
    } as MetricUpdateJobData & Record<string, unknown>,
    {
      jobId, // BullMQ deduplicates by jobId — idempotent
    },
  )

  logger.info({ jobId, metricName: cfg.metric_name, orgId }, 'Metric update job enqueued successfully')
}
