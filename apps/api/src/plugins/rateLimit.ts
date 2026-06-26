/**
 * Rate Limit Plugin — Task 10.1
 *
 * Fixed-window rate limiter: 1000 requests per minute per organization.
 *
 * Algorithm: Fixed Window
 *   key = rate:{orgId}:{Math.floor(Date.now() / 60_000)}
 *   INCR key → if > 1000, reject with 429
 *   EXPIRE key 60 on first write
 *
 * Failure Mode: FAIL OPEN
 *   If Redis is unavailable, the request is allowed to proceed.
 *   Losing rate-limit protection briefly is safer than taking down the API.
 *
 * Excluded routes (no orgId available):
 *   /health
 *   /v1/auth/*
 *
 * This plugin must be registered AFTER authPlugin so that request.orgId
 * is populated before the rate-limit check runs.
 *
 * Requirements: 13.6
 */

import fp from 'fastify-plugin'
import type { FastifyPluginAsync, FastifyRequest, FastifyReply } from 'fastify'
import { redisClient } from '../lib/redis.js'
import { logger } from '@opscore/logger'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const WINDOW_MS = 60_000          // 1 minute in milliseconds
const MAX_REQUESTS = 1_000        // requests per window per org
const WINDOW_SECONDS = 60         // TTL for the Redis key

// ---------------------------------------------------------------------------
// Excluded path prefixes — requests on these paths bypass rate limiting
// ---------------------------------------------------------------------------

const EXCLUDED_PREFIXES = ['/health', '/v1/auth']

function isExcluded(url: string): boolean {
  return EXCLUDED_PREFIXES.some((prefix) => url === prefix || url.startsWith(prefix + '/') || url.startsWith(prefix + '?'))
}

// ---------------------------------------------------------------------------
// Plugin
// ---------------------------------------------------------------------------

const rateLimitPlugin: FastifyPluginAsync = async (fastify) => {
  fastify.addHook('preHandler', async (request: FastifyRequest, reply: FastifyReply) => {
    // Skip excluded routes
    if (isExcluded(request.url)) return

    // orgId must be set by authPlugin — if missing, the request is
    // unauthenticated and should have been rejected before reaching here.
    // Fail open to avoid blocking legitimate unauthenticated error paths.
    const orgId = (request as { orgId?: string }).orgId
    if (!orgId) return

    try {
      const windowStart = Math.floor(Date.now() / WINDOW_MS)
      const key = `rate:${orgId}:${windowStart}`

      // INCR is atomic — safe for concurrent requests
      const count = await redisClient.incr(key)

      // Set TTL on the first increment only
      if (count === 1) {
        await redisClient.expire(key, WINDOW_SECONDS)
      }

      if (count > MAX_REQUESTS) {
        // Calculate seconds until next window boundary
        const windowEnd = (windowStart + 1) * WINDOW_MS
        const retryAfter = Math.ceil((windowEnd - Date.now()) / 1000)

        return reply
          .status(429)
          .header('Retry-After', String(retryAfter))
          .send({
            error: {
              code: 'RATE_LIMIT_EXCEEDED',
              message: `Rate limit exceeded. Maximum ${MAX_REQUESTS} requests per minute per organization.`,
              request_id: request.id,
              retry_after: retryAfter,
            },
          })
      }
    } catch (err) {
      // FAIL OPEN — Redis unavailable, allow the request through
      logger.error(
        { err, orgId, url: request.url },
        'Rate limiter Redis error — failing open',
      )
    }
  })
}

export default fp(rateLimitPlugin, {
  name: 'rate-limit',
  fastify: '4.x',
})
