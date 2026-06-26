/**
 * Notification routes — Tasks 9.1, 9.3
 *
 * GET    /v1/notifications              → notification:read   (list)
 * PATCH  /v1/notifications/:id/read     → notification:update (markRead)
 * POST   /v1/notifications/read-all     → notification:update (markAllRead)
 *
 * Requirements: 12.1, 12.2, 12.3, 12.5
 */

import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import authPlugin from '../plugins/auth.js'
import { requirePermission } from '../plugins/rbac.js'
import { NotificationService } from '../services/NotificationService.js'

// ---------------------------------------------------------------------------
// Zod validation schemas
// ---------------------------------------------------------------------------

const listNotificationsQuerySchema = z.object({
  isRead: z
    .string()
    .optional()
    .transform((v) => (v === 'true' ? true : v === 'false' ? false : undefined))
    .pipe(z.boolean().optional()),
  fromDate: z.string().datetime({ offset: true }).optional(),
  toDate: z.string().datetime({ offset: true }).optional(),
  after: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
})

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function zodErrors(errors: z.ZodIssue[]) {
  return errors.map((e) => ({ field: e.path.join('.'), message: e.message }))
}

// ---------------------------------------------------------------------------
// Route registration
// ---------------------------------------------------------------------------

export async function notificationRoutes(app: FastifyInstance) {
  await app.register(authPlugin)

  // -------------------------------------------------------------------------
  // GET /v1/notifications — list user's notifications (Req 12.1, 12.5)
  // -------------------------------------------------------------------------
  app.get(
    '/v1/notifications',
    { preHandler: [requirePermission('notification:read')] },
    async (request, reply) => {
      const parse = listNotificationsQuerySchema.safeParse(request.query)
      if (!parse.success) {
        return reply.status(422).send({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Query parameter validation failed',
            details: zodErrors(parse.error.errors),
            request_id: request.id,
          },
        })
      }

      const q = parse.data
      const result = await NotificationService.list(
        request.orgId,
        request.userId,
        {
          isRead: q.isRead,
          fromDate: q.fromDate ? new Date(q.fromDate) : undefined,
          toDate: q.toDate ? new Date(q.toDate) : undefined,
        },
        {
          after: q.after,
          limit: q.limit,
        },
      )

      return reply.status(200).send(result)
    },
  )

  // -------------------------------------------------------------------------
  // POST /v1/notifications/read-all — mark all as read (Req 12.3)
  // NOTE: must be registered before /:id/read to avoid route conflict
  // -------------------------------------------------------------------------
  app.post(
    '/v1/notifications/read-all',
    { preHandler: [requirePermission('notification:update')] },
    async (request, reply) => {
      const count = await NotificationService.markAllRead(request.orgId, request.userId)
      return reply.status(200).send({ data: { updatedCount: count } })
    },
  )

  // -------------------------------------------------------------------------
  // PATCH /v1/notifications/:id/read — mark single as read (Req 12.3)
  // -------------------------------------------------------------------------
  app.patch<{ Params: { id: string } }>(
    '/v1/notifications/:id/read',
    {
      preHandler: [requirePermission('notification:update')],
      schema: {
        params: { type: 'object', required: ['id'], properties: { id: { type: 'string' } } },
      },
    },
    async (request, reply) => {
      const notification = await NotificationService.markRead(
        request.params.id,
        request.orgId,
        request.userId,
      )
      return reply.status(200).send({ data: notification })
    },
  )
}
