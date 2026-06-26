import fp from 'fastify-plugin'
import type { FastifyPluginAsync } from 'fastify'

/**
 * Assigns a UUID v4 request_id to every inbound request.
 * - Sets it as `request.id` (Fastify's built-in request id field)
 * - Returns it in the `X-Request-Id` response header so callers can
 *   correlate their request with platform logs
 * - Fastify's built-in logger automatically picks up request.id
 */
const requestIdPlugin: FastifyPluginAsync = async (fastify) => {
  fastify.addHook('onRequest', async (request, reply) => {
    // Use client-supplied header if present (useful for distributed tracing),
    // otherwise generate a fresh UUID v4
    const incoming = request.headers['x-request-id']
    const requestId =
      typeof incoming === 'string' && incoming.length > 0
        ? incoming
        : crypto.randomUUID()

    // Override request.id — Fastify binds this into the child logger automatically
    ;(request as typeof request & { id: string }).id = requestId

    reply.header('X-Request-Id', requestId)
  })
}

export default fp(requestIdPlugin, {
  name: 'request-id',
  fastify: '4.x',
})
