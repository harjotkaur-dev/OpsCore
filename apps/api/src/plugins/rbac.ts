/**
 * RBAC plugin — permission enforcement for protected routes.
 *
 * Exports `requirePermission(perm)` which returns a Fastify preHandler
 * function.  The preHandler checks that `request.permissions` contains
 * the required permission string and returns 403 if it does not.
 *
 * This module assumes the auth plugin has already run and populated
 * `request.permissions`.  Register auth first, then use `requirePermission`
 * as an additional preHandler on routes that need fine-grained access control.
 *
 * Usage:
 *   fastify.post('/v1/workflows', {
 *     preHandler: [requirePermission('workflow:create')],
 *   }, handler)
 *
 * Permission map:
 *   Permissions are `resource:action` strings. The full mapping for all five
 *   built-in roles is defined in ROLE_PERMISSIONS below and mirrors the
 *   mapping in AuthService.ts (used when signing JWT tokens).
 */

import type { FastifyRequest, FastifyReply } from 'fastify'

// ---------------------------------------------------------------------------
// Permission map — mirrors AuthService.ROLE_PERMISSIONS
// ---------------------------------------------------------------------------

export const ROLE_PERMISSIONS: Readonly<Record<string, readonly string[]>> = {
  owner: [
    'organization:read', 'organization:update', 'organization:deactivate',
    'user:read', 'user:update', 'user:invite', 'user:role',
    'team:create', 'team:read', 'team:update', 'team:archive', 'team:member',
    'event_type:create', 'event_type:read', 'event_type:update', 'event_type:deprecate',
    'event:ingest', 'event:read',
    'workflow:create', 'workflow:read', 'workflow:update', 'workflow:activate', 'workflow:delete',
    'task:create', 'task:read', 'task:update', 'task:assign', 'task:cancel', 'task:delete',
    'execution:read', 'execution:retry',
    'metric:read', 'kpi:create', 'kpi:read', 'kpi:update', 'kpi:delete',
    'notification:read', 'notification:update',
    'audit_log:read',
  ],
  admin: [
    'organization:read', 'organization:update',
    'user:read', 'user:update', 'user:invite',
    'team:create', 'team:read', 'team:update', 'team:archive', 'team:member',
    'event_type:create', 'event_type:read', 'event_type:update', 'event_type:deprecate',
    'event:ingest', 'event:read',
    'workflow:create', 'workflow:read', 'workflow:update', 'workflow:activate', 'workflow:delete',
    'task:create', 'task:read', 'task:update', 'task:assign', 'task:cancel',
    'execution:read', 'execution:retry',
    'metric:read', 'kpi:create', 'kpi:read', 'kpi:update', 'kpi:delete',
    'notification:read', 'notification:update',
    'audit_log:read',
  ],
  operations_manager: [
    'event_type:create', 'event_type:read', 'event_type:update', 'event_type:deprecate',
    'event:ingest', 'event:read',
    'workflow:create', 'workflow:read', 'workflow:update', 'workflow:activate',
    'task:create', 'task:read', 'task:update', 'task:assign', 'task:cancel',
    'execution:read', 'execution:retry',
    'metric:read', 'kpi:create', 'kpi:read', 'kpi:update', 'kpi:delete',
    'audit_log:read',
  ],
  team_lead: [
    'event:read', 'execution:read',
    'task:create', 'task:read', 'task:update', 'task:assign', 'task:cancel',
    'notification:read', 'notification:update',
  ],
  member: [
    'task:read', 'task:update',
    'notification:read', 'notification:update',
  ],
}

// ---------------------------------------------------------------------------
// requirePermission
// ---------------------------------------------------------------------------

/**
 * Returns a Fastify preHandler function that enforces the given permission.
 *
 * The handler inspects `request.permissions` (populated by the auth plugin)
 * and replies with 403 if the required permission is absent.
 *
 * @param perm - A `resource:action` permission string, e.g. `'workflow:create'`.
 */
export function requirePermission(
  perm: string,
): (request: FastifyRequest, reply: FastifyReply) => Promise<void> {
  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    if (!request.permissions.includes(perm)) {
      return reply.status(403).send({
        error: {
          code: 'FORBIDDEN',
          message: `Missing required permission: ${perm}`,
          request_id: request.id,
        },
      })
    }
  }
}
