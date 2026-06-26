/**
 * WorkflowWorker — Task 5.1
 *
 * BullMQ Worker that processes workflow execution jobs from the 'workflow-exec' queue.
 *
 * Lifecycle:
 * 1. Load WorkflowVersion + ordered Actions from DB
 * 2. Update execution status to 'running'
 * 3. Execute each action sequentially by order_index
 * 4. Update execution status to 'completed' on success or 'failed' on error
 *
 * Emits structured Pino logs on every state transition:
 * - { job_id, queue, workflow_id, transition, organization_id, request_id }
 *
 * Requirements: 6.2, 8.1, 10.1, 10.3
 */

import { Worker, type Job } from 'bullmq'
import { prisma } from '@opscore/database'
import { logger } from '@opscore/logger'
import { QueueName, type WorkflowJobData, ExecutionStatus } from '@opscore/types'
import type { ConnectionOptions } from 'bullmq'
import { executeAction } from './actionHandlers/index.js'

interface WorkflowDefinition {
  triggerEventTypeId: string
  rules: Array<{
    expression: string
    description?: string
  }>
  actions: Array<{
    actionType: string
    orderIndex: number
    config: Record<string, unknown>
  }>
}

/**
 * Process a workflow execution job.
 *
 * Loads the workflow version, iterates through actions in order,
 * and updates the execution record at each step.
 */
async function processWorkflowJob(job: Job<WorkflowJobData>) {
  const { workflowVersionId, workflowId, eventId, executionId, orgId, requestId } = job.data

  // Create a child logger with job context
  const jobLogger = logger.child({
    jobId: job.id,
    queue: QueueName.WORKFLOW_EXEC,
    workflowId,
    organizationId: orgId,
    requestId: requestId ?? null,
  })

  jobLogger.info({ transition: 'started' }, 'Workflow execution started')

  try {
    // 1. Load WorkflowVersion + definition from DB
    const workflowVersion = await prisma.workflowVersion.findUnique({
      where: { id: workflowVersionId },
      select: {
        id: true,
        workflowId: true,
        version: true,
        definition: true,
        status: true,
      },
    })

    if (!workflowVersion) {
      throw new Error(`WorkflowVersion ${workflowVersionId} not found`)
    }

    if (workflowVersion.status !== 'published') {
      throw new Error(
        `WorkflowVersion ${workflowVersionId} has status '${workflowVersion.status}', expected 'published'`,
      )
    }

    const definition = workflowVersion.definition as unknown as WorkflowDefinition

    if (!definition.actions || definition.actions.length === 0) {
      jobLogger.info('Workflow has no actions, completing immediately')
    }

    // Load the triggering event for context
    const event = await prisma.event.findUnique({
      where: { id: eventId },
      select: {
        id: true,
        eventTypeId: true,
        payload: true,
        source: true,
      },
    })

    if (!event) {
      throw new Error(`Event ${eventId} not found`)
    }

    // 2. Update execution status to 'running'
    await prisma.execution.update({
      where: { id: executionId },
      data: {
        status: ExecutionStatus.RUNNING,
        startedAt: new Date(),
      },
    })

    jobLogger.info({ transition: 'running' }, 'Execution status updated to running')

    // 3. Execute actions sequentially by orderIndex
    const sortedActions = [...definition.actions].sort(
      (a, b) => a.orderIndex - b.orderIndex,
    )

    for (const action of sortedActions) {
      jobLogger.info(
        {
          actionType: action.actionType,
          orderIndex: action.orderIndex,
        },
        'Executing action',
      )

      // Execute the action (delegates to action handlers — Task 5.2)
      await executeAction({
        actionType: action.actionType,
        config: action.config,
        event,
        executionId,
        orgId,
        orderIndex: action.orderIndex,
        logger: jobLogger,
      })

      jobLogger.info(
        {
          actionType: action.actionType,
          orderIndex: action.orderIndex,
        },
        'Action completed',
      )
    }

    // 4. Update execution status to 'completed'
    await prisma.execution.update({
      where: { id: executionId },
      data: {
        status: ExecutionStatus.COMPLETED,
        completedAt: new Date(),
      },
    })

    jobLogger.info({ transition: 'completed' }, 'Workflow execution completed successfully')
  } catch (error) {
    // Log the error with full context
    jobLogger.error(
      {
        transition: 'failed',
        err: error instanceof Error ? { message: error.message, stack: error.stack } : error,
      },
      'Workflow execution failed',
    )

    // Re-throw to trigger BullMQ retry mechanism
    throw error
  }
}

/**
 * Handle job failure after all retry attempts exhausted.
 *
 * Updates the execution record to 'failed' status with error details.
 */
async function handleJobFailed(job: Job<WorkflowJobData> | undefined, error: Error) {
  if (!job) {
    logger.error({ err: error }, 'Job failed but job object is undefined')
    return
  }

  const { executionId, orgId, workflowId, requestId } = job.data

  const jobLogger = logger.child({
    jobId: job.id,
    queue: QueueName.WORKFLOW_EXEC,
    workflowId,
    organizationId: orgId,
    requestId: requestId ?? null,
  })

  try {
    await prisma.execution.update({
      where: { id: executionId },
      data: {
        status: ExecutionStatus.FAILED,
        errorDetail: error.message,
        completedAt: new Date(),
        attemptCount: job.attemptsMade,
      },
    })

    jobLogger.error(
      {
        transition: 'failed_final',
        attemptCount: job.attemptsMade,
        err: { message: error.message, stack: error.stack },
      },
      'Workflow execution failed after all retry attempts',
    )
  } catch (updateError) {
    jobLogger.error(
      {
        err: updateError instanceof Error ? updateError : new Error(String(updateError)),
      },
      'Failed to update execution record after job failure',
    )
  }
}

/**
 * Create and configure the WorkflowWorker.
 *
 * @param connection - Redis connection options
 * @param concurrency - Maximum concurrent jobs to process
 * @returns Configured BullMQ Worker instance
 */
export function createWorkflowWorker(
  connection: ConnectionOptions,
  concurrency: number,
): Worker<WorkflowJobData> {
  const worker = new Worker<WorkflowJobData>(
    QueueName.WORKFLOW_EXEC,
    processWorkflowJob,
    {
      connection,
      concurrency,
    },
  )

  // Register failure handler
  worker.on('failed', handleJobFailed)

  // Log worker lifecycle events
  worker.on('ready', () => {
    logger.info(
      { queue: QueueName.WORKFLOW_EXEC, concurrency },
      'WorkflowWorker ready',
    )
  })

  worker.on('error', (error) => {
    logger.error(
      { queue: QueueName.WORKFLOW_EXEC, err: error },
      'WorkflowWorker error',
    )
  })

  return worker
}
