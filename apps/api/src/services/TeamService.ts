import { prisma, type TransactionClient } from '../lib/prisma.js'
import { Prisma } from '@prisma/client'
import createError from '@fastify/error'

// ---------------------------------------------------------------------------
// Custom errors
// ---------------------------------------------------------------------------

const NotFoundError = createError('NOT_FOUND', '%s', 404)
const ConflictError = createError('CONFLICT', '%s', 409)
const UnprocessableError = createError('UNPROCESSABLE_ENTITY', '%s', 422)

// ---------------------------------------------------------------------------
// Input types
// ---------------------------------------------------------------------------

export interface CreateTeamInput {
  name: string
  description?: string | undefined
}

export interface UpdateTeamInput {
  name?: string | undefined
  description?: string | undefined
}

export interface AddMemberInput {
  userId: string
}

// ---------------------------------------------------------------------------
// Context type
// ---------------------------------------------------------------------------

interface MutationContext {
  requestId?: string
  actorId?: string
}

// ---------------------------------------------------------------------------
// TeamService
// ---------------------------------------------------------------------------

export const TeamService = {
  /**
   * Create a new team within an organization.
   * Writes an audit log entry inside the same transaction.
   */
  async createTeam(
    orgId: string,
    input: CreateTeamInput,
    context: MutationContext = {},
  ) {
    // Check for name uniqueness within the org
    const existing = await prisma.team.findFirst({
      where: { organizationId: orgId, name: input.name },
    })
    if (existing) {
      throw new ConflictError(`Team name '${input.name}' already exists in this organization`)
    }

    return prisma.$transaction(async (tx: TransactionClient) => {
      const team = await tx.team.create({
        data: {
          organizationId: orgId,
          name: input.name,
          status: 'active',
        },
      })

      await tx.auditLog.create({
        data: {
          organizationId: orgId,
          entityType: 'team',
          entityId: team.id,
          action: 'created',
          actorType: context.actorId ? 'user' : 'system',
          actorId: context.actorId ?? null,
          beforeState: Prisma.JsonNull,
          afterState: {
            id: team.id,
            organizationId: team.organizationId,
            name: team.name,
            status: team.status,
            createdAt: team.createdAt,
            updatedAt: team.updatedAt,
          },
          requestId: context.requestId ?? null,
        },
      })

      return team
    })
  },

  /**
   * List all teams for an organization (active and archived).
   */
  async listTeams(orgId: string) {
    return prisma.team.findMany({
      where: { organizationId: orgId },
      orderBy: { createdAt: 'asc' },
    })
  },

  /**
   * Find a single team by id within an organization.
   * Returns null if not found.
   */
  async findById(orgId: string, teamId: string) {
    const team = await prisma.team.findFirst({
      where: { id: teamId, organizationId: orgId },
      include: { members: { include: { user: { select: { id: true, email: true, fullName: true } } } } },
    })
    return team
  },

  /**
   * Update a team's name.
   * Writes an audit log entry inside the same transaction.
   */
  async updateTeam(
    orgId: string,
    teamId: string,
    input: UpdateTeamInput,
    context: MutationContext = {},
  ) {
    const team = await prisma.team.findFirst({
      where: { id: teamId, organizationId: orgId },
    })
    if (!team) {
      throw new NotFoundError(`Team '${teamId}' not found`)
    }

    // Check name uniqueness if name is being changed
    if (input.name && input.name !== team.name) {
      const conflict = await prisma.team.findFirst({
        where: { organizationId: orgId, name: input.name },
      })
      if (conflict) {
        throw new ConflictError(`Team name '${input.name}' already exists in this organization`)
      }
    }

    return prisma.$transaction(async (tx: TransactionClient) => {
      const updated = await tx.team.update({
        where: { id: teamId },
        data: {
          ...(input.name !== undefined ? { name: input.name } : {}),
        },
      })

      await tx.auditLog.create({
        data: {
          organizationId: orgId,
          entityType: 'team',
          entityId: teamId,
          action: 'updated',
          actorType: context.actorId ? 'user' : 'system',
          actorId: context.actorId ?? null,
          beforeState: {
            id: team.id,
            organizationId: team.organizationId,
            name: team.name,
            status: team.status,
            createdAt: team.createdAt,
            updatedAt: team.updatedAt,
          },
          afterState: {
            id: updated.id,
            organizationId: updated.organizationId,
            name: updated.name,
            status: updated.status,
            createdAt: updated.createdAt,
            updatedAt: updated.updatedAt,
          },
          requestId: context.requestId ?? null,
        },
      })

      return updated
    })
  },

  /**
   * Archive a team — sets status to 'archived'.
   * Idempotent: if already archived, returns current record.
   * Writes an audit log entry inside the same transaction.
   */
  async archiveTeam(
    orgId: string,
    teamId: string,
    context: MutationContext = {},
  ) {
    const team = await prisma.team.findFirst({
      where: { id: teamId, organizationId: orgId },
    })
    if (!team) {
      throw new NotFoundError(`Team '${teamId}' not found`)
    }

    // Idempotent — already archived
    if (team.status === 'archived') {
      return team
    }

    return prisma.$transaction(async (tx: TransactionClient) => {
      const updated = await tx.team.update({
        where: { id: teamId },
        data: { status: 'archived' },
      })

      await tx.auditLog.create({
        data: {
          organizationId: orgId,
          entityType: 'team',
          entityId: teamId,
          action: 'status_changed',
          actorType: context.actorId ? 'user' : 'system',
          actorId: context.actorId ?? null,
          beforeState: {
            id: team.id,
            name: team.name,
            status: team.status,
            organizationId: team.organizationId,
            createdAt: team.createdAt,
            updatedAt: team.updatedAt,
          },
          afterState: {
            id: updated.id,
            name: updated.name,
            status: updated.status,
            organizationId: updated.organizationId,
            createdAt: updated.createdAt,
            updatedAt: updated.updatedAt,
          },
          requestId: context.requestId ?? null,
        },
      })

      return updated
    })
  },

  /**
   * Add a member to a team.
   * Validates:
   *  - Team exists and is active (422 if archived)
   *  - User is a member of the organization
   *  - No duplicate membership (409)
   * Writes an audit log entry inside the same transaction.
   */
  async addMember(
    orgId: string,
    teamId: string,
    input: AddMemberInput,
    context: MutationContext = {},
  ) {
    const team = await prisma.team.findFirst({
      where: { id: teamId, organizationId: orgId },
    })
    if (!team) {
      throw new NotFoundError(`Team '${teamId}' not found`)
    }

    if (team.status === 'archived') {
      throw new UnprocessableError(`Cannot add members to archived team '${teamId}'`)
    }

    // Check user is a member of the organization
    const orgMember = await prisma.organizationMember.findFirst({
      where: { organizationId: orgId, userId: input.userId },
    })
    if (!orgMember) {
      throw new NotFoundError(`User '${input.userId}' is not a member of this organization`)
    }

    // Check for duplicate team membership
    const existing = await prisma.teamMember.findFirst({
      where: { teamId, userId: input.userId },
    })
    if (existing) {
      throw new ConflictError(`User '${input.userId}' is already a member of team '${teamId}'`)
    }

    return prisma.$transaction(async (tx: TransactionClient) => {
      const member = await tx.teamMember.create({
        data: {
          teamId,
          userId: input.userId,
          organizationId: orgId,
        },
      })

      await tx.auditLog.create({
        data: {
          organizationId: orgId,
          entityType: 'team',
          entityId: teamId,
          action: 'updated',
          actorType: context.actorId ? 'user' : 'system',
          actorId: context.actorId ?? null,
          beforeState: Prisma.JsonNull,
          afterState: {
            action: 'member_added',
            teamId,
            userId: input.userId,
            teamMemberId: member.id,
          },
          requestId: context.requestId ?? null,
        },
      })

      return member
    })
  },

  /**
   * Remove a member from a team.
   * Writes an audit log entry inside the same transaction.
   */
  async removeMember(
    orgId: string,
    teamId: string,
    userId: string,
    context: MutationContext = {},
  ) {
    const team = await prisma.team.findFirst({
      where: { id: teamId, organizationId: orgId },
    })
    if (!team) {
      throw new NotFoundError(`Team '${teamId}' not found`)
    }

    const member = await prisma.teamMember.findFirst({
      where: { teamId, userId, organizationId: orgId },
    })
    if (!member) {
      throw new NotFoundError(`User '${userId}' is not a member of team '${teamId}'`)
    }

    return prisma.$transaction(async (tx: TransactionClient) => {
      await tx.teamMember.delete({
        where: { id: member.id },
      })

      await tx.auditLog.create({
        data: {
          organizationId: orgId,
          entityType: 'team',
          entityId: teamId,
          action: 'updated',
          actorType: context.actorId ? 'user' : 'system',
          actorId: context.actorId ?? null,
          beforeState: {
            action: 'member_removed',
            teamId,
            userId,
            teamMemberId: member.id,
          },
          afterState: Prisma.JsonNull,
          requestId: context.requestId ?? null,
        },
      })
    })
  },
}
