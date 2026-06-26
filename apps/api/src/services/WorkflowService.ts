/**
 * WorkflowService — Task 4.1
 *
 * Workflow CRUD and versioning using the locked architecture:
 *  - workflows  = business concept (name, description, current_version_id)
 *  - workflow_versions = immutable snapshots (definition JSON)
 *  - States: draft → published → archived
 *  - One published version per workflow at any time
 *  - Soft delete only (deletedAt timestamp)
 *  - Audit log on every mutation
 */

import { prisma, type TransactionClient } from '../lib/prisma.js'
import { Prisma } from '@prisma/client'
import createError from '@fastify/error'
import { validateExpression } from '../lib/ruleEvaluator.js'
import { validateAllActions } from '../lib/actionConfigValidator.js'

// ---------------------------------------------------------------------------
// Custom errors
// ---------------------------------------------------------------------------

const NotFoundError = createError('NOT_FOUND', '%s', 404)
const ConflictError = createError('CONFLICT', '%s', 409)
const UnprocessableError = createError('UNPROCESSABLE_ENTITY', '%s', 422)

// ---------------------------------------------------------------------------
// Workflow definition types
// ---------------------------------------------------------------------------

export interface WorkflowRule {
  id: string
  expression: string       // e.g. "event.payload.quantity < 10"
  description?: string | undefined
}

export interface WorkflowAction {
  id: string
  type: 'create_task' | 'send_notification' | 'update_metric' | 'call_webhook'
  orderIndex: number
  config: Record<string, unknown>
}

export interface WorkflowDefinition {
  triggerEventTypeId: string
  rules: WorkflowRule[]
  actions: WorkflowAction[]
}

// ---------------------------------------------------------------------------
// Input types
// ---------------------------------------------------------------------------

export interface CreateWorkflowInput {
  name: string
  description?: string | undefined
}

export interface UpdateWorkflowInput {
  name?: string | undefined
  description?: string | undefined
}

export interface CreateVersionInput {
  definition: WorkflowDefinition
}

// ---------------------------------------------------------------------------
// Context type
// ---------------------------------------------------------------------------

interface MutationContext {
  requestId?: string
  actorId?: string
}

// ---------------------------------------------------------------------------
// WorkflowService
// ---------------------------------------------------------------------------

