/**
 * Task routes — Tasks 6.1, 6.5, 6.9
 *
 * POST   /v1/tasks                — create task (supports Idempotency-Key)
 * GET    /v1/tasks                — list tasks (paginated, filterable)
 * GET    /v1/tasks/:id            — get single task
 * PATCH  /v1/tasks/:id            — update task fields
 * POST   /v1/tasks/:id/status     — transition task status
 * DELETE /v1/tasks/:id            — delete task
 * POST   /v1/tasks/:id/assign     — assign task (manual)
 * GET    /v1/tasks/:id/assignments        — list assignments
 * DELETE /v1/tasks/:id/assignments/:assignmentId — unassign
 * POST   /v1/tasks/:id/comments   — add a comment (Req 7.9)
 * GET    /v1/tasks/:id/comments   — list comments (Req 7.9)
 *
 * Permissions (RBAC):
 *   POST   /v1/tasks             → task:create
 *   GET    /v1/tasks             → task:read
 *   GET    /v1/tasks/:id         → task:read
 *   PATCH  /v1/tasks/:id         → task:update
 *   POST   /v1/tasks/:id/status  → task:update
 *   DELETE /v1/tasks/:id         → task:delete
 *   POST   /v1/tasks/:id/assign  → task:update
 *   GET    /v1/tasks/:id/assignments → task:read
 *   DELETE /v1/tasks/:id/assignments/:assignmentId → task:update
 *   POST   /v1/tasks/:id/comments → task:update
 *   GET    /v1/tasks/:id/comments → task:read
 */

import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import authPlugin from '../plugins/auth.js'
import { requirePermission } from '../plugins/rbac.js'
import { TaskService, type TaskStatus } from '../services/TaskService.js'
import {
  checkKey,
  setKeyInFlight,
  setKeyCompleted,
} from '../lib/idempotency.js'

// ---------------------------------------------------------------------------
// Zod validation schemas
// ---------------------------------------------------------------------------

const createTaskSchema = z.object({
  title: z.string().min(1, 'title is required').max(500),
  description: z.string().max(5000).optional(),
  priority: z.enum(['low', 'medium', 'high', 'critical']).optional(),
  dueDate: z.string().datetime({ offset: true }).optional(),
})

const updateTaskSchema = z
  .object({
    title: z.string().min(1).max(500).optional(),
    description: z.string().max(5000).optional(),
    priority: z.enum(['low', 'medium', 'high', 'critical']).optional(),
    dueDate: z.string().datetime({ offset: true }).nullable().optional(),
  })
  .refine(
    (d) =>
      d.title !== undefined ||
      d.description !== undefined ||
      d.priority !== undefined ||
      d.dueDate !== undefined,
    { message: 'At least one field must be provided' },
  )

const transitionStatusSchema = z.object({
  status: z.enum(['pending', 'in_progress', 'completed', 'cancelled']),
})

const listTasksQuerySchema = z.object({
  status: z.enum(['pending', 'in_progress', 'completed', 'cancelled']).optional(),
  priority: z.enum(['low', 'medium', 'high', 'critical']).optional(),
  assigneeUserId: z.string().uuid().optional(),
  teamId: z.string().uuid().optional(),
  dueDateFrom: z.string().datetime({ offset: true }).optional(),
  dueDateTo: z.string().datetime({ offset: true }).optional(),
  overdue: z
    .string()
    .optional()
    .transform((v) => (v === 'true' ? true : v === 'false' ? false : undefined))
    .pipe(z.boolean().optional()),
  sourceWorkflowId: z.string().uuid().optional(),
  after: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
})

const assignTaskSchema = z.object({
  assigneeType: z.enum(['user', 'team']),
  userId: z.string().uuid().optional(),
  teamId: z.string().uuid().optional(),
  assignedBy: z.string().uuid().optional(),
})

const addCommentSchema = z.object({
  body: z.string().min(1).max(10000),
})

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function zodErrors(errors: z.ZodIssue[]) {
  return errors.map((e) => ({ field: e.path.join('.'), message: e.message }))
}

// ---------------------------------------------------------------------------
// Route registration
// ---------------------------------------------------------------------------

