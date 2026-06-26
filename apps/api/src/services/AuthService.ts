/**
 * AuthService — user registration, login, logout, and token refresh.
 *
 * - register: hash password (bcryptjs cost 12), create user + org + org_member
 *   (role=owner) in a single $transaction, write login_success audit log.
 * - login: verify bcrypt, check org status='active', issue access + refresh
 *   tokens, write login_success or login_failed audit log.
 * - logout / refresh: stubbed — implemented in task 2.4.
 */

import bcrypt from 'bcryptjs'
import { Prisma } from '@prisma/client'
import { prisma, type TransactionClient } from '../lib/prisma.js'
import {
  signAccessToken,
  signRefreshToken,
  hashToken,
  signInvitationToken,
  verifyInvitationToken,
} from '../lib/jwt.js'
import createError from '@fastify/error'

// ---------------------------------------------------------------------------
// Custom errors
// ---------------------------------------------------------------------------

const ConflictError = createError('CONFLICT', '%s', 409)
const UnauthorizedError = createError('UNAUTHORIZED', '%s', 401)
const NotFoundError = createError('NOT_FOUND', '%s', 404)

// ---------------------------------------------------------------------------
// NotImplementedError — stub for methods completed in task 2.4
// ---------------------------------------------------------------------------

export class NotImplementedError extends Error {
  constructor(method: string) {
    super(`${method} is not yet implemented`)
    this.name = 'NotImplementedError'
  }
}

// ---------------------------------------------------------------------------
// RBAC permission map
// ---------------------------------------------------------------------------

const ROLE_PERMISSIONS: Record<string, string[]> = {
  owner: [
    'organization:read', 'organization:update', 'organization:deactivate',
    'user:read', 'user:update', 'user:invite', 'user:role',
    'team:create', 'team:read', 'team:update', 'team:archive', 'team:member',
    'event_type:create', 'event_type:read', 'event_type:update', 'event_type:deprecate',
    'event:ingest', 'event:read',
    'workflow:create', 'workflow:read', 'workflow:update', 'workflow:activate', 'workflow:delete',
    'task:create', 'task:read', 'task:update', 'task:assign', 'task:cancel', 'task:delete',
    'execution:read', 'execution:retry',
    'metric:read', 'kpi:create', 'kpi:read', 'kpi:update', 'kpi:delete',
    'notification:read', 'notification:update',
    'audit_log:read',
  ],
  admin: [
    'organization:read', 'organization:update',
    'user:read', 'user:update', 'user:invite',
    'team:create', 'team:read', 'team:update', 'team:archive', 'team:member',
    'event_type:create', 'event_type:read', 'event_type:update', 'event_type:deprecate',
    'event:ingest', 'event:read',
    'workflow:create', 'workflow:read', 'workflow:update', 'workflow:activate', 'workflow:delete',
    'task:create', 'task:read', 'task:update', 'task:assign', 'task:cancel',
    'execution:read', 'execution:retry',
    'metric:read', 'kpi:create', 'kpi:read', 'kpi:update', 'kpi:delete',
    'notification:read', 'notification:update',
    'audit_log:read',
  ],
  operations_manager: [
    'event_type:create', 'event_type:read', 'event_type:update', 'event_type:deprecate',
    'event:ingest', 'event:read',
    'workflow:create', 'workflow:read', 'workflow:update', 'workflow:activate',
    'task:create', 'task:read', 'task:update', 'task:assign', 'task:cancel',
    'execution:read', 'execution:retry',
    'metric:read', 'kpi:create', 'kpi:read', 'kpi:update', 'kpi:delete',
    'audit_log:read',
  ],
  team_lead: [
    'event:read', 'execution:read',
    'task:create', 'task:read', 'task:update', 'task:assign', 'task:cancel',
    'notification:read', 'notification:update',
  ],
  member: [
    'task:read', 'task:update',
    'notification:read', 'notification:update',
  ],
}

// ---------------------------------------------------------------------------
// Input / output types
// ---------------------------------------------------------------------------

