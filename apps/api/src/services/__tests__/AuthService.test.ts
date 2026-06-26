/**
 * Unit tests for AuthService
 *
 * Uses jest.unstable_mockModule to mock prisma, bcrypt, and jwt utilities.
 * Dynamic imports are used after mock registration.
 */

import { jest, describe, it, expect, beforeEach } from '@jest/globals'

// ---------------------------------------------------------------------------
// Mock: prisma
// ---------------------------------------------------------------------------

const mockUserFindUnique = jest.fn()
const mockOrgFindUnique = jest.fn()
const mockOrgMemberFindFirst = jest.fn()
const mockOrgMemberCreate = jest.fn()
const mockUserCreate = jest.fn()
const mockOrgCreate = jest.fn()
const mockRefreshTokenCreate = jest.fn()
const mockAuditLogCreate = jest.fn().mockResolvedValue({})
const mockOrgMemberUpdate = jest.fn()

const mockTransaction = jest.fn(async (fn: (tx: unknown) => Promise<unknown>) =>
  fn({
    organization: { create: mockOrgCreate },
    user: { create: mockUserCreate, findUnique: mockUserFindUnique },
    organizationMember: {
      create: mockOrgMemberCreate,
      update: mockOrgMemberUpdate,
      findFirst: mockOrgMemberFindFirst,
    },
    refreshToken: { create: mockRefreshTokenCreate, update: mockRefreshTokenUpdate },
    auditLog: { create: mockAuditLogCreate },
  }),
)

// ---------------------------------------------------------------------------
// Mock: prisma — extended for refresh/logout
// ---------------------------------------------------------------------------

const mockRefreshTokenFindUnique = jest.fn()
const mockRefreshTokenUpdate = jest.fn()

jest.unstable_mockModule('../../lib/prisma.js', () => ({
  prisma: {
    user: { findUnique: mockUserFindUnique },
    organization: { findUnique: mockOrgFindUnique },
    organizationMember: {
      findFirst: mockOrgMemberFindFirst,
      update: mockOrgMemberUpdate,
    },
    refreshToken: {
      create: mockRefreshTokenCreate,
      findUnique: mockRefreshTokenFindUnique,
      update: mockRefreshTokenUpdate,
    },
    auditLog: { create: mockAuditLogCreate },
    $transaction: mockTransaction,
  },
  PrismaClient: jest.fn(),
}))

// ---------------------------------------------------------------------------
// Mock: @prisma/client
// ---------------------------------------------------------------------------

jest.unstable_mockModule('@prisma/client', () => ({
  Prisma: { JsonNull: 'JsonNull' },
}))

// ---------------------------------------------------------------------------
// Mock: bcryptjs
// ---------------------------------------------------------------------------

const mockBcryptHash = jest.fn()
const mockBcryptCompare = jest.fn()

jest.unstable_mockModule('bcryptjs', () => ({
  default: {
    hash: mockBcryptHash,
    compare: mockBcryptCompare,
  },
  hash: mockBcryptHash,
  compare: mockBcryptCompare,
}))

// ---------------------------------------------------------------------------
// Mock: jwt utilities
// ---------------------------------------------------------------------------

const mockSignAccessToken = jest.fn().mockReturnValue('mock-access-token')
const mockSignRefreshToken = jest.fn().mockReturnValue({
  token: 'mock-refresh-token-uuid',
  expiresAt: new Date('2099-01-01'),
})
const mockHashToken = jest.fn().mockReturnValue('mock-token-hash')
const mockSignInvitationToken = jest.fn().mockReturnValue('mock-invitation-token')
const mockVerifyInvitationToken = jest.fn()

jest.unstable_mockModule('../../lib/jwt.js', () => ({
  signAccessToken: mockSignAccessToken,
  signRefreshToken: mockSignRefreshToken,
  hashToken: mockHashToken,
  verifyAccessToken: jest.fn(),
  signInvitationToken: mockSignInvitationToken,
  verifyInvitationToken: mockVerifyInvitationToken,
}))

// ---------------------------------------------------------------------------
// Dynamic import AFTER all mocks are registered
// ---------------------------------------------------------------------------

const { AuthService } = await import('../AuthService.js')

// ---------------------------------------------------------------------------
// Sample data
// ---------------------------------------------------------------------------

