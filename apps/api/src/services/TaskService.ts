/**
 * TaskService — Tasks 6.1, 6.5, 6.9
 *
 * Task CRUD and status machine:
 *   createTask, getTask, updateTask, cancelTask, listTasks, transitionStatus
 *
 * Task Assignment:
 *   assignTask, unassignTask, listAssignments
 *
 * Task Comments (Req 7.9):
 *   addComment, listComments
 *
 * Valid status transitions:
 *   pending      → in_progress
 *   pending      → cancelled
 *   in_progress  → completed
 *   in_progress  → cancelled
 *
 * Invalid (returns 422):
 *   completed    → anything
 *   cancelled    → anything
 *   in_progress  → pending
 *
 * Audit log written on every mutation (entity_type='task').
 * Status transitions written inside a single transaction with audit log.
 */

import { prisma, type TransactionClient } from '../lib/prisma.js'
import { Prisma, type TaskComment } from '@prisma/client'
import createError from '@fastify/error'

// ---------------------------------------------------------------------------
// Custom errors
// ---------------------------------------------------------------------------

const NotFoundError = createError('NOT_FOUND', '%s', 404)
const UnprocessableError = createError('UNPROCESSABLE_ENTITY', '%s', 422)

// ---------------------------------------------------------------------------
// Status machine
// ---------------------------------------------------------------------------

export type TaskStatus = 'pending' | 'in_progress' | 'completed' | 'cancelled'

/** Allowed target statuses for each source status */
const VALID_TRANSITIONS: Readonly<Record<TaskStatus, readonly TaskStatus[]>> = {
  pending: ['in_progress', 'cancelled'],
  in_progress: ['completed', 'cancelled'],
  completed: [],
  cancelled: [],
}

/**
 * Returns true when the transition from `from` → `to` is allowed.
 */
export function isValidTransition(from: TaskStatus, to: TaskStatus): boolean {
  return (VALID_TRANSITIONS[from] as readonly string[]).includes(to)
}

/**
 * Returns a human-readable description of the allowed transitions from `from`.
 * Used in 422 error messages (Req 7.5).
 */
export function allowedTransitions(from: TaskStatus): string {
  const allowed = VALID_TRANSITIONS[from]
  if (allowed.length === 0) {
    return `Status '${from}' is terminal — no further transitions are allowed`
  }
  return `From '${from}' the allowed transitions are: ${allowed.map((s) => `'${s}'`).join(', ')}`
}

// ---------------------------------------------------------------------------
// Input types
// ---------------------------------------------------------------------------

export interface CreateTaskInput {
  title: string
  description?: string | undefined
  priority?: 'low' | 'medium' | 'high' | 'critical' | undefined
  dueDate?: Date | undefined
  /** Set when created by a workflow action */
  sourceWorkflowId?: string | undefined
  sourceExecutionId?: string | undefined
}

export interface UpdateTaskInput {
  title?: string | undefined
  description?: string | undefined
  priority?: 'low' | 'medium' | 'high' | 'critical' | undefined
  dueDate?: Date | null | undefined
}

export interface ListTasksFilters {
  status?: string | undefined
  priority?: string | undefined
  assigneeUserId?: string | undefined
  teamId?: string | undefined
  dueDateFrom?: Date | undefined
  dueDateTo?: Date | undefined
  overdue?: boolean | undefined
  sourceWorkflowId?: string | undefined
}

export interface ListTasksPagination {
  after?: string | undefined
  limit?: number | undefined
}

// ---------------------------------------------------------------------------
// Assignment input types
// ---------------------------------------------------------------------------

export interface AssignTaskInput {
  assigneeType: 'user' | 'team'
  userId?: string | undefined
  teamId?: string | undefined
  assignedBy?: string | undefined
}

// ---------------------------------------------------------------------------
// Comment input / output types
// ---------------------------------------------------------------------------

export interface AddCommentInput {
  body: string
  authorId: string
}

export interface CommentWithAuthor extends TaskComment {
  author: {
    id: string
    fullName: string
  }
}

// ---------------------------------------------------------------------------
// Context type
// ---------------------------------------------------------------------------

export interface MutationContext {
  requestId?: string | undefined
  actorId?: string | undefined
}

