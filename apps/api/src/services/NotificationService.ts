/**
 * NotificationService — Tasks 9.1, 9.3
 *
 * Notification creation with fan-out (9.1):
 *   create({ orgId, recipientType, recipientUserId?, recipientTeamId?, message,
 *            sourceEntityType, sourceEntityId, actorId? })
 *   - recipientType='user': validates active membership, creates 1 row, enqueues 1 job
 *   - recipientType='team': validates team is not archived, fan-out to all active
 *     team_members → N rows, N jobs
 *
 * Mark-as-read / query (9.3):
 *   markRead(notificationId, orgId, userId)   — sets isRead=true, readAt=now()
 *   markAllRead(orgId, userId)                — batch update, returns count
 *   list(orgId, userId, filters, pagination)  — cursor pagination, order createdAt DESC
 *
 * Transaction boundary: validate → create rows → audit log → commit.
 * Queue enqueue happens AFTER commit.
 *
 * Requirements: 12.1, 12.2, 12.3, 12.4, 12.5
 */

import { Prisma } from '@prisma/client'
import { prisma, type TransactionClient } from '../lib/prisma.js'
import { notificationsQueue } from '../lib/queue.js'
import createError from '@fastify/error'

// ---------------------------------------------------------------------------
// Custom errors
// ---------------------------------------------------------------------------

const NotFoundError = createError('NOT_FOUND', '%s', 404)
const UnprocessableError = createError('UNPROCESSABLE_ENTITY', '%s', 422)

// ---------------------------------------------------------------------------
// Input types
// ---------------------------------------------------------------------------

export interface CreateNotificationInput {
  orgId: string
  recipientType: 'user' | 'team'
  recipientUserId?: string | undefined
  recipientTeamId?: string | undefined
  message: string
  sourceEntityType: string
  sourceEntityId: string
  actorId?: string | undefined
}

export interface ListNotificationsFilters {
  isRead?: boolean | undefined
  fromDate?: Date | undefined
  toDate?: Date | undefined
}

export interface ListNotificationsPagination {
  after?: string | undefined
  limit?: number | undefined
}

export interface MutationContext {
  requestId?: string | undefined
  actorId?: string | undefined
}

// ---------------------------------------------------------------------------
// NotificationService
// ---------------------------------------------------------------------------

