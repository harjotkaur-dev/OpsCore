import type { FastifyInstance } from 'fastify'
import { prisma } from '../lib/prisma.js'
import { redisClient } from '../lib/redis.js'

interface HealthResponse {
  status: 'ok' | 'degraded'
  timestamp: string
  checks: {
    database: 'ok' | 'error'
    redis: 'ok' | 'error'
  }
}

export async function healthRoutes(app: FastifyInstance) {
  /**
   * GET /health
   *
   * Returns platform connectivity status.
   * - 200 when all checks pass
   * - 503 when any check fails (allows load balancers to pull the instance)
   *
   * No authentication required — used by Docker health checks and monitoring.
   */
  app.get<{ Reply: HealthResponse }>(
    '/health',
    {
      schema: {
        response: {
          200: {
            type: 'object',
            properties: {
              status: { type: 'string', enum: ['ok', 'degraded'] },
              timestamp: { type: 'string' },
              checks: {
                type: 'object',
                properties: {
                  database: { type: 'string', enum: ['ok', 'error'] },
                  redis: { type: 'string', enum: ['ok', 'error'] },
                },
              },
            },
          },
          503: {
            type: 'object',
            properties: {
              status: { type: 'string' },
              timestamp: { type: 'string' },
              checks: {
                type: 'object',
                properties: {
                  database: { type: 'string' },
                  redis: { type: 'string' },
                },
              },
            },
          },
        },
      },
    },
    async (_request, reply) => {
      const [dbStatus, redisStatus] = await Promise.all([
        prisma.$queryRaw`SELECT 1`
          .then(() => 'ok' as const)
          .catch(() => 'error' as const),

        redisClient
          .ping()
          .then((res): 'ok' | 'error' => (res === 'PONG' ? 'ok' : 'error'))
          .catch((): 'error' => 'error'),
      ])

      const allOk = dbStatus === 'ok' && redisStatus === 'ok'
      const body: HealthResponse = {
        status: allOk ? 'ok' : 'degraded',
        timestamp: new Date().toISOString(),
        checks: {
          database: dbStatus,
          redis: redisStatus,
        },
      }

      return reply.status(allOk ? 200 : 503).send(body)
    },
  )
}
