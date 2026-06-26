/**
 * Redis connection helper for the worker app.
 *
 * Parses a REDIS_URL string into a BullMQ-compatible ConnectionOptions object.
 */

import { URL } from 'node:url'
import type { ConnectionOptions } from 'bullmq'

export function parseRedisConnectionOptions(redisUrl: string): ConnectionOptions {
  const url = new URL(redisUrl)
  return {
    host: url.hostname,
    port: parseInt(url.port || '6379', 10),
    password: url.password || undefined,
    db: url.pathname ? parseInt(url.pathname.slice(1) || '0', 10) : 0,
    maxRetriesPerRequest: null, // required by BullMQ
  }
}
