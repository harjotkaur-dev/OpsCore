/**
 * MetricService (Worker) — Task 8.1
 *
 * Implements metric computation and KPI threshold evaluation for the MetricWorker.
 *
 * recompute(job):
 *   Computes the current value for a built-in metric, upserts the Metric record,
 *   inserts a MetricHistory record, then calls evaluateKPIs.
 *
 * evaluateKPIs(orgId):
 *   Loads all active KPIs for the org, compares metric.currentValue against
 *   kpi.targetValue using kpi.operator. If the threshold is newly crossed
 *   (was not breached before the latest recompute), enqueues a notification.
 *
 * Built-in metric names:
 *   total_events_ingested        — COUNT(*) from events
 *   total_tasks_created          — COUNT(*) from tasks
 *   task_completion_rate         — (completed / total) * 100
 *   avg_task_resolution_time_minutes — AVG((updatedAt-createdAt) minutes) for completed tasks
 *   total_failed_executions      — COUNT(*) from executions WHERE status='failed'
 *
 * Requirements: 11.1, 11.2, 11.4, 11.5
 */

import type { Job } from 'bullmq'
import { Queue } from 'bullmq'
import { Decimal } from '@prisma/client/runtime/library'
import { prisma } from '@opscore/database'
import { logger } from '@opscore/logger'
import { QueueName, type MetricUpdateJobData } from '@opscore/types'
import { config as appConfig } from '@opscore/config'
import { parseRedisConnectionOptions } from '../lib/redis.js'

// ---------------------------------------------------------------------------
// Built-in metric definitions
// ---------------------------------------------------------------------------

export const BUILT_IN_METRICS: Record<string, string> = {
  total_events_ingested: 'count',
  total_tasks_created: 'count',
  task_completion_rate: 'percentage',
  avg_task_resolution_time_minutes: 'duration_minutes',
  total_failed_executions: 'count',
}

// ---------------------------------------------------------------------------
// Notifications queue (lazy singleton)
// ---------------------------------------------------------------------------

let notificationsQueue: Queue | null = null

function getNotificationsQueue(): Queue {
  if (!notificationsQueue) {
    const connection = parseRedisConnectionOptions(appConfig.REDIS_URL)
    notificationsQueue = new Queue(QueueName.NOTIFICATIONS, {
      connection,
      defaultJobOptions: {
        removeOnComplete: { count: 100 },
        removeOnFail: false,
        attempts: 3,
        backoff: { type: 'fixed', delay: 2000 },
      },
    })
  }
  return notificationsQueue
}

// ---------------------------------------------------------------------------
// Operator evaluation
// ---------------------------------------------------------------------------

export function evaluateOperator(
  current: Decimal,
  operator: string,
  target: Decimal,
): boolean {
  switch (operator) {
    case '>':  return current.gt(target)
    case '<':  return current.lt(target)
    case '>=': return current.gte(target)
    case '<=': return current.lte(target)
    case '=':  return current.eq(target)
    default:   return false
  }
}

// ---------------------------------------------------------------------------
// Metric computation helpers
// ---------------------------------------------------------------------------

async function computeMetricValue(orgId: string, metricName: string): Promise<Decimal> {
  switch (metricName) {
    case 'total_events_ingested': {
      const count = await prisma.event.count({ where: { organizationId: orgId } })
      return new Decimal(count)
    }

    case 'total_tasks_created': {
      const count = await prisma.task.count({ where: { organizationId: orgId } })
      return new Decimal(count)
    }

    case 'task_completion_rate': {
      const [completedCount, totalCount] = await Promise.all([
        prisma.task.count({ where: { organizationId: orgId, status: 'completed' } }),
        prisma.task.count({ where: { organizationId: orgId } }),
      ])
      if (totalCount === 0) return new Decimal(0)
      return new Decimal(completedCount).div(new Decimal(totalCount)).mul(100)
    }

    case 'avg_task_resolution_time_minutes': {
      // Use raw SQL for AVG of time difference in minutes
      const result = await prisma.$queryRaw<[{ avg_minutes: number | null }]>`
        SELECT AVG(EXTRACT(EPOCH FROM ("updated_at" - "created_at")) / 60) AS avg_minutes
        FROM tasks
        WHERE organization_id = ${orgId}::uuid
          AND status = 'completed'
      `
      const avg = result[0]?.avg_minutes
      if (avg == null) return new Decimal(0)
      return new Decimal(avg.toString())
    }

    case 'total_failed_executions': {
      const count = await prisma.execution.count({
        where: { organizationId: orgId, status: 'failed' },
      })
      return new Decimal(count)
    }

    default:
      throw new Error(`Unknown built-in metric: ${metricName}`)
  }
}

