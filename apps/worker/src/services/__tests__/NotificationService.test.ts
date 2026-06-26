/**
 * Worker NotificationService Unit Tests — Task 9.1
 *
 * Tests the worker-side deliver() implementation:
 * - Loads notification and logs delivery
 * - Notification not found → logs warning, does NOT throw
 *
 * ESM-native mocking via jest.unstable_mockModule + dynamic imports.
 */

import { jest, describe, it, expect, beforeEach } from '@jest/globals'
import type { Job } from 'bullmq'
import type { NotificationJobData } from '@opscore/types'

// ---------------------------------------------------------------------------
// Prisma mock
// ---------------------------------------------------------------------------

const mockNotificationFindFirst = jest.fn<(args: unknown) => Promise<unknown>>()

jest.unstable_mockModule('@opscore/database', () => ({
  prisma: {
    notification: {
      findFirst: mockNotificationFindFirst,
    },
  },
  PrismaClient: jest.fn(),
}))

jest.unstable_mockModule('@opscore/config', () => ({
  config: {
    NODE_ENV: 'test',
    DATABASE_URL: 'postgresql://test:test@localhost:5432/test',
    REDIS_URL: 'redis://localhost:6379',
    JWT_PRIVATE_KEY: 'test-private-key',
    JWT_PUBLIC_KEY: 'test-public-key',
    COOKIE_SECRET: 'test-cookie-secret-32-chars-long!!',
    CORS_ORIGIN: 'http://localhost:5173',
    PORT: 3000,
    WORKER_CONCURRENCY_WORKFLOW: 10,
    WORKER_CONCURRENCY_NOTIFICATIONS: 20,
    WORKER_CONCURRENCY_METRICS: 5,
    LOG_LEVEL: 'info',
  },
}))

const { deliver } = await import('../NotificationService.js')

// ---------------------------------------------------------------------------
// Sample data
// ---------------------------------------------------------------------------

const ORG_ID = 'org-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
const NOTIF_ID = 'notif-bbbb-bbbb-bbbb-bbbbbbbbbbbb'
const USER_ID = 'user-cccc-cccc-cccc-cccccccccccc'

const sampleNotification = {
  id: NOTIF_ID,
  organizationId: ORG_ID,
  recipientType: 'user',
  recipientUserId: USER_ID,
  recipientTeamId: null,
  message: 'You have a new notification',
  sourceEntityType: 'execution',
  sourceEntityId: 'exec-1234',
  isRead: false,
  readAt: null,
  createdAt: new Date('2024-01-01T10:00:00.000Z'),
}

function makeJob(data: NotificationJobData): Job<NotificationJobData> {
  return {
    id: 'job-001',
    data,
    attemptsMade: 0,
  } as Job<NotificationJobData>
}

// ---------------------------------------------------------------------------
// deliver — notification found
// ---------------------------------------------------------------------------

describe('NotificationService.deliver — notification found', () => {
  beforeEach(async () => { jest.clearAllMocks() })

  it('loads the notification and resolves without throwing', async () => {
    mockNotificationFindFirst.mockResolvedValue(sampleNotification as unknown)

    const job = makeJob({ notificationId: NOTIF_ID, orgId: ORG_ID })

    await expect(deliver(job)).resolves.toBeUndefined()

    expect(mockNotificationFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: NOTIF_ID, organizationId: ORG_ID },
      }),
    )
  })

  it('queries using the correct notificationId and orgId from job data', async () => {
    mockNotificationFindFirst.mockResolvedValue(sampleNotification as unknown)

    const job = makeJob({ notificationId: NOTIF_ID, orgId: ORG_ID })

    await deliver(job)

    expect(mockNotificationFindFirst).toHaveBeenCalledTimes(1)
    expect(mockNotificationFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: NOTIF_ID, organizationId: ORG_ID },
      }),
    )
  })
})

// ---------------------------------------------------------------------------
// deliver — notification not found
// ---------------------------------------------------------------------------

describe('NotificationService.deliver — notification not found', () => {
  beforeEach(async () => { jest.clearAllMocks() })

  it('does NOT throw when notification is not found', async () => {
    mockNotificationFindFirst.mockResolvedValue(null as unknown)

    const job = makeJob({ notificationId: 'missing-id', orgId: ORG_ID })

    await expect(deliver(job)).resolves.toBeUndefined()
  })

  it('does NOT throw when orgId does not match (wrong tenant)', async () => {
    mockNotificationFindFirst.mockResolvedValue(null as unknown)

    const job = makeJob({ notificationId: NOTIF_ID, orgId: 'wrong-org-id' })

    await expect(deliver(job)).resolves.toBeUndefined()
  })
})