const sampleUser = {
  id: 'user-1111-1111-1111-111111111111',
  email: 'alice@example.com',
  passwordHash: '$2b$12$hashedpassword',
  fullName: 'Alice Smith',
  createdAt: new Date('2024-01-01'),
  updatedAt: new Date('2024-01-01'),
}

const sampleOrg = {
  id: 'org-11111-1111-1111-111111111111',
  name: 'Acme Corp',
  slug: 'acme-corp',
  status: 'active',
  createdAt: new Date('2024-01-01'),
  updatedAt: new Date('2024-01-01'),
}

const sampleMembership = {
  id: 'mem-11111-1111-1111-111111111111',
  organizationId: sampleOrg.id,
  userId: sampleUser.id,
  role: 'owner',
  status: 'active',
  invitedAt: null,
  joinedAt: new Date('2024-01-01'),
  createdAt: new Date('2024-01-01'),
  organization: sampleOrg,
}

// ---------------------------------------------------------------------------
// AuthService.register
// ---------------------------------------------------------------------------

describe('AuthService.register', () => {
  beforeEach(() => jest.clearAllMocks())

  it('creates user, org, membership, refresh token, and audit log in a transaction', async () => {
    mockUserFindUnique.mockResolvedValue(null)
    mockOrgFindUnique.mockResolvedValue(null)
    mockBcryptHash.mockResolvedValue('$2b$12$hashed')
    mockOrgCreate.mockResolvedValue(sampleOrg)
    mockUserCreate.mockResolvedValue(sampleUser)
    mockOrgMemberCreate.mockResolvedValue(sampleMembership)
    mockRefreshTokenCreate.mockResolvedValue({})

    const result = await AuthService.register({
      email: 'alice@example.com',
      password: 'secret1234',
      fullName: 'Alice Smith',
      organizationName: 'Acme Corp',
      organizationSlug: 'acme-corp',
    })

    expect(result.accessToken).toBe('mock-access-token')
    expect(result.refreshToken).toBe('mock-refresh-token-uuid')
    expect(result.userId).toBe(sampleUser.id)
    expect(result.orgId).toBe(sampleOrg.id)

    expect(mockBcryptHash).toHaveBeenCalledWith('secret1234', 12)
    expect(mockTransaction).toHaveBeenCalledTimes(1)
    expect(mockAuditLogCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: 'login_success' }),
      }),
    )
  })

  it('signs the access token with the owner role and permissions', async () => {
    mockUserFindUnique.mockResolvedValue(null)
    mockOrgFindUnique.mockResolvedValue(null)
    mockBcryptHash.mockResolvedValue('$2b$12$hashed')
    mockOrgCreate.mockResolvedValue(sampleOrg)
    mockUserCreate.mockResolvedValue(sampleUser)
    mockOrgMemberCreate.mockResolvedValue(sampleMembership)
    mockRefreshTokenCreate.mockResolvedValue({})

    await AuthService.register({
      email: 'alice@example.com',
      password: 'secret1234',
      fullName: 'Alice Smith',
      organizationName: 'Acme Corp',
      organizationSlug: 'acme-corp',
    })

    expect(mockSignAccessToken).toHaveBeenCalledWith(
      expect.objectContaining({
        sub: sampleUser.id,
        org: sampleOrg.id,
        role: 'owner',
      }),
    )
  })

  it('hashes the refresh token before storing it', async () => {
    mockUserFindUnique.mockResolvedValue(null)
    mockOrgFindUnique.mockResolvedValue(null)
    mockBcryptHash.mockResolvedValue('$2b$12$hashed')
    mockOrgCreate.mockResolvedValue(sampleOrg)
    mockUserCreate.mockResolvedValue(sampleUser)
    mockOrgMemberCreate.mockResolvedValue(sampleMembership)
    mockRefreshTokenCreate.mockResolvedValue({})

    await AuthService.register({
      email: 'alice@example.com',
      password: 'secret1234',
      fullName: 'Alice Smith',
      organizationName: 'Acme Corp',
      organizationSlug: 'acme-corp',
    })

    expect(mockHashToken).toHaveBeenCalledWith('mock-refresh-token-uuid')
    expect(mockRefreshTokenCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ tokenHash: 'mock-token-hash', revoked: false }),
      }),
    )
  })

  it('throws 409 when email is already registered', async () => {
    mockUserFindUnique.mockResolvedValue(sampleUser)
    mockOrgFindUnique.mockResolvedValue(null)

    await expect(
      AuthService.register({
        email: 'alice@example.com',
        password: 'secret1234',
        fullName: 'Alice Smith',
        organizationName: 'Acme Corp',
        organizationSlug: 'acme-corp',
      }),
    ).rejects.toMatchObject({ statusCode: 409 })

    expect(mockTransaction).not.toHaveBeenCalled()
  })

  it('throws 409 when organization slug is already taken', async () => {
    mockUserFindUnique.mockResolvedValue(null)
    mockOrgFindUnique.mockResolvedValue(sampleOrg)

    await expect(
      AuthService.register({
        email: 'alice@example.com',
        password: 'secret1234',
        fullName: 'Alice Smith',
        organizationName: 'Acme Corp',
        organizationSlug: 'acme-corp',
      }),
    ).rejects.toMatchObject({ statusCode: 409 })

    expect(mockTransaction).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// AuthService.login
// ---------------------------------------------------------------------------

describe('AuthService.login', () => {
  beforeEach(() => jest.clearAllMocks())

  it('returns tokens on valid credentials with active org', async () => {
    mockUserFindUnique.mockResolvedValue(sampleUser)
    mockBcryptCompare.mockResolvedValue(true)
    mockOrgMemberFindFirst.mockResolvedValue(sampleMembership)
    mockRefreshTokenCreate.mockResolvedValue({})

    const result = await AuthService.login({
      email: 'alice@example.com',
      password: 'secret1234',
    })

    expect(result.accessToken).toBe('mock-access-token')
    expect(result.refreshToken).toBe('mock-refresh-token-uuid')
    expect(result.userId).toBe(sampleUser.id)
    expect(result.orgId).toBe(sampleOrg.id)
    expect(result.role).toBe('owner')
  })

  it('writes a login_success audit log on successful login', async () => {
    mockUserFindUnique.mockResolvedValue(sampleUser)
    mockBcryptCompare.mockResolvedValue(true)
    mockOrgMemberFindFirst.mockResolvedValue(sampleMembership)
    mockRefreshTokenCreate.mockResolvedValue({})

    await AuthService.login({
      email: 'alice@example.com',
      password: 'secret1234',
    })

    expect(mockAuditLogCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: 'login_success' }),
      }),
    )
  })

  it('throws 401 and writes login_failed when password is wrong', async () => {
    mockUserFindUnique.mockResolvedValue(sampleUser)
    mockBcryptCompare.mockResolvedValue(false)
    // For the failed audit log, findFirst returns the membership
    mockOrgMemberFindFirst.mockResolvedValue(sampleMembership)

    await expect(
      AuthService.login({ email: 'alice@example.com', password: 'wrongpassword' }),
    ).rejects.toMatchObject({ statusCode: 401 })

    expect(mockAuditLogCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: 'login_failed' }),
      }),
    )
    expect(mockTransaction).not.toHaveBeenCalled()
  })

  it('throws 401 when user does not exist', async () => {
    mockUserFindUnique.mockResolvedValue(null)
    // bcrypt.compare still gets called (constant-time stub returns false)
    mockBcryptCompare.mockResolvedValue(false)

    await expect(
      AuthService.login({ email: 'nobody@example.com', password: 'whatever' }),
    ).rejects.toMatchObject({ statusCode: 401 })

    expect(mockTransaction).not.toHaveBeenCalled()
  })

  it('throws 401 when organization is deactivated', async () => {
    const deactivatedOrg = { ...sampleOrg, status: 'deactivated' }
    const deactivatedMembership = { ...sampleMembership, organization: deactivatedOrg }

    mockUserFindUnique.mockResolvedValue(sampleUser)
    mockBcryptCompare.mockResolvedValue(true)
    mockOrgMemberFindFirst.mockResolvedValue(deactivatedMembership)

    await expect(
      AuthService.login({ email: 'alice@example.com', password: 'secret1234' }),
    ).rejects.toMatchObject({ statusCode: 401 })

    expect(mockAuditLogCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: 'login_failed' }),
      }),
    )
    expect(mockTransaction).not.toHaveBeenCalled()
  })

  it('signs access token with the correct claims', async () => {
    mockUserFindUnique.mockResolvedValue(sampleUser)
    mockBcryptCompare.mockResolvedValue(true)
    mockOrgMemberFindFirst.mockResolvedValue(sampleMembership)
    mockRefreshTokenCreate.mockResolvedValue({})

    await AuthService.login({
      email: 'alice@example.com',
      password: 'secret1234',
    })

    expect(mockSignAccessToken).toHaveBeenCalledWith(
      expect.objectContaining({
        sub: sampleUser.id,
        org: sampleOrg.id,
        role: 'owner',
      }),
    )
  })
})

