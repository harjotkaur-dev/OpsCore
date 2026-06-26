/**
 * createTaskHandler — Task 5.2
 *
 * Creates a task (and optional task assignment) from a `create_task` workflow action.
 *
 * Idempotency:
 *   The task's UUID is seeded as the first 32 hex chars of
 *   SHA-256(executionId + ":" + orderIndex), formatted as a UUID v4.
 *   On re-delivery of the same job the upsert skips the duplicate.
 *
 * Config schema (validated at workflow-publish time by actionConfigValidator):
 *   {
 *     title_template: string          — Mustache template; receives { event: { payload, source, … } }
 *     priority: "low"|"medium"|"high"|"critical"
 *     assignee_type?: "user"|"team"
 *     assignee_id?: string
 *     due_in_hours?: number
 *   }
 *
 * Requirements: 5.4, 6.6
 */

import { createHash } from 'node:crypto'
import Mustache from 'mustache'
import { prisma } from '@opscore/database'
import type { ActionExecutionContext } from './index.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Derive a deterministic UUID v4 from SHA-256(executionId + ":" + orderIndex).
 * Uses the first 32 hex characters (128 bits) and sets version/variant bits.
 */
export function deriveIdempotentTaskId(executionId: string, orderIndex: number): string {
  const hash = createHash('sha256')
    .update(`${executionId}:${orderIndex}`)
    .digest('hex')
    .slice(0, 32) // 128 bits = 32 hex chars

  // Format as UUID v4 (set version=4, variant=8/9/a/b)
  return [
    hash.slice(0, 8),
    hash.slice(8, 12),
    '4' + hash.slice(13, 16),          // version 4
    ((parseInt(hash[16]!, 16) & 0x3) | 0x8).toString(16) + hash.slice(17, 20), // variant
    hash.slice(20, 32),
  ].join('-')
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export interface CreateTaskConfig {
  title_template: string
  priority: 'low' | 'medium' | 'high' | 'critical'
  assignee_type?: 'user' | 'team'
  assignee_id?: string
  due_in_hours?: number
}

export async function createTaskHandler(context: ActionExecutionContext): Promise<void> {
  const { config, event, executionId, orgId, orderIndex, logger } = context
  const cfg = config as unknown as CreateTaskConfig

  // Render the title template with event data
  const title = Mustache.render(cfg.title_template, { event })

  // Derive deterministic task UUID for idempotency
  const taskId = deriveIdempotentTaskId(executionId, orderIndex)

  logger.info({ taskId, title, executionId, orderIndex }, 'Creating task via workflow action')

  // Compute optional due date
  const dueDate =
    typeof cfg.due_in_hours === 'number'
      ? new Date(Date.now() + cfg.due_in_hours * 60 * 60 * 1000)
      : null

  await prisma.$transaction(async (tx) => {
    // Upsert task using the deterministic id for idempotency
    const task = await tx.task.upsert({
      where: { id: taskId },
      update: {}, // no-op on duplicate delivery
      create: {
        id: taskId,
        organizationId: orgId,
        title,
        priority: cfg.priority,
        status: 'pending',
        dueDate,
        sourceExecutionId: executionId,
        createdBy: null, // workflow-created task
      },
    })

    // Create task assignment if configured
    if (cfg.assignee_type && cfg.assignee_id) {
      const existingAssignment = await tx.taskAssignment.findFirst({
        where: {
          taskId: task.id,
          organizationId: orgId,
          assigneeType: cfg.assignee_type,
          userId: cfg.assignee_type === 'user' ? cfg.assignee_id : null,
          teamId: cfg.assignee_type === 'team' ? cfg.assignee_id : null,
        },
      })

      if (!existingAssignment) {
        await tx.taskAssignment.create({
          data: {
            taskId: task.id,
            organizationId: orgId,
            assigneeType: cfg.assignee_type,
            userId: cfg.assignee_type === 'user' ? cfg.assignee_id : null,
            teamId: cfg.assignee_type === 'team' ? cfg.assignee_id : null,
            assignedBy: null,
          },
        })
      }
    }
  })

  logger.info({ taskId }, 'Task created successfully')
}
