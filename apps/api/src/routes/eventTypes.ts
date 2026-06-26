/**
 * Event Type routes — Task 3.1
 *
 * POST   /v1/event-types
 * GET    /v1/event-types
 * GET    /v1/event-types/:id
 * PATCH  /v1/event-types/:id
 * POST   /v1/event-types/:id/deprecate
 *
 * All routes require authentication (authPlugin registered at scope level).
 * Fine-grained RBAC via requirePermission.
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

const createEventTypeSchema = z.object({
  name: z.string().min(1, 'name is required').max(255),
  description: z.string().max(1000).optional(),
  payloadSchema: z
    .record(z.unknown())
    .refine((v) => typeof v === 'object' && v !== null, {
      message: 'payloadSchema must be a JSON object',
    }),
  source: z.enum(VALID_SOURCES, {
    errorMap: () => ({ message: `source must be one of: ${VALID_SOURCES.join(', ')}` }),
  }),
})

const updateEventTypeSchema = z
  .object({
    name: z.string().min(1).max(255).optional(),
    description: z.string().max(1000).optional(),
    payloadSchema: z.record(z.unknown()).optional(),
  })
  .refine(
    (d) => d.name !== undefined || d.description !== undefined || d.payloadSchema !== undefined,
    { message: 'At least one field must be provided' },
  )

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function zodErrors(errors: z.ZodIssue[]) {
  return errors.map((e) => ({ field: e.path.join('.'), message: e.message }))
}

// ---------------------------------------------------------------------------
// Route registration
// ---------------------------------------------------------------------------

export async function eventTypeRoutes(app: FastifyInstance) {
  // Auth required for all routes in this scope
  await app.register(authPlugin)

  /**
   * POST /v1/event-types
   * Create a new event type.
   * Requires: event_type:create
   */
  app.post(
    '/v1/event-types',
    { preHandler: [requirePermission('event_type:create')] },
    async (request, reply) => {
      const parse = createEventTypeSchema.safeParse(request.body)
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

      const eventType = await EventService.createEventType(
        request.orgId,
        {
          name: parse.data.name,
          source: parse.data.source,
          payloadSchema: parse.data.payloadSchema,
          description: parse.data.description,
        },
        { requestId: request.id, actorId: request.userId },
      )

      return reply.status(201).send({ data: eventType })
    },
  )

  /**
   * GET /v1/event-types
   * List event types for the organisation.
   * Optional query param: ?status=active|deprecated
   * Requires: event_type:read
   */
  app.get(
    '/v1/event-types',
    { preHandler: [requirePermission('event_type:read')] },
    async (request, reply) => {
      const { status } = request.query as { status?: string }
      const eventTypes = await EventService.listEventTypes(request.orgId, status)
      return reply.status(200).send({ data: eventTypes })
    },
  )

  /**
   * GET /v1/event-types/:id
   * Get a single event type.
   * Requires: event_type:read
   */
  app.get<{ Params: { id: string } }>(
    '/v1/event-types/:id',
    {
      preHandler: [requirePermission('event_type:read')],
      schema: {
        params: { type: 'object', required: ['id'], properties: { id: { type: 'string' } } },
      },
    },
    async (request, reply) => {
      const eventType = await EventService.getEventType(request.orgId, request.params.id)
      if (!eventType) {
        return reply.status(404).send({
          error: {
            code: 'NOT_FOUND',
            message: `Event type '${request.params.id}' not found`,
            request_id: request.id,
          },
        })
      }
      return reply.status(200).send({ data: eventType })
    },
  )

  /**
   * PATCH /v1/event-types/:id
   * Update name, description, or payloadSchema.
   * Requires: event_type:update
   */
  app.patch<{ Params: { id: string } }>(
    '/v1/event-types/:id',
    {
      preHandler: [requirePermission('event_type:update')],
      schema: {
        params: { type: 'object', required: ['id'], properties: { id: { type: 'string' } } },
      },
    },
    async (request, reply) => {
      const parse = updateEventTypeSchema.safeParse(request.body)
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

      const eventType = await EventService.updateEventType(
        request.orgId,
        request.params.id,
        {
          name: parse.data.name,
          description: parse.data.description,
          payloadSchema: parse.data.payloadSchema,
        },
        { requestId: request.id, actorId: request.userId },
      )

      return reply.status(200).send({ data: eventType })
    },
  )

  /**
   * POST /v1/event-types/:id/deprecate
   * Deprecate an event type (idempotent).
   * Requires: event_type:deprecate
   */
  app.post<{ Params: { id: string } }>(
    '/v1/event-types/:id/deprecate',
    {
      preHandler: [requirePermission('event_type:deprecate')],
      schema: {
        params: { type: 'object', required: ['id'], properties: { id: { type: 'string' } } },
      },
    },
    async (request, reply) => {
      const eventType = await EventService.deprecateEventType(
        request.orgId,
        request.params.id,
        { requestId: request.id, actorId: request.userId },
      )
      return reply.status(200).send({ data: eventType })
    },
  )
}
