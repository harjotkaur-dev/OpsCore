/**
 * Event ingestion and query routes — Tasks 3.5 + 3.9
 *
 * POST /v1/events        — ingest an event (Task 3.5)
 * GET  /v1/events        — list events with filters + cursor pagination (Task 3.9)
 * GET  /v1/events/:id    — get a single event by id (Task 3.9)
 */

import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import authPlugin from '../plugins/auth.js'
import { requirePermission } from '../plugins/rbac.js'
import { EventService } from '../services/EventService.js'

// ---------------------------------------------------------------------------
// Validation schemas
// ---------------------------------------------------------------------------

const VALID_SOURCES = ['api', 'webhook', 'scheduled', 'manual'] as const

const ingestEventSchema = z.object({
  eventTypeId: z.string().uuid('eventTypeId must be a valid UUID'),
  source: z.enum(VALID_SOURCES, {
    errorMap: () => ({ message: `source must be one of: ${VALID_SOURCES.join(', ')}` }),
  }),
  payload: z
    .record(z.unknown())
    .refine((v) => typeof v === 'object' && v !== null, {
      message: 'payload must be a JSON object',
    }),
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

export async function eventRoutes(app: FastifyInstance) {
  // Auth required for all routes in this scope
  await app.register(authPlugin)

  /**
   * POST /v1/events
   *
   * Ingest an event for the authenticated organisation.
   *
   * Headers:
   *   Authorization: Bearer <token>      (required)
   *   Idempotency-Key: <uuid>            (optional — client-supplied key)
   *
   * Body:
   *   { eventTypeId, source, payload }
   *
   * Responses:
   *   201  { data: Event }                 — event created
   *   200  { data: Event }                 — duplicate key, original response returned
   *   409  { error }                       — key in-flight (concurrent request)
   *   404  { error }                       — event type not found
   *   422  { error, details? }             — deprecated type or schema validation failure
   *
   * Requires: event:ingest
   */
  app.post(
    '/v1/events',
    { preHandler: [requirePermission('event:ingest')] },
    async (request, reply) => {
      // Validate request body
      const parse = ingestEventSchema.safeParse(request.body)
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

      // Extract optional client-supplied idempotency key from header
      const clientKey = request.headers['idempotency-key'] as string | undefined

      // Track whether this is a duplicate response (for correct HTTP status)
      let isDuplicate = false

      const ingestInput = {
        eventTypeId: parse.data.eventTypeId,
        source: parse.data.source,
        payload: parse.data.payload,
        idempotencyKey: clientKey,
      }

      // Peek at existing key to know if response is a duplicate before calling ingest.
      // ingest() returns the cached body directly for completed keys, so we need to
      // detect that case to return 200 instead of 201.
      if (clientKey) {
        const { checkKey } = await import('../lib/idempotency.js')
        const existing = await checkKey(request.orgId, clientKey)
        if (existing?.status === 'completed') {
          isDuplicate = true
        }
      }

      const event = await EventService.ingest(
        request.orgId,
        ingestInput,
        { requestId: request.id, actorId: request.userId },
      )

      // 200 for replayed idempotent response, 201 for new event
      return reply.status(isDuplicate ? 200 : 201).send({ data: event })
    },
  )

  /**
   * GET /v1/events
   *
   * List events for the authenticated organisation.
   * Supports filtering and cursor-based pagination.
   *
   * Query params:
   *   eventTypeId  UUID        filter by event type
   *   source       string      filter by source (api|webhook|scheduled|manual)
   *   status       string      filter by status (received|processed|failed)
   *   fromDate     ISO 8601    received_at >= fromDate
   *   toDate       ISO 8601    received_at <= toDate
   *   after        UUID        cursor — return events after this id
   *   limit        1–100       page size, default 20
   *
   * Requires: event:read
   */
  app.get(
    '/v1/events',
    { preHandler: [requirePermission('event:read')] },
    async (request, reply) => {
      const q = request.query as Record<string, string | undefined>

      // Validate limit
      const rawLimit = q['limit']
      let limit: number | undefined
      if (rawLimit !== undefined) {
        limit = Number(rawLimit)
        if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
          return reply.status(422).send({
            error: {
              code: 'VALIDATION_ERROR',
              message: 'Request validation failed',
              details: [{ field: 'limit', message: 'limit must be an integer between 1 and 100' }],
              request_id: request.id,
            },
          })
        }
      }

      // Validate and parse date params
      let fromDate: Date | undefined
      let toDate: Date | undefined
      if (q['fromDate']) {
        fromDate = new Date(q['fromDate'])
        if (isNaN(fromDate.getTime())) {
          return reply.status(422).send({
            error: {
              code: 'VALIDATION_ERROR',
              message: 'Request validation failed',
              details: [{ field: 'fromDate', message: 'fromDate must be a valid ISO 8601 date' }],
              request_id: request.id,
            },
          })
        }
      }
      if (q['toDate']) {
        toDate = new Date(q['toDate'])
        if (isNaN(toDate.getTime())) {
          return reply.status(422).send({
            error: {
              code: 'VALIDATION_ERROR',
              message: 'Request validation failed',
              details: [{ field: 'toDate', message: 'toDate must be a valid ISO 8601 date' }],
              request_id: request.id,
            },
          })
        }
      }

      const result = await EventService.listEvents(
        request.orgId,
        {
          eventTypeId: q['eventTypeId'],
          source: q['source'],
          status: q['status'],
          fromDate,
          toDate,
        },
        {
          after: q['after'],
          limit,
        },
      )

      return reply.status(200).send(result)
    },
  )

  /**
   * GET /v1/events/:id
   *
   * Get a single event by id.
   * Returns 200 or 404.
   * Requires: event:read
   */
  app.get<{ Params: { id: string } }>(
    '/v1/events/:id',
    {
      preHandler: [requirePermission('event:read')],
      schema: {
        params: { type: 'object', required: ['id'], properties: { id: { type: 'string' } } },
      },
    },
    async (request, reply) => {
      const event = await EventService.getEvent(request.orgId, request.params.id)
      if (!event) {
        return reply.status(404).send({
          error: {
            code: 'NOT_FOUND',
            message: `Event '${request.params.id}' not found`,
            request_id: request.id,
          },
        })
      }
      return reply.status(200).send({ data: event })
    },
  )
}
