import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { OrganizationService } from '../services/OrganizationService.js'

// ---------------------------------------------------------------------------
// Zod validation schemas
// ---------------------------------------------------------------------------

const createOrgSchema = z.object({
  name: z.string().min(1, 'name is required').max(255),
  slug: z
    .string()
    .min(1, 'slug is required')
    .max(63)
    .regex(
      /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
      'slug must be lowercase alphanumeric with hyphens',
    ),
})

const updateOrgSchema = z
  .object({
    name: z.string().min(1).max(255).optional(),
    slug: z
      .string()
      .min(1)
      .max(63)
      .regex(
        /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
        'slug must be lowercase alphanumeric with hyphens',
      )
      .optional(),
  })
  .refine((data) => data.name !== undefined || data.slug !== undefined, {
    message: 'At least one field (name or slug) must be provided',
  })

// ---------------------------------------------------------------------------
// Route registration
// ---------------------------------------------------------------------------

export async function organizationRoutes(app: FastifyInstance) {
  /**
   * POST /v1/organizations
   * Create a new organization.
   * Returns 201 with the created organization.
   */
  app.post(
    '/v1/organizations',
    {
      schema: {
        body: {
          type: 'object',
          required: ['name', 'slug'],
          properties: {
            name: { type: 'string', minLength: 1, maxLength: 255 },
            slug: { type: 'string', minLength: 1, maxLength: 63 },
          },
        },
        response: {
          201: {
            type: 'object',
            properties: {
              data: {
                type: 'object',
                properties: {
                  id: { type: 'string' },
                  name: { type: 'string' },
                  slug: { type: 'string' },
                  status: { type: 'string' },
                  createdAt: { type: 'string' },
                  updatedAt: { type: 'string' },
                },
              },
            },
          },
        },
      },
    },
    async (request, reply) => {
      const parse = createOrgSchema.safeParse(request.body)
      if (!parse.success) {
        return reply.status(422).send({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Request validation failed',
            details: parse.error.errors.map((e) => ({
              field: e.path.join('.'),
              message: e.message,
            })),
            request_id: request.id,
          },
        })
      }

      const org = await OrganizationService.create(parse.data, {
        requestId: request.id,
        // actorId: not yet available — auth middleware comes in task 2.7
      })

      return reply.status(201).send({ data: org })
    },
  )

  /**
   * GET /v1/organizations/:id
   * Fetch a single organization by id.
   * Returns 200 or 404.
   */
  app.get<{ Params: { id: string } }>(
    '/v1/organizations/:id',
    {
      schema: {
        params: {
          type: 'object',
          required: ['id'],
          properties: {
            id: { type: 'string' },
          },
        },
        response: {
          200: {
            type: 'object',
            properties: {
              data: {
                type: 'object',
                properties: {
                  id: { type: 'string' },
                  name: { type: 'string' },
                  slug: { type: 'string' },
                  status: { type: 'string' },
                  createdAt: { type: 'string' },
                  updatedAt: { type: 'string' },
                },
              },
            },
          },
        },
      },
    },
    async (request, reply) => {
      const org = await OrganizationService.findById(request.params.id)
      if (!org) {
        return reply.status(404).send({
          error: {
            code: 'NOT_FOUND',
            message: `Organization '${request.params.id}' not found`,
            request_id: request.id,
          },
        })
      }

      return reply.status(200).send({ data: org })
    },
  )

  /**
   * PATCH /v1/organizations/:id
   * Update name and/or slug.
   * Returns 200 or 404 or 422.
   */
  app.patch<{ Params: { id: string } }>(
    '/v1/organizations/:id',
    {
      schema: {
        params: {
          type: 'object',
          required: ['id'],
          properties: {
            id: { type: 'string' },
          },
        },
        body: {
          type: 'object',
          properties: {
            name: { type: 'string', minLength: 1, maxLength: 255 },
            slug: { type: 'string', minLength: 1, maxLength: 63 },
          },
        },
      },
    },
    async (request, reply) => {
      const parse = updateOrgSchema.safeParse(request.body)
      if (!parse.success) {
        return reply.status(422).send({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Request validation failed',
            details: parse.error.errors.map((e) => ({
              field: e.path.join('.'),
              message: e.message,
            })),
            request_id: request.id,
          },
        })
      }

      const org = await OrganizationService.update(
        request.params.id,
        parse.data,
        { requestId: request.id },
      )

      return reply.status(200).send({ data: org })
    },
  )

  /**
   * POST /v1/organizations/:id/deactivate
   * Soft-deactivate an organization.
   * Sets status to 'deactivated'; preserves all data.
   * Returns 200 or 404.
   */
  app.post<{ Params: { id: string } }>(
    '/v1/organizations/:id/deactivate',
    {
      schema: {
        params: {
          type: 'object',
          required: ['id'],
          properties: {
            id: { type: 'string' },
          },
        },
      },
    },
    async (request, reply) => {
      const org = await OrganizationService.deactivate(request.params.id, {
        requestId: request.id,
      })

      return reply.status(200).send({ data: org })
    },
  )
}
