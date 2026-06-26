/**
 * Tenant context — propagates the active organization ID through async call
 * chains using Node.js AsyncLocalStorage.
 *
 * Usage:
 *   runWithOrgId(orgId, () => {
 *     // Any code here (including Prisma queries) can read the org ID via
 *     // getOrgId() or by inspecting the store directly.
 *   })
 */

import { AsyncLocalStorage } from 'node:async_hooks'

// ---------------------------------------------------------------------------
// Store type
// ---------------------------------------------------------------------------

export interface TenantStore {
  orgId: string
}

// ---------------------------------------------------------------------------
// Singleton AsyncLocalStorage instance
// ---------------------------------------------------------------------------

export const tenantStorage = new AsyncLocalStorage<TenantStore>()

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Run `fn` inside an async context that carries the given `orgId`.
 * All code executed inside `fn` — including Prisma middleware — can retrieve
 * the org ID via `getOrgId()` without any explicit parameter threading.
 */
export function runWithOrgId<T>(orgId: string, fn: () => T): T {
  return tenantStorage.run({ orgId }, fn)
}

/**
 * Return the `orgId` stored in the current async context, or `null` if
 * called outside of a `runWithOrgId` scope (e.g. during startup / migrations).
 */
export function getOrgId(): string | null {
  return tenantStorage.getStore()?.orgId ?? null
}
