/**
 * Idempotency helpers — Task 3.2
 *
 * Two-layer idempotency: Redis (fast) → PostgreSQL (durable fallback).
 * Designed to guard Event ingestion and Task creation against duplicates.
 *
 * Key lifecycle:
 *   1. checkKey()       — returns existing record or null
 *   2. setKeyInFlight() — atomically claims the key (SET NX EX 86400)
 *   3. setKeyCompleted()— persists final result to DB + updates Redis cache
 *
 * computeSystemKey() generates a deterministic idempotency key when the
 * caller has not supplied a client-provided Idempotency-Key header.
 */

import { createHash } from 'node:crypto'
import type { Prisma } from '@prisma/client'
import { redisClient } from './redis.js'
import { prisma } from './prisma.js'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface IdempotencyRecord {
  status: 'in_flight' | 'completed'
  responseStatus?: number
  responseBody?: unknown
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Redis key format: `idempotency:{orgId}:{key}` */
function redisKey(orgId: string, key: string): string {
  return `idempotency:${orgId}:${key}`
}

/** 24 hours in seconds — matches DB expiresAt policy */
const TTL_SECONDS = 86400

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Check whether an idempotency key already exists.
 *
 * Strategy:
 *  1. Try Redis (O(1), fast path)
 *  2. On miss, fall back to PostgreSQL (handles Redis eviction / restarts)
 *
 * Returns the stored record or null if the key has never been seen.
 */
export async function checkKey(
  orgId: string,
  key: string,
): Promise<IdempotencyRecord | null> {
  // --- Redis fast path ---
  const cached = await redisClient.get(redisKey(orgId, key))
  if (cached) {
    try {
      return JSON.parse(cached) as IdempotencyRecord
    } catch {
      // Corrupt cache entry — fall through to DB
    }
  }

  // --- DB fallback ---
  const record = await prisma.idempotencyKey.findFirst({
    where: {
      organizationId: orgId,
      key,
      expiresAt: { gt: new Date() },
    },
  })

  if (!record) return null

  return {
    status: record.status as 'in_flight' | 'completed',
    responseStatus: record.responseStatus,
    responseBody: record.responseBody as unknown,
  }
}

/**
 * Atomically claim an idempotency key as "in-flight".
 *
 * Uses Redis SET NX EX so only one concurrent request can claim the key.
 *
 * @returns true  if the key was successfully claimed (proceed with request)
 * @returns false if the key already exists (conflict — return 409)
 */
export async function setKeyInFlight(orgId: string, key: string): Promise<boolean> {
  const payload: IdempotencyRecord = { status: 'in_flight' }
  // SET key value NX EX ttl — returns 'OK' on success, null if key existed
  const result = await redisClient.set(
    redisKey(orgId, key),
    JSON.stringify(payload),
    'EX',
    TTL_SECONDS,
    'NX',
  )
  return result === 'OK'
}

/**
 * Mark an idempotency key as completed, persisting the response.
 *
 * Writes the final response to PostgreSQL (durable) then updates Redis
 * so subsequent identical requests get a fast cache hit.
 */
export async function setKeyCompleted(
  orgId: string,
  key: string,
  responseStatus: number,
  responseBody: unknown,
): Promise<void> {
  const now = new Date()
  const expiresAt = new Date(now.getTime() + TTL_SECONDS * 1000)

  // Upsert to DB — handles the case where the in-flight record was already
  // written to DB (e.g. by a previous partial failure).
  await prisma.idempotencyKey.upsert({
    where: { organizationId_key: { organizationId: orgId, key } },
    create: {
      organizationId: orgId,
      key,
      requestHash: '',
      responseStatus,
      responseBody: responseBody as Prisma.InputJsonValue,
      status: 'completed',
      createdAt: now,
      expiresAt,
    },
    update: {
      responseStatus,
      responseBody: responseBody as Prisma.InputJsonValue,
      status: 'completed',
      expiresAt,
    },
  })

  // Update Redis cache with the completed response
  const cachePayload: IdempotencyRecord = { status: 'completed', responseStatus, responseBody }
  await redisClient.set(
    redisKey(orgId, key),
    JSON.stringify(cachePayload),
    'EX',
    TTL_SECONDS,
  )
}

/**
 * Compute a deterministic system-generated idempotency key.
 *
 * Used when the caller does not supply an Idempotency-Key header.
 * The key is SHA-256(orgId | eventTypeId | source | JSON(sortedPayload)).
 *
 * @param orgId       - Organisation scope
 * @param eventTypeId - Event type UUID
 * @param source      - Event source string
 * @param payload     - Event payload (keys sorted for determinism)
 */
export function computeSystemKey(
  orgId: string,
  eventTypeId: string,
  source: string,
  payload: unknown,
): string {
  const sortedPayload = sortObjectKeys(payload)
  const raw = `${orgId}|${eventTypeId}|${source}|${JSON.stringify(sortedPayload)}`
  return createHash('sha256').update(raw).digest('hex')
}

// ---------------------------------------------------------------------------
// Internal — sort object keys recursively for deterministic serialisation
// ---------------------------------------------------------------------------

function sortObjectKeys(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortObjectKeys)
  }
  if (value !== null && typeof value === 'object') {
    const sorted: Record<string, unknown> = {}
    for (const k of Object.keys(value as object).sort()) {
      sorted[k] = sortObjectKeys((value as Record<string, unknown>)[k])
    }
    return sorted
  }
  return value
}
