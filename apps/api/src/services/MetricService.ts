/**
 * MetricService (API) — Task 8.5
 *
 * Handles KPI definition CRUD and metric query operations.
 *
 * KPI methods:
 *   createKPI   — validates metricId + ownerUserId, creates KPI + audit log
 *   updateKPI   — loads KPI, updates fields, writes audit log
 *   deleteKPI   — hard-delete + audit log
 *   listKPIs    — cursor pagination, order by createdAt DESC
 *   getKPI      — findFirst scoped to org
 *
 * Metric query methods:
 *   listMetrics  — return all metric records for the org
 *   getMetricHistory — return MetricHistory records for a named metric, cursor pagination
 *
 * Requirements: 11.3, 11.4, 11.5
 */

import { Prisma } from '@prisma/client'
import { prisma, type TransactionClient } from '../lib/prisma.js'
import { AuditService } from './AuditService.js'
import createError from '@fastify/error'

// ---------------------------------------------------------------------------
// Custom errors
// ---------------------------------------------------------------------------

const NotFoundError = createError('NOT_FOUND', '%s', 404)
const UnprocessableError = createError('UNPROCESSABLE_ENTITY', '%s', 422)

// ---------------------------------------------------------------------------
// Input / output types
// ---------------------------------------------------------------------------

export interface CreateKPIInput {
  name: string
  metricId: string
  operator: '>' | '<' | '>=' | '<=' | '='
  targetValue: number
  ownerUserId: string
}

export interface UpdateKPIInput {
  name?: string
  targetValue?: number
  operator?: '>' | '<' | '>=' | '<=' | '='
  status?: 'active' | 'inactive'
}

export interface ListKPIsFilters {
  status?: string
}

export interface ListKPIsPagination {
  after?: string
  limit?: number
}

export interface ListMetricHistoryPagination {
  after?: string
  limit?: number
}

export interface MutationContext {
  requestId?: string
  actorId?: string
}

// ---------------------------------------------------------------------------
// MetricService
// ---------------------------------------------------------------------------

