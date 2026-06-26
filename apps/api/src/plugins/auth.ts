/**
 * Auth plugin — JWT Bearer token verification.
 *
 * Registers a preHandler hook that:
 *  1. Extracts the `Authorization: Bearer <token>` header
 *  2. Verifies the token with the RS256 public key via `verifyAccessToken`
 *  3. Attaches `userId`, `orgId`, `role`, and `permissions` to the request
 *
 * Returns 401 if:
 *  - The Authorization header is missing or not in `Bearer <token>` form
 *  - The token is invalid, expired, or signed with the wrong key
 *
 * Register this plugin on individual routes / route prefixes that require
 * authentication — do NOT register it globally via app.register so that
 * public routes (health, auth/*) remain unauthenticated.
 *
 * Usage:
 *   await app.register(authPlugin)   // on a scoped enclosure
 *
 * After this plugin runs, route handlers can safely access:
 *   request.userId, request.orgId, request.role, request.permissions
 */

import fp from 'fastify-plugin'
import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify'
import { verifyAccessToken } from '../lib/jwt.js'
import { runWithOrgId } from '../lib/tenantContext.js'

// ---------------------------------------------------------------------------
// Fastify type augmentation — extend FastifyRequest with auth claims
// ---------------------------------------------------------------------------

declare module 'fastify' {
  interface FastifyRequest {
    /** UUID of the authenticated user (from JWT `sub` claim) */
    userId: string
    /** UUID of the active organization (from JWT `org` claim) */
    orgId: string
    /** Role of the user within the organization (from JWT `role` claim) */
    role: string
    /** List of `resource:action` permission strings (from JWT `permissions` claim) */
    permissions: string[]
  }
}

// ---------------------------------------------------------------------------
// Plugin
// ---------------------------------------------------------------------------

const authPlugin: FastifyPluginAsync = async (fastify) => {
  // Step 1 (onRequest): verify the JWT and attach claims to the request.
  // We use onRequest so that the orgId is available as early as possible.
  fastify.addHook('onRequest', async (request: FastifyRequest, reply: FastifyReply) => {
    const authHeader = request.headers.authorization

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return reply.status(401).send({
        error: {
          code: 'UNAUTHORIZED',
          message: 'Missing or malformed Authorization header',
          request_id: request.id,
        },
      })
    }

    const token = authHeader.slice('Bearer '.length)

    try {
      const decoded = verifyAccessToken(token)
      request.userId = decoded.sub
      request.orgId = decoded.org
      request.role = decoded.role
      request.permissions = decoded.permissions
    } catch {
      return reply.status(401).send({
        error: {
          code: 'UNAUTHORIZED',
          message: 'Invalid or expired access token',
          request_id: request.id,
        },
      })
    }
  })

  // Step 2 (preHandler): wrap the remaining handler chain in the tenant
  // AsyncLocalStorage context so that Prisma queries automatically inherit
  // the orgId without explicit parameter threading.
  fastify.addHook('preHandler', (request: FastifyRequest, _reply: FastifyReply, done: () => void) => {
    // request.orgId is guaranteed to be set by the onRequest hook above
    // (requests that fail auth never reach this hook).
    runWithOrgId(request.orgId, done)
  })
}

export default fp(authPlugin, {
  name: 'auth',
  fastify: '4.x',
})
