/**
 * ExecutionService — Tasks 4.8 + 5.7
 *
 * Handles enqueueing workflow execution jobs and querying execution records.
 * Each execution is tied to a specific workflow_version_id (immutable snapshot)
 * so historical execution records remain accurate even after new versions are published.
 */

import createError from '@fastify/error'
import { type Prisma } from '@prisma/client'
import { prisma, type TransactionClient } from '../lib/prisma.js'
import { workflowQueue } from '../lib/queue.js'
import { redisClient } from '../lib/redis.js'
import { v4 as uuidv4 } from 'uuid'

// ---------------------------------------------------------------------------
// Custom errors
// ---------------------------------------------------------------------------

const NotFoundError = createError('NOT_FOUND', '%s', 404)
const UnprocessableError = createError('UNPROCESSABLE_ENTITY', '%s', 422)

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const QUEUE_DEPTH_CACHE_KEY = 'queue:depth:cache'
const QUEUE_DEPTH_CACHE_TTL_SECONDS = 30

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ListExecutionsOptions {
  workflowId?: string
  status?: string
  fromDate?: Date
  toDate?: Date
  after?: string
  limit?: number
}

export interface ListFailedJobsOptions {
  workflowId?: string
  fromDate?: Date
  toDate?: Date
  errorType?: string
  after?: string
  limit?: number
}

