/**
 * Unit tests for TeamService
 *
 * Uses jest.unstable_mockModule (the correct ESM-native API) to mock the
 * prisma lib module. Dynamic imports are used after the mock is registered.
 */

import { jest, describe, it, expect, beforeEach } from '@jest/globals'

// ---------------------------------------------------------------------------
// Shared mock functions — defined at module scope so they are accessible
// in the mock factory via closure.
// ---------------------------------------------------------------------------

const mockTeamFindFirst = jest.fn()
const mockTeamFindMany = jest.fn()
const mockTeamCreate = jest.fn()
const mockTeamUpdate = jest.fn()

const mockOrgMemberFindFirst = jest.fn()
const mockTeamMemberFindFirst = jest.fn()
const mockTeamMemberCreate = jest.fn()
const mockTeamMemberDelete = jest.fn()

const mockAuditCreate = jest.fn().mockResolvedValue({})

const mockTransaction = jest.fn(async (fn: (tx: unknown) => Promise<unknown>) => {
  return fn({
    team: {
      create: mockTeamCreate,
      update: mockTeamUpdate,
    },
    teamMember: {
      create: mockTeamMemberCreate,
      delete: mockTeamMemberDelete,
    },
    auditLog: { create: mockAuditCreate },
  })
})

jest.unstable_mockModule('../../lib/prisma.js', () => ({
  prisma: {
    team: {
      findFirst: mockTeamFindFirst,
      findMany: mockTeamFindMany,
    },
    organizationMember: { findFirst: mockOrgMemberFindFirst },
    teamMember: {
      findFirst: mockTeamMemberFindFirst,
    },
    $transaction: mockTransaction,
  },
  PrismaClient: jest.fn(),
}))

// Stub @prisma/client so Prisma.JsonNull resolves cleanly
jest.unstable_mockModule('@prisma/client', () => ({
  Prisma: { JsonNull: 'JsonNull' },
}))

// Dynamic import AFTER mock registration
const { TeamService } = await import('../TeamService.js')

// ---------------------------------------------------------------------------
// Sample data
// ---------------------------------------------------------------------------

const ORG_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
const TEAM_ID = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'
const USER_ID = 'cccccccc-cccc-cccc-cccc-cccccccccccc'

const sampleTeam = {
  id: TEAM_ID,
  organizationId: ORG_ID,
  name: 'Engineering',
  status: 'active',
  createdAt: new Date('2024-01-01'),
  updatedAt: new Date('2024-01-01'),
}

const sampleMember = {
  id: 'dddddddd-dddd-dddd-dddd-dddddddddddd',
  teamId: TEAM_ID,
  userId: USER_ID,
  organizationId: ORG_ID,
  createdAt: new Date('2024-01-01'),
}

const sampleOrgMember = {
  id: 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee',
  organizationId: ORG_ID,
  userId: USER_ID,
  role: 'member',
  status: 'active',
}

// ---------------------------------------------------------------------------
// createTeam
// ---------------------------------------------------------------------------

