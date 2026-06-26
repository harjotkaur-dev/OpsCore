/**
 * AuditService — Task 7.1
 *
 * Canonical service for writing audit log entries.
 *
 * Design decisions:
 *  - `log` accepts a TransactionClient so the audit write happens atomically
 *    with the state-changing operation (Req 9.5, 14.5).
 *  - Sensitive fields (password_hash, token variants, secrets) are stripped
 *    from beforeState / afterState before persisting (Req 9.2).
 *  - Existing inline `tx.auditLog.create(...)` calls in other services are
 *    intentionally left as-is — migrating them is a separate refactor.
 *
 * Requirements: 9.1, 9.2, 9.3, 9.4
 */

import { Prisma } from '@prisma/client'
import type { TransactionClient } from '../lib/prisma.js'

// ---------------------------------------------------------------------------
// Keys to scrub from state snapshots before persisting
// ---------------------------------------------------------------------------

const SENSITIVE_KEYS = new Set([
  'password_hash',
  'passwordHash',
  'token',
  'tokenHash',
  'token_hash',
  'refreshToken',
  'refresh_token',
  'invitationToken',
  'invitation_token',
  'secret',
  'privateKey',
  'private_key',
])

/**
 * Strip sensitive fields from a state snapshot object (one level deep).
 * Returns null if the input is null/undefined.
 */
export function scrubSensitiveFields(
  state: Record<string, unknown> | null | undefined,
): Record<string, unknown> | null {
  if (state == null) return null

  const result: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(state)) {
    if (!SENSITIVE_KEYS.has(key)) {
      result[key] = value
    }
  }
  return result
}

// ---------------------------------------------------------------------------
// Input type
// ---------------------------------------------------------------------------

export interface AuditLogParams {
  orgId: string
  entityType: string
  entityId: string
  action: string
  actorType: 'user' | 'system'
  actorId?: string | null
  beforeState?: Record<string, unknown> | null
  afterState?: Record<string, unknown> | null
  requestId?: string | null
}

// ---------------------------------------------------------------------------
// AuditService
// ---------------------------------------------------------------------------

export const AuditService = {
  /**
   * Write an audit log entry using the provided transaction client.
   *
   * Always call this inside an existing `prisma.$transaction` so the audit
   * write is atomic with the state-changing operation:
   *
   *   await prisma.$transaction(async (tx) => {
   *     await tx.someModel.create(...)
   *     await AuditService.log(tx, { ... })
   *   })
   *
   * Sensitive fields (password hashes, tokens, secrets) are automatically
   * stripped from beforeState and afterState before persisting.
   */
  async log(tx: TransactionClient, params: AuditLogParams): Promise<void> {
    const before = scrubSensitiveFields(params.beforeState ?? null)
    const after = scrubSensitiveFields(params.afterState ?? null)

    await tx.auditLog.create({
      data: {
        organizationId: params.orgId,
        entityType: params.entityType,
        entityId: params.entityId,
        action: params.action,
        actorType: params.actorType,
        actorId: params.actorId ?? null,
        beforeState: before ?? Prisma.JsonNull,
        afterState: after ?? Prisma.JsonNull,
        requestId: params.requestId ?? null,
      },
    })
  },
}
