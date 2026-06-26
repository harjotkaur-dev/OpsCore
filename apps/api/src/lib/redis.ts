import { Redis } from 'ioredis'
import type { RedisOptions } from 'ioredis'
import { config } from '@opscore/config'
import { logger } from '@opscore/logger'

/** Parse a `redis://host:port` URL into a BullMQ-compatible ConnectionOptions object. */
export function parseRedisConnectionOptions(url: string): RedisOptions {
  const parsed = new URL(url)
  return {
    host: parsed.hostname,
    port: Number(parsed.port) || 6379,
    // Required by BullMQ Worker to avoid blocking the event loop
    maxRetriesPerRequest: null,
  }
}

// Singleton ioredis client
const globalForRedis = global as unknown as { redisClient: Redis }

export const redisClient: Redis =
  globalForRedis.redisClient ??
  new Redis(config.REDIS_URL, {
    maxRetriesPerRequest: null,
    lazyConnect: false,
  })

if (process.env['NODE_ENV'] !== 'production') {
  globalForRedis.redisClient = redisClient
}

redisClient.on('connect', () => {
  logger.info({ msg: 'Redis connected' })
})

redisClient.on('error', (err: Error) => {
  // Log the error but do NOT throw — ioredis handles reconnection internally
  logger.error({ msg: 'Redis error', err })
})

export default redisClient