describe('TeamService.createTeam', () => {
  beforeEach(() => jest.clearAllMocks())

  it('creates a team when name is not taken', async () => {
    mockTeamFindFirst.mockResolvedValue(null)
    mockTeamCreate.mockResolvedValue(sampleTeam)

    const result = await TeamService.createTeam(
      ORG_ID,
      { name: 'Engineering' },
      { requestId: 'req-1', actorId: USER_ID },
    )

    expect(result).toMatchObject({ id: TEAM_ID, name: 'Engineering' })
    expect(mockTransaction).toHaveBeenCalledTimes(1)
    expect(mockAuditCreate).toHaveBeenCalledTimes(1)
    expect(mockAuditCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          organizationId: ORG_ID,
          entityType: 'team',
          action: 'created',
        }),
      }),
    )
  })

  it('throws 409 when team name already exists in the org', async () => {
    mockTeamFindFirst.mockResolvedValue(sampleTeam)

    await expect(
      TeamService.createTeam(ORG_ID, { name: 'Engineering' }),
    ).rejects.toMatchObject({ statusCode: 409 })

    expect(mockTransaction).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// listTeams
// ---------------------------------------------------------------------------

describe('TeamService.listTeams', () => {
  beforeEach(() => jest.clearAllMocks())

  it('returns all teams for the organization', async () => {
    const archivedTeam = { ...sampleTeam, id: 'ffff', status: 'archived' }
    mockTeamFindMany.mockResolvedValue([sampleTeam, archivedTeam])

    const result = await TeamService.listTeams(ORG_ID)

    expect(result).toHaveLength(2)
    expect(mockTeamFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { organizationId: ORG_ID },
      }),
    )
  })

  it('returns empty array when no teams exist', async () => {
    mockTeamFindMany.mockResolvedValue([])

    const result = await TeamService.listTeams(ORG_ID)

    expect(result).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// findById
// ---------------------------------------------------------------------------

describe('TeamService.findById', () => {
  beforeEach(() => jest.clearAllMocks())

  it('returns the team when found', async () => {
    const teamWithMembers = { ...sampleTeam, members: [] }
    mockTeamFindFirst.mockResolvedValue(teamWithMembers)

    const result = await TeamService.findById(ORG_ID, TEAM_ID)

    expect(result).toMatchObject({ id: TEAM_ID })
    expect(mockTeamFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: TEAM_ID, organizationId: ORG_ID },
      }),
    )
  })

  it('returns null when team not found', async () => {
    mockTeamFindFirst.mockResolvedValue(null)

    const result = await TeamService.findById(ORG_ID, '00000000-0000-0000-0000-000000000000')

    expect(result).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// updateTeam
// ---------------------------------------------------------------------------

describe('TeamService.updateTeam', () => {
  beforeEach(() => jest.clearAllMocks())

  it('updates and returns the team', async () => {
    const updatedTeam = { ...sampleTeam, name: 'Platform Engineering' }
    mockTeamFindFirst
      .mockResolvedValueOnce(sampleTeam)   // load existing team
      .mockResolvedValueOnce(null)          // name conflict check
    mockTeamUpdate.mockResolvedValue(updatedTeam)

    const result = await TeamService.updateTeam(
      ORG_ID,
      TEAM_ID,
      { name: 'Platform Engineering' },
      { requestId: 'req-2', actorId: USER_ID },
    )

    expect(result).toMatchObject({ name: 'Platform Engineering' })
    expect(mockTransaction).toHaveBeenCalledTimes(1)
    expect(mockAuditCreate).toHaveBeenCalledTimes(1)
    expect(mockAuditCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: 'updated',
          entityType: 'team',
        }),
      }),
    )
  })

  it('throws 404 when team not found', async () => {
    mockTeamFindFirst.mockResolvedValue(null)

    await expect(
      TeamService.updateTeam(ORG_ID, '00000000-0000-0000-0000-000000000001', { name: 'X' }),
    ).rejects.toMatchObject({ statusCode: 404 })

    expect(mockTransaction).not.toHaveBeenCalled()
  })

  it('throws 409 when new name conflicts with an existing team', async () => {
    const conflictTeam = { ...sampleTeam, id: 'different-id', name: 'Ops' }
    mockTeamFindFirst
      .mockResolvedValueOnce(sampleTeam)   // load existing team
      .mockResolvedValueOnce(conflictTeam) // name conflict found

    await expect(
      TeamService.updateTeam(ORG_ID, TEAM_ID, { name: 'Ops' }),
    ).rejects.toMatchObject({ statusCode: 409 })

    expect(mockTransaction).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// archiveTeam
// ---------------------------------------------------------------------------

describe('TeamService.archiveTeam', () => {
  beforeEach(() => jest.clearAllMocks())

  it('sets status to archived', async () => {
    const archivedTeam = { ...sampleTeam, status: 'archived' }
    mockTeamFindFirst.mockResolvedValue(sampleTeam)
    mockTeamUpdate.mockResolvedValue(archivedTeam)

    const result = await TeamService.archiveTeam(ORG_ID, TEAM_ID, {
      requestId: 'req-3',
      actorId: USER_ID,
    })

    expect(result).toMatchObject({ status: 'archived' })
    expect(mockTransaction).toHaveBeenCalledTimes(1)
    expect(mockAuditCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: 'status_changed',
          entityType: 'team',
        }),
      }),
    )
  })

  it('throws 404 when team not found', async () => {
    mockTeamFindFirst.mockResolvedValue(null)

    await expect(
      TeamService.archiveTeam(ORG_ID, '00000000-0000-0000-0000-000000000002'),
    ).rejects.toMatchObject({ statusCode: 404 })

    expect(mockTransaction).not.toHaveBeenCalled()
  })

  it('is idempotent — returns current record when already archived', async () => {
    const already = { ...sampleTeam, status: 'archived' }
    mockTeamFindFirst.mockResolvedValue(already)

    const result = await TeamService.archiveTeam(ORG_ID, TEAM_ID)

    expect(result).toMatchObject({ status: 'archived' })
    expect(mockTransaction).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// addMember
// ---------------------------------------------------------------------------

describe('TeamService.addMember', () => {
  beforeEach(() => jest.clearAllMocks())

  it('adds a member to an active team', async () => {
    mockTeamFindFirst.mockResolvedValue(sampleTeam)
    mockOrgMemberFindFirst.mockResolvedValue(sampleOrgMember)
    mockTeamMemberFindFirst.mockResolvedValue(null) // no existing membership
    mockTeamMemberCreate.mockResolvedValue(sampleMember)

    const result = await TeamService.addMember(
      ORG_ID,
      TEAM_ID,
      { userId: USER_ID },
      { requestId: 'req-4', actorId: USER_ID },
    )

    expect(result).toMatchObject({ userId: USER_ID, teamId: TEAM_ID })
    expect(mockTransaction).toHaveBeenCalledTimes(1)
    expect(mockAuditCreate).toHaveBeenCalledTimes(1)
  })

  it('throws 404 when team not found', async () => {
    mockTeamFindFirst.mockResolvedValue(null)

    await expect(
      TeamService.addMember(ORG_ID, TEAM_ID, { userId: USER_ID }),
    ).rejects.toMatchObject({ statusCode: 404 })
  })

  it('throws 422 when team is archived', async () => {
    mockTeamFindFirst.mockResolvedValue({ ...sampleTeam, status: 'archived' })

    await expect(
      TeamService.addMember(ORG_ID, TEAM_ID, { userId: USER_ID }),
    ).rejects.toMatchObject({ statusCode: 422 })

    expect(mockTransaction).not.toHaveBeenCalled()
  })

  it('throws 404 when user is not a member of the organization', async () => {
    mockTeamFindFirst.mockResolvedValue(sampleTeam)
    mockOrgMemberFindFirst.mockResolvedValue(null)

    await expect(
      TeamService.addMember(ORG_ID, TEAM_ID, { userId: USER_ID }),
    ).rejects.toMatchObject({ statusCode: 404 })

    expect(mockTransaction).not.toHaveBeenCalled()
  })

  it('throws 409 when user is already a member of the team', async () => {
    mockTeamFindFirst.mockResolvedValue(sampleTeam)
    mockOrgMemberFindFirst.mockResolvedValue(sampleOrgMember)
    mockTeamMemberFindFirst.mockResolvedValue(sampleMember) // already exists

    await expect(
      TeamService.addMember(ORG_ID, TEAM_ID, { userId: USER_ID }),
    ).rejects.toMatchObject({ statusCode: 409 })

    expect(mockTransaction).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// removeMember
// ---------------------------------------------------------------------------

describe('TeamService.removeMember', () => {
  beforeEach(() => jest.clearAllMocks())

  it('removes a member from a team', async () => {
    mockTeamFindFirst.mockResolvedValue(sampleTeam)
    mockTeamMemberFindFirst.mockResolvedValue(sampleMember)
    mockTeamMemberDelete.mockResolvedValue(sampleMember)

    await TeamService.removeMember(ORG_ID, TEAM_ID, USER_ID, {
      requestId: 'req-5',
      actorId: USER_ID,
    })

    expect(mockTransaction).toHaveBeenCalledTimes(1)
    expect(mockTeamMemberDelete).toHaveBeenCalledWith({
      where: { id: sampleMember.id },
    })
    expect(mockAuditCreate).toHaveBeenCalledTimes(1)
  })

  it('throws 404 when team not found', async () => {
    mockTeamFindFirst.mockResolvedValue(null)

    await expect(
      TeamService.removeMember(ORG_ID, TEAM_ID, USER_ID),
    ).rejects.toMatchObject({ statusCode: 404 })
  })

  it('throws 404 when user is not a member of the team', async () => {
    mockTeamFindFirst.mockResolvedValue(sampleTeam)
    mockTeamMemberFindFirst.mockResolvedValue(null)

    await expect(
      TeamService.removeMember(ORG_ID, TEAM_ID, USER_ID),
    ).rejects.toMatchObject({ statusCode: 404 })

    expect(mockTransaction).not.toHaveBeenCalled()
  })
})
