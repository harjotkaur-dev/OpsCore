/**
 * Dashboard summary route — Phase 12
 *
 * GET /v1/dashboard/summary
 *   Returns aggregated operational data for the operations command center.
 *   Single request replaces 7+ parallel frontend queries.
 *
 * Requirements: 11.1, 11.5
 */

import type { FastifyInstance } from 'fastify'
import authPlugin from '../plugins/auth.js'
import { requirePermission } from '../plugins/rbac.js'
import { prisma } from '../lib/prisma.js'
import { ExecutionService } from '../services/ExecutionService.js'

export async function dashboardRoutes(app: FastifyInstance) {
  await app.register(authPlugin)

  app.get(
    '/v1/dashboard/summary',
    { preHandler: [requirePermission('metric:read')] },
    async (request, reply) => {
      const orgId = request.orgId

      const [
        activeWorkflowCount,
        runningExecutionCount,
        failedExecutionCount,
        openTaskCount,
        overdueTaskCount,
        kpiAlertCount,
        recentExecutions,
        recentNotifications,
        recentAuditLogs,
        workflowStatusCounts,
        taskStatusCounts,
      ] = await Promise.all([
        // Active workflows (schema: status = 'active' | 'archived')
        prisma.workflow.count({
          where: { organizationId: orgId, status: 'active' },
        }),
        prisma.execution.count({
          where: { organizationId: orgId, status: 'running' },
        }),
        prisma.execution.count({
          where: { organizationId: orgId, status: 'failed' },
        }),
        // Open tasks: pending + in_progress
        prisma.task.count({
          where: {
            organizationId: orgId,
            status: { in: ['pending', 'in_progress'] },
          },
        }),
        prisma.task.count({
          where: {
            organizationId: orgId,
            overdue: true,
            status: { notIn: ['completed', 'cancelled'] },
          },
        }),
        // KPI alerts — count KPIs where lastBreached = true
        prisma.kPI.count({
          where: {
            organizationId: orgId,
            lastBreached: true,
          },
        }),
        // Recent executions — include workflow name via join
        prisma.execution.findMany({
          where: { organizationId: orgId },
          orderBy: { createdAt: 'desc' },
          take: 5,
          include: {
            workflowVersion: {
              include: { workflow: { select: { id: true, name: true } } },
            },
          },
        }),
        // Recent notifications for this user
        prisma.notification.findMany({
          where: { organizationId: orgId, recipientUserId: request.userId },
          orderBy: { createdAt: 'desc' },
          take: 5,
        }),
        // Recent audit logs — schema uses 'timestamp', not 'createdAt'
        prisma.auditLog.findMany({
          where: { organizationId: orgId },
          orderBy: { timestamp: 'desc' },
          take: 5,
        }),
        prisma.workflow.groupBy({
          by: ['status'],
          where: { organizationId: orgId },
          _count: { _all: true },
        }),
        prisma.task.groupBy({
          by: ['status'],
          where: { organizationId: orgId },
          _count: { _all: true },
        }),
      ])

      // Workflow health breakdown
      const workflowHealth = { active: 0, archived: 0, total: 0 }
      for (const row of workflowStatusCounts) {
        const count = row._count._all
        if (row.status === 'active') workflowHealth.active = count
        else if (row.status === 'archived') workflowHealth.archived = count
        workflowHealth.total += count
      }

      // Task overview breakdown
      const taskOverview = {
        pending: 0,
        inProgress: 0,
        completed: 0,
        cancelled: 0,
        overdue: overdueTaskCount,
        total: 0,
      }
      for (const row of taskStatusCounts) {
        const count = row._count._all
        if (row.status === 'pending') taskOverview.pending = count
        else if (row.status === 'in_progress') taskOverview.inProgress = count
        else if (row.status === 'completed') taskOverview.completed = count
        else if (row.status === 'cancelled') taskOverview.cancelled = count
        taskOverview.total += count
      }

      // Queue depth (cached, best-effort — non-fatal if Redis unavailable)
      let queueStatus: Record<string, Record<string, number>> = {}
      try {
        const depth = await ExecutionService.getQueueDepth()
        queueStatus = depth.queues
      } catch {
        // Non-fatal
      }

      // Shape executions for the frontend
      const shapedExecutions = recentExecutions.map(exec => ({
        id: exec.id,
        workflowId: exec.workflowVersion.workflowId,
        workflowName: exec.workflowVersion.workflow.name,
        status: exec.status,
        startedAt: exec.startedAt?.toISOString() ?? null,
        completedAt: exec.completedAt?.toISOString() ?? null,
        errorDetail: exec.errorDetail,
        attemptCount: exec.attemptCount,
        createdAt: exec.createdAt.toISOString(),
      }))

      // Shape audit logs — use timestamp field from schema
      const shapedAuditLogs = recentAuditLogs.map(log => ({
        id: log.id,
        entityType: log.entityType,
        entityId: log.entityId,
        action: log.action,
        actorType: log.actorType,
        actorId: log.actorId,
        timestamp: log.timestamp.toISOString(),
      }))

      return reply.status(200).send({
        summary: {
          activeWorkflows: activeWorkflowCount,
          runningExecutions: runningExecutionCount,
          failedExecutions: failedExecutionCount,
          openTasks: openTaskCount,
          kpiAlerts: kpiAlertCount,
        },
        workflowHealth,
        taskOverview,
        recentExecutions: shapedExecutions,
        recentNotifications,
        recentAuditLogs: shapedAuditLogs,
        queueStatus,
      })
    },
  )
}
