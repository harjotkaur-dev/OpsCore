/**
 * Unit tests for OrganizationService
 *
 * Uses jest.unstable_mockModule (the correct ESM-native API) to mock the
 * prisma lib module. Dynamic imports are used after the mock is registered.
 */

import { jest, describe, it, expect, beforeEach } from '@jest/globals'

// ---------------------------------------------------------------------------
// Shared mock functions — defined at module scope so they are accessible
// in the mock factory via closure.
// ---------------------------------------------------------------------------

const mockFindUnique = jest.fn()
const mockOrgCreate = jest.fn()
const mockOrgUpdate = jest.fn()
const mockAuditCreate = jest.fn().mockResolvedValue({})

const mockTransaction = jest.fn(async (fn: (tx: unknown) => Promise<unknown>) => {
  return fn({
    organization: { create: mockOrgCreate, update: mockOrgUpdate },
    auditLog: { create: mockAuditCreate },
  })
})

jest.unstable_mockModule('../../lib/prisma.js', () => ({
  prisma: {
    organization: { findUnique: mockFindUnique },
    $transaction: mockTransaction,
  },
  PrismaClient: jest.fn(),
}))

// Stub @prisma/client so Prisma.JsonNull resolves cleanly
jest.unstable_mockModule('@prisma/client', () => ({
  Prisma: { JsonNull: 'JsonNull' },
}))

// Dynamic import AFTER mock registration
const { OrganizationService } = await import('../OrganizationService.js')

// ---------------------------------------------------------------------------
// Sample data
// ---------------------------------------------------------------------------

const sampleOrg = {
  id: '11111111-1111-1111-1111-111111111111',
  name: 'Acme Corp',
  slug: 'acme-corp',
  status: 'active',
  createdAt: new Date('2024-01-01'),
  updatedAt: new Date('2024-01-01'),
}

// ---------------------------------------------------------------------------
// create
// ---------------------------------------------------------------------------

describe('OrganizationService.create', () => {
  beforeEach(() => jest.clearAllMocks())

  it('creates an organization when slug is not taken', async () => {
    mockFindUnique.mockResolvedValue(null)
    mockOrgCreate.mockResolvedValue(sampleOrg)

    const result = await OrganizationService.create(
      { name: 'Acme Corp', slug: 'acme-corp' },
      { requestId: 'req-1' },
    )

    expect(result).toMatchObject({ id: sampleOrg.id, name: 'Acme Corp' })
    expect(mockTransaction).toHaveBeenCalledTimes(1)
  })

  it('throws 409 when slug is already taken', async () => {
    mockFindUnique.mockResolvedValue(sampleOrg)

    await expect(
      OrganizationService.create({ name: 'Other Corp', slug: 'acme-corp' }),
    ).rejects.toMatchObject({ statusCode: 409 })

    expect(mockTransaction).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// findById
// ---------------------------------------------------------------------------

describe('OrganizationService.findById', () => {
  beforeEach(() => jest.clearAllMocks())

  it('returns the organization when found', async () => {
    mockFindUnique.mockResolvedValue(sampleOrg)

    const result = await OrganizationService.findById(sampleOrg.id)

    expect(result).toEqual(sampleOrg)
    expect(mockFindUnique).toHaveBeenCalledWith({ where: { id: sampleOrg.id } })
  })

  it('returns null when not found', async () => {
    mockFindUnique.mockResolvedValue(null)

    const result = await OrganizationService.findById('00000000-0000-0000-0000-000000000000')

    expect(result).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// update
// ---------------------------------------------------------------------------

describe('OrganizationService.update', () => {
  beforeEach(() => jest.clearAllMocks())

  it('updates and returns the organization', async () => {
    const updatedOrg = { ...sampleOrg, name: 'Acme Updated' }
    mockFindUnique.mockResolvedValue(sampleOrg)
    mockOrgUpdate.mockResolvedValue(updatedOrg)

    const result = await OrganizationService.update(
      sampleOrg.id,
      { name: 'Acme Updated' },
      { requestId: 'req-2' },
    )

    expect(result).toMatchObject({ name: 'Acme Updated' })
    expect(mockTransaction).toHaveBeenCalledTimes(1)
  })

  it('throws 404 when organization not found', async () => {
    mockFindUnique.mockResolvedValue(null)

    await expect(
      OrganizationService.update('00000000-0000-0000-0000-000000000001', { name: 'X' }),
    ).rejects.toMatchObject({ statusCode: 404 })

    expect(mockTransaction).not.toHaveBeenCalled()
  })

  it('throws 409 when new slug is already taken by another org', async () => {
    const otherOrg = {
      ...sampleOrg,
      id: '22222222-2222-2222-2222-222222222222',
      slug: 'taken-slug',
    }
    mockFindUnique
      .mockResolvedValueOnce(sampleOrg) // load org being updated
      .mockResolvedValueOnce(otherOrg)   // slug conflict check

    await expect(
      OrganizationService.update(sampleOrg.id, { slug: 'taken-slug' }),
    ).rejects.toMatchObject({ statusCode: 409 })

    expect(mockTransaction).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// deactivate
// ---------------------------------------------------------------------------

describe('OrganizationService.deactivate', () => {
  beforeEach(() => jest.clearAllMocks())

  it('sets status to deactivated', async () => {
    const deactivatedOrg = { ...sampleOrg, status: 'deactivated' }
    mockFindUnique.mockResolvedValue(sampleOrg)
    mockOrgUpdate.mockResolvedValue(deactivatedOrg)

    const result = await OrganizationService.deactivate(sampleOrg.id, { requestId: 'req-3' })

    expect(result).toMatchObject({ status: 'deactivated' })
    expect(mockTransaction).toHaveBeenCalledTimes(1)
  })

  it('throws 404 when organization not found', async () => {
    mockFindUnique.mockResolvedValue(null)

    await expect(
      OrganizationService.deactivate('00000000-0000-0000-0000-000000000002'),
    ).rejects.toMatchObject({ statusCode: 404 })

    expect(mockTransaction).not.toHaveBeenCalled()
  })

  it('is idempotent — returns current record when already deactivated', async () => {
    const already = { ...sampleOrg, status: 'deactivated' }
    mockFindUnique.mockResolvedValue(already)

    const result = await OrganizationService.deactivate(sampleOrg.id)

    expect(result).toMatchObject({ status: 'deactivated' })
    expect(mockTransaction).not.toHaveBeenCalled()
  })
})