export const WorkflowService = {

  // -------------------------------------------------------------------------
  // Workflow CRUD
  // -------------------------------------------------------------------------

  /**
   * Create a new workflow (no version yet — draft version is created separately).
   *
   * The workflow entity represents the business concept.
   * It starts with no current version; callers must create a version to make
   * it executable.
   */
  async createWorkflow(
    orgId: string,
    input: CreateWorkflowInput,
    context: MutationContext = {},
  ) {
    if (!context.actorId) throw new Error('actorId is required')

    // Name uniqueness within org (soft-deleted workflows excluded)
    const existing = await prisma.workflow.findFirst({
      where: { organizationId: orgId, name: input.name, deletedAt: null },
    })
    if (existing) {
      throw new ConflictError(`Workflow '${input.name}' already exists in this organization`)
    }

    return prisma.$transaction(async (tx: TransactionClient) => {
      const workflow = await tx.workflow.create({
        data: {
          organizationId: orgId,
          name: input.name,
          description: input.description ?? null,
          status: 'active',
          createdBy: context.actorId!,
        },
      })

      await tx.auditLog.create({
        data: {
          organizationId: orgId,
          entityType: 'workflow',
          entityId: workflow.id,
          action: 'created',
          actorType: 'user',
          actorId: context.actorId!,
          beforeState: Prisma.JsonNull,
          afterState: { id: workflow.id, name: workflow.name, status: workflow.status },
          requestId: context.requestId ?? null,
        },
      })

      return workflow
    })
  },

  /**
   * Get a single workflow by id (excludes soft-deleted).
   * Includes the current published version if one exists.
   */
  async getWorkflow(orgId: string, workflowId: string) {
    return prisma.workflow.findFirst({
      where: { id: workflowId, organizationId: orgId, deletedAt: null },
      include: {
        currentVersion: true,
      },
    })
  },

  /**
   * List workflows for an org (excludes soft-deleted).
   * Optional status filter: 'active' | 'archived'
   */
  async listWorkflows(orgId: string, statusFilter?: string) {
    return prisma.workflow.findMany({
      where: {
        organizationId: orgId,
        deletedAt: null,
        ...(statusFilter ? { status: statusFilter } : {}),
      },
      include: { currentVersion: { select: { id: true, version: true, status: true } } },
      orderBy: { createdAt: 'asc' },
    })
  },

  /**
   * Update workflow name and/or description.
   * Only the workflow entity is updated — versions are immutable.
   */
  async updateWorkflow(
    orgId: string,
    workflowId: string,
    input: UpdateWorkflowInput,
    context: MutationContext = {},
  ) {
    const workflow = await prisma.workflow.findFirst({
      where: { id: workflowId, organizationId: orgId, deletedAt: null },
    })
    if (!workflow) throw new NotFoundError(`Workflow '${workflowId}' not found`)

    if (input.name && input.name !== workflow.name) {
      const conflict = await prisma.workflow.findFirst({
        where: { organizationId: orgId, name: input.name, deletedAt: null },
      })
      if (conflict) {
        throw new ConflictError(`Workflow '${input.name}' already exists in this organization`)
      }
    }

    return prisma.$transaction(async (tx: TransactionClient) => {
      const updated = await tx.workflow.update({
        where: { id: workflowId },
        data: {
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.description !== undefined ? { description: input.description } : {}),
        },
      })

      await tx.auditLog.create({
        data: {
          organizationId: orgId,
          entityType: 'workflow',
          entityId: workflowId,
          action: 'updated',
          actorType: context.actorId ? 'user' : 'system',
          actorId: context.actorId ?? null,
          beforeState: { name: workflow.name, description: workflow.description },
          afterState: { name: updated.name, description: updated.description },
          requestId: context.requestId ?? null,
        },
      })

      return updated
    })
  },

  /**
   * Soft-delete a workflow.
   * Sets deletedAt timestamp. Preserves all versions and execution history.
   * Idempotent — already-deleted workflows return current state.
   */
  async deleteWorkflow(
    orgId: string,
    workflowId: string,
    context: MutationContext = {},
  ) {
    const workflow = await prisma.workflow.findFirst({
      where: { id: workflowId, organizationId: orgId },
    })
    if (!workflow) throw new NotFoundError(`Workflow '${workflowId}' not found`)

    if (workflow.deletedAt !== null) return workflow // already deleted

    return prisma.$transaction(async (tx: TransactionClient) => {
      const deleted = await tx.workflow.update({
        where: { id: workflowId },
        data: { deletedAt: new Date(), status: 'archived' },
      })

      await tx.auditLog.create({
        data: {
          organizationId: orgId,
          entityType: 'workflow',
          entityId: workflowId,
          action: 'deleted',
          actorType: context.actorId ? 'user' : 'system',
          actorId: context.actorId ?? null,
          beforeState: { status: workflow.status, deletedAt: null },
          afterState: { status: deleted.status, deletedAt: deleted.deletedAt },
          requestId: context.requestId ?? null,
        },
      })

      return deleted
    })
  },

  // -------------------------------------------------------------------------
  // Version management
  // -------------------------------------------------------------------------

  /**
   * Create a new draft version for a workflow.
   *
   * A workflow can have multiple drafts, but only one published version.
   * The version number auto-increments from the latest version of this workflow.
   * The definition is stored as an immutable JSON snapshot.
   */
  async createVersion(
    orgId: string,
    workflowId: string,
    input: CreateVersionInput,
    context: MutationContext = {},
  ) {
    if (!context.actorId) throw new Error('actorId is required')

    const workflow = await prisma.workflow.findFirst({
      where: { id: workflowId, organizationId: orgId, deletedAt: null },
    })
    if (!workflow) throw new NotFoundError(`Workflow '${workflowId}' not found`)

    // Find the highest version number for this workflow
    const latestVersion = await prisma.workflowVersion.findFirst({
      where: { workflowId },
      orderBy: { version: 'desc' },
    })
    const nextVersion = (latestVersion?.version ?? 0) + 1

    // Validate rule expressions
    for (const rule of input.definition.rules) {
      try {
        validateExpression(rule.expression)
      } catch {
        throw new UnprocessableError(
          `Rule '${rule.id}' has an invalid expression: ${rule.expression}`,
        )
      }
    }

    // Validate action configs
    const actionFailures = validateAllActions(input.definition.actions)
    if (actionFailures.size > 0) {
      const details = Array.from(actionFailures.entries())
        .map(([id, errs]) => `Action '${id}': ${errs.map((e) => e.message).join(', ')}`)
        .join('; ')
      throw new UnprocessableError(`Action config validation failed: ${details}`)
    }

    return prisma.$transaction(async (tx: TransactionClient) => {
      const version = await tx.workflowVersion.create({
        data: {
          workflowId,
          organizationId: orgId,
          version: nextVersion,
          status: 'draft',
          createdBy: context.actorId!,
          definition: input.definition as unknown as Prisma.InputJsonValue,
        },
      })

      await tx.auditLog.create({
        data: {
          organizationId: orgId,
          entityType: 'workflow',
          entityId: workflowId,
          action: 'created',
          actorType: 'user',
          actorId: context.actorId!,
          beforeState: Prisma.JsonNull,
          afterState: { versionId: version.id, version: version.version, status: version.status },
          requestId: context.requestId ?? null,
        },
      })

      return version
    })
  },

  /**
   * List all versions of a workflow.
   */
  async listVersions(orgId: string, workflowId: string) {
    const workflow = await prisma.workflow.findFirst({
      where: { id: workflowId, organizationId: orgId, deletedAt: null },
    })
    if (!workflow) throw new NotFoundError(`Workflow '${workflowId}' not found`)

    return prisma.workflowVersion.findMany({
      where: { workflowId, organizationId: orgId },
      orderBy: { version: 'asc' },
    })
  },

  /**
   * Get a single workflow version by its UUID.
   */
  async getVersion(orgId: string, versionId: string) {
    return prisma.workflowVersion.findFirst({
      where: { id: versionId, organizationId: orgId },
    })
  },

  /**
   * Publish a workflow version.
   *
   * Rules:
   *  - Only draft versions can be published
   *  - Validates all references in the definition before publishing:
   *      - triggerEventTypeId must exist and be active in the org
   *      - create_task.assignee_id (team/user) must exist in the org
   *      - send_notification.recipient_id (team/user) must exist in the org
   *  - If any references are invalid, throws 422 listing all failures
   *  - Any previously published version is automatically archived
   *  - The workflow's current_version_id is updated to the new published version
   *  - One published version per workflow at a time
   */
  async publishVersion(
    orgId: string,
    versionId: string,
    context: MutationContext = {},
  ) {
    const version = await prisma.workflowVersion.findFirst({
      where: { id: versionId, organizationId: orgId },
    })
    if (!version) throw new NotFoundError(`Workflow version '${versionId}' not found`)

    if (version.status !== 'draft') {
      throw new UnprocessableError(
        `Only draft versions can be published. Current status: '${version.status}'`,
      )
    }

    // -----------------------------------------------------------------------
    // Reference validation (Task 4.6)
    // -----------------------------------------------------------------------
    const definition = version.definition as unknown as {
      triggerEventTypeId: string
      rules: Array<{ id: string; expression: string }>
      actions: Array<{ id: string; type: string; config: Record<string, unknown> }>
    }

    const invalidRefs: string[] = []

    // Validate triggerEventTypeId exists and is active in this org
    const eventType = await prisma.eventType.findFirst({
      where: { id: definition.triggerEventTypeId, organizationId: orgId, status: 'active' },
    })
    if (!eventType) {
      invalidRefs.push(
        `triggerEventTypeId '${definition.triggerEventTypeId}' does not exist or is not active`,
      )
    }

    // Validate action references
    for (const action of definition.actions) {
      const cfg = action.config

      if (action.type === 'create_task' && cfg['assignee_type'] && cfg['assignee_id']) {
        const assigneeId = String(cfg['assignee_id'])
        if (cfg['assignee_type'] === 'team') {
          const team = await prisma.team.findFirst({
            where: { id: assigneeId, organizationId: orgId, status: 'active' },
          })
          if (!team) {
            invalidRefs.push(`Action '${action.id}': team '${assigneeId}' not found or archived`)
          }
        } else if (cfg['assignee_type'] === 'user') {
          const member = await prisma.organizationMember.findFirst({
            where: { userId: assigneeId, organizationId: orgId, status: 'active' },
          })
          if (!member) {
            invalidRefs.push(`Action '${action.id}': user '${assigneeId}' is not an active org member`)
          }
        }
      }

      if (action.type === 'send_notification' && cfg['recipient_id']) {
        const recipientId = String(cfg['recipient_id'])
        const recipientType = String(cfg['recipient_type'] ?? 'user')
        if (recipientType === 'team') {
          const team = await prisma.team.findFirst({
            where: { id: recipientId, organizationId: orgId, status: 'active' },
          })
          if (!team) {
            invalidRefs.push(`Action '${action.id}': team '${recipientId}' not found or archived`)
          }
        } else {
          const member = await prisma.organizationMember.findFirst({
            where: { userId: recipientId, organizationId: orgId, status: 'active' },
          })
          if (!member) {
            invalidRefs.push(`Action '${action.id}': user '${recipientId}' is not an active org member`)
          }
        }
      }
    }

    if (invalidRefs.length > 0) {
      throw new UnprocessableError(
        `Workflow version has invalid references: ${invalidRefs.join('; ')}`,
      )
    }

    return prisma.$transaction(async (tx: TransactionClient) => {
      // Archive any currently published version for this workflow
      await tx.workflowVersion.updateMany({
        where: {
          workflowId: version.workflowId,
          organizationId: orgId,
          status: 'published',
        },
        data: { status: 'archived' },
      })

      // Publish the target version
      const published = await tx.workflowVersion.update({
        where: { id: versionId },
        data: { status: 'published' },
      })

      // Point the workflow entity to the new published version
      await tx.workflow.update({
        where: { id: version.workflowId },
        data: { currentVersionId: versionId },
      })

      await tx.auditLog.create({
        data: {
          organizationId: orgId,
          entityType: 'workflow',
          entityId: version.workflowId,
          action: 'status_changed',
          actorType: context.actorId ? 'user' : 'system',
          actorId: context.actorId ?? null,
          beforeState: { versionId, status: 'draft' },
          afterState: { versionId, status: 'published', version: published.version },
          requestId: context.requestId ?? null,
        },
      })

      return published
    })
  },

  /**
   * Archive a workflow version.
   *
   * Rules:
   *  - Both draft and published versions can be archived
   *  - If archiving the currently published version, the workflow's
   *    current_version_id is cleared (no active version)
   *  - Already-archived versions: idempotent
   */
  async archiveVersion(
    orgId: string,
    versionId: string,
    context: MutationContext = {},
  ) {
    const version = await prisma.workflowVersion.findFirst({
      where: { id: versionId, organizationId: orgId },
    })
    if (!version) throw new NotFoundError(`Workflow version '${versionId}' not found`)

    if (version.status === 'archived') return version // idempotent

    return prisma.$transaction(async (tx: TransactionClient) => {
      const archived = await tx.workflowVersion.update({
        where: { id: versionId },
        data: { status: 'archived' },
      })

      // If this was the published version, clear the workflow's current_version_id
      const workflow = await tx.workflow.findFirst({
        where: { id: version.workflowId },
      })
      if (workflow?.currentVersionId === versionId) {
        await tx.workflow.update({
          where: { id: version.workflowId },
          data: { currentVersionId: null },
        })
      }

      await tx.auditLog.create({
        data: {
          organizationId: orgId,
          entityType: 'workflow',
          entityId: version.workflowId,
          action: 'status_changed',
          actorType: context.actorId ? 'user' : 'system',
          actorId: context.actorId ?? null,
          beforeState: { versionId, status: version.status },
          afterState: { versionId, status: 'archived' },
          requestId: context.requestId ?? null,
        },
      })

      return archived
    })
  },
}
