/**
 * User routes
 *
 * GET /v1/users/me — return the authenticated user's profile + org membership
 *
 * Requires a valid JWT Bearer token (authPlugin enforces this).
 * Returns 200 with { data: { id, email, fullName, createdAt, orgId, role } }.
 * Returns 401 if token is missing or invalid (handled by authPlugin).
 * Returns 404 if the user record no longer exists in the database.
 */

import type { FastifyInstance } from 'fastify'
import authPlugin from '../plugins/auth.js'
import { prisma } from '../lib/prisma.js'
import createError from '@fastify/error'

const NotFoundError = createError('NOT_FOUND', '%s', 404)

export async function userRoutes(app: FastifyInstance) {
  await app.register(async (authedScope) => {
    await authedScope.register(authPlugin)

    /**
     * GET /v1/users/me
     *
     * Returns the currently authenticated user's profile along with their
     * role and orgId (sourced from the JWT claims already on the request).
     */
    authedScope.get('/v1/users/me', async (request, reply) => {
      const user = await prisma.user.findUnique({
        where: { id: request.userId },
        select: {
          id: true,
          email: true,
          fullName: true,
          createdAt: true,
        },
      })

      if (!user) {
        throw new NotFoundError(`User '${request.userId}' not found`)
      }

      return reply.status(200).send({
        data: {
          id: user.id,
          email: user.email,
          fullName: user.fullName,
          createdAt: user.createdAt,
          orgId: request.orgId,
          role: request.role,
        },
      })
    })
  })
}
