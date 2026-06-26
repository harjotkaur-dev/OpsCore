import { prisma, type TransactionClient } from '../lib/prisma.js'
import { Prisma } from '@prisma/client'
import createError from '@fastify/error'

// ---------------------------------------------------------------------------
// Custom errors
// ---------------------------------------------------------------------------

const NotFoundError = createError('NOT_FOUND', '%s', 404)
const ConflictError = createError('CONFLICT', '%s', 409)

// ---------------------------------------------------------------------------
// Input types
// ---------------------------------------------------------------------------

export interface CreateOrganizationInput {
  name: string
  slug: string
}

export interface UpdateOrganizationInput {
  name?: string | undefined
  slug?: string | undefined
}

// ---------------------------------------------------------------------------
// OrganizationService
// ---------------------------------------------------------------------------

export const OrganizationService = {
  /**
   * Create a new organization.
   * Writes a single audit log entry inside the same transaction.
   */
  async create(
    input: CreateOrganizationInput,
    context: { requestId?: string; actorId?: string } = {},
  ) {
    // Validate slug uniqueness before opening a transaction so we can return
    // a clear 409 rather than a raw Prisma constraint error.
    const existing = await prisma.organization.findUnique({
      where: { slug: input.slug },
    })
    if (existing) {
      throw new ConflictError(`Slug '${input.slug}' is already in use`)
    }

    return prisma.$transaction(async (tx: TransactionClient) => {
      const org = await tx.organization.create({
        data: {
          name: input.name,
          slug: input.slug,
          status: 'active',
        },
      })

      await tx.auditLog.create({
        data: {
          organizationId: org.id,
          entityType: 'organization',
          entityId: org.id,
          action: 'created',
          actorType: context.actorId ? 'user' : 'system',
          actorId: context.actorId ?? null,
          beforeState: Prisma.JsonNull,
          afterState: {
            id: org.id,
            name: org.name,
            slug: org.slug,
            status: org.status,
            createdAt: org.createdAt,
            updatedAt: org.updatedAt,
          },
          requestId: context.requestId ?? null,
        },
      })

      return org
    })
  },

  /**
   * Find an organization by its id.
   * Returns null if not found.
   */
  async findById(id: string) {
    return prisma.organization.findUnique({ where: { id } })
  },

  /**
   * Update name and/or slug of an organization.
   * Writes a single audit log entry inside the same transaction.
   */
  async update(
    id: string,
    input: UpdateOrganizationInput,
    context: { requestId?: string; actorId?: string } = {},
  ) {
    const org = await prisma.organization.findUnique({ where: { id } })
    if (!org) {
      throw new NotFoundError(`Organization '${id}' not found`)
    }

    // Check slug uniqueness when slug is being changed
    if (input.slug && input.slug !== org.slug) {
      const conflicting = await prisma.organization.findUnique({
        where: { slug: input.slug },
      })
      if (conflicting) {
        throw new ConflictError(`Slug '${input.slug}' is already in use`)
      }
    }

    return prisma.$transaction(async (tx: TransactionClient) => {
      const updated = await tx.organization.update({
        where: { id },
        data: {
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.slug !== undefined ? { slug: input.slug } : {}),
        },
      })

      await tx.auditLog.create({
        data: {
          organizationId: id,
          entityType: 'organization',
          entityId: id,
          action: 'updated',
          actorType: context.actorId ? 'user' : 'system',
          actorId: context.actorId ?? null,
          beforeState: {
            id: org.id,
            name: org.name,
            slug: org.slug,
            status: org.status,
            createdAt: org.createdAt,
            updatedAt: org.updatedAt,
          },
          afterState: {
            id: updated.id,
            name: updated.name,
            slug: updated.slug,
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
   * Deactivate an organization — sets status to 'deactivated'.
   * Does NOT delete any data.
   * Writes a single audit log entry inside the same transaction.
   */
  async deactivate(
    id: string,
    context: { requestId?: string; actorId?: string } = {},
  ) {
    const org = await prisma.organization.findUnique({ where: { id } })
    if (!org) {
      throw new NotFoundError(`Organization '${id}' not found`)
    }

    if (org.status === 'deactivated') {
      // Already deactivated — return current record (idempotent)
      return org
    }

    return prisma.$transaction(async (tx: TransactionClient) => {
      const updated = await tx.organization.update({
        where: { id },
        data: { status: 'deactivated' },
      })

      await tx.auditLog.create({
        data: {
          organizationId: id,
          entityType: 'organization',
          entityId: id,
          action: 'status_changed',
          actorType: context.actorId ? 'user' : 'system',
          actorId: context.actorId ?? null,
          beforeState: {
            id: org.id,
            name: org.name,
            slug: org.slug,
            status: org.status,
            createdAt: org.createdAt,
            updatedAt: org.updatedAt,
          },
          afterState: {
            id: updated.id,
            name: updated.name,
            slug: updated.slug,
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
}
