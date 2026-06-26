/**
 * executeAction routing tests
 *
 * Verifies that executeAction dispatches to the correct handler
 * for each action type and throws for unknown types.
 */

import { describe, it, expect, jest } from '@jest/globals'
import type { ActionExecutionContext } from '../index.js'

// ---------------------------------------------------------------------------
// Mock all four handlers
// ---------------------------------------------------------------------------

const mockCreateTask = jest.fn<(ctx: ActionExecutionContext) => Promise<void>>().mockResolvedValue(undefined)
const mockSendNotification = jest.fn<(ctx: ActionExecutionContext) => Promise<void>>().mockResolvedValue(undefined)
const mockUpdateMetric = jest.fn<(ctx: ActionExecutionContext) => Promise<void>>().mockResolvedValue(undefined)
const mockCallWebhook = jest.fn<(ctx: ActionExecutionContext) => Promise<void>>().mockResolvedValue(undefined)

jest.unstable_mockModule('../createTaskHandler.js', () => ({
  createTaskHandler: mockCreateTask,
}))

jest.unstable_mockModule('../sendNotificationHandler.js', () => ({
  sendNotificationHandler: mockSendNotification,
}))

jest.unstable_mockModule('../updateMetricHandler.js', () => ({
  updateMetricHandler: mockUpdateMetric,
}))

jest.unstable_mockModule('../callWebhookHandler.js', () => ({
  callWebhookHandler: mockCallWebhook,
}))

const { executeAction } = await import('../index.js')

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeContext(actionType: string): ActionExecutionContext {
  return {
    actionType,
    config: {},
    event: { id: 'e1', eventTypeId: 'et1', payload: {}, source: 'api' },
    executionId: 'exec-1',
    orgId: 'org-1',
    orderIndex: 0,
    logger: {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
      child: jest.fn().mockReturnThis(),
    } as unknown as ActionExecutionContext['logger'],
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('executeAction', () => {
  it('dispatches create_task to createTaskHandler', async () => {
    await executeAction(makeContext('create_task'))
    expect(mockCreateTask).toHaveBeenCalledTimes(1)
  })

  it('dispatches send_notification to sendNotificationHandler', async () => {
    await executeAction(makeContext('send_notification'))
    expect(mockSendNotification).toHaveBeenCalledTimes(1)
  })

  it('dispatches update_metric to updateMetricHandler', async () => {
    await executeAction(makeContext('update_metric'))
    expect(mockUpdateMetric).toHaveBeenCalledTimes(1)
  })

  it('dispatches call_webhook to callWebhookHandler', async () => {
    await executeAction(makeContext('call_webhook'))
    expect(mockCallWebhook).toHaveBeenCalledTimes(1)
  })

  it('throws for an unknown action type', async () => {
    await expect(executeAction(makeContext('unknown_type'))).rejects.toThrow(
      'Unknown action type: unknown_type',
    )
  })

  it('passes the full context to the handler', async () => {
    const ctx = makeContext('create_task')
    await executeAction(ctx)
    expect(mockCreateTask).toHaveBeenCalledWith(ctx)
  })
})