export const ExecutionService = {
  /**
   * Create an execution record and enqueue a BullMQ job.
   *
   * Called from EventService.matchWorkflows after a workflow version's rules pass.
   * Must be called inside or immediately after the event ingestion transaction.
   *
   * @param tx                - Active Prisma transaction client (called within event TX)
   * @param orgId             - Organization scope
   * @param workflowVersionId - The published workflow version that matched
   * @param workflowId        - Parent workflow id (for display/logging)
   * @param eventId           - The event that triggered this execution
   * @param requestId         - Optional HTTP request id for tracing
   */
  async enqueueJob(
    tx: TransactionClient,
    orgId: string,
    workflowVersionId: string,
    workflowId: string,
    eventId: string,
    requestId?: string,
  ) {
    // Create the execution record inside the transaction.
    // We use execution.id as both the DB PK and the BullMQ jobId so we can
    // set jobId immediately — no post-transaction update needed.
    const execution = await tx.execution.create({
      data: {
        organizationId: orgId,
        workflowVersionId,
        eventId,
        jobId: '',      // placeholder; updated below after we have the UUID
        queueName: 'workflow-exec',
        status: 'queued',
        attemptCount: 0,
      },
    })

    // Back-fill the jobId using the execution's own UUID (deterministic)
    await tx.execution.update({
      where: { id: execution.id },
      data: { jobId: execution.id },
    })

    // Add the job to BullMQ (outside the transaction — BullMQ is Redis-backed).
    // We enqueue after the execution record is committed so the worker always
    // finds the record when it picks up the job.
    const jobData = {
      workflowVersionId,
      workflowId,
      eventId,
      executionId: execution.id,
      orgId,
      requestId,
    }

    await workflowQueue.add('workflow-exec', jobData, {
      jobId: execution.id, // BullMQ jobId === executionId for easy cross-system lookup
    })

    return { ...execution, jobId: execution.id }
  },

  /**
   * List executions for an organization with optional filters and cursor-based pagination.
   *
   * Requirements: 8.2
   */
  async listExecutions(
    orgId: string,
    options: ListExecutionsOptions = {},
  ) {
    const { workflowId, status, fromDate, toDate, after, limit = 20 } = options
    const pageSize = Math.min(limit, 100)

    // Build where clause — note: the Execution model links to workflowVersionId, not workflowId.
    // We need to find executions that belong to any version of the given workflow.
    const where: Record<string, unknown> = {
      organizationId: orgId,
    }

    if (status) {
      where['status'] = status
    }

    if (fromDate || toDate) {
      where['createdAt'] = {
        ...(fromDate ? { gte: fromDate } : {}),
        ...(toDate ? { lte: toDate } : {}),
      }
    }

    if (workflowId) {
      // Filter by executions whose workflowVersion belongs to the given workflow
      where['workflowVersion'] = {
        workflowId,
      }
    }

    if (after) {
      where['id'] = { gt: after }
    }

    const executions = await prisma.execution.findMany({
      where: where as Prisma.ExecutionWhereInput,
      orderBy: { createdAt: 'desc' },
      take: pageSize + 1,
      include: {
        workflowVersion: {
          select: { workflowId: true, version: true },
        },
      },
    })

    const hasMore = executions.length > pageSize
    const items = hasMore ? executions.slice(0, pageSize) : executions
    const nextCursor = hasMore ? items[items.length - 1]?.id : null

    return {
      data: items,
      meta: {
        nextCursor,
        hasMore,
      },
    }
  },

  /**
   * Get a single execution by id, scoped to the organization.
   *
   * Requirements: 8.2
   */
  async getExecution(orgId: string, executionId: string) {
    const execution = await prisma.execution.findFirst({
      where: { id: executionId, organizationId: orgId },
      include: {
        workflowVersion: {
          select: { workflowId: true, version: true },
        },
        event: {
          select: { id: true, eventTypeId: true, receivedAt: true },
        },
      },
    })

    return execution ?? null
  },

  /**
   * List failed executions for an organization with optional filters and pagination.
   *
   * Requirements: 8.4
   */
  async listFailedJobs(
    orgId: string,
    options: ListFailedJobsOptions = {},
  ) {
    const { workflowId, fromDate, toDate, errorType, after, limit = 20 } = options
    const pageSize = Math.min(limit, 100)

    const where: Record<string, unknown> = {
      organizationId: orgId,
      status: 'failed',
    }

    if (fromDate || toDate) {
      where['createdAt'] = {
        ...(fromDate ? { gte: fromDate } : {}),
        ...(toDate ? { lte: toDate } : {}),
      }
    }

    if (workflowId) {
      where['workflowVersion'] = {
        workflowId,
      }
    }

    if (errorType) {
      // Partial match on errorDetail
      where['errorDetail'] = {
        contains: errorType,
        mode: 'insensitive',
      }
    }

    if (after) {
      where['id'] = { gt: after }
    }

    const executions = await prisma.execution.findMany({
      where: where as Prisma.ExecutionWhereInput,
      orderBy: { createdAt: 'desc' },
      take: pageSize + 1,
      include: {
        workflowVersion: {
          select: { workflowId: true, version: true },
        },
        event: {
          select: { id: true, eventTypeId: true, receivedAt: true },
        },
      },
    })

    const hasMore = executions.length > pageSize
    const items = hasMore ? executions.slice(0, pageSize) : executions
    const nextCursor = hasMore ? items[items.length - 1]?.id : null

    return {
      data: items,
      meta: {
        nextCursor,
        hasMore,
      },
    }
  },

  /**
   * Re-enqueue a failed execution as a new execution record.
   *
   * Requirements: 8.5
   *
   * Steps:
   *  1. Load execution by id + orgId
   *  2. Verify status === 'failed' — throw 422 if not
   *  3. Create a NEW executions record (status='queued', attemptCount=0)
   *  4. Enqueue to BullMQ workflow-exec queue with the new executionId
   *  5. Return the new execution record
   */
  async retryJob(orgId: string, executionId: string) {
    // Step 1: Load the execution
    const existing = await prisma.execution.findFirst({
      where: { id: executionId, organizationId: orgId },
      include: {
        workflowVersion: {
          select: { workflowId: true, version: true },
        },
      },
    })

    if (!existing) {
      throw new NotFoundError(`Execution '${executionId}' not found`)
    }

    // Step 2: Verify status is 'failed'
    if (existing.status !== 'failed') {
      throw new UnprocessableError(
        `Cannot retry execution with status '${existing.status}'. Valid transition: failed → queued`,
      )
    }

    // Step 3: Create a new execution record
    const newJobId = uuidv4()
    const newExecution = await prisma.execution.create({
      data: {
        organizationId: orgId,
        workflowVersionId: existing.workflowVersionId,
        eventId: existing.eventId,
        jobId: newJobId,   // placeholder, will be updated after BullMQ add
        queueName: 'workflow-exec',
        status: 'queued',
        attemptCount: 0,
      },
    })

    // Step 4: Enqueue to BullMQ
    const jobData = {
      workflowVersionId: existing.workflowVersionId,
      workflowId: existing.workflowVersion.workflowId,
      eventId: existing.eventId,
      executionId: newExecution.id,
      orgId,
    }

    const job = await workflowQueue.add('workflow-exec', jobData, {
      jobId: newExecution.id,
    })

    // Update the jobId on the new execution record
    const updated = await prisma.execution.update({
      where: { id: newExecution.id },
      data: { jobId: job.id ?? newExecution.id },
    })

    // Write audit log for retry (best-effort, outside the execution TX)
    await prisma.auditLog.create({
      data: {
        organizationId: orgId,
        entityType: 'execution',
        entityId: newExecution.id,
        action: 'created',
        actorType: 'user',
        actorId: null, // retry is API-triggered but actor is not threaded here — fix in Phase 7
        beforeState: {
          originalExecutionId: executionId,
          status: existing.status,
          errorDetail: existing.errorDetail,
          attemptCount: existing.attemptCount,
        },
        afterState: {
          newExecutionId: newExecution.id,
          status: 'queued',
          attemptCount: 0,
          retriedFrom: executionId,
        },
        requestId: null,
      },
    })

    return updated
  },

  /**
   * Get queue depth metrics for all active queues, cached in Redis for 30 seconds.
   *
   * Requirements: 8.6
   */
  async getQueueDepth() {
    // Check Redis cache first
    const cached = await redisClient.get(QUEUE_DEPTH_CACHE_KEY)
    if (cached) {
      return JSON.parse(cached) as {
        queues: Record<string, Record<string, number>>
        cachedAt: string
      }
    }

    // Import all three queues
    const { workflowQueue: wfQueue, notificationsQueue, metricUpdatesQueue } = await import('../lib/queue.js')

    const [wfCounts, notifCounts, metricCounts] = await Promise.all([
      wfQueue.getJobCounts('waiting', 'active', 'completed', 'failed', 'delayed'),
      notificationsQueue.getJobCounts('waiting', 'active', 'completed', 'failed', 'delayed'),
      metricUpdatesQueue.getJobCounts('waiting', 'active', 'completed', 'failed', 'delayed'),
    ])

    const result = {
      queues: {
        'workflow-exec': wfCounts,
        notifications: notifCounts,
        'metric-updates': metricCounts,
      },
      cachedAt: new Date().toISOString(),
    }

    // Cache in Redis for 30 seconds
    await redisClient.set(
      QUEUE_DEPTH_CACHE_KEY,
      JSON.stringify(result),
      'EX',
      QUEUE_DEPTH_CACHE_TTL_SECONDS,
    )

    return result
  },
}
