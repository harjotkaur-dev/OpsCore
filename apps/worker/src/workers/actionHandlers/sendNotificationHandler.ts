/**
 * sendNotificationHandler — Task 5.2 (updated Phase 9)
 *
 * Persist-first notification pattern:
 *  1. Create the Notification record in DB (fan-out handled by NotificationService in Phase 9,
 *     here we create a single user/team record as the source)
 *  2. Enqueue { notificationId, orgId } to the notifications queue
 *
 * This aligns with the KPI alert path (MetricService) and the Phase 9 architecture:
 * every notification in the system follows one lifecycle:
 *   create → persist → queue → deliver → read
 *
 * Idempotency: the Notification row uses the deterministic jobId as a check.
 * BullMQ deduplicates by jobId so the enqueue is idempotent.
 * The DB upsert uses findFirst + conditional create so retries don't create duplicates.
 *
 * Config schema (validated at workflow-publish time):
 *   {
 *     recipient_type: "user"|"team"
 *     recipient_id: string
 *     message_template: string
 *   }
 *
 * Requirements: 5.4, 6.6
 */

import { Queue } from 'bullmq'
import { QueueName, type NotificationJobData } from '@opscore/types'
import { config as appConfig } from '@opscore/config'
import { prisma } from '@opscore/database'
import { parseRedisConnectionOptions } from '../../lib/redis.js'
import type { ActionExecutionContext } from './index.js'

// ---------------------------------------------------------------------------
// Queue (lazy singleton per process)
// ---------------------------------------------------------------------------

let notificationsQueue: Queue<NotificationJobData> | null = null

function getNotificationsQueue(): Queue<NotificationJobData> {
  if (!notificationsQueue) {
    const connection = parseRedisConnectionOptions(appConfig.REDIS_URL)
    notificationsQueue = new Queue<NotificationJobData>(QueueName.NOTIFICATIONS, {
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
// Handler
// ---------------------------------------------------------------------------

export interface SendNotificationConfig {
  recipient_type: 'user' | 'team'
  recipient_id: string
  message_template: string
}

export async function sendNotificationHandler(context: ActionExecutionContext): Promise<void> {
  const { config, event, executionId, orgId, orderIndex, logger } = context
  const cfg = config as unknown as SendNotificationConfig

  logger.info(
    { recipientType: cfg.recipient_type, recipientId: cfg.recipient_id, executionId },
    'Creating notification via workflow action',
  )

  // Deterministic job id for BullMQ deduplication
  const jobId = `notif:${executionId}:${orderIndex}`

  // Persist-first: create the Notification record before enqueueing.
  // Use findFirst + conditional create for idempotency on retries.
  const existing = await prisma.notification.findFirst({
    where: {
      organizationId: orgId,
      sourceEntityType: 'execution',
      sourceEntityId: executionId,
      ...(cfg.recipient_type === 'user'
        ? { recipientUserId: cfg.recipient_id }
        : { recipientTeamId: cfg.recipient_id }),
    },
    select: { id: true },
  })

  const notification = existing ?? await prisma.notification.create({
    data: {
      organizationId: orgId,
      recipientType: cfg.recipient_type,
      recipientUserId: cfg.recipient_type === 'user' ? cfg.recipient_id : null,
      recipientTeamId: cfg.recipient_type === 'team' ? cfg.recipient_id : null,
      message: cfg.message_template,
      sourceEntityType: 'execution',
      sourceEntityId: executionId,
      isRead: false,
    },
  })

  const queue = getNotificationsQueue()

  await queue.add(
    'send-notification',
    {
      notificationId: notification.id,
      orgId,
    } satisfies NotificationJobData,
    {
      jobId, // BullMQ deduplicates by jobId — idempotent
    },
  )

  logger.info({ notificationId: notification.id, jobId, orgId }, 'Notification persisted and enqueued')
}
