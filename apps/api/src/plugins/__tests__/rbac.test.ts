/**
 * Unit tests for plugins/rbac.ts
 *
 * Covers:
 *  - requirePermission returns 403 when the permission is absent from request.permissions
 *  - requirePermission allows the request when the permission is present
 *  - ROLE_PERMISSIONS map correctness: each role has its expected set of permissions
 *  - Owner has all permissions
 *  - Admin lacks billing-only permissions (organization:deactivate)
 *  - Member cannot access admin-level permissions
 */

import { describe, it, expect } from '@jest/globals'
import Fastify from 'fastify'
import type { FastifyInstance } from 'fastify'
import { requirePermission, ROLE_PERMISSIONS } from '../rbac.js'

// Apply the FastifyRequest module augmentation inline so TypeScript knows
// about userId/orgId/role/permissions without importing auth.ts (which has
// side-effectful config validation at module load time).
declare module 'fastify' {
  interface FastifyRequest {
    userId: string
    orgId: string
    role: string
    permissions: string[]
  }
}

// ---------------------------------------------------------------------------
// Helper — build a test app that pre-populates request.permissions
// ---------------------------------------------------------------------------

async function buildApp(permissions: string[]): Promise<FastifyInstance> {
  const app = Fastify({ logger: false })

  // Simulate the auth plugin having run — inject permissions directly
  app.addHook('preHandler', async (request) => {
    request.userId = 'user-test-id'
    request.orgId = 'org-test-id'
    request.role = 'test-role'
    request.permissions = permissions
  })

  // Route protected by a specific permission
  app.get('/needs-workflow-create', {
    preHandler: [requirePermission('workflow:create')],
    handler: async () => ({ ok: true }),
  })

  app.get('/needs-audit-log-read', {
    preHandler: [requirePermission('audit_log:read')],
    handler: async () => ({ ok: true }),
  })

  app.get('/needs-org-deactivate', {
    preHandler: [requirePermission('organization:deactivate')],
    handler: async () => ({ ok: true }),
  })

  await app.ready()

  // Fastify TypeScript augmentation — declare module so types compile
  return app
}

// ---------------------------------------------------------------------------
// requirePermission — runtime enforcement
// ---------------------------------------------------------------------------

describe('requirePermission', () => {
  it('returns 403 when the required permission is not in request.permissions', async () => {
    const app = await buildApp(['task:read', 'task:update'])

    const response = await app.inject({ method: 'GET', url: '/needs-workflow-create' })

    expect(response.statusCode).toBe(403)
    const body = response.json<{ error: { code: string; message: string } }>()
    expect(body.error.code).toBe('FORBIDDEN')
    expect(body.error.message).toContain('workflow:create')
  })

  it('allows the request when the required permission is present', async () => {
    const app = await buildApp(['task:read', 'workflow:create'])

    const response = await app.inject({ method: 'GET', url: '/needs-workflow-create' })

    expect(response.statusCode).toBe(200)
    const body = response.json<{ ok: boolean }>()
    expect(body.ok).toBe(true)
  })

  it('returns 403 for an empty permissions array', async () => {
    const app = await buildApp([])

    const response = await app.inject({ method: 'GET', url: '/needs-workflow-create' })

    expect(response.statusCode).toBe(403)
  })

  it('includes the required permission name in the error message', async () => {
    const app = await buildApp([])

    const response = await app.inject({ method: 'GET', url: '/needs-audit-log-read' })

    expect(response.statusCode).toBe(403)
    const body = response.json<{ error: { message: string } }>()
    expect(body.error.message).toContain('audit_log:read')
  })

  it('returns 403 for a permission that is a substring of one the user has', async () => {
    // Ensure exact match is required — 'task:read' should not satisfy 'task:read:admin'
    const freshApp = Fastify({ logger: false })
    freshApp.addHook('preHandler', async (request) => {
      request.userId = 'user-test-id'
      request.orgId = 'org-test-id'
      request.role = 'test-role'
      request.permissions = ['task:read']
    })
    freshApp.get('/custom', {
      preHandler: [requirePermission('task:read:admin')],
      handler: async () => ({ ok: true }),
    })
    await freshApp.ready()

    const response = await freshApp.inject({ method: 'GET', url: '/custom' })
    expect(response.statusCode).toBe(403)
  })

  it('includes request_id in the 403 error envelope', async () => {
    const app = await buildApp([])

    const response = await app.inject({ method: 'GET', url: '/needs-workflow-create' })

    const body = response.json<{ error: { request_id: unknown } }>()
    expect(body.error).toHaveProperty('request_id')
  })
})

// ---------------------------------------------------------------------------
// ROLE_PERMISSIONS map
// ---------------------------------------------------------------------------

