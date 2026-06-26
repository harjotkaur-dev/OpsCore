import { Queue } from 'bullmq'
import { QueueName } from '@opscore/types'
import { config } from '@opscore/config'
import { parseRedisConnectionOptions } from './redis.js'

const connection = parseRedisConnectionOptions(config.REDIS_URL)

/**
 * Per-queue retry and removal configuration.
 *
 * Requirements: 6.3, 6.4, 6.5
 * - removeOnFail: false ensures failed jobs remain inspectable in Redis
 * - attempts + backoff configure the BullMQ retry policy per queue
 */
const queueJobOptions = {
  [QueueName.WORKFLOW_EXEC]: {
    removeOnComplete: { count: 100 },
    removeOnFail: false,
    attempts: 3,
    backoff: { type: 'exponential' as const, delay: 1000 },
  },
  [QueueName.NOTIFICATIONS]: {
    removeOnComplete: { count: 100 },
    removeOnFail: false,
    attempts: 3,
    backoff: { type: 'fixed' as const, delay: 2000 },
  },
  [QueueName.METRIC_UPDATES]: {
    removeOnComplete: { count: 100 },
    removeOnFail: false,
    attempts: 2,
    backoff: { type: 'fixed' as const, delay: 1000 },
  },
} as const

/** Typed factory for creating BullMQ queues with per-queue retry configuration. */
export function createQueue<T>(name: QueueName): Queue<T> {
  return new Queue<T>(name, {
    connection,
    defaultJobOptions: queueJobOptions[name],
  })
}

export const workflowQueue = createQueue<import('@opscore/types').WorkflowJobData>(
  QueueName.WORKFLOW_EXEC,
)

export const notificationsQueue = createQueue<import('@opscore/types').NotificationJobData>(
  QueueName.NOTIFICATIONS,
)

export const metricUpdatesQueue = createQueue<import('@opscore/types').MetricUpdateJobData>(
  QueueName.METRIC_UPDATES,
)
