/**
 * Route-level tests for /v1/audit-logs — Task 7.1
 *
 * Tests:
 *  - GET /v1/audit-logs      — pagination, filters, returns 200
 *  - GET /v1/audit-logs/:id  — returns 200 or 404
 *  - PUT/PATCH/DELETE /v1/audit-logs/:id → 405 (append-only enforcement)
 *
 * Auth plugin is mocked via fastify-plugin registration to inject request
 * properties directly, following the same approach as organizations.test.ts.
 */

import { jest, describe, it, expect, beforeAll, afterAll, beforeEach } from '@jest/globals'
import Fastify from 'fastify'
import fp from 'fastify-plugin'
import type { FastifyInstance } from 'fastify'

// ---------------------------------------------------------------------------
// Sample data
// ---------------------------------------------------------------------------

const ORG_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
const LOG_ID = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'
const ENTITY_ID = 'cccccccc-cccc-cccc-cccc-cccccccccccc'
const ACTOR_ID = 'dddddddd-dddd-dddd-dddd-dddddddddddd'

const sampleLog = {
  id: LOG_ID,
  organizationId: ORG_ID,
  entityType: 'workflow',
  entityId: ENTITY_ID,
  action: 'created',
  actorType: 'user',
  actorId: ACTOR_ID,
  beforeState: null,
  afterState: { id: ENTITY_ID, name: 'My Workflow' },
  timestamp: new Date('2024-06-01T12:00:00Z').toISOString(),
  requestId: 'req-1',
}

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

// Prisma mock — the route uses prisma.auditLog.findMany / findFirst directly
const mockAuditLogFindMany = jest.fn()
const mockAuditLogFindFirst = jest.fn()

jest.unstable_mockModule('../../lib/prisma.js', () => ({
  prisma: {
    auditLog: {
      findMany: mockAuditLogFindMany,
      findFirst: mockAuditLogFindFirst,
    },
    $transaction: jest.fn(),
  },
  PrismaClient: jest.fn(),
}))

// Auth plugin mock — injects request.userId, orgId, role, permissions
jest.unstable_mockModule('../../plugins/auth.js', () => ({
  default: fp(async (fastify: FastifyInstance) => {
    fastify.addHook('onRequest', async (request) => {
      // Inject test auth context
      ;(request as Record<string, unknown>)['userId'] = ACTOR_ID
      ;(request as Record<string, unknown>)['orgId'] = ORG_ID
      ;(request as Record<string, unknown>)['role'] = 'owner'
      ;(request as Record<string, unknown>)['permissions'] = ['audit_log:read']
    })
  }),
}))

// RBAC plugin mock — always passes (permission check handled by auth mock above)
jest.unstable_mockModule('../../plugins/rbac.js', () => ({
  requirePermission: (_perm: string) => async () => {
    // no-op — permission granted in tests
  },
}))

jest.unstable_mockModule('@opscore/config', () => ({
  config: {
    NODE_ENV: 'test',
    DATABASE_URL: 'postgresql://test:test@localhost:5432/test',
    REDIS_URL: 'redis://localhost:6379',
    JWT_PRIVATE_KEY: 'test-private-key',
    JWT_PUBLIC_KEY: 'test-public-key',
    COOKIE_SECRET: 'test-cookie-secret-32-chars-long!!',
    CORS_ORIGIN: 'http://localhost:5173',
    PORT: 3000,
    WORKER_CONCURRENCY_WORKFLOW: 10,
    WORKER_CONCURRENCY_NOTIFICATIONS: 20,
    WORKER_CONCURRENCY_METRICS: 5,
    LOG_LEVEL: 'info',
  },
}))

// Dynamic import AFTER all mocks
const { auditLogRoutes } = await import('../auditLogs.js')

// ---------------------------------------------------------------------------
// App setup
// ---------------------------------------------------------------------------

let app: FastifyInstance

beforeAll(async () => {
  app = Fastify({ logger: false })

  app.setErrorHandler((error, _request, reply) => {
    if (error.validation) {
      return reply.status(422).send({
        error: { code: 'VALIDATION_ERROR', message: 'Validation failed' },
      })
    }
    const code = error.statusCode ?? 500
    return reply.status(code).send({
      error: { code: error.code ?? 'ERROR', message: error.message },
    })
  })

  await app.register(auditLogRoutes)
  await app.ready()
})

afterAll(() => app.close())
beforeEach(() => jest.clearAllMocks())

// ---------------------------------------------------------------------------
// GET /v1/audit-logs
// ---------------------------------------------------------------------------

