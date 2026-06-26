import { type ConnectionOptions } from 'bullmq'
import { config } from '@opscore/config'
import { logger } from '@opscore/logger'
import { URL } from 'node:url'
import { createWorkflowWorker } from './workers/WorkflowWorker.js'
import { createNotificationWorker } from './workers/NotificationWorker.js'
import { createMetricWorker } from './workers/MetricWorker.js'
import { createOverdueScheduler } from './workers/OverdueWorker.js'
import { createMetricHistoryCleanupScheduler } from './workers/MetricHistoryCleanupWorker.js'

// BullMQ requires host/port/password options — parse from REDIS_URL
function parseRedisConnection(redisUrl: string): ConnectionOptions {
  const url = new URL(redisUrl)
  return {
    host: url.hostname,
    port: parseInt(url.port || '6379', 10),
    password: url.password || undefined,
    db: url.pathname ? parseInt(url.pathname.slice(1) || '0', 10) : 0,
    maxRetriesPerRequest: null, // required by BullMQ
  }
}

const connection = parseRedisConnection(config.REDIS_URL)

// Initialize all workers with configured concurrency
const workflowWorker = createWorkflowWorker(
  connection,
  config.WORKER_CONCURRENCY_WORKFLOW,
)

const notificationWorker = createNotificationWorker(
  connection,
  config.WORKER_CONCURRENCY_NOTIFICATIONS,
)

const metricWorker = createMetricWorker(
  connection,
  config.WORKER_CONCURRENCY_METRICS,
)

// Overdue detection — repeatable job every 5 minutes (Req 7.7)
const { queue: overdueQueue, worker: overdueWorker } = createOverdueScheduler(connection)

// Metric history cleanup — repeatable job every 24 hours (Req 11.6)
const { queue: metricCleanupQueue, worker: metricCleanupWorker } = createMetricHistoryCleanupScheduler(connection)

const shutdown = async () => {
  logger.info('Worker shutting down...')
  await Promise.all([
    workflowWorker.close(),
    notificationWorker.close(),
    metricWorker.close(),
    overdueWorker.close(),
    overdueQueue.close(),
    metricCleanupWorker.close(),
    metricCleanupQueue.close(),
  ])
  process.exit(0)
}

process.on('SIGTERM', shutdown)
process.on('SIGINT', shutdown)

logger.info('Worker started')
