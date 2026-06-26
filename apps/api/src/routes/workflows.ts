/**
 * Workflow routes — Task 4.1
 *
 * Workflow CRUD:
 *   POST   /v1/workflows
 *   GET    /v1/workflows
 *   GET    /v1/workflows/:id
 *   PATCH  /v1/workflows/:id
 *   DELETE /v1/workflows/:id
 *
 * Version management:
 *   POST   /v1/workflows/:id/versions
 *   GET    /v1/workflows/:id/versions
 *   GET    /v1/workflow-versions/:id
 *   POST   /v1/workflow-versions/:id/publish
 *   POST   /v1/workflow-versions/:id/archive
 */

import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import authPlugin from '../plugins/auth.js'
import { requirePermission } from '../plugins/rbac.js'
import { WorkflowService } from '../services/WorkflowService.js'

// ---------------------------------------------------------------------------
// Zod validation schemas
// ---------------------------------------------------------------------------

const createWorkflowSchema = z.object({
  name: z.string().min(1, 'name is required').max(255),
  description: z.string().max(1000).optional(),
})

const updateWorkflowSchema = z
  .object({
    name: z.string().min(1).max(255).optional(),
    description: z.string().max(1000).optional(),
  })
  .refine((d) => d.name !== undefined || d.description !== undefined, {
    message: 'At least one field (name or description) must be provided',
  })

const workflowRuleSchema = z.object({
  id: z.string().min(1),
  expression: z.string().min(1),
  description: z.string().optional(),
})

const workflowActionSchema = z.object({
  id: z.string().min(1),
  type: z.enum(['create_task', 'send_notification', 'update_metric', 'call_webhook']),
  orderIndex: z.number().int().min(0),
  config: z.record(z.unknown()),
})

const workflowDefinitionSchema = z.object({
  triggerEventTypeId: z.string().uuid('triggerEventTypeId must be a valid UUID'),
  rules: z.array(workflowRuleSchema),
  actions: z.array(workflowActionSchema),
})