// ---------------------------------------------------------------------------
// TaskService
// ---------------------------------------------------------------------------

export const TaskService = {

  // -------------------------------------------------------------------------
  // createTask (Req 7.1, 7.6, 9.1, 14.1)
  // -------------------------------------------------------------------------

  /**
   * Create a new task.
   *
   * If actorId is provided it is stored as createdBy (manual creation).
   * Workflow-created tasks may omit actorId and set sourceWorkflowId instead.
   * Writes an audit log entry inside the same transaction.
   */
  async createTask(
    orgId: string,
    input: CreateTaskInput,
    context: MutationContext = {},
  ) {
    return prisma.$transaction(async (tx: TransactionClient) => {
      const task = await tx.task.create({
        data: {
          organizationId: orgId,
          title: input.title,
          description: input.description ?? null,
          priority: input.priority ?? 'medium',
          status: 'pending',
          dueDate: input.dueDate ?? null,
          overdue: false,
          createdBy: context.actorId ?? null,
          sourceWorkflowId: input.sourceWorkflowId ?? null,
          sourceExecutionId: input.sourceExecutionId ?? null,
        },
      })

      await tx.auditLog.create({
        data: {
          organizationId: orgId,
          entityType: 'task',
          entityId: task.id,
          action: 'created',
          actorType: context.actorId ? 'user' : 'system',
          actorId: context.actorId ?? null,
          beforeState: Prisma.JsonNull,
          afterState: {
            id: task.id,
            title: task.title,
            priority: task.priority,
            status: task.status,
            dueDate: task.dueDate,
          },
          requestId: context.requestId ?? null,
        },
      })

      return task
    })
  },

  // -------------------------------------------------------------------------
  // getTask (Req 7.6)
  // -------------------------------------------------------------------------

  /**
   * Get a single task by id scoped to the organisation.
   * Returns null if not found.
   */
  async getTask(orgId: string, taskId: string) {
    return prisma.task.findFirst({
      where: { id: taskId, organizationId: orgId },
      include: {
        assignments: true,
      },
    })
  },

  // -------------------------------------------------------------------------
  // updateTask (Req 7.6, 9.1)
  // -------------------------------------------------------------------------

  /**
   * Update mutable task fields: title, description, priority, dueDate.
   * Does not handle status changes — use transitionStatus for those.
   * Writes an audit log entry inside the same transaction.
   */
  async updateTask(
    orgId: string,
    taskId: string,
    input: UpdateTaskInput,
    context: MutationContext = {},
  ) {
    const task = await prisma.task.findFirst({
      where: { id: taskId, organizationId: orgId },
    })
    if (!task) throw new NotFoundError(`Task '${taskId}' not found`)

    return prisma.$transaction(async (tx: TransactionClient) => {
      const updated = await tx.task.update({
        where: { id: taskId },
        data: {
          ...(input.title !== undefined ? { title: input.title } : {}),
          ...(input.description !== undefined ? { description: input.description } : {}),
          ...(input.priority !== undefined ? { priority: input.priority } : {}),
          ...(input.dueDate !== undefined ? { dueDate: input.dueDate } : {}),
        },
      })

      await tx.auditLog.create({
        data: {
          organizationId: orgId,
          entityType: 'task',
          entityId: taskId,
          action: 'updated',
          actorType: context.actorId ? 'user' : 'system',
          actorId: context.actorId ?? null,
          beforeState: {
            title: task.title,
            description: task.description,
            priority: task.priority,
            dueDate: task.dueDate,
          },
          afterState: {
            title: updated.title,
            description: updated.description,
            priority: updated.priority,
            dueDate: updated.dueDate,
          },
          requestId: context.requestId ?? null,
        },
      })

      return updated
    })
  },

  // -------------------------------------------------------------------------
  // cancelTask (Req 7.6, 9.1)
  // -------------------------------------------------------------------------

  /**
   * Cancel a task. Delegates to transitionStatus with target='cancelled'.
   */
  async cancelTask(
    orgId: string,
    taskId: string,
    context: MutationContext = {},
  ) {
    return TaskService.transitionStatus(orgId, taskId, 'cancelled', context)
  },

  // -------------------------------------------------------------------------
  // transitionStatus (Req 7.3, 7.4, 7.5, 9.1)
  // -------------------------------------------------------------------------

  /**
   * Transition a task's status, validate the transition, persist the new
   * status, and write an audit log entry — all inside a single transaction.
   *
   * Throws 404 if the task does not exist.
   * Throws 422 if the transition is invalid (Req 7.5).
   */
  async transitionStatus(
    orgId: string,
    taskId: string,
    toStatus: TaskStatus,
    context: MutationContext = {},
  ) {
    const task = await prisma.task.findFirst({
      where: { id: taskId, organizationId: orgId },
    })
    if (!task) throw new NotFoundError(`Task '${taskId}' not found`)

    const fromStatus = task.status as TaskStatus

    if (!isValidTransition(fromStatus, toStatus)) {
      throw new UnprocessableError(
        `Invalid status transition from '${fromStatus}' to '${toStatus}'. ${allowedTransitions(fromStatus)}`,
      )
    }

    return prisma.$transaction(async (tx: TransactionClient) => {
      const updated = await tx.task.update({
        where: { id: taskId },
        data: {
          status: toStatus,
          // Reset overdue flag when reaching a terminal state (Req 7.7)
          ...(toStatus === 'completed' || toStatus === 'cancelled' ? { overdue: false } : {}),
        },
      })

      // Req 7.4, 9.1 — audit log for status change with before/after state
      await tx.auditLog.create({
        data: {
          organizationId: orgId,
          entityType: 'task',
          entityId: taskId,
          action: 'status_changed',
          actorType: context.actorId ? 'user' : 'system',
          actorId: context.actorId ?? null,
          beforeState: {
            id: task.id,
            status: fromStatus,
            title: task.title,
          },
          afterState: {
            id: updated.id,
            status: toStatus,
            title: updated.title,
          },
          requestId: context.requestId ?? null,
        },
      })

      return updated
    })
  },

  // -------------------------------------------------------------------------
  // listTasks (Req 7.6, 7.8, 13.5)
  // -------------------------------------------------------------------------

  /**
   * List tasks for an organisation with optional filters and cursor pagination.
   *
   * Filters: status, priority, assigneeUserId, teamId, dueDateFrom, dueDateTo
   * Pagination: cursor (task id), limit (default 20, max 100)
   * Order: createdAt DESC, id DESC (stable)
   */
  async listTasks(
    orgId: string,
    filters: ListTasksFilters = {},
    pagination: ListTasksPagination = {},
  ) {
    const limit = Math.min(pagination.limit ?? 20, 100)

    const where: Prisma.TaskWhereInput = {
      organizationId: orgId,
      ...(filters.status ? { status: filters.status } : {}),
      ...(filters.priority ? { priority: filters.priority } : {}),
      ...(filters.dueDateFrom || filters.dueDateTo
        ? {
            dueDate: {
              ...(filters.dueDateFrom ? { gte: filters.dueDateFrom } : {}),
              ...(filters.dueDateTo ? { lte: filters.dueDateTo } : {}),
            },
          }
        : {}),
      ...(filters.assigneeUserId
        ? { assignments: { some: { userId: filters.assigneeUserId, assigneeType: 'user' } } }
        : {}),
      ...(filters.teamId
        ? { assignments: { some: { teamId: filters.teamId, assigneeType: 'team' } } }
        : {}),
      ...(filters.overdue !== undefined ? { overdue: filters.overdue } : {}),
      ...(filters.sourceWorkflowId ? { sourceWorkflowId: filters.sourceWorkflowId } : {}),
    }

    const tasks = await prisma.task.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      include: { assignments: true },
      ...(pagination.after
        ? { cursor: { id: pagination.after }, skip: 1 }
        : {}),
    })

    const hasNextPage = tasks.length > limit
    const data = hasNextPage ? tasks.slice(0, limit) : tasks
    const nextCursor = hasNextPage ? (data[data.length - 1]?.id ?? null) : null

    return {
      data,
      pagination: { limit, hasNextPage, nextCursor },
    }
  },

  // -------------------------------------------------------------------------
  // deleteTask (Req 7.6, 9.1)
  // -------------------------------------------------------------------------

  /**
   * Delete (hard-delete) a task.
   * Writes an audit log entry inside the same transaction.
   */
  async deleteTask(
    orgId: string,
    taskId: string,
    context: MutationContext = {},
  ) {
    const task = await prisma.task.findFirst({
      where: { id: taskId, organizationId: orgId },
    })
    if (!task) throw new NotFoundError(`Task '${taskId}' not found`)

    return prisma.$transaction(async (tx: TransactionClient) => {
      await tx.task.delete({ where: { id: taskId } })

      await tx.auditLog.create({
        data: {
          organizationId: orgId,
          entityType: 'task',
          entityId: taskId,
          action: 'deleted',
          actorType: context.actorId ? 'user' : 'system',
          actorId: context.actorId ?? null,
          beforeState: {
            id: task.id,
            title: task.title,
            status: task.status,
            priority: task.priority,
          },
          afterState: Prisma.JsonNull,
          requestId: context.requestId ?? null,
        },
      })
    })
  },

  // -------------------------------------------------------------------------
  // assignTask (Req 7.2, 3.4)
  // -------------------------------------------------------------------------

  /**
   * Create a task assignment. Idempotent on exact duplicate
   * (taskId, assigneeType, userId, teamId) — returns existing if found.
   *
   * Validates:
   *  - Task exists (404 if not)
   *  - If assigneeType='team': team must not be archived (422)
   *  - If assigneeType='user': user must be an active org member (422)
   */
  async assignTask(
    orgId: string,
    taskId: string,
    input: AssignTaskInput,
    context: MutationContext = {},
  ) {
    // Load task
    const task = await prisma.task.findFirst({
      where: { id: taskId, organizationId: orgId },
    })
    if (!task) throw new NotFoundError(`Task '${taskId}' not found`)

    // Validate team is not archived (Req 3.4)
    if (input.assigneeType === 'team') {
      if (!input.teamId) throw new UnprocessableError(`teamId is required for team assignment`)
      const team = await prisma.team.findFirst({
        where: { id: input.teamId, organizationId: orgId },
      })
      if (!team) throw new NotFoundError(`Team '${input.teamId}' not found`)
      if (team.status === 'archived') {
        throw new UnprocessableError(`Cannot assign task to archived team '${input.teamId}'`)
      }
    }

    // Validate user is active org member
    if (input.assigneeType === 'user') {
      if (!input.userId) throw new UnprocessableError(`userId is required for user assignment`)
      const member = await prisma.organizationMember.findFirst({
        where: { organizationId: orgId, userId: input.userId, status: 'active' },
      })
      if (!member) {
        throw new UnprocessableError(
          `User '${input.userId}' is not an active member of this organization`,
        )
      }
    }

    // Check for exact duplicate — idempotent return
    const existing = await prisma.taskAssignment.findFirst({
      where: {
        taskId,
        organizationId: orgId,
        assigneeType: input.assigneeType,
        userId: input.assigneeType === 'user' ? (input.userId ?? null) : null,
        teamId: input.assigneeType === 'team' ? (input.teamId ?? null) : null,
      },
    })
    if (existing) return existing

    return prisma.$transaction(async (tx: TransactionClient) => {
      const assignment = await tx.taskAssignment.create({
        data: {
          taskId,
          organizationId: orgId,
          assigneeType: input.assigneeType,
          userId: input.assigneeType === 'user' ? (input.userId ?? null) : null,
          teamId: input.assigneeType === 'team' ? (input.teamId ?? null) : null,
          assignedBy: input.assignedBy ?? null,
        },
      })

      await tx.auditLog.create({
        data: {
          organizationId: orgId,
          entityType: 'task',
          entityId: taskId,
          action: 'updated',
          actorType: context.actorId ? 'user' : 'system',
          actorId: context.actorId ?? null,
          beforeState: Prisma.JsonNull,
          afterState: {
            action: 'assignment_created',
            assignmentId: assignment.id,
            taskId,
            assigneeType: input.assigneeType,
            userId: assignment.userId,
            teamId: assignment.teamId,
          },
          requestId: context.requestId ?? null,
        },
      })

      return assignment
    })
  },

  // -------------------------------------------------------------------------
  // unassignTask (Req 7.2)
  // -------------------------------------------------------------------------

  /**
   * Hard-delete a task assignment.
   * Writes an audit log entry inside the same transaction.
   */
  async unassignTask(
    orgId: string,
    taskId: string,
    assignmentId: string,
    context: MutationContext = {},
  ) {
    const assignment = await prisma.taskAssignment.findFirst({
      where: { id: assignmentId, taskId, organizationId: orgId },
    })
    if (!assignment) throw new NotFoundError(`Assignment '${assignmentId}' not found`)

    return prisma.$transaction(async (tx: TransactionClient) => {
      await tx.taskAssignment.delete({ where: { id: assignmentId } })

      await tx.auditLog.create({
        data: {
          organizationId: orgId,
          entityType: 'task',
          entityId: taskId,
          action: 'updated',
          actorType: context.actorId ? 'user' : 'system',
          actorId: context.actorId ?? null,
          beforeState: {
            action: 'assignment_removed',
            assignmentId: assignment.id,
            taskId,
            assigneeType: assignment.assigneeType,
            userId: assignment.userId,
            teamId: assignment.teamId,
          },
          afterState: Prisma.JsonNull,
          requestId: context.requestId ?? null,
        },
      })
    })
  },

  // -------------------------------------------------------------------------
  // listAssignments (Req 7.2)
  // -------------------------------------------------------------------------

  /**
   * Return all assignments for a task scoped to the organisation.
   */
  async listAssignments(orgId: string, taskId: string) {
    return prisma.taskAssignment.findMany({
      where: { taskId, organizationId: orgId },
      orderBy: { assignedAt: 'asc' },
    })
  },

  // -------------------------------------------------------------------------
  // addComment (Req 7.9)
  // -------------------------------------------------------------------------

  /**
   * Add a comment to a task.
   *
   * Validates:
   *  - Task exists (404 if not)
   *  - authorId is an active org member (422 if not)
   * Creates the TaskComment and writes an audit log in a single transaction.
   * Returns the comment with author info included.
   */
  async addComment(
    orgId: string,
    taskId: string,
    input: AddCommentInput,
    context: MutationContext = {},
  ): Promise<CommentWithAuthor> {
    const task = await prisma.task.findFirst({
      where: { id: taskId, organizationId: orgId },
    })
    if (!task) throw new NotFoundError(`Task '${taskId}' not found`)

    const member = await prisma.organizationMember.findFirst({
      where: { organizationId: orgId, userId: input.authorId, status: 'active' },
    })
    if (!member) {
      throw new UnprocessableError(
        `User '${input.authorId}' is not an active member of this organization`,
      )
    }

    return prisma.$transaction(async (tx: TransactionClient) => {
      const comment = await tx.taskComment.create({
        data: {
          taskId,
          organizationId: orgId,
          authorId: input.authorId,
          body: input.body,
        },
        include: {
          author: { select: { id: true, fullName: true } },
        },
      })

      await tx.auditLog.create({
        data: {
          organizationId: orgId,
          entityType: 'task',
          entityId: taskId,
          action: 'updated',
          actorType: context.actorId ? 'user' : 'system',
          actorId: context.actorId ?? null,
          beforeState: Prisma.JsonNull,
          afterState: {
            action: 'comment_added',
            commentId: comment.id,
            authorId: input.authorId,
          },
          requestId: context.requestId ?? null,
        },
      })

      return comment as CommentWithAuthor
    })
  },

  // -------------------------------------------------------------------------
  // listComments (Req 7.9)
  // -------------------------------------------------------------------------

  /**
   * List comments for a task in chronological order (createdAt ASC).
   * Includes author id and fullName.
   * Returns empty array if no comments exist (no 404 — task existence is implied).
   */
  async listComments(
    orgId: string,
    taskId: string,
  ): Promise<CommentWithAuthor[]> {
    const comments = await prisma.taskComment.findMany({
      where: { taskId, organizationId: orgId },
      orderBy: { createdAt: 'asc' },
      include: {
        author: { select: { id: true, fullName: true } },
      },
    })
    return comments as CommentWithAuthor[]
  },
}
