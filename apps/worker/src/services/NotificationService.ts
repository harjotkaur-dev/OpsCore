/**
 * NotificationService (Worker) — Task 9.1
 *
 * deliver(job):
 *   Loads the notification record, verifies it belongs to the correct org,
 *   logs delivery, and returns. Email delivery will be added in Phase 9.6.
 *
 * If the notification is not found (already deleted or wrong org), logs a
 * warning and returns without throwing — this prevents unnecessary retries
 * for stale jobs.
 *
 * Requirements: 6.2, 12.1, 12.2
 */

import type { Job } from 'bullmq'
import { prisma } from '@opscore/database'
import { logger } from '@opscore/logger'
import type { NotificationJobData } from '@opscore/types'

/**
 * Deliver a notification job.
 *
 * Loads the notification to verify it exists and belongs to the org.
 * Logs delivery; does not throw if the notification is missing (skip silently).
 */
export async function deliver(job: Job<NotificationJobData>): Promise<void> {
  const { notificationId, orgId } = job.data 

  // Load notification to verify it exists and belongs to org
  const notification = await prisma.notification.findFirst({
    where: { id: notificationId, organizationId: orgId },
  })

  if (!notification) {
    // Already deleted or wrong org — log and skip (don't throw, don't retry)
    logger.warn(
      { notificationId, orgId },
      'Notification not found during delivery — skipping',
    )
    return
  }

  logger.info(
    {
      notificationId,
      orgId,
      recipientType: notification.recipientType,
      recipientUserId: notification.recipientUserId,
    },
    'Notification delivered',
  )

  // Phase 9.6: email delivery will be added here
}
