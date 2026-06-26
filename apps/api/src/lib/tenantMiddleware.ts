/**
 * Multi-tenant Prisma middleware (Prisma 5 extension-based).
 *
 * Automatically injects `organizationId` into all Prisma queries so that
 * every database operation is silently scoped to the active tenant, even if
 * the calling service layer forgets to pass it explicitly.
 *
 * Behavior by operation:
 *  - findMany / findFirst / findFirstOrThrow / update / updateMany /
 *    delete / deleteMany / upsert  →  inject `where.organizationId = orgId`
 *  - create                        →  inject `data.organizationId = orgId`
 *  - findUnique / findUniqueOrThrow →  NO injection; the caller provides the
 *    primary key and MUST do an explicit org check after the query.
 *
 * Excluded models (tables that do NOT have an organization_id column):
 *  - Organization, User
 *
 * The `orgId` is read from the AsyncLocalStorage tenant context set by the
 * auth plugin via `runWithOrgId` before each request is handled.
 *
 * Exporting `ForbiddenError` for use by service layers that perform the
 * post-query org check on `findUnique` results.
 */

import { Prisma } from '@prisma/client'
import { getOrgId } from './tenantContext.js'

// ---------------------------------------------------------------------------
// ForbiddenError
// ---------------------------------------------------------------------------

/**
 * Thrown by service layers when a `findUnique` result belongs to a different
 * organization than the one in the current request context.
 */
export class ForbiddenError extends Error {
  readonly statusCode = 403
  readonly code = 'FORBIDDEN'

  constructor(message = 'Access to this resource is forbidden') {
    super(message)
    this.name = 'ForbiddenError'
    // Maintain proper prototype chain in compiled JS (ES5 target edge case)
    Object.setPrototypeOf(this, new.target.prototype)
  }
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Models that do NOT carry an `organizationId` column and must be excluded
 * from automatic tenant scoping.
 */
const EXCLUDED_MODELS = new Set(['Organization', 'User'])

/**
 * Operations where we inject `where.organizationId = orgId`.
 */
const WHERE_OPS = new Set([
  'findMany',
  'findFirst',
  'findFirstOrThrow',
  'update',
  'updateMany',
  'delete',
  'deleteMany',
  'upsert',
])

/**
 * Operations where we inject `data.organizationId = orgId`.
 */
const DATA_OPS = new Set(['create'])

// ---------------------------------------------------------------------------
// Core middleware handler (exported for unit testing)
// ---------------------------------------------------------------------------

export interface TenantOperationContext {
  model?: string
  operation: string
  args: Record<string, unknown>
  query: (args: Record<string, unknown>) => Promise<unknown>
}

/**
 * Core tenant-scoping logic. Exported so unit tests can invoke it directly
 * without having to introspect the Prisma extension object internals.
 */
export async function applyTenantScope({
  model,
  operation,
  args,
  query,
}: TenantOperationContext): Promise<unknown> {
  // Skip models that have no organization_id column
  if (model && EXCLUDED_MODELS.has(model)) {
    return query(args)
  }

  const orgId = getOrgId()

  if (orgId === null) {
    // No tenant context (e.g. background jobs that manage their own
    // org scoping, seed scripts, health checks). Pass through unchanged.
    return query(args)
  }

  if (WHERE_OPS.has(operation)) {
    // Merge organizationId into the existing where clause (if any)
    const existingWhere = (args['where'] as Record<string, unknown> | undefined) ?? {}
    return query({
      ...args,
      where: { ...existingWhere, organizationId: orgId },
    })
  }

  if (DATA_OPS.has(operation)) {
    // Inject organizationId into the data payload
    const existingData = (args['data'] as Record<string, unknown> | undefined) ?? {}
    return query({
      ...args,
      data: { ...existingData, organizationId: orgId },
    })
  }

  // findUnique / findUniqueOrThrow and any other operations: pass through.
  // Service layers are responsible for the explicit org check on the result.
  return query(args)
}

// ---------------------------------------------------------------------------
// Prisma extension definition
// ---------------------------------------------------------------------------

/**
 * A Prisma 5 client extension that applies multi-tenant query scoping.
 *
 * Apply via:
 *   const scopedPrisma = prisma.$extends(tenantExtension)
 */
export const tenantExtension = Prisma.defineExtension({
  name: 'tenant-isolation',
  query: {
    $allModels: {
      $allOperations: applyTenantScope,
    },
  },
})
