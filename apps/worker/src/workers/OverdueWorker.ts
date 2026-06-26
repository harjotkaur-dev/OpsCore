/**
 * OverdueWorker — Task 6.7
 *
 * Scheduled sweep that marks tasks as overdue when their due date has passed
 * and their status is not 'completed' or 'cancelled'.
 *
 * Mechanism: BullMQ repeatable job (overdue-check, every 5 minutes).
 *   - The Queue + upsertJobScheduler registers the repeatable schedule.
 *   - A BullMQ Worker executes runOverdueCheck on each tick.
 *
 * Overdue state rules:
 *   overdue = true when ALL of:
 *     dueDate IS NOT NULL
 *     dueDate < now()
 *     status NOT IN ('completed', 'cancelled')
 *     overdue = false  ← only update records not already marked
 *
 * Audit log: actorType='system', actorId=null, action='status_changed',
 *   entityType='task' — one entry per newly-overdue task.
 *
 * Requirements: 7.7
 */

import { Queue, Worker, type Job } from 'bullmq'
import type { ConnectionOptions } from 'bullmq'
import { prisma } from '@opscore/database'
import { logger } from '@opscore/logger'

const OVERDUE_QUEUE_NAME = 'overdue-check'
const OVERDUE_JOB_NAME = 'overdue-check'

export { OVERDUE_QUEUE_NAME }

/**
 * Core logic: find all tasks that have become overdue and mark them.
 *
 * For each newly-overdue task, updates overdue=true and writes an audit
 * log entry, all inside a single Prisma transaction per task.
 *
 * @param orgId  Optional — if provided, restrict the sweep to one org.
 *               Omit (or pass undefined) to sweep all organisations.
 */
export async function runOverdueCheck(orgId?: string): Promise<void> {
  const now = new Date()

  // Find tasks that should be marked overdue
  const overdueTasks = await prisma.task.findMany({
    where: {
      ...(orgId ? { organizationId: orgId } : {}),
      dueDate: { lt: now },
      status: { notIn: ['completed', 'cancelled'] },
      overdue: false,
    },
    select: {
      id: true,
      organizationId: true,
      title: true,
      status: true,
      dueDate: true,
    },
  })

  if (overdueTasks.length === 0) {
    logger.info({ queue: OVERDUE_QUEUE_NAME }, 'Overdue check: no newly-overdue tasks')
    return
  }

  logger.info(
    { queue: OVERDUE_QUEUE_NAME, count: overdueTasks.length },
    'Overdue check: marking tasks overdue',
  )

  // Process each task in its own transaction
  for (const task of overdueTasks) {
    await prisma.$transaction(async (tx) => {
      await tx.task.update({
        where: { id: task.id },
        data: { overdue: true },
      })

      await tx.auditLog.create({
        data: {
          organizationId: task.organizationId,
          entityType: 'task',
          entityId: task.id,
          action: 'status_changed',
          actorType: 'system',
          actorId: null,
          beforeState: {
            id: task.id,
            status: task.status,
            overdue: false,
            dueDate: task.dueDate,
          },
          afterState: {
            id: task.id,
            status: task.status,
            overdue: true,
            dueDate: task.dueDate,
          },
          requestId: null,
        },
      })
    })

    logger.info(
      { queue: OVERDUE_QUEUE_NAME, taskId: task.id, orgId: task.organizationId },
      'Task marked overdue',
    )
  }

  logger.info(
    { queue: OVERDUE_QUEUE_NAME, count: overdueTasks.length },
    'Overdue check completed',
  )
}

/**
 * Create and configure the BullMQ Queue + Worker for the overdue-check job.
 *
 * Registers a repeatable job that runs every 5 minutes using BullMQ's
 * upsertJobScheduler API (BullMQ v5).
 *
 * @param connection  Redis connection options
 * @returns           Object with { queue, worker } for shutdown handling
 */
export function createOverdueScheduler(connection: ConnectionOptions): {
  queue: Queue
  worker: Worker
} {
  const queue = new Queue(OVERDUE_QUEUE_NAME, { connection })

  // Register a repeatable job — every 5 minutes using BullMQ v5 API
  void queue.add(
    OVERDUE_JOB_NAME,
    {},
    {
      repeat: { every: 5 * 60 * 1000 },
      removeOnComplete: { count: 10 },
      removeOnFail: false,
    },
  )

  logger.info(
    { queue: OVERDUE_QUEUE_NAME, intervalMs: 5 * 60 * 1000 },
    'Overdue check scheduler registered',
  )

  // Worker that actually executes runOverdueCheck on each tick
  const worker = new Worker(
    OVERDUE_QUEUE_NAME,
    async (_job: Job) => {
      await runOverdueCheck()
    },
    {
      connection,
      concurrency: 1, // Only one overdue sweep at a time
    },
  )

  worker.on('ready', () => {
    logger.info({ queue: OVERDUE_QUEUE_NAME }, 'OverdueWorker ready')
  })

  worker.on('error', (error) => {
    logger.error({ queue: OVERDUE_QUEUE_NAME, err: error }, 'OverdueWorker error')
  })

  return { queue, worker }
}
