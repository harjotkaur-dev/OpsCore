/**
 * Audit Log routes — Task 7.1
 *
 * GET    /v1/audit-logs      — paginated list with filters (Req 9.4)
 * GET    /v1/audit-logs/:id  — single entry
 *
 * Append-only enforcement (Req 9.3):
 *   PUT /v1/audit-logs/:id    → 405 Method Not Allowed
 *   PATCH /v1/audit-logs/:id  → 405 Method Not Allowed
 *   DELETE /v1/audit-logs/:id → 405 Method Not Allowed
 *
 * All routes require auth + `audit_log:read` permission.
 *
 * Requirements: 9.3, 9.4
 */

import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import authPlugin from '../plugins/auth.js'
import { requirePermission } from '../plugins/rbac.js'
import { prisma } from '../lib/prisma.js'
import type { Prisma } from '@prisma/client'

// ---------------------------------------------------------------------------
// Query schema
// ---------------------------------------------------------------------------

const listAuditLogsQuerySchema = z.object({
  entityType: z.string().optional(),
  entityId: z.string().uuid().optional(),
  actorId: z.string().uuid().optional(),
  action: z.string().optional(),
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

export async function auditLogRoutes(app: FastifyInstance) {
  await app.register(authPlugin)

  // -------------------------------------------------------------------------
  // GET /v1/audit-logs
  //
  // List audit log entries for the authenticated org.
  // Filters: entityType, entityId, actorId, action, fromDate, toDate
  // Pagination: cursor-based (after = last id seen), limit (default 20, max 100)
  // Order: timestamp DESC
  // Requires: audit_log:read
  // -------------------------------------------------------------------------
  app.get(
    '/v1/audit-logs',
    { preHandler: [requirePermission('audit_log:read')] },
    async (request, reply) => {
      const parse = listAuditLogsQuerySchema.safeParse(request.query)
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

      const { entityType, entityId, actorId, action, fromDate, toDate, after, limit } = parse.data
      const pageSize = Math.min(limit ?? 20, 100)

      const where: Prisma.AuditLogWhereInput = {
        organizationId: request.orgId,
        ...(entityType ? { entityType } : {}),
        ...(entityId ? { entityId } : {}),
        ...(actorId ? { actorId } : {}),
        ...(action ? { action } : {}),
        ...(fromDate || toDate
          ? {
              timestamp: {
                ...(fromDate ? { gte: new Date(fromDate) } : {}),
                ...(toDate ? { lte: new Date(toDate) } : {}),
              },
            }
          : {}),
      }

      const logs = await prisma.auditLog.findMany({
        where,
        orderBy: [{ timestamp: 'desc' }, { id: 'desc' }],
        take: pageSize + 1,
        ...(after ? { cursor: { id: after }, skip: 1 } : {}),
      })

      const hasNextPage = logs.length > pageSize
      const data = hasNextPage ? logs.slice(0, pageSize) : logs
      const nextCursor = hasNextPage ? (data[data.length - 1]?.id ?? null) : null

      return reply.status(200).send({
        data,
        pagination: { limit: pageSize, hasNextPage, nextCursor },
      })
    },
  )

  // -------------------------------------------------------------------------
  // GET /v1/audit-logs/:id
  //
  // Get a single audit log entry by id.
  // Returns 200 or 404.
  // Requires: audit_log:read
  // -------------------------------------------------------------------------
  app.get<{ Params: { id: string } }>(
    '/v1/audit-logs/:id',
    {
      preHandler: [requirePermission('audit_log:read')],
      schema: {
        params: { type: 'object', required: ['id'], properties: { id: { type: 'string' } } },
      },
    },
    async (request, reply) => {
      const log = await prisma.auditLog.findFirst({
        where: { id: request.params.id, organizationId: request.orgId },
      })

      if (!log) {
        return reply.status(404).send({
          error: {
            code: 'NOT_FOUND',
            message: `Audit log '${request.params.id}' not found`,
            request_id: request.id,
          },
        })
      }

      return reply.status(200).send({ data: log })
    },
  )

  // -------------------------------------------------------------------------
  // 405 Method Not Allowed for mutating methods on /v1/audit-logs/:id
  // Req 9.3: the audit log is append-only — no modifications or deletions
  // via the API.
  // -------------------------------------------------------------------------
  const mutatingMethods = ['PUT', 'PATCH', 'DELETE'] as const

  for (const method of mutatingMethods) {
    app.route({
      method,
      url: '/v1/audit-logs/:id',
      // Auth is still required — unauthenticated requests get 401, not 405
      preHandler: [requirePermission('audit_log:read')],
      handler: async (_request, reply) => {
        return reply
          .status(405)
          .header('Allow', 'GET')
          .send({
            error: {
              code: 'METHOD_NOT_ALLOWED',
              message: 'Audit logs are append-only and cannot be modified or deleted',
            },
          })
      },
    })
  }
}