export const NotificationService = {

  // -------------------------------------------------------------------------
  // create (Req 12.1, 12.2, 12.4)
  // -------------------------------------------------------------------------

  /**
   * Create one or more notification records and enqueue delivery jobs.
   *
   * For recipientType='user': validates the user is an active org member,
   * creates 1 notification row, enqueues 1 job.
   *
   * For recipientType='team': validates the team exists and is not archived,
   * loads all active team_members, creates one notification row per member
   * with recipientType='user' (fan-out). Returns [] if team has no active members.
   *
   * Transaction: create rows + audit log → commit → enqueue jobs.
   */
  async create(
    input: CreateNotificationInput,
    context: { requestId?: string } = {},
  ) {
    // -----------------------------------------------------------------------
    // Validation
    // -----------------------------------------------------------------------
    if (input.recipientType === 'user') {
      if (!input.recipientUserId) {
        throw new UnprocessableError('recipientUserId is required when recipientType is user')
      }

      const member = await prisma.organizationMember.findFirst({
        where: {
          organizationId: input.orgId,
          userId: input.recipientUserId,
          status: 'active',
        },
      })
      if (!member) {
        throw new UnprocessableError(
          `User '${input.recipientUserId}' is not an active member of this organization`,
        )
      }
    } else {
      // recipientType === 'team'
      if (!input.recipientTeamId) {
        throw new UnprocessableError('recipientTeamId is required when recipientType is team')
      }

      const team = await prisma.team.findFirst({
        where: { id: input.recipientTeamId, organizationId: input.orgId },
      })
      if (!team) {
        throw new NotFoundError(`Team '${input.recipientTeamId}' not found`)
      }
      if (team.status === 'archived') {
        throw new UnprocessableError(
          `Cannot send notification to archived team '${input.recipientTeamId}'`,
        )
      }
    }

    // -----------------------------------------------------------------------
    // Build recipient list
    // -----------------------------------------------------------------------
    let recipientUserIds: string[]

    if (input.recipientType === 'user') {
      recipientUserIds = [input.recipientUserId!]
    } else {
      // Fan-out: load all active team members
      const members = await prisma.teamMember.findMany({
        where: {
          teamId: input.recipientTeamId!,
          organizationId: input.orgId,
          user: {
            memberships: {
              some: {
                organizationId: input.orgId,
                status: 'active',
              },
            },
          },
        },
        select: { userId: true },
      })

      recipientUserIds = members.map((m) => m.userId)

      // Team with 0 active members → return empty, no rows, no jobs
      if (recipientUserIds.length === 0) {
        return []
      }
    }

    // -----------------------------------------------------------------------
    // Transaction: create rows + audit log
    // -----------------------------------------------------------------------
    const notifications = await prisma.$transaction(async (tx: TransactionClient) => {
      const created = await Promise.all(
        recipientUserIds.map((userId) =>
          tx.notification.create({
            data: {
              organizationId: input.orgId,
              recipientType: 'user',
              recipientUserId: userId,
              recipientTeamId: null,
              message: input.message,
              sourceEntityType: input.sourceEntityType,
              sourceEntityId: input.sourceEntityId,
              isRead: false,
            },
          }),
        ),
      )

      // Audit log — write one entry for the first notification id
      await tx.auditLog.create({
        data: {
          organizationId: input.orgId,
          entityType: 'notification',
          entityId: created[0]!.id,
          action: 'created',
          actorType: input.actorId ? 'user' : 'system',
          actorId: input.actorId ?? null,
          beforeState: Prisma.JsonNull,
          afterState: {
            recipientType: input.recipientType,
            recipientCount: created.length,
            sourceEntityType: input.sourceEntityType,
            sourceEntityId: input.sourceEntityId,
            message: input.message,
          },
          requestId: context.requestId ?? null,
        },
      })

      return created
    })

    // -----------------------------------------------------------------------
    // Enqueue jobs AFTER commit
    // -----------------------------------------------------------------------
    await Promise.all(
      notifications.map((notification) =>
        notificationsQueue.add('send-notification', {
          notificationId: notification.id,
          orgId: input.orgId,
        }),
      ),
    )

    return notifications
  },

  // -------------------------------------------------------------------------
  // markRead (Req 12.3)
  // -------------------------------------------------------------------------

  /**
   * Mark a single notification as read for a specific user (tenant-safe).
   *
   * Scopes the query to orgId + recipientUserId — a user cannot mark
   * another user's notification as read.
   *
   * Throws 404 if not found or if it belongs to a different user/org.
   */
  async markRead(
    notificationId: string,
    orgId: string,
    userId: string,
  ) {
    const notification = await prisma.notification.findFirst({
      where: {
        id: notificationId,
        organizationId: orgId,
        recipientUserId: userId,
      },
    })
    if (!notification) {
      throw new NotFoundError(`Notification '${notificationId}' not found`)
    }

    return prisma.$transaction(async (tx: TransactionClient) => {
      const updated = await tx.notification.update({
        where: { id: notificationId },
        data: {
          isRead: true,
          readAt: new Date(),
        },
      })

      await tx.auditLog.create({
        data: {
          organizationId: orgId,
          entityType: 'notification',
          entityId: updated.id,
          action: 'status_changed',
          actorType: 'user',
          actorId: userId,
          beforeState: { isRead: false },
          afterState: { isRead: true, readAt: updated.readAt },
          requestId: null,
        },
      })

      return updated
    })
  },

  // -------------------------------------------------------------------------
  // markAllRead (Req 12.3)
  // -------------------------------------------------------------------------

  /**
   * Mark all unread notifications as read for a user in an org.
   *
   * Returns the count of updated records.
   */
  async markAllRead(orgId: string, userId: string): Promise<number> {
    const result = await prisma.notification.updateMany({
      where: {
        organizationId: orgId,
        recipientUserId: userId,
        isRead: false,
      },
      data: {
        isRead: true,
        readAt: new Date(),
      },
    })

    // Write one aggregate audit entry for the batch operation.
    // A single entry is sufficient — it answers "when did this user bulk-mark as read"
    // without creating one row per notification.
    await prisma.auditLog.create({
      data: {
        organizationId: orgId,
        entityType: 'notification',
        entityId: orgId, // orgId scopes the batch operation
        action: 'status_changed',
        actorType: 'user',
        actorId: userId,
        beforeState: { isRead: false, scope: 'all_unread' },
        afterState: { isRead: true, markedReadCount: result.count },
        requestId: null,
      },
    })

    return result.count
  },

  // -------------------------------------------------------------------------
  // list (Req 12.5)
  // -------------------------------------------------------------------------

  /**
   * List notifications for a user with optional filters and cursor pagination.
   *
   * Filters: isRead, fromDate (createdAt >=), toDate (createdAt <=)
   * Pagination: cursor (notification id), limit (default 20, max 100)
   * Order: createdAt DESC, id DESC (stable)
   */
  async list(
    orgId: string,
    userId: string,
    filters: ListNotificationsFilters = {},
    pagination: ListNotificationsPagination = {},
  ) {
    const limit = Math.min(pagination.limit ?? 20, 100)

    const where: Prisma.NotificationWhereInput = {
      organizationId: orgId,
      recipientUserId: userId,
      ...(filters.isRead !== undefined ? { isRead: filters.isRead } : {}),
      ...(filters.fromDate || filters.toDate
        ? {
            createdAt: {
              ...(filters.fromDate ? { gte: filters.fromDate } : {}),
              ...(filters.toDate ? { lte: filters.toDate } : {}),
            },
          }
        : {}),
    }

    const notifications = await prisma.notification.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      ...(pagination.after
        ? { cursor: { id: pagination.after }, skip: 1 }
        : {}),
    })

    const hasNextPage = notifications.length > limit
    const data = hasNextPage ? notifications.slice(0, limit) : notifications
    const nextCursor = hasNextPage ? (data[data.length - 1]?.id ?? null) : null

    return {
      data,
      pagination: { limit, hasNextPage, nextCursor },
    }
  },
}
