/**
 * sendNotificationHandler unit tests (Phase 9 persist-first pattern)
 *
 * Verifies the canonical notification lifecycle for workflow actions:
 *   1. Persist Notification row in DB
 *   2. Enqueue { notificationId: <real DB id>, orgId }
 *   3. On retry (row already exists): reuse existing id, no duplicate row
 *
 * Requirements: 5.4, 6.6
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals'
import type { ActionExecutionContext } from '../index.js'

// ---------------------------------------------------------------------------
// Mocks — declared before any imports so unstable_mockModule hoisting works
// ---------------------------------------------------------------------------

const mockQueueAdd = jest.fn<(name: string, data: unknown, opts?: unknown) => Promise<unknown>>()

jest.unstable_mockModule('bullmq', () => ({
  Queue: jest.fn().mockImplementation(() => ({ add: mockQueueAdd })),
}))

jest.unstable_mockModule('@opscore/config', () => ({
  config: { REDIS_URL: 'redis://localhost:6379' },
}))

jest.unstable_mockModule('../../lib/redis', () => ({
  parseRedisConnectionOptions: jest.fn().mockReturnValue({ host: 'localhost', port: 6379 }),
}))

const mockNotificationFindFirst = jest.fn<(args: unknown) => Promise<unknown>>()
const mockNotificationCreate = jest.fn<(args: unknown) => Promise<unknown>>()

jest.unstable_mockModule('@opscore/database', () => ({
  prisma: {
    notification: {
      findFirst: mockNotificationFindFirst,
      create: mockNotificationCreate,
    },
  },
}))

const { sendNotificationHandler } = await import('../sendNotificationHandler.js')

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const NOTIFICATION_ID = 'notif-real-aaaa-aaaa-aaaaaaaaaaaa'

function makeContext(overrides: Partial<ActionExecutionContext> = {}): ActionExecutionContext {
  return {
    actionType: 'send_notification',
    config: {
      recipient_type: 'user',
      recipient_id: 'user-123',
      message_template: 'You have a new task',
    },
    event: { id: 'evt-001', eventTypeId: 'et-001', payload: {}, source: 'api' },
    executionId: 'exec-001',
    orgId: 'org-001',
    orderIndex: 1,
    logger: {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
      child: jest.fn().mockReturnThis(),
    } as unknown as ActionExecutionContext['logger'],
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('sendNotificationHandler', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockQueueAdd.mockResolvedValue({})
    mockNotificationFindFirst.mockResolvedValue(null)       // no existing record by default
    mockNotificationCreate.mockResolvedValue({ id: NOTIFICATION_ID, organizationId: 'org-001' })
  })

  // -------------------------------------------------------------------------
  // Core persist-first contract
  // -------------------------------------------------------------------------

  it('creates a notification record before enqueueing', async () => {
    await sendNotificationHandler(makeContext())

    expect(mockNotificationCreate).toHaveBeenCalledTimes(1)
    expect(mockNotificationCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          organizationId: 'org-001',
          recipientType: 'user',
          recipientUserId: 'user-123',
          recipientTeamId: null,
          message: 'You have a new task',
          sourceEntityType: 'execution',
          sourceEntityId: 'exec-001',
          isRead: false,
        }),
      }),
    )

    // Queue is called after create
    expect(mockQueueAdd).toHaveBeenCalledTimes(1)
  })

  it('enqueues with the real notification.id — not a placeholder', async () => {
    await sendNotificationHandler(makeContext())

    expect(mockQueueAdd).toHaveBeenCalledWith(
      'send-notification',
      expect.objectContaining({
        notificationId: NOTIFICATION_ID,   // real DB id
        orgId: 'org-001',
      }),
      expect.anything(),
    )
  })

  it('does NOT include placeholder fields in the queue payload', async () => {
    await sendNotificationHandler(makeContext())

    const payload = (mockQueueAdd.mock.calls[0] as [string, Record<string, unknown>])[1]
    // The new contract only has notificationId + orgId
    expect(payload).not.toHaveProperty('recipientType')
    expect(payload).not.toHaveProperty('recipientId')
    expect(payload).not.toHaveProperty('message')
    expect(payload).not.toHaveProperty('sourceEntityType')
    expect(payload).not.toHaveProperty('sourceEntityId')
  })

  // -------------------------------------------------------------------------
  // Idempotency on retry
  // -------------------------------------------------------------------------

  it('reuses existing notification id on retry — does NOT create a duplicate row', async () => {
    // Simulate: job was retried, notification record already persisted
    mockNotificationFindFirst.mockResolvedValue({ id: NOTIFICATION_ID })

    await sendNotificationHandler(makeContext())

    // No second row created
    expect(mockNotificationCreate).not.toHaveBeenCalled()
    // Still enqueues with the existing real id
    expect(mockQueueAdd).toHaveBeenCalledWith(
      'send-notification',
      expect.objectContaining({ notificationId: NOTIFICATION_ID }),
      expect.anything(),
    )
  })

  // -------------------------------------------------------------------------
  // BullMQ jobId deduplication
  // -------------------------------------------------------------------------

  it('uses a deterministic BullMQ jobId for queue-level deduplication', async () => {
    await sendNotificationHandler(makeContext())

    expect(mockQueueAdd).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ jobId: 'notif:exec-001:1' }),
    )
  })

  it('produces different BullMQ jobIds for different orderIndexes', async () => {
    mockNotificationCreate
      .mockResolvedValueOnce({ id: 'notif-a' })
      .mockResolvedValueOnce({ id: 'notif-b' })

    await sendNotificationHandler(makeContext({ orderIndex: 0 }))
    await sendNotificationHandler(makeContext({ orderIndex: 2 }))

    const calls = mockQueueAdd.mock.calls
    const id0 = (calls[0]?.[2] as { jobId: string }).jobId
    const id1 = (calls[1]?.[2] as { jobId: string }).jobId
    expect(id0).not.toBe(id1)
    expect(id0).toBe('notif:exec-001:0')
    expect(id1).toBe('notif:exec-001:2')
  })

  // -------------------------------------------------------------------------
  // Team recipient
  // -------------------------------------------------------------------------

  it('sets recipientTeamId and null recipientUserId for team recipients', async () => {
    const ctx = makeContext({
      config: {
        recipient_type: 'team',
        recipient_id: 'team-xyz',
        message_template: 'Team alert',
      },
    })
    mockNotificationCreate.mockResolvedValue({ id: NOTIFICATION_ID })

    await sendNotificationHandler(ctx)

    expect(mockNotificationCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          recipientType: 'team',
          recipientTeamId: 'team-xyz',
          recipientUserId: null,
        }),
      }),
    )
  })
})