describe('ROLE_PERMISSIONS map', () => {
  it('defines all five roles', () => {
    const roles = Object.keys(ROLE_PERMISSIONS)
    expect(roles).toContain('owner')
    expect(roles).toContain('admin')
    expect(roles).toContain('operations_manager')
    expect(roles).toContain('team_lead')
    expect(roles).toContain('member')
  })

  describe('owner', () => {
    const perms = ROLE_PERMISSIONS['owner'] ?? []

    it('has organization:deactivate', () => expect(perms).toContain('organization:deactivate'))
    it('has audit_log:read', () => expect(perms).toContain('audit_log:read'))
    it('has workflow:create', () => expect(perms).toContain('workflow:create'))
    it('has task:cancel', () => expect(perms).toContain('task:cancel'))
    it('has kpi:delete', () => expect(perms).toContain('kpi:delete'))
    it('has execution:retry', () => expect(perms).toContain('execution:retry'))
  })

  describe('admin', () => {
    const perms = ROLE_PERMISSIONS['admin'] ?? []

    it('has organization:read and organization:update', () => {
      expect(perms).toContain('organization:read')
      expect(perms).toContain('organization:update')
    })

    it('does NOT have organization:deactivate (owner-only)', () => {
      expect(perms).not.toContain('organization:deactivate')
    })

    it('has all workflow permissions', () => {
      expect(perms).toContain('workflow:create')
      expect(perms).toContain('workflow:read')
      expect(perms).toContain('workflow:update')
      expect(perms).toContain('workflow:activate')
      expect(perms).toContain('workflow:delete')
    })

    it('has audit_log:read', () => expect(perms).toContain('audit_log:read'))
  })

  describe('operations_manager', () => {
    const perms = ROLE_PERMISSIONS['operations_manager'] ?? []

    it('has full workflow CRUD except delete', () => {
      expect(perms).toContain('workflow:create')
      expect(perms).toContain('workflow:read')
      expect(perms).toContain('workflow:update')
      expect(perms).toContain('workflow:activate')
    })

    it('does NOT have workflow:delete (Owner/Admin only)', () => {
      expect(perms).not.toContain('workflow:delete')
    })

    it('has audit_log:read', () => expect(perms).toContain('audit_log:read'))

    it('does NOT have organization:deactivate', () => {
      expect(perms).not.toContain('organization:deactivate')
    })

    it('does NOT have user:invite', () => {
      expect(perms).not.toContain('user:invite')
    })

    it('has execution:retry', () => expect(perms).toContain('execution:retry'))
  })

  describe('team_lead', () => {
    const perms = ROLE_PERMISSIONS['team_lead'] ?? []

    it('has task CRUD permissions', () => {
      expect(perms).toContain('task:create')
      expect(perms).toContain('task:read')
      expect(perms).toContain('task:update')
      expect(perms).toContain('task:assign')
      expect(perms).toContain('task:cancel')
    })

    it('has event:read and execution:read', () => {
      expect(perms).toContain('event:read')
      expect(perms).toContain('execution:read')
    })

    it('does NOT have workflow:create', () => {
      expect(perms).not.toContain('workflow:create')
    })

    it('does NOT have audit_log:read', () => {
      expect(perms).not.toContain('audit_log:read')
    })

    it('does NOT have organization:read', () => {
      expect(perms).not.toContain('organization:read')
    })
  })

  describe('member', () => {
    const perms = ROLE_PERMISSIONS['member'] ?? []

    it('has task:read and task:update', () => {
      expect(perms).toContain('task:read')
      expect(perms).toContain('task:update')
    })

    it('has notification:read and notification:update', () => {
      expect(perms).toContain('notification:read')
      expect(perms).toContain('notification:update')
    })

    it('does NOT have task:create', () => {
      expect(perms).not.toContain('task:create')
    })

    it('does NOT have task:assign', () => {
      expect(perms).not.toContain('task:assign')
    })

    it('does NOT have workflow:read', () => {
      expect(perms).not.toContain('workflow:read')
    })

    it('does NOT have audit_log:read', () => {
      expect(perms).not.toContain('audit_log:read')
    })

    it('does NOT have event:ingest', () => {
      expect(perms).not.toContain('event:ingest')
    })
  })

  describe('permission set relationships', () => {
    it('owner permissions are a superset of admin permissions', () => {
      const ownerPerms = new Set(ROLE_PERMISSIONS['owner'])
      const adminPerms = ROLE_PERMISSIONS['admin'] ?? []
      for (const perm of adminPerms) {
        expect(ownerPerms.has(perm)).toBe(true)
      }
    })

    it('admin permissions are a superset of operations_manager permissions', () => {
      const adminPerms = new Set(ROLE_PERMISSIONS['admin'])
      const omPerms = ROLE_PERMISSIONS['operations_manager'] ?? []
      for (const perm of omPerms) {
        expect(adminPerms.has(perm)).toBe(true)
      }
    })

    it('member has fewer permissions than team_lead', () => {
      const memberCount = (ROLE_PERMISSIONS['member'] ?? []).length
      const teamLeadCount = (ROLE_PERMISSIONS['team_lead'] ?? []).length
      expect(memberCount).toBeLessThan(teamLeadCount)
    })
  })
})

// ---------------------------------------------------------------------------
// TypeScript type augmentation check — verify the module augmentation compiles
// ---------------------------------------------------------------------------

describe('Fastify type augmentation', () => {
  it('FastifyRequest has auth claim properties accessible via type augmentation', async () => {
    const app = Fastify({ logger: false })

    app.addHook('preHandler', async (request) => {
      request.userId = 'uid'
      request.orgId = 'oid'
      request.role = 'member'
      request.permissions = ['task:read']
    })

    app.get('/type-check', async (request) => ({
      userId: request.userId,
      orgId: request.orgId,
      role: request.role,
      permissions: request.permissions,
    }))

    await app.ready()

    const response = await app.inject({ method: 'GET', url: '/type-check' })
    const body = response.json<{
      userId: string
      orgId: string
      role: string
      permissions: string[]
    }>()

    expect(body.userId).toBe('uid')
    expect(body.orgId).toBe('oid')
    expect(body.role).toBe('member')
    expect(body.permissions).toEqual(['task:read'])
  })
})