export const MetricService = {

  // -------------------------------------------------------------------------
  // createKPI (Req 11.3)
  // -------------------------------------------------------------------------

  /**
   * Create a KPI for an organization.
   *
   * Validates:
   *  - metricId belongs to the org (404 if not)
   *  - ownerUserId is an active org member (422 if not)
   *
   * Creates KPI + audit log in a single transaction.
   */
  async createKPI(
    orgId: string,
    input: CreateKPIInput,
    context: MutationContext = {},
  ) {
    // Validate metricId belongs to this org
    const metric = await prisma.metric.findFirst({
      where: { id: input.metricId, organizationId: orgId },
    })
    if (!metric) {
      throw new NotFoundError(`Metric '${input.metricId}' not found in this organization`)
    }

    // Validate ownerUserId is an active org member
    const member = await prisma.organizationMember.findFirst({
      where: { organizationId: orgId, userId: input.ownerUserId, status: 'active' },
    })
    if (!member) {
      throw new UnprocessableError(
        `User '${input.ownerUserId}' is not an active member of this organization`,
      )
    }

    return prisma.$transaction(async (tx: TransactionClient) => {
      const kpi = await tx.kPI.create({
        data: {
          organizationId: orgId,
          name: input.name,
          metricId: input.metricId,
          operator: input.operator,
          targetValue: new Prisma.Decimal(input.targetValue),
          ownerUserId: input.ownerUserId,
          status: 'active',
        },
        include: { metric: true, owner: { select: { id: true, fullName: true, email: true } } },
      })

      await AuditService.log(tx, {
        orgId,
        entityType: 'kpi',
        entityId: kpi.id,
        action: 'created',
        actorType: context.actorId ? 'user' : 'system',
        actorId: context.actorId ?? null,
        beforeState: null,
        afterState: {
          id: kpi.id,
          name: kpi.name,
          metricId: kpi.metricId,
          operator: kpi.operator,
          targetValue: kpi.targetValue.toString(),
          ownerUserId: kpi.ownerUserId,
          status: kpi.status,
        },
        requestId: context.requestId ?? null,
      })

      return kpi
    })
  },

  // -------------------------------------------------------------------------
  // updateKPI (Req 11.3)
  // -------------------------------------------------------------------------

  /**
   * Update a KPI's name, targetValue, or operator.
   * Writes audit log inside the same transaction.
   */
  async updateKPI(
    orgId: string,
    kpiId: string,
    input: UpdateKPIInput,
    context: MutationContext = {},
  ) {
    const kpi = await prisma.kPI.findFirst({
      where: { id: kpiId, organizationId: orgId },
    })
    if (!kpi) throw new NotFoundError(`KPI '${kpiId}' not found`)

    return prisma.$transaction(async (tx: TransactionClient) => {
      const updated = await tx.kPI.update({
        where: { id: kpiId },
        data: {
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.targetValue !== undefined ? { targetValue: new Prisma.Decimal(input.targetValue) } : {}),
          ...(input.operator !== undefined ? { operator: input.operator } : {}),
          ...(input.status !== undefined ? { status: input.status } : {}),
        },
        include: { metric: true, owner: { select: { id: true, fullName: true, email: true } } },
      })

      await AuditService.log(tx, {
        orgId,
        entityType: 'kpi',
        entityId: kpiId,
        action: 'updated',
        actorType: context.actorId ? 'user' : 'system',
        actorId: context.actorId ?? null,
        beforeState: {
          name: kpi.name,
          operator: kpi.operator,
          targetValue: kpi.targetValue.toString(),
          status: kpi.status,
        },
        afterState: {
          name: updated.name,
          operator: updated.operator,
          targetValue: updated.targetValue.toString(),
          status: updated.status,
        },
        requestId: context.requestId ?? null,
      })

      return updated
    })
  },

  // -------------------------------------------------------------------------
  // deleteKPI (Req 11.3)
  // -------------------------------------------------------------------------

  /**
   * Hard-delete a KPI. Writes audit log inside the same transaction.
   */
  async deleteKPI(
    orgId: string,
    kpiId: string,
    context: MutationContext = {},
  ) {
    const kpi = await prisma.kPI.findFirst({
      where: { id: kpiId, organizationId: orgId },
    })
    if (!kpi) throw new NotFoundError(`KPI '${kpiId}' not found`)

    return prisma.$transaction(async (tx: TransactionClient) => {
      await tx.kPI.delete({ where: { id: kpiId } })

      await AuditService.log(tx, {
        orgId,
        entityType: 'kpi',
        entityId: kpiId,
        action: 'deleted',
        actorType: context.actorId ? 'user' : 'system',
        actorId: context.actorId ?? null,
        beforeState: {
          id: kpi.id,
          name: kpi.name,
          operator: kpi.operator,
          targetValue: kpi.targetValue.toString(),
          status: kpi.status,
        },
        afterState: null,
        requestId: context.requestId ?? null,
      })
    })
  },

  // -------------------------------------------------------------------------
  // listKPIs (Req 11.3, 11.5)
  // -------------------------------------------------------------------------

  /**
   * List KPIs for an organization with optional status filter.
   * Cursor-based pagination, ordered by createdAt DESC.
   */
  async listKPIs(
    orgId: string,
    filters: ListKPIsFilters = {},
    pagination: ListKPIsPagination = {},
  ) {
    const limit = Math.min(pagination.limit ?? 20, 100)

    const where: Prisma.KPIWhereInput = {
      organizationId: orgId,
      ...(filters.status ? { status: filters.status } : {}),
    }

    const kpis = await prisma.kPI.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      include: {
        metric: { select: { id: true, name: true, metricType: true, currentValue: true, computedAt: true } },
        owner: { select: { id: true, fullName: true, email: true } },
      },
      ...(pagination.after ? { cursor: { id: pagination.after }, skip: 1 } : {}),
    })

    const hasNextPage = kpis.length > limit
    const data = hasNextPage ? kpis.slice(0, limit) : kpis
    const nextCursor = hasNextPage ? (data[data.length - 1]?.id ?? null) : null

    return { data, pagination: { limit, hasNextPage, nextCursor } }
  },

  // -------------------------------------------------------------------------
  // getKPI (Req 11.3, 11.5)
  // -------------------------------------------------------------------------

  /**
   * Get a single KPI by id scoped to the organization.
   * Returns null if not found.
   */
  async getKPI(orgId: string, kpiId: string) {
    return prisma.kPI.findFirst({
      where: { id: kpiId, organizationId: orgId },
      include: {
        metric: { select: { id: true, name: true, metricType: true, currentValue: true, computedAt: true } },
        owner: { select: { id: true, fullName: true, email: true } },
      },
    })
  },

  // -------------------------------------------------------------------------
  // listMetrics (Req 11.5)
  // -------------------------------------------------------------------------

  /**
   * Return all metric records for the org with currentValue + computedAt.
   * Ordered by name ASC for consistent presentation.
   */
  async listMetrics(orgId: string) {
    return prisma.metric.findMany({
      where: { organizationId: orgId },
      orderBy: { name: 'asc' },
      select: {
        id: true,
        name: true,
        metricType: true,
        currentValue: true,
        computedAt: true,
        createdAt: true,
      },
    })
  },

  // -------------------------------------------------------------------------
  // getMetricHistory (Req 11.2, 11.5)
  // -------------------------------------------------------------------------

  /**
   * Return MetricHistory records for a named metric within the org.
   * Cursor-based pagination ordered by recordedAt DESC.
   */
  async getMetricHistory(
    orgId: string,
    metricName: string,
    pagination: ListMetricHistoryPagination = {},
  ) {
    // Resolve the metric by name first
    const metric = await prisma.metric.findFirst({
      where: { organizationId: orgId, name: metricName },
    })
    if (!metric) return { data: [], pagination: { limit: 20, hasNextPage: false, nextCursor: null } }

    const limit = Math.min(pagination.limit ?? 20, 100)

    const history = await prisma.metricHistory.findMany({
      where: { metricId: metric.id, organizationId: orgId },
      orderBy: [{ recordedAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      select: {
        id: true,
        metricId: true,
        organizationId: true,
        value: true,
        recordedAt: true,
        triggeredBy: true,
      },
      ...(pagination.after ? { cursor: { id: pagination.after }, skip: 1 } : {}),
    })

    const hasNextPage = history.length > limit
    const data = hasNextPage ? history.slice(0, limit) : history
    const nextCursor = hasNextPage ? (data[data.length - 1]?.id ?? null) : null

    return { data, pagination: { limit, hasNextPage, nextCursor } }
  },
}