// ---------------------------------------------------------------------------
// recompute
// ---------------------------------------------------------------------------

/**
 * Recompute a metric based on the update job.
 *
 * Steps:
 *  1. Validate the metric name is a known built-in (skip unknown with warning)
 *  2. Compute the new value using DB queries
 *  3. Upsert the Metric record (create or update currentValue + computedAt)
 *  4. Insert a MetricHistory record
 *  5. Call evaluateKPIs
 */
export async function recompute(job: Job<MetricUpdateJobData>): Promise<void> {
  const { metricName, orgId, triggeredBy } = job.data

  const metricLogger = logger.child({
    metricName,
    orgId,
    triggeredBy,
    jobId: job.id,
  })

  // Skip unrecognised metrics — future custom metric support
  if (!(metricName in BUILT_IN_METRICS)) {
    metricLogger.warn({ metricName }, 'Unknown metric name — skipping recompute')
    return
  }

  const metricType = BUILT_IN_METRICS[metricName]!
  const newValue = await computeMetricValue(orgId, metricName)
  const now = new Date()

  // Upsert the Metric record
  const metric = await prisma.metric.upsert({
    where: {
      organizationId_name: { organizationId: orgId, name: metricName },
    },
    create: {
      organizationId: orgId,
      name: metricName,
      metricType,
      currentValue: newValue,
      computedAt: now,
    },
    update: {
      currentValue: newValue,
      computedAt: now,
    },
  })

  // Insert MetricHistory record
  await prisma.metricHistory.create({
    data: {
      metricId: metric.id,
      organizationId: orgId,
      value: newValue,
      recordedAt: now,
      triggeredBy: triggeredBy ?? 'system',
    },
  })

  metricLogger.info(
    { metricName, orgId, newValue: newValue.toString(), metricId: metric.id },
    'Metric recomputed successfully',
  )

  // Evaluate KPIs after every recompute
  await evaluateKPIs(orgId)
}

// ---------------------------------------------------------------------------
// evaluateKPIs
// ---------------------------------------------------------------------------

/**
 * Evaluate all active KPIs for the org against their metrics' current values.
 *
 * For each KPI:
 *  - Load the associated metric's currentValue
 *  - Compare against targetValue using the KPI operator
 *  - Check if the threshold was NOT crossed before (look at the previous
 *    MetricHistory entry; if none exists, treat as not previously breached)
 *  - If newly crossed, enqueue a notification to the KPI's ownerUserId
 */
export async function evaluateKPIs(orgId: string): Promise<void> {
  const kpis = await prisma.kPI.findMany({
    where: { organizationId: orgId, status: 'active' },
    include: {
      metric: {
        select: {
          id: true,
          currentValue: true,
          history: {
            orderBy: { recordedAt: 'desc' },
            take: 2,
            select: { value: true, recordedAt: true },
          },
        },
      },
    },
  })

  if (kpis.length === 0) return

  const queue = getNotificationsQueue()

  for (const kpi of kpis) {
    const currentValue = kpi.metric.currentValue
    const targetValue = kpi.targetValue
    const operator = kpi.operator

    const isCurrentlyBreached = evaluateOperator(
      new Decimal(currentValue.toString()),
      operator,
      new Decimal(targetValue.toString()),
    )

    if (!isCurrentlyBreached) continue

    // Check if it was previously breached using the second-most-recent history entry
    const historyEntries = kpi.metric.history
    // history[0] is the most recent (just inserted), history[1] is the previous value
    const previousEntry = historyEntries[1] ?? null

    let wasPreviouslyBreached = false
    if (previousEntry) {
      wasPreviouslyBreached = evaluateOperator(
        new Decimal(previousEntry.value.toString()),
        operator,
        new Decimal(targetValue.toString()),
      )
    }

    // Only notify on a newly-crossed threshold
    if (wasPreviouslyBreached) continue

    logger.info(
      {
        kpiId: kpi.id,
        orgId,
        metricId: kpi.metric.id,
        operator,
        currentValue: currentValue.toString(),
        targetValue: targetValue.toString(),
      },
      'KPI threshold newly crossed — enqueueing notification',
    )

    // Persist notification record and enqueue the job
    const notification = await prisma.notification.create({
      data: {
        organizationId: orgId,
        recipientType: 'user',
        recipientUserId: kpi.ownerUserId,
        message: `KPI "${kpi.name}" threshold crossed: current value ${currentValue.toString()} ${operator} ${targetValue.toString()}`,
        sourceEntityType: 'kpi',
        sourceEntityId: kpi.id,
        isRead: false,
      },
    })

    await queue.add('send-notification', {
      notificationId: notification.id,
      orgId,
    })
  }
}