describe('GET /v1/audit-logs', () => {
  it('returns 200 with paginated results', async () => {
    mockAuditLogFindMany.mockResolvedValue([sampleLog])

    const res = await app.inject({ method: 'GET', url: '/v1/audit-logs' })

    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(body.data).toHaveLength(1)
    expect(body.data[0]).toMatchObject({ id: LOG_ID, entityType: 'workflow' })
    expect(body.pagination).toMatchObject({ limit: 20, hasNextPage: false })
  })

  it('indicates hasNextPage when limit+1 results returned', async () => {
    // 21 logs returned for a default limit of 20
    const logs = Array.from({ length: 21 }, (_, i) => ({ ...sampleLog, id: `log-${i.toString().padStart(4, '0')}` }))
    mockAuditLogFindMany.mockResolvedValue(logs)

    const res = await app.inject({ method: 'GET', url: '/v1/audit-logs?limit=20' })

    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(body.data).toHaveLength(20)
    expect(body.pagination.hasNextPage).toBe(true)
    expect(body.pagination.nextCursor).toBeDefined()
  })

  it('applies entityType filter', async () => {
    mockAuditLogFindMany.mockResolvedValue([])

    await app.inject({ method: 'GET', url: '/v1/audit-logs?entityType=workflow' })

    expect(mockAuditLogFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ entityType: 'workflow' }),
      }),
    )
  })

  it('applies entityId filter', async () => {
    mockAuditLogFindMany.mockResolvedValue([])

    await app.inject({
      method: 'GET',
      url: `/v1/audit-logs?entityId=${ENTITY_ID}`,
    })

    expect(mockAuditLogFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ entityId: ENTITY_ID }),
      }),
    )
  })

  it('applies actorId filter', async () => {
    mockAuditLogFindMany.mockResolvedValue([])

    await app.inject({
      method: 'GET',
      url: `/v1/audit-logs?actorId=${ACTOR_ID}`,
    })

    expect(mockAuditLogFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ actorId: ACTOR_ID }),
      }),
    )
  })

  it('applies action filter', async () => {
    mockAuditLogFindMany.mockResolvedValue([])

    await app.inject({ method: 'GET', url: '/v1/audit-logs?action=created' })

    expect(mockAuditLogFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ action: 'created' }),
      }),
    )
  })

  it('applies date range filter', async () => {
    mockAuditLogFindMany.mockResolvedValue([])

    const from = '2024-01-01T00:00:00Z'
    const to = '2024-12-31T23:59:59Z'

    await app.inject({
      method: 'GET',
      url: `/v1/audit-logs?fromDate=${encodeURIComponent(from)}&toDate=${encodeURIComponent(to)}`,
    })

    expect(mockAuditLogFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          timestamp: {
            gte: new Date(from),
            lte: new Date(to),
          },
        }),
      }),
    )
  })

  it('returns 422 for invalid entityId (not a UUID)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/audit-logs?entityId=not-a-uuid',
    })

    expect(res.statusCode).toBe(422)
  })

  it('always scopes query to authenticated orgId', async () => {
    mockAuditLogFindMany.mockResolvedValue([])

    await app.inject({ method: 'GET', url: '/v1/audit-logs' })

    expect(mockAuditLogFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ organizationId: ORG_ID }),
      }),
    )
  })
})

// ---------------------------------------------------------------------------
// GET /v1/audit-logs/:id
// ---------------------------------------------------------------------------

describe('GET /v1/audit-logs/:id', () => {
  it('returns 200 with the audit log when found', async () => {
    mockAuditLogFindFirst.mockResolvedValue(sampleLog)

    const res = await app.inject({
      method: 'GET',
      url: `/v1/audit-logs/${LOG_ID}`,
    })

    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(body.data).toMatchObject({ id: LOG_ID })
  })

  it('returns 404 when audit log not found', async () => {
    mockAuditLogFindFirst.mockResolvedValue(null)

    const res = await app.inject({
      method: 'GET',
      url: `/v1/audit-logs/${LOG_ID}`,
    })

    expect(res.statusCode).toBe(404)
    const body = JSON.parse(res.body)
    expect(body.error.code).toBe('NOT_FOUND')
  })

  it('scopes query to authenticated orgId', async () => {
    mockAuditLogFindFirst.mockResolvedValue(sampleLog)

    await app.inject({ method: 'GET', url: `/v1/audit-logs/${LOG_ID}` })

    expect(mockAuditLogFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ organizationId: ORG_ID, id: LOG_ID }),
      }),
    )
  })
})

// ---------------------------------------------------------------------------
// 405 — append-only enforcement (Req 9.3)
// ---------------------------------------------------------------------------

describe('Audit log immutability — 405 on mutation methods', () => {
  it('returns 405 on PUT /v1/audit-logs/:id', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: `/v1/audit-logs/${LOG_ID}`,
      payload: {},
    })
    expect(res.statusCode).toBe(405)
    const body = JSON.parse(res.body)
    expect(body.error.code).toBe('METHOD_NOT_ALLOWED')
  })

  it('returns 405 on PATCH /v1/audit-logs/:id', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: `/v1/audit-logs/${LOG_ID}`,
      payload: {},
    })
    expect(res.statusCode).toBe(405)
    const body = JSON.parse(res.body)
    expect(body.error.code).toBe('METHOD_NOT_ALLOWED')
  })

  it('returns 405 on DELETE /v1/audit-logs/:id', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: `/v1/audit-logs/${LOG_ID}`,
    })
    expect(res.statusCode).toBe(405)
    const body = JSON.parse(res.body)
    expect(body.error.code).toBe('METHOD_NOT_ALLOWED')
  })

  it('includes Allow: GET header on 405 response', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: `/v1/audit-logs/${LOG_ID}`,
    })
    expect(res.statusCode).toBe(405)
    expect(res.headers['allow']).toBe('GET')
  })
})
