/**
 * Execution routes — Task 5.7
 *
 * GET    /v1/executions                      — paginated (workflow, status, date range)
 * GET    /v1/executions/failed               — list failed jobs with filters
 * GET    /v1/executions/:id                  — get single execution
 * POST   /v1/executions/:id/retry            — re-enqueue failed job
 * GET    /v1/queues/depth                    — queue depth metrics (cached 30s)
 *
 * Requirements: 8.2, 8.4, 8.5, 8.6
 */

import type { FastifyInstance } from 'fastify'
import authPlugin from '../plugins/auth.js'
import { requirePermission } from '../plugins/rbac.js'
import { ExecutionService } from '../services/ExecutionService.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Parse a query param as a positive integer.
 * Returns undefined if the param is absent, or throws a validation-style error
 * if it's present but not a valid integer within [min, max].
 */
function parseIntParam(
  value: string | undefined,
  field: string,
  min: number,
  max: number,
): number | undefined {
  if (value === undefined) return undefined
  const n = Number(value)
  if (!Number.isInteger(n) || n < min || n > max) {
    const err = Object.assign(new Error(`${field} must be an integer between ${min} and ${max}`), {
      statusCode: 422,
      code: 'VALIDATION_ERROR',
    })
    throw err
  }
  return n
}

/**
 * Parse a query param as a Date.
 * Returns undefined if absent, throws a 422-style error if the value is not valid ISO 8601.
 */
function parseDateParam(value: string | undefined, field: string): Date | undefined {
  if (value === undefined) return undefined
  const d = new Date(value)
  if (isNaN(d.getTime())) {
    const err = Object.assign(new Error(`${field} must be a valid ISO 8601 date`), {
      statusCode: 422,
      code: 'VALIDATION_ERROR',
    })
    throw err
  }
  return d
}

// ---------------------------------------------------------------------------
// Route registration
// ---------------------------------------------------------------------------

export async function executionRoutes(app: FastifyInstance) {
  await app.register(authPlugin)

  // -------------------------------------------------------------------------
  // GET /v1/executions/failed
  //
  // IMPORTANT: This route must be registered BEFORE /v1/executions/:id so
  // that Fastify matches the literal path 'failed' before treating it as an
  // id param.
  //
  // List all failed executions for the authenticated org.
  // Filters: workflowId, fromDate, toDate, errorType
  // Pagination: after (cursor), limit (1–100, default 20)
  // Requires: execution:read
  // -------------------------------------------------------------------------
  app.get(
    '/v1/executions/failed',
    { preHandler: [requirePermission('execution:read')] },
    async (request, reply) => {
      const q = request.query as Record<string, string | undefined>

      const limit = parseIntParam(q['limit'], 'limit', 1, 100)
      const fromDate = parseDateParam(q['fromDate'], 'fromDate')
      const toDate = parseDateParam(q['toDate'], 'toDate')

      const result = await ExecutionService.listFailedJobs(request.orgId, {
        ...(q['workflowId'] !== undefined && { workflowId: q['workflowId'] }),
        ...(fromDate !== undefined && { fromDate }),
        ...(toDate !== undefined && { toDate }),
        ...(q['errorType'] !== undefined && { errorType: q['errorType'] }),
        ...(q['after'] !== undefined && { after: q['after'] }),
        ...(limit !== undefined && { limit }),
      })

      return reply.status(200).send(result)
    },
  )

  // -------------------------------------------------------------------------
  // GET /v1/executions
  //
  // List executions for the authenticated org.
  // Filters: workflowId, status, fromDate, toDate
  // Pagination: after (cursor), limit (1–100, default 20)
  // Requires: execution:read
  // -------------------------------------------------------------------------
  app.get(
    '/v1/executions',
    { preHandler: [requirePermission('execution:read')] },
    async (request, reply) => {
      const q = request.query as Record<string, string | undefined>

      const limit = parseIntParam(q['limit'], 'limit', 1, 100)
      const fromDate = parseDateParam(q['fromDate'], 'fromDate')
      const toDate = parseDateParam(q['toDate'], 'toDate')

      const result = await ExecutionService.listExecutions(request.orgId, {
        ...(q['workflowId'] !== undefined && { workflowId: q['workflowId'] }),
        ...(q['status'] !== undefined && { status: q['status'] }),
        ...(fromDate !== undefined && { fromDate }),
        ...(toDate !== undefined && { toDate }),
        ...(q['after'] !== undefined && { after: q['after'] }),
        ...(limit !== undefined && { limit }),
      })

      return reply.status(200).send(result)
    },
  )

  // -------------------------------------------------------------------------
  // GET /v1/executions/:id
  //
  // Get a single execution by id.
  // Returns 200 with the execution or 404 if not found.
  // Requires: execution:read
  // -------------------------------------------------------------------------
  app.get<{ Params: { id: string } }>(
    '/v1/executions/:id',
    {
      preHandler: [requirePermission('execution:read')],
      schema: {
        params: { type: 'object', required: ['id'], properties: { id: { type: 'string' } } },
      },
    },
    async (request, reply) => {
      const execution = await ExecutionService.getExecution(request.orgId, request.params.id)
      if (!execution) {
        return reply.status(404).send({
          error: {
            code: 'NOT_FOUND',
            message: `Execution '${request.params.id}' not found`,
            request_id: request.id,
          },
        })
      }
      return reply.status(200).send({ data: execution })
    },
  )

  // -------------------------------------------------------------------------
  // POST /v1/executions/:id/retry
  //
  // Re-enqueue a failed execution as a new execution record.
  // Returns 201 with the new execution.
  // Returns 422 if the execution is not in 'failed' status.
  // Returns 404 if not found.
  // Requires: execution:retry
  // -------------------------------------------------------------------------
  app.post<{ Params: { id: string } }>(
    '/v1/executions/:id/retry',
    {
      preHandler: [requirePermission('execution:retry')],
      schema: {
        params: { type: 'object', required: ['id'], properties: { id: { type: 'string' } } },
      },
    },
    async (request, reply) => {
      const newExecution = await ExecutionService.retryJob(request.orgId, request.params.id)
      return reply.status(201).send({ data: newExecution })
    },
  )
}

// ---------------------------------------------------------------------------
// Queue depth route — registered separately (different permission)
// ---------------------------------------------------------------------------

export async function queueRoutes(app: FastifyInstance) {
  await app.register(authPlugin)

  // -------------------------------------------------------------------------
  // GET /v1/queues/depth
  //
  // Return job counts for all active queues.
  // Result is cached in Redis for 30 seconds (Requirement 8.6).
  // Requires: execution:read
  // -------------------------------------------------------------------------
  app.get(
    '/v1/queues/depth',
    { preHandler: [requirePermission('execution:read')] },
    async (request, reply) => {
      const result = await ExecutionService.getQueueDepth()
      return reply.status(200).send(result)
    },
  )
}
