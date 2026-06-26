/**
 * Metrics and KPI routes — Task 8.5
 *
 * Metric endpoints:
 *   GET  /v1/metrics                    → metric:read
 *   GET  /v1/metrics/:name/history      → metric:read
 *
 * KPI endpoints:
 *   POST   /v1/kpis                     → kpi:create
 *   GET    /v1/kpis                     → kpi:read
 *   GET    /v1/kpis/:id                 → kpi:read
 *   PATCH  /v1/kpis/:id                 → kpi:update
 *   DELETE /v1/kpis/:id                 → kpi:delete
 *
 * Requirements: 11.3, 11.4, 11.5
 */

import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import authPlugin from '../plugins/auth.js'
import { requirePermission } from '../plugins/rbac.js'
import { MetricService } from '../services/MetricService.js'

// ---------------------------------------------------------------------------
// Zod validation schemas
// ---------------------------------------------------------------------------

const createKPISchema = z.object({
  name: z.string().min(1).max(255),
  metricId: z.string().uuid(),
  operator: z.enum(['>', '<', '>=', '<=', '=']),
  targetValue: z.number().finite(),
  ownerUserId: z.string().uuid(),
})

const updateKPISchema = z
  .object({
    name: z.string().min(1).max(255).optional(),
    targetValue: z.number().finite().optional(),
    operator: z.enum(['>', '<', '>=', '<=', '=']).optional(),
    status: z.enum(['active', 'inactive']).optional(),
  })
  .refine(
    (d) =>
      d.name !== undefined ||
      d.targetValue !== undefined ||
      d.operator !== undefined ||
      d.status !== undefined,
    { message: 'At least one field must be provided' },
  )

const listKPIsQuerySchema = z.object({
  status: z.enum(['active', 'inactive']).optional(),
  after: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
})

const listMetricHistoryQuerySchema = z.object({
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

export async function metricRoutes(app: FastifyInstance) {
  await app.register(authPlugin)

  // -------------------------------------------------------------------------
  // GET /v1/metrics — list all metrics for the org (Req 11.5)
  // -------------------------------------------------------------------------
  app.get(
    '/v1/metrics',
    { preHandler: [requirePermission('metric:read')] },
    async (request, reply) => {
      const metrics = await MetricService.listMetrics(request.orgId)
      return reply.status(200).send({ data: metrics })
    },
  )

  // -------------------------------------------------------------------------
  // GET /v1/metrics/:name/history — metric history (Req 11.2, 11.5)
  // -------------------------------------------------------------------------
  app.get<{ Params: { name: string } }>(
    '/v1/metrics/:name/history',
    {
      preHandler: [requirePermission('metric:read')],
      schema: {
        params: { type: 'object', required: ['name'], properties: { name: { type: 'string' } } },
      },
    },
    async (request, reply) => {
      const parse = listMetricHistoryQuerySchema.safeParse(request.query)
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

      const result = await MetricService.getMetricHistory(
        request.orgId,
        request.params.name,
        {
          ...(parse.data.after !== undefined && { after: parse.data.after }),
          ...(parse.data.limit !== undefined && { limit: parse.data.limit }),
        },
      )

      return reply.status(200).send(result)
    },
  )

  // -------------------------------------------------------------------------
  // POST /v1/kpis — create KPI (Req 11.3)
  // -------------------------------------------------------------------------
  app.post(
    '/v1/kpis',
    { preHandler: [requirePermission('kpi:create')] },
    async (request, reply) => {
      const parse = createKPISchema.safeParse(request.body)
      if (!parse.success) {
        return reply.status(422).send({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Request validation failed',
            details: zodErrors(parse.error.errors),
            request_id: request.id,
          },
        })
      }

      const kpi = await MetricService.createKPI(
        request.orgId,
        {
          name: parse.data.name,
          metricId: parse.data.metricId,
          operator: parse.data.operator,
          targetValue: parse.data.targetValue,
          ownerUserId: parse.data.ownerUserId,
        },
        { requestId: request.id, actorId: request.userId },
      )

      return reply.status(201).send({ data: kpi })
    },
  )

  // -------------------------------------------------------------------------
  // GET /v1/kpis — list KPIs (Req 11.3, 11.5)
  // -------------------------------------------------------------------------
  app.get(
    '/v1/kpis',
    { preHandler: [requirePermission('kpi:read')] },
    async (request, reply) => {
      const parse = listKPIsQuerySchema.safeParse(request.query)
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

      const result = await MetricService.listKPIs(
        request.orgId,
        { ...(parse.data.status !== undefined && { status: parse.data.status }) },
        {
          ...(parse.data.after !== undefined && { after: parse.data.after }),
          ...(parse.data.limit !== undefined && { limit: parse.data.limit }),
        },
      )

      return reply.status(200).send(result)
    },
  )

  // -------------------------------------------------------------------------
  // GET /v1/kpis/:id — get single KPI (Req 11.3, 11.5)
  // -------------------------------------------------------------------------
  app.get<{ Params: { id: string } }>(
    '/v1/kpis/:id',
    {
      preHandler: [requirePermission('kpi:read')],
      schema: {
        params: { type: 'object', required: ['id'], properties: { id: { type: 'string' } } },
      },
    },
    async (request, reply) => {
      const kpi = await MetricService.getKPI(request.orgId, request.params.id)
      if (!kpi) {
        return reply.status(404).send({
          error: {
            code: 'NOT_FOUND',
            message: `KPI '${request.params.id}' not found`,
            request_id: request.id,
          },
        })
      }
      return reply.status(200).send({ data: kpi })
    },
  )

  // -------------------------------------------------------------------------
  // PATCH /v1/kpis/:id — update KPI (Req 11.3)
  // -------------------------------------------------------------------------
  app.patch<{ Params: { id: string } }>(
    '/v1/kpis/:id',
    {
      preHandler: [requirePermission('kpi:update')],
      schema: {
        params: { type: 'object', required: ['id'], properties: { id: { type: 'string' } } },
      },
    },
    async (request, reply) => {
      const parse = updateKPISchema.safeParse(request.body)
      if (!parse.success) {
        return reply.status(422).send({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Request validation failed',
            details: zodErrors(parse.error.errors),
            request_id: request.id,
          },
        })
      }

      const kpi = await MetricService.updateKPI(
        request.orgId,
        request.params.id,
        {
          ...(parse.data.name !== undefined && { name: parse.data.name }),
          ...(parse.data.targetValue !== undefined && { targetValue: parse.data.targetValue }),
          ...(parse.data.operator !== undefined && { operator: parse.data.operator }),
          ...(parse.data.status !== undefined && { status: parse.data.status }),
        },
        { requestId: request.id, actorId: request.userId },
      )

      return reply.status(200).send({ data: kpi })
    },
  )

  // -------------------------------------------------------------------------
  // DELETE /v1/kpis/:id — delete KPI (Req 11.3)
  // -------------------------------------------------------------------------
  app.delete<{ Params: { id: string } }>(
    '/v1/kpis/:id',
    {
      preHandler: [requirePermission('kpi:delete')],
      schema: {
        params: { type: 'object', required: ['id'], properties: { id: { type: 'string' } } },
      },
    },
    async (request, reply) => {
      await MetricService.deleteKPI(
        request.orgId,
        request.params.id,
        { requestId: request.id, actorId: request.userId },
      )
      return reply.status(204).send()
    },
  )
}