export async function taskRoutes(app: FastifyInstance) {
  await app.register(authPlugin)

  // -------------------------------------------------------------------------
  // POST /v1/tasks — create a task (Req 7.1, 7.6, 9.1, 14.1)
  // -------------------------------------------------------------------------
  app.post(
    '/v1/tasks',
    { preHandler: [requirePermission('task:create')] },
    async (request, reply) => {
      // --- Idempotency-Key handling (Req 14.1) ---
      const idempotencyKey = request.headers['idempotency-key'] as string | undefined

      if (idempotencyKey) {
        const existing = await checkKey(request.orgId, idempotencyKey)

        if (existing?.status === 'completed') {
          return reply
            .status(existing.responseStatus ?? 201)
            .send(existing.responseBody)
        }

        if (existing?.status === 'in_flight') {
          return reply.status(409).send({
            error: {
              code: 'CONFLICT',
              message: 'A request with this idempotency key is already being processed',
              request_id: request.id,
            },
          })
        }

        const claimed = await setKeyInFlight(request.orgId, idempotencyKey)
        if (!claimed) {
          return reply.status(409).send({
            error: {
              code: 'CONFLICT',
              message: 'A request with this idempotency key is already being processed',
              request_id: request.id,
            },
          })
        }
      }

      const parse = createTaskSchema.safeParse(request.body)
      if (!parse.success) {
        return reply.status(422).send({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Request validation failed',
            details: zodErrors(parse.error.errors),
            request_id: request.id,
          },
        })
      }

      const task = await TaskService.createTask(
        request.orgId,
        {
          title: parse.data.title,
          description: parse.data.description,
          priority: parse.data.priority,
          dueDate: parse.data.dueDate ? new Date(parse.data.dueDate) : undefined,
        },
        { requestId: request.id, actorId: request.userId },
      )

      const responseBody = { data: task }

      if (idempotencyKey) {
        await setKeyCompleted(request.orgId, idempotencyKey, 201, responseBody)
      }

      return reply.status(201).send(responseBody)
    },
  )

  // -------------------------------------------------------------------------
  // GET /v1/tasks — list tasks (Req 7.6, 7.8, 13.5)
  // -------------------------------------------------------------------------
  app.get(
    '/v1/tasks',
    { preHandler: [requirePermission('task:read')] },
    async (request, reply) => {
      const parse = listTasksQuerySchema.safeParse(request.query)
      if (!parse.success) {
        return reply.status(422).send({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Query parameter validation failed',
            details: zodErrors(parse.error.errors),
            request_id: request.id,
          },
        })
      }

      const q = parse.data
      const result = await TaskService.listTasks(
        request.orgId,
        {
          status: q.status,
          priority: q.priority,
          assigneeUserId: q.assigneeUserId,
          teamId: q.teamId,
          dueDateFrom: q.dueDateFrom ? new Date(q.dueDateFrom) : undefined,
          dueDateTo: q.dueDateTo ? new Date(q.dueDateTo) : undefined,
          overdue: q.overdue,
          sourceWorkflowId: q.sourceWorkflowId,
        },
        {
          after: q.after,
          limit: q.limit,
        },
      )

      return reply.status(200).send(result)
    },
  )

  // -------------------------------------------------------------------------
  // GET /v1/tasks/:id — get single task (Req 7.6)
  // -------------------------------------------------------------------------
  app.get<{ Params: { id: string } }>(
    '/v1/tasks/:id',
    {
      preHandler: [requirePermission('task:read')],
      schema: {
        params: { type: 'object', required: ['id'], properties: { id: { type: 'string' } } },
      },
    },
    async (request, reply) => {
      const task = await TaskService.getTask(request.orgId, request.params.id)
      if (!task) {
        return reply.status(404).send({
          error: {
            code: 'NOT_FOUND',
            message: `Task '${request.params.id}' not found`,
            request_id: request.id,
          },
        })
      }
      return reply.status(200).send({ data: task })
    },
  )

  // -------------------------------------------------------------------------
  // PATCH /v1/tasks/:id — update task fields (Req 7.6, 9.1)
  // -------------------------------------------------------------------------
  app.patch<{ Params: { id: string } }>(
    '/v1/tasks/:id',
    {
      preHandler: [requirePermission('task:update')],
      schema: {
        params: { type: 'object', required: ['id'], properties: { id: { type: 'string' } } },
      },
    },
    async (request, reply) => {
      const parse = updateTaskSchema.safeParse(request.body)
      if (!parse.success) {
        return reply.status(422).send({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Request validation failed',
            details: zodErrors(parse.error.errors),
            request_id: request.id,
          },
        })
      }

      const task = await TaskService.updateTask(
        request.orgId,
        request.params.id,
        {
          title: parse.data.title,
          description: parse.data.description,
          priority: parse.data.priority,
          dueDate:
            parse.data.dueDate !== undefined
              ? parse.data.dueDate === null
                ? null
                : new Date(parse.data.dueDate)
              : undefined,
        },
        { requestId: request.id, actorId: request.userId },
      )

      return reply.status(200).send({ data: task })
    },
  )

  // -------------------------------------------------------------------------
  // POST /v1/tasks/:id/status — transition status (Req 7.3, 7.4, 7.5, 9.1)
  // -------------------------------------------------------------------------
  app.post<{ Params: { id: string } }>(
    '/v1/tasks/:id/status',
    {
      preHandler: [requirePermission('task:update')],
      schema: {
        params: { type: 'object', required: ['id'], properties: { id: { type: 'string' } } },
      },
    },
    async (request, reply) => {
      const parse = transitionStatusSchema.safeParse(request.body)
      if (!parse.success) {
        return reply.status(422).send({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Request validation failed',
            details: zodErrors(parse.error.errors),
            request_id: request.id,
          },
        })
      }

      const task = await TaskService.transitionStatus(
        request.orgId,
        request.params.id,
        parse.data.status as TaskStatus,
        { requestId: request.id, actorId: request.userId },
      )

      return reply.status(200).send({ data: task })
    },
  )

  // -------------------------------------------------------------------------
  // DELETE /v1/tasks/:id — delete task (Req 7.6, 9.1)
  // -------------------------------------------------------------------------
  app.delete<{ Params: { id: string } }>(
    '/v1/tasks/:id',
    {
      preHandler: [requirePermission('task:delete')],
      schema: {
        params: { type: 'object', required: ['id'], properties: { id: { type: 'string' } } },
      },
    },
    async (request, reply) => {
      await TaskService.deleteTask(
        request.orgId,
        request.params.id,
        { requestId: request.id, actorId: request.userId },
      )
      return reply.status(204).send()
    },
  )

  // -------------------------------------------------------------------------
  // POST /v1/tasks/:id/assign — assign task (Req 7.2, 3.4)
  // -------------------------------------------------------------------------
  app.post<{ Params: { id: string } }>(
    '/v1/tasks/:id/assign',
    {
      preHandler: [requirePermission('task:update')],
      schema: {
        params: { type: 'object', required: ['id'], properties: { id: { type: 'string' } } },
      },
    },
    async (request, reply) => {
      const parse = assignTaskSchema.safeParse(request.body)
      if (!parse.success) {
        return reply.status(422).send({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Request validation failed',
            details: zodErrors(parse.error.errors),
            request_id: request.id,
          },
        })
      }

      const assignment = await TaskService.assignTask(
        request.orgId,
        request.params.id,
        {
          assigneeType: parse.data.assigneeType,
          userId: parse.data.userId,
          teamId: parse.data.teamId,
          assignedBy: parse.data.assignedBy ?? request.userId,
        },
        { requestId: request.id, actorId: request.userId },
      )

      return reply.status(201).send({ data: assignment })
    },
  )

  // -------------------------------------------------------------------------
  // GET /v1/tasks/:id/assignments — list assignments (Req 7.2)
  // -------------------------------------------------------------------------
  app.get<{ Params: { id: string } }>(
    '/v1/tasks/:id/assignments',
    {
      preHandler: [requirePermission('task:read')],
      schema: {
        params: { type: 'object', required: ['id'], properties: { id: { type: 'string' } } },
      },
    },
    async (request, reply) => {
      const assignments = await TaskService.listAssignments(request.orgId, request.params.id)
      return reply.status(200).send({ data: assignments })
    },
  )

  // -------------------------------------------------------------------------
  // DELETE /v1/tasks/:id/assignments/:assignmentId — unassign (Req 7.2)
  // -------------------------------------------------------------------------
  app.delete<{ Params: { id: string; assignmentId: string } }>(
    '/v1/tasks/:id/assignments/:assignmentId',
    {
      preHandler: [requirePermission('task:update')],
      schema: {
        params: {
          type: 'object',
          required: ['id', 'assignmentId'],
          properties: {
            id: { type: 'string' },
            assignmentId: { type: 'string' },
          },
        },
      },
    },
    async (request, reply) => {
      await TaskService.unassignTask(
        request.orgId,
        request.params.id,
        request.params.assignmentId,
        { requestId: request.id, actorId: request.userId },
      )
      return reply.status(204).send()
    },
  )

  // -------------------------------------------------------------------------
  // POST /v1/tasks/:id/comments — add a comment (Req 7.9)
  // -------------------------------------------------------------------------
  app.post<{ Params: { id: string } }>(
    '/v1/tasks/:id/comments',
    {
      preHandler: [requirePermission('task:update')],
      schema: {
        params: { type: 'object', required: ['id'], properties: { id: { type: 'string' } } },
      },
    },
    async (request, reply) => {
      const parse = addCommentSchema.safeParse(request.body)
      if (!parse.success) {
        return reply.status(422).send({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Request validation failed',
            details: zodErrors(parse.error.errors),
            request_id: request.id,
          },
        })
      }

      const comment = await TaskService.addComment(
        request.orgId,
        request.params.id,
        { body: parse.data.body, authorId: request.userId },
        { requestId: request.id, actorId: request.userId },
      )

      return reply.status(201).send({ data: comment })
    },
  )

  // -------------------------------------------------------------------------
  // GET /v1/tasks/:id/comments — list comments (Req 7.9)
  // -------------------------------------------------------------------------
  app.get<{ Params: { id: string } }>(
    '/v1/tasks/:id/comments',
    {
      preHandler: [requirePermission('task:read')],
      schema: {
        params: { type: 'object', required: ['id'], properties: { id: { type: 'string' } } },
      },
    },
    async (request, reply) => {
      const comments = await TaskService.listComments(request.orgId, request.params.id)
      return reply.status(200).send({ data: comments })
    },
  )
}
