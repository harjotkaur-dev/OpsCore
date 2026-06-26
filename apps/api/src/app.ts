import Fastify from 'fastify'
import helmet from '@fastify/helmet'
import cookie from '@fastify/cookie'
import { config } from '@opscore/config'
import requestIdPlugin from './plugins/requestId.js'
import corsPlugin from './plugins/cors.js'
import rateLimitPlugin from './plugins/rateLimit.js'
import { healthRoutes } from './routes/health.js'
import { organizationRoutes } from './routes/organizations.js'
import { authRoutes } from './routes/auth.js'
import { teamRoutes } from './routes/teams.js'
import { eventTypeRoutes } from './routes/eventTypes.js'
import { eventRoutes } from './routes/events.js'
import { workflowRoutes } from './routes/workflows.js'
import { executionRoutes, queueRoutes } from './routes/executions.js'
import { taskRoutes } from './routes/tasks.js'
import { auditLogRoutes } from './routes/auditLogs.js'
import { metricRoutes } from './routes/metrics.js'
import { notificationRoutes } from './routes/notifications.js'
import { dashboardRoutes } from './routes/dashboard.js'
import { userRoutes } from './routes/users.js'

export async function buildApp() {
  const isDev = config.NODE_ENV !== 'production'

  const app = Fastify({
    // In production: plain JSON to stdout (consumed by log aggregators)
    // In development: pino-pretty for human-readable colourised output
    logger: isDev
      ? {
          level: config.LOG_LEVEL,
          transport: {
            target: 'pino-pretty',
            options: { colorize: true, translateTime: 'SYS:standard' },
          },
          serializers: {
            // Task 7.5: include .stack in error log entries (Req 10.5)
            err: (err: Error) => ({
              type: err.constructor?.name ?? 'Error',
              message: err.message,
              stack: err.stack ?? '',
            }),
          },
        }
      : {
          level: config.LOG_LEVEL,
          serializers: {
            // Task 7.5: include .stack in error log entries (Req 10.5)
            err: (err: Error) => ({
              type: err.constructor?.name ?? 'Error',
              message: err.message,
              stack: err.stack ?? '',
            }),
          },
        },
    // Let our requestId plugin control the id; disable Fastify's default header
    requestIdHeader: false,
    genReqId: () => crypto.randomUUID(),
    // Trust X-Forwarded-* headers when behind a reverse proxy (nginx in Docker)
    trustProxy: !isDev,
  })

  // -------------------------------------------------------------------------
  // Core plugins — order matters:
  //   1. requestId  — must run first so all subsequent hooks have request.id
  //   2. cors       — must run before routes handle preflight OPTIONS
  //   3. helmet     — security headers
  //   4. cookie     — needed by auth routes
  // -------------------------------------------------------------------------
  await app.register(requestIdPlugin)
  await app.register(corsPlugin)
  await app.register(helmet, { global: true })
  await app.register(cookie, { secret: config.COOKIE_SECRET })

  // -------------------------------------------------------------------------
  // Rate limiting — fixed window, 1000 req/min per org (Task 10.1, Req 13.6)
  // Registered globally; runs as preHandler after authPlugin sets request.orgId.
  // Excluded routes: /health, /v1/auth/* (no orgId on those paths)
  // Failure mode: FAIL OPEN (Redis unavailable → allow request through)
  // -------------------------------------------------------------------------
  await app.register(rateLimitPlugin)

  // -------------------------------------------------------------------------
  // Global onResponse hook — structured HTTP request log (Task 7.5, Req 10.2)
  // Emits: { method, path, status, response_time_ms, organization_id, request_id }
  // -------------------------------------------------------------------------
  app.addHook('onResponse', (request, reply, done) => {
    request.log.info({
      method: request.method,
      path: request.routerPath ?? request.url,
      status: reply.statusCode,
      response_time_ms: Math.round(reply.elapsedTime),
      organization_id: (request as { orgId?: string }).orgId ?? null,
      request_id: request.id,
    }, 'request completed')
    done()
  })

  // -------------------------------------------------------------------------
  // Global error handler
  // Catches any unhandled error from route handlers or plugins.
  // Logs the full error server-side (with request context); returns a safe
  // opaque envelope to the caller — no stack traces, no internal details.
  // -------------------------------------------------------------------------
  app.setErrorHandler((error, request, reply) => {
    const requestId = request.id

    // Fastify validation errors (schema mismatch) — surface them as 422
    if (error.validation) {
      return reply.status(422).send({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Request validation failed',
          details: error.validation,
          request_id: requestId,
        },
      })
    }

    // Known HTTP errors thrown by route handlers (e.g. createError(404, ...))
    const statusCode = error.statusCode ?? 500

    if (statusCode < 500) {
      return reply.status(statusCode).send({
        error: {
          code: error.code ?? 'CLIENT_ERROR',
          message: error.message,
          request_id: requestId,
        },
      })
    }

    // 5xx — log full detail server-side, return opaque response to client
    const errorId = crypto.randomUUID()
    request.log.error(
      {
        err: {
          message: error.message,
          stack: error.stack,
          code: error.code,
        },
        error_id: errorId,
        request_id: requestId,
        context: 'api_handler',
      },
      'Unhandled server error',
    )

    return reply.status(500).send({
      error: {
        code: 'INTERNAL_ERROR',
        message: 'An unexpected error occurred',
        error_id: errorId,
        request_id: requestId,
      },
    })
  })

  // -------------------------------------------------------------------------
  // Routes
  // -------------------------------------------------------------------------
  await app.register(healthRoutes)
  await app.register(organizationRoutes)
  await app.register(authRoutes)
  await app.register(teamRoutes)
  await app.register(eventTypeRoutes)
  await app.register(eventRoutes)
  await app.register(workflowRoutes)
  await app.register(executionRoutes)
  await app.register(queueRoutes)
  await app.register(taskRoutes)
  await app.register(auditLogRoutes)
  await app.register(metricRoutes)
  await app.register(notificationRoutes)
  await app.register(dashboardRoutes)
  await app.register(userRoutes)

  return app
}