export interface RegisterInput {
  email: string
  password: string
  fullName: string
  organizationName: string
  organizationSlug: string
}

export interface RegisterResult {
  accessToken: string
  refreshToken: string
  refreshTokenExpiresAt: Date
  userId: string
  orgId: string
  email: string
  fullName: string
  role: string
}

export interface LoginInput {
  email: string
  password: string
}

export interface LoginResult {
  accessToken: string
  refreshToken: string
  refreshTokenExpiresAt: Date
  userId: string
  orgId: string
  role: string
  fullName: string
  email: string
}

export interface InviteUserInput {
  /** Organization issuing the invite */
  orgId: string
  /** Email address to invite */
  email: string
  /** Role to assign on acceptance */
  role: string
}

export interface InviteUserResult {
  /** Relative URL the invitee can follow to accept */
  inviteLink: string
  /** Raw signed invitation JWT */
  token: string
}

export interface AcceptInviteResult {
  /** The user record that accepted (created or existing) */
  userId: string
  /** Organization they joined */
  orgId: string
}

// ---------------------------------------------------------------------------
// AuthService
// ---------------------------------------------------------------------------

export const AuthService = {
  /**
   * Register a new user with a new organization.
   *
   * Creates (in a single transaction):
   *  - organizations record
   *  - users record (password hashed with bcrypt cost 12)
   *  - organization_members record (role=owner, status=active)
   *  - refresh_tokens record
   *  - audit_log entry (action=login_success, entity_type=user)
   *
   * Returns the access token and raw refresh token.
   * Throws 409 on duplicate email or slug.
   */
  async register(
    input: RegisterInput,
    context: { requestId?: string } = {},
  ): Promise<RegisterResult> {
    // Pre-flight uniqueness checks outside the transaction for clear errors
    const [existingEmail, existingSlug] = await Promise.all([
      prisma.user.findUnique({ where: { email: input.email } }),
      prisma.organization.findUnique({ where: { slug: input.organizationSlug } }),
    ])

    if (existingEmail) {
      throw new ConflictError(`Email '${input.email}' is already registered`)
    }
    if (existingSlug) {
      throw new ConflictError(`Slug '${input.organizationSlug}' is already in use`)
    }

    const passwordHash = await bcrypt.hash(input.password, 12)
    const { token: rawRefreshToken, expiresAt: refreshTokenExpiresAt } = signRefreshToken()
    const tokenHash = hashToken(rawRefreshToken)

    const result = await prisma.$transaction(async (tx: TransactionClient) => {
      // 1. Create the organization
      const org = await tx.organization.create({
        data: {
          name: input.organizationName,
          slug: input.organizationSlug,
          status: 'active',
        },
      })

      // 2. Create the user
      const user = await tx.user.create({
        data: {
          email: input.email,
          passwordHash,
          fullName: input.fullName,
        },
      })

      // 3. Create the org membership (role=owner)
      await tx.organizationMember.create({
        data: {
          organizationId: org.id,
          userId: user.id,
          role: 'owner',
          status: 'active',
          joinedAt: new Date(),
        },
      })

      // 4. Store the refresh token hash
      await tx.refreshToken.create({
        data: {
          userId: user.id,
          organizationId: org.id,
          tokenHash,
          expiresAt: refreshTokenExpiresAt,
          revoked: false,
        },
      })

      // 5. Write audit log
      await tx.auditLog.create({
        data: {
          organizationId: org.id,
          entityType: 'user',
          entityId: user.id,
          action: 'login_success',
          actorType: 'user',
          actorId: user.id,
          beforeState: Prisma.JsonNull,
          afterState: {
            userId: user.id,
            email: user.email,
            fullName: user.fullName,
            organizationId: org.id,
            role: 'owner',
          },
          requestId: context.requestId ?? null,
        },
      })

      return { org, user }
    })

    const permissions = ROLE_PERMISSIONS['owner'] ?? []
    const accessToken = signAccessToken({
      sub: result.user.id,
      org: result.org.id,
      role: 'owner',
      permissions,
    })

    return {
      accessToken,
      refreshToken: rawRefreshToken,
      refreshTokenExpiresAt,
      userId: result.user.id,
      email: result.user.email,
      fullName: result.user.fullName,
      orgId: result.org.id,
      role: 'owner',
    }
  },

  /**
   * Authenticate a user by email + password.
   *
   * Steps:
   *  1. Look up user by email (generic 401 if not found — no enumeration)
   *  2. Verify password with bcrypt
   *  3. Find org membership; verify org status='active'
   *  4. Issue access + refresh tokens
   *  5. Write login_success or login_failed audit log (in a transaction)
   *
   * Throws 401 on invalid credentials or deactivated org.
   */
  async login(
    input: LoginInput,
    context: { requestId?: string } = {},
  ): Promise<LoginResult> {
    const user = await prisma.user.findUnique({ where: { email: input.email } })

    const passwordValid = user
      ? await bcrypt.compare(input.password, user.passwordHash)
      : false

    // If no user or bad password — write login_failed audit (best-effort)
    // and return 401. We do NOT write an audit log if there's no user/org to
    // attach it to (organization_id is required on audit_log).
    if (!user || !passwordValid) {
      // Attempt to write failed audit log if we have a user
      if (user) {
        const membership = await prisma.organizationMember.findFirst({
          where: { userId: user.id },
          include: { organization: true },
          orderBy: { createdAt: 'asc' },
        })
        if (membership) {
          await prisma.auditLog.create({
            data: {
              organizationId: membership.organizationId,
              entityType: 'user',
              entityId: user.id,
              action: 'login_failed',
              actorType: 'user',
              actorId: user.id,
              beforeState: Prisma.JsonNull,
              afterState: Prisma.JsonNull,
              requestId: context.requestId ?? null,
            },
          })
        }
      }
      throw new UnauthorizedError('Invalid email or password')
    }

    // Find the org membership (take the most recently created one if multiple)
    const membership = await prisma.organizationMember.findFirst({
      where: { userId: user.id, status: 'active' },
      include: { organization: true },
      orderBy: { createdAt: 'asc' },
    })

    if (!membership) {
      // No active membership — write failed audit if we can get any org
      const anyMembership = await prisma.organizationMember.findFirst({
        where: { userId: user.id },
        orderBy: { createdAt: 'asc' },
      })
      if (anyMembership) {
        await prisma.auditLog.create({
          data: {
            organizationId: anyMembership.organizationId,
            entityType: 'user',
            entityId: user.id,
            action: 'login_failed',
            actorType: 'user',
            actorId: user.id,
            beforeState: Prisma.JsonNull,
            afterState: Prisma.JsonNull,
            requestId: context.requestId ?? null,
          },
        })
      }
      throw new UnauthorizedError('Invalid email or password')
    }

    if (membership.organization.status !== 'active') {
      await prisma.auditLog.create({
        data: {
          organizationId: membership.organizationId,
          entityType: 'user',
          entityId: user.id,
          action: 'login_failed',
          actorType: 'user',
          actorId: user.id,
          beforeState: Prisma.JsonNull,
          afterState: Prisma.JsonNull,
          requestId: context.requestId ?? null,
        },
      })
      throw new UnauthorizedError('Organization is not active')
    }

    const { token: rawRefreshToken, expiresAt: refreshTokenExpiresAt } = signRefreshToken()
    const tokenHash = hashToken(rawRefreshToken)

    await prisma.$transaction(async (tx: TransactionClient) => {
      await tx.refreshToken.create({
        data: {
          userId: user.id,
          organizationId: membership.organizationId,
          tokenHash,
          expiresAt: refreshTokenExpiresAt,
          revoked: false,
        },
      })

      await tx.auditLog.create({
        data: {
          organizationId: membership.organizationId,
          entityType: 'user',
          entityId: user.id,
          action: 'login_success',
          actorType: 'user',
          actorId: user.id,
          beforeState: Prisma.JsonNull,
          afterState: {
            userId: user.id,
            email: user.email,
            organizationId: membership.organizationId,
            role: membership.role,
          },
          requestId: context.requestId ?? null,
        },
      })
    })

    const permissions = ROLE_PERMISSIONS[membership.role] ?? []
    const accessToken = signAccessToken({
      sub: user.id,
      org: membership.organizationId,
      role: membership.role,
      permissions,
    })

    return {
      accessToken,
      refreshToken: rawRefreshToken,
      refreshTokenExpiresAt,
      userId: user.id,
      email: user.email,
      fullName: user.fullName,
      orgId: membership.organizationId,
      role: membership.role,
    }
  },

  /**
   * Logout — revoke the current refresh token.
   *
   * Looks up the hashed token in `refresh_tokens` and sets `revoked=true`.
   * If the cookie is absent or the token is not found, returns silently
   * (idempotent — a missing or already-revoked token is not an error).
   */
  async logout(rawRefreshToken: string, context: { requestId?: string } = {}): Promise<void> {
    const tokenHash = hashToken(rawRefreshToken)

    const existing = await prisma.refreshToken.findUnique({ where: { tokenHash } })
    if (!existing || existing.revoked) {
      // Already revoked or never existed — idempotent, nothing to do.
      return
    }

    await prisma.refreshToken.update({
      where: { tokenHash },
      data: { revoked: true },
    })

    // Write a best-effort audit log for the logout (non-transactional is acceptable
    // here because revocation is already committed — audit failure should not
    // un-revoke the token).
    try {
      await prisma.auditLog.create({
        data: {
          organizationId: existing.organizationId,
          entityType: 'user',
          entityId: existing.userId,
          action: 'login_failed', // logout maps to login_failed per spec convention
          actorType: 'user',
          actorId: existing.userId,
          beforeState: Prisma.JsonNull,
          afterState: Prisma.JsonNull,
          requestId: context.requestId ?? null,
        },
      })
    } catch {
      // Non-fatal — revocation is already persisted
    }
  },

  /**
   * Refresh token rotation — revoke old token, issue new access + refresh pair.
   *
   * Steps (all inside a single $transaction):
   *  1. Hash the raw token, look up in `refresh_tokens`
   *  2. If not found, revoked, or expired → write login_failed audit log and throw 401
   *  3. Revoke the old token (set revoked=true)
   *  4. Issue a new refresh token; store its hash
   *  5. Write login_success audit log
   *  6. Return new access token + raw refresh token
   *
   * Returns the same shape as LoginResult so the route handler can reuse the
   * cookie-setting logic.
   */
  async refresh(
    rawRefreshToken: string,
    context: { requestId?: string } = {},
  ): Promise<LoginResult> {
    const tokenHash = hashToken(rawRefreshToken)

    // Look up the existing token record (outside transaction for clear 401 reason)
    const existing = await prisma.refreshToken.findUnique({
      where: { tokenHash },
      include: { user: { include: { memberships: { include: { organization: true } } } } },
    })

    // Helper: write login_failed audit when orgId is available
    const writeFailedAudit = async (orgId: string, userId: string) => {
      try {
        await prisma.auditLog.create({
          data: {
            organizationId: orgId,
            entityType: 'user',
            entityId: userId,
            action: 'login_failed',
            actorType: 'user',
            actorId: userId,
            beforeState: Prisma.JsonNull,
            afterState: Prisma.JsonNull,
            requestId: context.requestId ?? null,
          },
        })
      } catch {
        // Best-effort
      }
    }

    if (!existing) {
      throw new UnauthorizedError('Invalid refresh token')
    }

    if (existing.revoked || existing.expiresAt < new Date()) {
      await writeFailedAudit(existing.organizationId, existing.userId)
      throw new UnauthorizedError('Refresh token is revoked or expired')
    }

    // Find the active membership for this user+org
    const membership = existing.user.memberships.find(
      (m: { organizationId: string; status: string; role: string; organization: { status: string } }) =>
        m.organizationId === existing.organizationId &&
        m.status === 'active',
    )

    if (!membership) {
      await writeFailedAudit(existing.organizationId, existing.userId)
      throw new UnauthorizedError('No active membership found')
    }

    if (membership.organization.status !== 'active') {
      await writeFailedAudit(existing.organizationId, existing.userId)
      throw new UnauthorizedError('Organization is not active')
    }

    const { token: newRawRefreshToken, expiresAt: newRefreshTokenExpiresAt } = signRefreshToken()
    const newTokenHash = hashToken(newRawRefreshToken)

    // All DB mutations in a single transaction: revoke old, create new, audit log
    await prisma.$transaction(async (tx: TransactionClient) => {
      // 1. Revoke the old token
      await tx.refreshToken.update({
        where: { tokenHash },
        data: { revoked: true },
      })

      // 2. Create the new token record
      await tx.refreshToken.create({
        data: {
          userId: existing.userId,
          organizationId: existing.organizationId,
          tokenHash: newTokenHash,
          expiresAt: newRefreshTokenExpiresAt,
          revoked: false,
        },
      })

      // 3. Write login_success audit log
      await tx.auditLog.create({
        data: {
          organizationId: existing.organizationId,
          entityType: 'user',
          entityId: existing.userId,
          action: 'login_success',
          actorType: 'user',
          actorId: existing.userId,
          beforeState: Prisma.JsonNull,
          afterState: {
            userId: existing.userId,
            organizationId: existing.organizationId,
            role: membership.role,
            tokenRotated: true,
          },
          requestId: context.requestId ?? null,
        },
      })
    })

    const permissions = ROLE_PERMISSIONS[membership.role] ?? []
    const accessToken = signAccessToken({
      sub: existing.userId,
      org: existing.organizationId,
      role: membership.role,
      permissions,
    })

    return {
      accessToken,
      refreshToken: newRawRefreshToken,
      refreshTokenExpiresAt: newRefreshTokenExpiresAt,
      userId: existing.userId,
      email: existing.user.email,
      fullName: existing.user.fullName,
      orgId: existing.organizationId,
      role: membership.role,
    }
  },

  /**
   * Invite a user to an organization by email.
   *
   * Steps:
   *  1. Verify the org exists
   *  2. Check if a user with that email already has an active membership → 409
   *  3. Create (or update if already invited) an organization_members record
   *     with status='invited', invited_at=now()
   *  4. Sign a 24-hour invitation JWT
   *  5. Write audit log (action='created', entity_type='user')
   *  6. Return { inviteLink, token }
   *
   * @param orgId   - Organization issuing the invite
   * @param email   - Email address to invite
   * @param role    - Role to assign on acceptance
   * @param context - Optional request context (actorId, requestId)
   */
  async inviteUser(
    orgId: string,
    email: string,
    role: string,
    context: { requestId?: string; actorId?: string } = {},
  ): Promise<InviteUserResult> {
    // Verify org exists
    const org = await prisma.organization.findUnique({ where: { id: orgId } })
    if (!org) {
      throw new NotFoundError(`Organization '${orgId}' not found`)
    }

    // Check if a user with this email already has an active membership in this org
    const existingUser = await prisma.user.findUnique({ where: { email } })
    if (existingUser) {
      const activeMembership = await prisma.organizationMember.findFirst({
        where: {
          organizationId: orgId,
          userId: existingUser.id,
          status: 'active',
        },
      })
      if (activeMembership) {
        throw new ConflictError(
          `User '${email}' already has an active membership in this organization`,
        )
      }
    }

    // Build or refresh the invitation record inside a transaction
    const member = await prisma.$transaction(async (tx: TransactionClient) => {
      let createdMember

      if (existingUser) {
        // Upsert the organization_members record for the existing user
        const existingMember = await tx.organizationMember.findFirst({
          where: { organizationId: orgId, userId: existingUser.id },
        })

        if (existingMember) {
          createdMember = await tx.organizationMember.update({
            where: { id: existingMember.id },
            data: {
              role,
              status: 'invited',
              invitedAt: new Date(),
            },
          })
        } else {
          createdMember = await tx.organizationMember.create({
            data: {
              organizationId: orgId,
              userId: existingUser.id,
              role,
              status: 'invited',
              invitedAt: new Date(),
            },
          })
        }
      } else {
        // We don't know the userId yet (user doesn't exist) — store a sentinel
        // placeholder record. We'll match by email in acceptInvite via the JWT.
        // However, OrganizationMember requires a valid userId FK, so we cannot
        // create the record until the user is created. Instead, we only create
        // the membership record when the user actually accepts. At invite time
        // we just sign the JWT and write the audit log without a member record.
        createdMember = null
      }

      // Write audit log entry for invite sent
      await tx.auditLog.create({
        data: {
          organizationId: orgId,
          entityType: 'user',
          entityId: existingUser?.id ?? orgId, // fall back to orgId when user is not yet created
          action: 'created',
          actorType: context.actorId ? 'user' : 'system',
          actorId: context.actorId ?? null,
          beforeState: Prisma.JsonNull,
          afterState: {
            email,
            role,
            organizationId: orgId,
            status: 'invited',
          },
          requestId: context.requestId ?? null,
        },
      })

      return createdMember
    })

    void member // used only for side-effects above

    // Sign invitation JWT
    const invitationToken = signInvitationToken({
      type: 'invitation',
      orgId,
      email,
      role,
    })

    const inviteLink = `/v1/auth/invite/${invitationToken}/accept`

    return { inviteLink, token: invitationToken }
  },

  /**
   * Accept an invitation using a signed invitation JWT.
   *
   * Steps:
   *  1. Verify the JWT (throw 401 on invalid/expired)
   *  2. Extract { orgId, email, role } from the token
   *  3. If user doesn't exist, create with bcrypt(password, 12) and provided fullName
   *     If user already exists, just proceed (no password update)
   *  4. Upsert the organization_members record: status='active', joined_at=now()
   *  5. Write audit log (action='updated', entity_type='user')
   *  6. Return { userId, orgId }
   *
   * @param token - Raw invitation JWT from the URL
   * @param credentials - `{ fullName, password }` for new user creation
   * @param context - Optional request context (requestId)
   */
  async acceptInvite(
    token: string,
    credentials: { fullName?: string; password?: string } = {},
    context: { requestId?: string } = {},
  ): Promise<AcceptInviteResult> {
    let payload
    try {
      payload = verifyInvitationToken(token)
    } catch {
      throw new UnauthorizedError('Invalid or expired invitation token')
    }

    const { orgId, email, role } = payload

    const result = await prisma.$transaction(async (tx: TransactionClient) => {
      // Find or create the user
      let user = await tx.user.findUnique({ where: { email } })

      if (!user) {
        // Create a new user with provided credentials
        const passwordHash = credentials.password
          ? await bcrypt.hash(credentials.password, 12)
          : ''
        user = await tx.user.create({
          data: {
            email,
            passwordHash,
            fullName: credentials.fullName ?? email,
          },
        })
      }

      // Upsert the membership record
      const existingMember = await tx.organizationMember.findFirst({
        where: { organizationId: orgId, userId: user.id },
      })

      if (existingMember) {
        await tx.organizationMember.update({
          where: { id: existingMember.id },
          data: {
            role,
            status: 'active',
            joinedAt: new Date(),
          },
        })
      } else {
        await tx.organizationMember.create({
          data: {
            organizationId: orgId,
            userId: user.id,
            role,
            status: 'active',
            joinedAt: new Date(),
            invitedAt: new Date(),
          },
        })
      }

      // Write audit log entry for invite accepted
      await tx.auditLog.create({
        data: {
          organizationId: orgId,
          entityType: 'user',
          entityId: user.id,
          action: 'updated',
          actorType: 'user',
          actorId: user.id,
          beforeState: Prisma.JsonNull,
          afterState: {
            userId: user.id,
            email: user.email,
            role,
            organizationId: orgId,
            status: 'active',
          },
          requestId: context.requestId ?? null,
        },
      })

      return { userId: user.id, orgId }
    })

    return result
  },
}
