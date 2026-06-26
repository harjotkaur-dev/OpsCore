import fp from 'fastify-plugin'
import cors from '@fastify/cors'
import type { FastifyPluginAsync } from 'fastify'
import { config } from '@opscore/config'

/**
 * CORS plugin — reads CORS_ORIGIN from validated config.
 * In development this is typically http://localhost:5173 (Vite dev server).
 * In production, set CORS_ORIGIN to the actual frontend origin.
 */
const corsPlugin: FastifyPluginAsync = async (fastify) => {
  await fastify.register(cors, {
    origin: config.CORS_ORIGIN,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'X-Request-Id',
      'Idempotency-Key',
    ],
    credentials: true,
  })
}

export default fp(corsPlugin, {
  name: 'cors',
  fastify: '4.x',
})
