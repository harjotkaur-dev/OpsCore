/**
 * Action Handlers — Task 5.2
 *
 * Dispatches workflow actions to their specific handler implementations.
 *
 * Supported action types:
 *  - create_task          → createTaskHandler (idempotent via seeded UUID)
 *  - send_notification    → sendNotificationHandler (enqueues to BullMQ)
 *  - update_metric        → updateMetricHandler (enqueues to BullMQ)
 *  - call_webhook         → callWebhookHandler (HTTP POST with env allowlist)
 *
 * Requirements: 5.4, 6.6
 */

import type { Logger } from '@opscore/logger'
import { createTaskHandler } from './createTaskHandler.js'
import { sendNotificationHandler } from './sendNotificationHandler.js'
import { updateMetricHandler } from './updateMetricHandler.js'
import { callWebhookHandler } from './callWebhookHandler.js'

export interface ActionExecutionContext {
  actionType: string
  config: Record<string, unknown>
  event: {
    id: string
    eventTypeId: string
    payload: unknown
    source: string
  }
  executionId: string
  orgId: string
  orderIndex: number
  logger: Logger
}

/**
 * Execute a workflow action.
 *
 * Routes to the appropriate handler based on action type.
 * Each handler is responsible for idempotent execution (Requirement 6.6).
 *
 * @param context - Action execution context
 */
export async function executeAction(context: ActionExecutionContext): Promise<void> {
  const { actionType } = context

  switch (actionType) {
    case 'create_task':
      return createTaskHandler(context)

    case 'send_notification':
      return sendNotificationHandler(context)

    case 'update_metric':
      return updateMetricHandler(context)

    case 'call_webhook':
      return callWebhookHandler(context)

    default:
      throw new Error(`Unknown action type: ${actionType}`)
  }
}