// ---------------------------------------------------------------------------
// AuthService.logout
// ---------------------------------------------------------------------------

describe('AuthService.logout', () => {
  beforeEach(() => jest.clearAllMocks())

  it('revokes an existing, non-revoked token', async () => {
    const tokenRecord = {
      id: 'rt-1',
      tokenHash: 'mock-token-hash',
      userId: sampleUser.id,
      organizationId: sampleOrg.id,
      revoked: false,
      expiresAt: new Date('2099-01-01'),
      createdAt: new Date('2024-01-01'),
    }

    mockRefreshTokenFindUnique.mockResolvedValue(tokenRecord)
    mockRefreshTokenUpdate.mockResolvedValue({ ...tokenRecord, revoked: true })

    await AuthService.logout('mock-raw-token')

    expect(mockHashToken).toHaveBeenCalledWith('mock-raw-token')
    expect(mockRefreshTokenUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { tokenHash: 'mock-token-hash' },
        data: { revoked: true },
      }),
    )
  })

  it('is idempotent — does nothing when token is already revoked', async () => {
    const revokedRecord = {
      id: 'rt-1',
      tokenHash: 'mock-token-hash',
      userId: sampleUser.id,
      organizationId: sampleOrg.id,
      revoked: true,
      expiresAt: new Date('2099-01-01'),
      createdAt: new Date('2024-01-01'),
    }

    mockRefreshTokenFindUnique.mockResolvedValue(revokedRecord)

    await expect(AuthService.logout('mock-raw-token')).resolves.toBeUndefined()
    expect(mockRefreshTokenUpdate).not.toHaveBeenCalled()
  })

  it('is idempotent — does nothing when token is not found', async () => {
    mockRefreshTokenFindUnique.mockResolvedValue(null)

    await expect(AuthService.logout('non-existent-token')).resolves.toBeUndefined()
    expect(mockRefreshTokenUpdate).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// AuthService.refresh
// ---------------------------------------------------------------------------

describe('AuthService.refresh', () => {
  beforeEach(() => jest.clearAllMocks())

  const activeMembershipWithOrg = {
    ...sampleMembership,
    organization: sampleOrg,
  }

  const activeTokenRecord = {
    id: 'rt-1',
    tokenHash: 'mock-token-hash',
    userId: sampleUser.id,
    organizationId: sampleOrg.id,
    revoked: false,
    expiresAt: new Date('2099-01-01'),
    createdAt: new Date('2024-01-01'),
    user: {
      ...sampleUser,
      memberships: [activeMembershipWithOrg],
    },
  }

  it('rotates the token and returns new access + refresh tokens', async () => {
    mockRefreshTokenFindUnique.mockResolvedValue(activeTokenRecord)
    mockRefreshTokenUpdate.mockResolvedValue({})
    mockRefreshTokenCreate.mockResolvedValue({})

    const result = await AuthService.refresh('mock-raw-token')

    expect(result.accessToken).toBe('mock-access-token')
    expect(result.refreshToken).toBe('mock-refresh-token-uuid')
    expect(result.userId).toBe(sampleUser.id)
    expect(result.orgId).toBe(sampleOrg.id)
    expect(result.role).toBe('owner')
  })

  it('executes revoke + create + audit in a single transaction', async () => {
    mockRefreshTokenFindUnique.mockResolvedValue(activeTokenRecord)
    mockRefreshTokenUpdate.mockResolvedValue({})
    mockRefreshTokenCreate.mockResolvedValue({})

    await AuthService.refresh('mock-raw-token')

    expect(mockTransaction).toHaveBeenCalledTimes(1)
    // Within the transaction: old token revoked
    expect(mockRefreshTokenUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: { revoked: true } }),
    )
    // New token created
    expect(mockRefreshTokenCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ revoked: false, userId: sampleUser.id }),
      }),
    )
    // Audit log written
    expect(mockAuditLogCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: 'login_success' }),
      }),
    )
  })

  it('throws 401 when the token is not found', async () => {
    mockRefreshTokenFindUnique.mockResolvedValue(null)

    await expect(AuthService.refresh('unknown-token')).rejects.toMatchObject({
      statusCode: 401,
    })
    expect(mockTransaction).not.toHaveBeenCalled()
  })

  it('throws 401 and writes login_failed audit when token is revoked', async () => {
    const revokedToken = { ...activeTokenRecord, revoked: true }
    mockRefreshTokenFindUnique.mockResolvedValue(revokedToken)

    await expect(AuthService.refresh('revoked-token')).rejects.toMatchObject({
      statusCode: 401,
    })

    expect(mockAuditLogCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: 'login_failed' }),
      }),
    )
    expect(mockTransaction).not.toHaveBeenCalled()
  })

  it('throws 401 and writes login_failed audit when token is expired', async () => {
    const expiredToken = { ...activeTokenRecord, expiresAt: new Date('2000-01-01') }
    mockRefreshTokenFindUnique.mockResolvedValue(expiredToken)

    await expect(AuthService.refresh('expired-token')).rejects.toMatchObject({
      statusCode: 401,
    })

    expect(mockAuditLogCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: 'login_failed' }),
      }),
    )
    expect(mockTransaction).not.toHaveBeenCalled()
  })

  it('throws 401 when the org membership is not active', async () => {
    const inactiveMembership = { ...activeMembershipWithOrg, status: 'suspended' }
    const tokenWithInactiveMembership = {
      ...activeTokenRecord,
      user: { ...sampleUser, memberships: [inactiveMembership] },
    }
    mockRefreshTokenFindUnique.mockResolvedValue(tokenWithInactiveMembership)

    await expect(AuthService.refresh('mock-raw-token')).rejects.toMatchObject({
      statusCode: 401,
    })
    expect(mockTransaction).not.toHaveBeenCalled()
  })

  it('throws 401 when the organization is deactivated', async () => {
    const deactivatedOrg = { ...sampleOrg, status: 'deactivated' }
    const membershipWithDeactivatedOrg = { ...activeMembershipWithOrg, organization: deactivatedOrg }
    const tokenWithDeactivatedOrg = {
      ...activeTokenRecord,
      user: { ...sampleUser, memberships: [membershipWithDeactivatedOrg] },
    }
    mockRefreshTokenFindUnique.mockResolvedValue(tokenWithDeactivatedOrg)

    await expect(AuthService.refresh('mock-raw-token')).rejects.toMatchObject({
      statusCode: 401,
    })
    expect(mockTransaction).not.toHaveBeenCalled()
  })

  it('signs the new access token with the correct claims', async () => {
    mockRefreshTokenFindUnique.mockResolvedValue(activeTokenRecord)
    mockRefreshTokenUpdate.mockResolvedValue({})
    mockRefreshTokenCreate.mockResolvedValue({})

    await AuthService.refresh('mock-raw-token')

    expect(mockSignAccessToken).toHaveBeenCalledWith(
      expect.objectContaining({
        sub: sampleUser.id,
        org: sampleOrg.id,
        role: 'owner',
      }),
    )
  })
})