const createVersionSchema = z.object({
  definition: workflowDefinitionSchema,
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

export async function workflowRoutes(app: FastifyInstance) {
  await app.register(authPlugin)

  // -------------------------------------------------------------------------
  // POST /v1/workflows — create a workflow entity
  // -------------------------------------------------------------------------
  app.post(
    '/v1/workflows',
    { preHandler: [requirePermission('workflow:create')] },
    async (request, reply) => {
      const parse = createWorkflowSchema.safeParse(request.body)
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

      const workflow = await WorkflowService.createWorkflow(
        request.orgId,
        { name: parse.data.name, description: parse.data.description },
        { requestId: request.id, actorId: request.userId },
      )

      return reply.status(201).send({ data: workflow })
    },
  )

  // -------------------------------------------------------------------------
  // GET /v1/workflows — list workflows
  // -------------------------------------------------------------------------
  app.get(
    '/v1/workflows',
    { preHandler: [requirePermission('workflow:read')] },
    async (request, reply) => {
      const { status } = request.query as { status?: string }
      const workflows = await WorkflowService.listWorkflows(request.orgId, status)
      return reply.status(200).send({ data: workflows })
    },
  )

  // -------------------------------------------------------------------------
  // GET /v1/workflows/:id — get single workflow with current version
  // -------------------------------------------------------------------------
  app.get<{ Params: { id: string } }>(
    '/v1/workflows/:id',
    {
      preHandler: [requirePermission('workflow:read')],
      schema: {
        params: { type: 'object', required: ['id'], properties: { id: { type: 'string' } } },
      },
    },
    async (request, reply) => {
      const workflow = await WorkflowService.getWorkflow(request.orgId, request.params.id)
      if (!workflow) {
        return reply.status(404).send({
          error: { code: 'NOT_FOUND', message: `Workflow '${request.params.id}' not found`, request_id: request.id },
        })
      }
      return reply.status(200).send({ data: workflow })
    },
  )

  // -------------------------------------------------------------------------
  // PATCH /v1/workflows/:id — update name/description
  // -------------------------------------------------------------------------
  app.patch<{ Params: { id: string } }>(
    '/v1/workflows/:id',
    {
      preHandler: [requirePermission('workflow:update')],
      schema: {
        params: { type: 'object', required: ['id'], properties: { id: { type: 'string' } } },
      },
    },
    async (request, reply) => {
      const parse = updateWorkflowSchema.safeParse(request.body)
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

      const workflow = await WorkflowService.updateWorkflow(
        request.orgId,
        request.params.id,
        { name: parse.data.name, description: parse.data.description },
        { requestId: request.id, actorId: request.userId },
      )

      return reply.status(200).send({ data: workflow })
    },
  )

  // -------------------------------------------------------------------------
  // DELETE /v1/workflows/:id — soft delete
  // -------------------------------------------------------------------------
  app.delete<{ Params: { id: string } }>(
    '/v1/workflows/:id',
    {
      preHandler: [requirePermission('workflow:delete')],
      schema: {
        params: { type: 'object', required: ['id'], properties: { id: { type: 'string' } } },
      },
    },
    async (request, reply) => {
      await WorkflowService.deleteWorkflow(
        request.orgId,
        request.params.id,
        { requestId: request.id, actorId: request.userId },
      )
      return reply.status(204).send()
    },
  )

  // -------------------------------------------------------------------------
  // POST /v1/workflows/:id/versions — create a new draft version
  // -------------------------------------------------------------------------
  app.post<{ Params: { id: string } }>(
    '/v1/workflows/:id/versions',
    {
      preHandler: [requirePermission('workflow:create')],
      schema: {
        params: { type: 'object', required: ['id'], properties: { id: { type: 'string' } } },
      },
    },
    async (request, reply) => {
      const parse = createVersionSchema.safeParse(request.body)
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

      const version = await WorkflowService.createVersion(
        request.orgId,
        request.params.id,
        { definition: parse.data.definition },
        { requestId: request.id, actorId: request.userId },
      )

      return reply.status(201).send({ data: version })
    },
  )

  // -------------------------------------------------------------------------
  // GET /v1/workflows/:id/versions — list all versions of a workflow
  // -------------------------------------------------------------------------
  app.get<{ Params: { id: string } }>(
    '/v1/workflows/:id/versions',
    {
      preHandler: [requirePermission('workflow:read')],
      schema: {
        params: { type: 'object', required: ['id'], properties: { id: { type: 'string' } } },
      },
    },
    async (request, reply) => {
      const versions = await WorkflowService.listVersions(request.orgId, request.params.id)
      return reply.status(200).send({ data: versions })
    },
  )

  // -------------------------------------------------------------------------
  // GET /v1/workflow-versions/:id — get a single version by id
  // -------------------------------------------------------------------------
  app.get<{ Params: { id: string } }>(
    '/v1/workflow-versions/:id',
    {
      preHandler: [requirePermission('workflow:read')],
      schema: {
        params: { type: 'object', required: ['id'], properties: { id: { type: 'string' } } },
      },
    },
    async (request, reply) => {
      const version = await WorkflowService.getVersion(request.orgId, request.params.id)
      if (!version) {
        return reply.status(404).send({
          error: { code: 'NOT_FOUND', message: `Workflow version '${request.params.id}' not found`, request_id: request.id },
        })
      }
      return reply.status(200).send({ data: version })
    },
  )

  // -------------------------------------------------------------------------
  // POST /v1/workflow-versions/:id/publish — publish a draft version
  // -------------------------------------------------------------------------
  app.post<{ Params: { id: string } }>(
    '/v1/workflow-versions/:id/publish',
    {
      preHandler: [requirePermission('workflow:activate')],
      schema: {
        params: { type: 'object', required: ['id'], properties: { id: { type: 'string' } } },
      },
    },
    async (request, reply) => {
      const version = await WorkflowService.publishVersion(
        request.orgId,
        request.params.id,
        { requestId: request.id, actorId: request.userId },
      )
      return reply.status(200).send({ data: version })
    },
  )

  // -------------------------------------------------------------------------
  // POST /v1/workflow-versions/:id/archive — archive a version
  // -------------------------------------------------------------------------
  app.post<{ Params: { id: string } }>(
    '/v1/workflow-versions/:id/archive',
    {
      preHandler: [requirePermission('workflow:update')],
      schema: {
        params: { type: 'object', required: ['id'], properties: { id: { type: 'string' } } },
      },
    },
    async (request, reply) => {
      const version = await WorkflowService.archiveVersion(
        request.orgId,
        request.params.id,
        { requestId: request.id, actorId: request.userId },
      )
      return reply.status(200).send({ data: version })
    },
  )
}
