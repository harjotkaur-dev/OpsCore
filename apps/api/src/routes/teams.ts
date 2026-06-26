import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import authPlugin from '../plugins/auth.js'
import { requirePermission } from '../plugins/rbac.js'
import { TeamService } from '../services/TeamService.js'

// ---------------------------------------------------------------------------
// Zod validation schemas
// ---------------------------------------------------------------------------

const createTeamSchema = z.object({
  name: z.string().min(1, 'name is required').max(255),
  description: z.string().max(1000).optional(),
})

const updateTeamSchema = z
  .object({
    name: z.string().min(1).max(255).optional(),
    description: z.string().max(1000).optional(),
  })
  .refine((data) => data.name !== undefined || data.description !== undefined, {
    message: 'At least one field (name or description) must be provided',
  })

const addMemberSchema = z.object({
  userId: z.string().uuid('userId must be a valid UUID'),
})

// ---------------------------------------------------------------------------
// Route registration
// ---------------------------------------------------------------------------

export async function teamRoutes(app: FastifyInstance) {
  // Register the auth plugin for all routes in this scope
  await app.register(authPlugin)

  /**
   * POST /v1/teams
   * Create a new team within the authenticated user's organization.
   * Returns 201 with the created team.
   * Requires permission: team:create
   */
  app.post(
    '/v1/teams',
    {
      preHandler: [requirePermission('team:create')],
      schema: {
        body: {
          type: 'object',
          required: ['name'],
          properties: {
            name: { type: 'string', minLength: 1, maxLength: 255 },
            description: { type: 'string', maxLength: 1000 },
          },
        },
      },
    },
    async (request, reply) => {
      const parse = createTeamSchema.safeParse(request.body)
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

      const team = await TeamService.createTeam(request.orgId, parse.data, {
        requestId: request.id,
        actorId: request.userId,
      })

      return reply.status(201).send({ data: team })
    },
  )

  /**
   * GET /v1/teams
   * List all teams (active and archived) for the authenticated user's organization.
   * Returns 200.
   * Requires permission: team:read
   */
  app.get(
    '/v1/teams',
    {
      preHandler: [requirePermission('team:read')],
    },
    async (request, reply) => {
      const teams = await TeamService.listTeams(request.orgId)
      return reply.status(200).send({ data: teams })
    },
  )

  /**
   * GET /v1/teams/:id
   * Get a single team by id.
   * Returns 200 or 404.
   * Requires permission: team:read
   */
  app.get<{ Params: { id: string } }>(
    '/v1/teams/:id',
    {
      preHandler: [requirePermission('team:read')],
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
      const team = await TeamService.findById(request.orgId, request.params.id)
      if (!team) {
        return reply.status(404).send({
          error: {
            code: 'NOT_FOUND',
            message: `Team '${request.params.id}' not found`,
            request_id: request.id,
          },
        })
      }
      return reply.status(200).send({ data: team })
    },
  )

  /**
   * PATCH /v1/teams/:id
   * Update a team's name or description.
   * Returns 200 or 404 or 422.
   * Requires permission: team:update
   */
  app.patch<{ Params: { id: string } }>(
    '/v1/teams/:id',
    {
      preHandler: [requirePermission('team:update')],
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
            description: { type: 'string', maxLength: 1000 },
          },
        },
      },
    },
    async (request, reply) => {
      const parse = updateTeamSchema.safeParse(request.body)
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

      const team = await TeamService.updateTeam(
        request.orgId,
        request.params.id,
        parse.data,
        { requestId: request.id, actorId: request.userId },
      )

      return reply.status(200).send({ data: team })
    },
  )

  /**
   * POST /v1/teams/:id/archive
   * Archive a team — sets status to 'archived'. Idempotent.
   * Returns 200 or 404.
   * Requires permission: team:archive
   */
  app.post<{ Params: { id: string } }>(
    '/v1/teams/:id/archive',
    {
      preHandler: [requirePermission('team:archive')],
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
      const team = await TeamService.archiveTeam(
        request.orgId,
        request.params.id,
        { requestId: request.id, actorId: request.userId },
      )
      return reply.status(200).send({ data: team })
    },
  )

  /**
   * POST /v1/teams/:id/members
   * Add a member to a team.
   * Body: { userId }
   * Returns 201 or 404/409/422.
   * Requires permission: team:member
   */
  app.post<{ Params: { id: string } }>(
    '/v1/teams/:id/members',
    {
      preHandler: [requirePermission('team:member')],
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
          required: ['userId'],
          properties: {
            userId: { type: 'string' },
          },
        },
      },
    },
    async (request, reply) => {
      const parse = addMemberSchema.safeParse(request.body)
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

      const member = await TeamService.addMember(
        request.orgId,
        request.params.id,
        parse.data,
        { requestId: request.id, actorId: request.userId },
      )

      return reply.status(201).send({ data: member })
    },
  )

  /**
   * DELETE /v1/teams/:id/members/:userId
   * Remove a member from a team.
   * Returns 204 or 404.
   * Requires permission: team:member
   */
  app.delete<{ Params: { id: string; userId: string } }>(
    '/v1/teams/:id/members/:userId',
    {
      preHandler: [requirePermission('team:member')],
      schema: {
        params: {
          type: 'object',
          required: ['id', 'userId'],
          properties: {
            id: { type: 'string' },
            userId: { type: 'string' },
          },
        },
      },
    },
    async (request, reply) => {
      await TeamService.removeMember(
        request.orgId,
        request.params.id,
        request.params.userId,
        { requestId: request.id, actorId: request.userId },
      )
      return reply.status(204).send()
    },
  )
}