// ---------------------------------------------------------------------------
// AuthService.inviteUser
// ---------------------------------------------------------------------------

describe('AuthService.inviteUser', () => {
  beforeEach(() => jest.clearAllMocks())

  it('creates an invitation member record and returns inviteLink + token', async () => {
    // Org exists
    mockOrgFindUnique.mockResolvedValue(sampleOrg)
    // No existing user with that email
    mockUserFindUnique.mockResolvedValue(null)
    mockOrgMemberCreate.mockResolvedValue({})
    mockSignInvitationToken.mockReturnValue('mock-invitation-token')

    const result = await AuthService.inviteUser(sampleOrg.id, 'newuser@example.com', 'member', {
      requestId: 'req-1',
      actorId: sampleUser.id,
    })

    expect(result.token).toBe('mock-invitation-token')
    expect(result.inviteLink).toBe('/v1/auth/invite/mock-invitation-token/accept')
    expect(mockSignInvitationToken).toHaveBeenCalledWith({
      type: 'invitation',
      orgId: sampleOrg.id,
      email: 'newuser@example.com',
      role: 'member',
    })
  })

  it('writes an audit log entry for invite sent', async () => {
    mockOrgFindUnique.mockResolvedValue(sampleOrg)
    mockUserFindUnique.mockResolvedValue(null)
    mockOrgMemberCreate.mockResolvedValue({})
    mockSignInvitationToken.mockReturnValue('mock-invitation-token')

    await AuthService.inviteUser(sampleOrg.id, 'newuser@example.com', 'member', {
      requestId: 'req-1',
      actorId: sampleUser.id,
    })

    expect(mockAuditLogCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: 'created',
          entityType: 'user',
          organizationId: sampleOrg.id,
        }),
      }),
    )
  })

  it('creates an org member record for an existing user who is not yet a member', async () => {
    mockOrgFindUnique.mockResolvedValue(sampleOrg)
    // User exists but no active membership
    mockUserFindUnique.mockResolvedValue(sampleUser)
    // No active membership
    mockOrgMemberFindFirst
      .mockResolvedValueOnce(null)  // active membership check
      .mockResolvedValueOnce(null)  // inside tx: existing invited member check
    mockOrgMemberCreate.mockResolvedValue({})
    mockSignInvitationToken.mockReturnValue('mock-invitation-token')

    const result = await AuthService.inviteUser(sampleOrg.id, sampleUser.email, 'admin', {
      actorId: sampleUser.id,
    })

    expect(result.token).toBe('mock-invitation-token')
    expect(mockOrgMemberCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          organizationId: sampleOrg.id,
          userId: sampleUser.id,
          role: 'admin',
          status: 'invited',
        }),
      }),
    )
  })

  it('updates an existing invited member record for a user who was previously invited', async () => {
    const invitedMembership = { ...sampleMembership, status: 'invited' }
    mockOrgFindUnique.mockResolvedValue(sampleOrg)
    mockUserFindUnique.mockResolvedValue(sampleUser)
    // No active membership
    mockOrgMemberFindFirst
      .mockResolvedValueOnce(null)         // active membership check (outer)
      .mockResolvedValueOnce(invitedMembership) // inside tx: existing member
    mockOrgMemberUpdate.mockResolvedValue({ ...invitedMembership, role: 'team_lead' })
    mockSignInvitationToken.mockReturnValue('mock-invitation-token')

    await AuthService.inviteUser(sampleOrg.id, sampleUser.email, 'team_lead', {
      actorId: sampleUser.id,
    })

    expect(mockOrgMemberUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ role: 'team_lead', status: 'invited' }),
      }),
    )
  })

  it('throws 409 when email already has an active membership', async () => {
    mockOrgFindUnique.mockResolvedValue(sampleOrg)
    mockUserFindUnique.mockResolvedValue(sampleUser)
    // Active membership exists
    mockOrgMemberFindFirst.mockResolvedValue(sampleMembership)

    await expect(
      AuthService.inviteUser(sampleOrg.id, sampleUser.email, 'member'),
    ).rejects.toMatchObject({ statusCode: 409 })

    expect(mockTransaction).not.toHaveBeenCalled()
  })

  it('throws 404 when the organization does not exist', async () => {
    mockOrgFindUnique.mockResolvedValue(null)

    await expect(
      AuthService.inviteUser('nonexistent-org', 'user@example.com', 'member'),
    ).rejects.toMatchObject({ statusCode: 404 })

    expect(mockTransaction).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// AuthService.acceptInvite
// ---------------------------------------------------------------------------

describe('AuthService.acceptInvite', () => {
  beforeEach(() => jest.clearAllMocks())

  const validPayload = {
    type: 'invitation' as const,
    orgId: sampleOrg.id,
    email: 'newuser@example.com',
    role: 'member',
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 86400,
  }

  it('creates a new user with bcrypt-hashed password and active membership when user does not exist', async () => {
    mockVerifyInvitationToken.mockReturnValue(validPayload)
    // Inside transaction: user not found → create
    mockUserFindUnique.mockResolvedValue(null)
    const newUser = { ...sampleUser, email: 'newuser@example.com', fullName: 'New User' }
    mockUserCreate.mockResolvedValue(newUser)
    // No existing membership
    mockOrgMemberFindFirst.mockResolvedValue(null)
    mockOrgMemberCreate.mockResolvedValue({})
    mockBcryptHash.mockResolvedValue('$2b$12$hashed-password')

    const result = await AuthService.acceptInvite(
      'mock-invitation-token',
      { fullName: 'New User', password: 'password123' },
      { requestId: 'req-1' },
    )

    expect(result.orgId).toBe(sampleOrg.id)
    expect(mockBcryptHash).toHaveBeenCalledWith('password123', 12)
    expect(mockUserCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          email: 'newuser@example.com',
          fullName: 'New User',
          passwordHash: '$2b$12$hashed-password',
        }),
      }),
    )
    expect(mockOrgMemberCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          organizationId: sampleOrg.id,
          role: 'member',
          status: 'active',
        }),
      }),
    )
  })

  it('uses the email as fullName when credentials are not provided', async () => {
    mockVerifyInvitationToken.mockReturnValue(validPayload)
    mockUserFindUnique.mockResolvedValue(null)
    mockUserCreate.mockResolvedValue({ ...sampleUser, email: 'newuser@example.com' })
    mockOrgMemberFindFirst.mockResolvedValue(null)
    mockOrgMemberCreate.mockResolvedValue({})

    await AuthService.acceptInvite('mock-invitation-token')

    expect(mockUserCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          email: 'newuser@example.com',
          fullName: 'newuser@example.com', // defaults to email
          passwordHash: '', // no password provided
        }),
      }),
    )
  })

  it('activates an existing invited membership for a known user', async () => {
    mockVerifyInvitationToken.mockReturnValue({ ...validPayload, email: sampleUser.email })
    // Inside transaction: user found
    mockUserFindUnique.mockResolvedValue(sampleUser)
    // Existing invited membership
    const invitedMembership = { ...sampleMembership, status: 'invited' }
    mockOrgMemberFindFirst.mockResolvedValue(invitedMembership)
    mockOrgMemberUpdate.mockResolvedValue({ ...invitedMembership, status: 'active' })

    const result = await AuthService.acceptInvite('mock-invitation-token')

    expect(result.userId).toBe(sampleUser.id)
    expect(result.orgId).toBe(sampleOrg.id)
    // No bcrypt hash for existing users
    expect(mockBcryptHash).not.toHaveBeenCalled()
    expect(mockOrgMemberUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'active', role: 'member' }),
      }),
    )
  })

  it('writes an audit log entry for invite accepted', async () => {
    mockVerifyInvitationToken.mockReturnValue(validPayload)
    mockUserFindUnique.mockResolvedValue(null)
    mockUserCreate.mockResolvedValue({ ...sampleUser, email: 'newuser@example.com' })
    mockOrgMemberFindFirst.mockResolvedValue(null)
    mockOrgMemberCreate.mockResolvedValue({})
    mockBcryptHash.mockResolvedValue('$2b$12$hashed')

    await AuthService.acceptInvite(
      'mock-invitation-token',
      { fullName: 'New User', password: 'password123' },
      { requestId: 'req-2' },
    )

    expect(mockAuditLogCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: 'updated',
          entityType: 'user',
          organizationId: sampleOrg.id,
        }),
      }),
    )
  })

  it('throws 401 when the invitation token is invalid', async () => {
    mockVerifyInvitationToken.mockImplementation(() => {
      throw new Error('JsonWebTokenError: invalid token')
    })

    await expect(AuthService.acceptInvite('bad-token')).rejects.toMatchObject({
      statusCode: 401,
    })

    expect(mockTransaction).not.toHaveBeenCalled()
  })

  it('throws 401 when the invitation token is expired', async () => {
    mockVerifyInvitationToken.mockImplementation(() => {
      throw new Error('TokenExpiredError: jwt expired')
    })

    await expect(AuthService.acceptInvite('expired-token')).rejects.toMatchObject({
      statusCode: 401,
    })

    expect(mockTransaction).not.toHaveBeenCalled()
  })
})
