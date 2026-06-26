/**
 * Route-level tests for /v1/organizations
 *
 * Uses jest.unstable_mockModule to mock OrganizationService and dynamic
 * imports to load the router after the mock is set up.
 */

import { jest, describe, it, expect, beforeAll, afterAll, beforeEach } from '@jest/globals'
import Fastify from 'fastify'
import type { FastifyInstance } from 'fastify'

// ---------------------------------------------------------------------------
// Mock functions defined at module scope so the factory closure can
// reference them directly.
// ---------------------------------------------------------------------------

const mockCreate = jest.fn()
const mockFindById = jest.fn()
const mockUpdate = jest.fn()
const mockDeactivate = jest.fn()

jest.unstable_mockModule('../../services/OrganizationService.js', () => ({
  OrganizationService: {
    create: mockCreate,
    findById: mockFindById,
    update: mockUpdate,
    deactivate: mockDeactivate,
  },
}))

// Dynamic import AFTER mock registration
const { organizationRoutes } = await import('../organizations.js')

// ---------------------------------------------------------------------------
// Sample data
// ---------------------------------------------------------------------------

const sampleOrg = {
  id: '11111111-1111-1111-1111-111111111111',
  name: 'Acme Corp',
  slug: 'acme-corp',
  status: 'active',
  createdAt: new Date('2024-01-01').toISOString(),
  updatedAt: new Date('2024-01-01').toISOString(),
}

// ---------------------------------------------------------------------------
// App setup
// ---------------------------------------------------------------------------

let app: FastifyInstance

beforeAll(async () => {
  app = Fastify({ logger: false })

  app.setErrorHandler((error, request, reply) => {
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

  await app.register(organizationRoutes)
  await app.ready()
})

afterAll(() => app.close())
beforeEach(() => jest.clearAllMocks())

// ---------------------------------------------------------------------------
// POST /v1/organizations
// ---------------------------------------------------------------------------

describe('POST /v1/organizations', () => {
  it('returns 201 with the created organization', async () => {
    mockCreate.mockResolvedValue(sampleOrg)

    const res = await app.inject({
      method: 'POST',
      url: '/v1/organizations',
      payload: { name: 'Acme Corp', slug: 'acme-corp' },
    })

    expect(res.statusCode).toBe(201)
    const body = JSON.parse(res.body)
    expect(body.data).toMatchObject({ id: sampleOrg.id, name: 'Acme Corp' })
  })

  it('returns 422 when name is missing', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/organizations',
      payload: { slug: 'acme-corp' },
    })

    expect([400, 422]).toContain(res.statusCode)
  })

  it('returns 422 when slug has invalid format', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/organizations',
      payload: { name: 'Acme', slug: 'INVALID SLUG' },
    })

    expect(res.statusCode).toBe(422)
    const body = JSON.parse(res.body)
    expect(body.error.code).toBe('VALIDATION_ERROR')
  })

  it('propagates 409 from service when slug is taken', async () => {
    const err = Object.assign(new Error('Slug already in use'), {
      statusCode: 409,
      code: 'CONFLICT',
    })
    mockCreate.mockRejectedValue(err)

    const res = await app.inject({
      method: 'POST',
      url: '/v1/organizations',
      payload: { name: 'Acme', slug: 'acme-corp' },
    })

    expect(res.statusCode).toBe(409)
  })
})

// ---------------------------------------------------------------------------
// GET /v1/organizations/:id
// ---------------------------------------------------------------------------

describe('GET /v1/organizations/:id', () => {
  it('returns 200 with the organization when found', async () => {
    mockFindById.mockResolvedValue(sampleOrg)

    const res = await app.inject({
      method: 'GET',
      url: `/v1/organizations/${sampleOrg.id}`,
    })

    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(body.data).toMatchObject({ id: sampleOrg.id })
  })

  it('returns 404 when organization does not exist', async () => {
    mockFindById.mockResolvedValue(null)

    const res = await app.inject({
      method: 'GET',
      url: '/v1/organizations/00000000-0000-0000-0000-000000000000',
    })

    expect(res.statusCode).toBe(404)
    const body = JSON.parse(res.body)
    expect(body.error.code).toBe('NOT_FOUND')
  })
})

// ---------------------------------------------------------------------------
// PATCH /v1/organizations/:id
// ---------------------------------------------------------------------------

describe('PATCH /v1/organizations/:id', () => {
  it('returns 200 with the updated organization', async () => {
    const updated = { ...sampleOrg, name: 'Acme Updated' }
    mockUpdate.mockResolvedValue(updated)

    const res = await app.inject({
      method: 'PATCH',
      url: `/v1/organizations/${sampleOrg.id}`,
      payload: { name: 'Acme Updated' },
    })

    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(body.data.name).toBe('Acme Updated')
  })

  it('returns 422 when body is empty', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: `/v1/organizations/${sampleOrg.id}`,
      payload: {},
    })

    expect(res.statusCode).toBe(422)
  })

  it('propagates 404 from service when organization not found', async () => {
    const err = Object.assign(new Error('Not found'), {
      statusCode: 404,
      code: 'NOT_FOUND',
    })
    mockUpdate.mockRejectedValue(err)

    const res = await app.inject({
      method: 'PATCH',
      url: '/v1/organizations/00000000-0000-0000-0000-000000000001',
      payload: { name: 'X' },
    })

    expect(res.statusCode).toBe(404)
  })
})

// ---------------------------------------------------------------------------
// POST /v1/organizations/:id/deactivate
// ---------------------------------------------------------------------------

describe('POST /v1/organizations/:id/deactivate', () => {
  it('returns 200 with the deactivated organization', async () => {
    const deactivated = { ...sampleOrg, status: 'deactivated' }
    mockDeactivate.mockResolvedValue(deactivated)

    const res = await app.inject({
      method: 'POST',
      url: `/v1/organizations/${sampleOrg.id}/deactivate`,
    })

    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(body.data.status).toBe('deactivated')
  })

  it('propagates 404 from service when organization not found', async () => {
    const err = Object.assign(new Error('Not found'), {
      statusCode: 404,
      code: 'NOT_FOUND',
    })
    mockDeactivate.mockRejectedValue(err)

    const res = await app.inject({
      method: 'POST',
      url: '/v1/organizations/00000000-0000-0000-0000-000000000002/deactivate',
    })

    expect(res.statusCode).toBe(404)
  })
})
