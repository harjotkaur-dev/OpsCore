/**
 * Unit tests for NotificationService — Tasks 9.1, 9.3
 *
 * ESM-native mocking via jest.unstable_mockModule + dynamic imports.
 * Follows the same pattern as TaskService.test.ts and EventService.test.ts.
 */

import { jest, describe, it, expect, beforeEach } from '@jest/globals'

// ---------------------------------------------------------------------------
// Prisma mocks
// ---------------------------------------------------------------------------

const mockNotificationCreate = jest.fn()
const mockNotificationFindFirst = jest.fn()
const mockNotificationFindMany = jest.fn()
const mockNotificationUpdate = jest.fn()
const mockNotificationUpdateMany = jest.fn()

const mockOrgMemberFindFirst = jest.fn()
const mockTeamFindFirst = jest.fn()
const mockTeamMemberFindMany = jest.fn()

const mockAuditCreate = jest.fn().mockResolvedValue({})

const mockTransaction = jest.fn(async (fn: (tx: unknown) => Promise<unknown>) =>
  fn({
    notification: {
      create: mockNotificationCreate,
      update: mockNotificationUpdate,
    },
    auditLog: { create: mockAuditCreate },
  }),
)

jest.unstable_mockModule('../../lib/prisma.js', () => ({
  prisma: {
    notification: {
      create: mockNotificationCreate,
      findFirst: mockNotificationFindFirst,
      findMany: mockNotificationFindMany,
      update: mockNotificationUpdate,
      updateMany: mockNotificationUpdateMany,
    },
    organizationMember: {
      findFirst: mockOrgMemberFindFirst,
    },
    team: {
      findFirst: mockTeamFindFirst,
    },
    teamMember: {
      findMany: mockTeamMemberFindMany,
    },
    auditLog: {
      create: mockAuditCreate,
    },
    $transaction: mockTransaction,
  },
  PrismaClient: jest.fn(),
}))

// ---------------------------------------------------------------------------
// Queue mock
// ---------------------------------------------------------------------------

const mockQueueAdd = jest.fn().mockResolvedValue({})

jest.unstable_mockModule('../../lib/queue.js', () => ({
  notificationsQueue: { add: mockQueueAdd },
  workflowQueue: { add: jest.fn() },
  metricUpdatesQueue: { add: jest.fn() },
  createQueue: jest.fn(),
}))

jest.unstable_mockModule('@prisma/client', () => ({
  Prisma: { JsonNull: 'JsonNull' },
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

const { NotificationService } = await import('../NotificationService.js')

// ---------------------------------------------------------------------------
// Sample data
// ---------------------------------------------------------------------------

const ORG_ID = 'org-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
const USER_ID = 'user-bbbb-bbbb-bbbb-bbbbbbbbbbbb'
const USER_ID_2 = 'user-cccc-cccc-cccc-cccccccccccc'
const USER_ID_3 = 'user-dddd-dddd-dddd-dddddddddddd'
const TEAM_ID = 'team-eeee-eeee-eeee-eeeeeeeeeeee'
const NOTIF_ID = 'notif-ffff-ffff-ffff-ffffffffffff'
const SOURCE_ENTITY_ID = 'exec-0000-0000-0000-000000000000'

const sampleNotification = {
  id: NOTIF_ID,
  organizationId: ORG_ID,
  recipientType: 'user',
  recipientUserId: USER_ID,
  recipientTeamId: null,
  message: 'Test notification',
  sourceEntityType: 'execution',
  sourceEntityId: SOURCE_ENTITY_ID,
  isRead: false,
  readAt: null,
  createdAt: new Date('2024-01-01T10:00:00.000Z'),
}

const sampleOrgMember = {
  id: 'mbr-1111-1111-1111-111111111111',
  organizationId: ORG_ID,
  userId: USER_ID,
  role: 'member',
  status: 'active',
}

const sampleTeam = {
  id: TEAM_ID,
  organizationId: ORG_ID,
  name: 'Engineering',
  status: 'active',
  createdAt: new Date('2024-01-01'),
  updatedAt: new Date('2024-01-01'),
}

// ---------------------------------------------------------------------------
// create — user recipient
// ---------------------------------------------------------------------------

describe('NotificationService.create — user recipient', () => {
  beforeEach(() => jest.clearAllMocks())

  it('creates 1 row and enqueues 1 job for user recipient', async () => {
    mockOrgMemberFindFirst.mockResolvedValue(sampleOrgMember)
    mockNotificationCreate.mockResolvedValue(sampleNotification)

    const result = await NotificationService.create({
      orgId: ORG_ID,
      recipientType: 'user',
      recipientUserId: USER_ID,
      message: 'Test notification',
      sourceEntityType: 'execution',
      sourceEntityId: SOURCE_ENTITY_ID,
    })

    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({ id: NOTIF_ID, recipientUserId: USER_ID })
    expect(mockTransaction).toHaveBeenCalledTimes(1)
    expect(mockNotificationCreate).toHaveBeenCalledTimes(1)
    expect(mockNotificationCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          organizationId: ORG_ID,
          recipientType: 'user',
          recipientUserId: USER_ID,
          message: 'Test notification',
          isRead: false,
        }),
      }),
    )
    // Queue enqueued after commit
    expect(mockQueueAdd).toHaveBeenCalledTimes(1)
    expect(mockQueueAdd).toHaveBeenCalledWith(
      'send-notification',
      { notificationId: NOTIF_ID, orgId: ORG_ID },
    )
  })

  it('throws 422 when user is not an active org member', async () => {
    mockOrgMemberFindFirst.mockResolvedValue(null)

    await expect(
      NotificationService.create({
        orgId: ORG_ID,
        recipientType: 'user',
        recipientUserId: USER_ID,
        message: 'Test notification',
        sourceEntityType: 'execution',
        sourceEntityId: SOURCE_ENTITY_ID,
      }),
    ).rejects.toMatchObject({ statusCode: 422 })

    expect(mockTransaction).not.toHaveBeenCalled()
    expect(mockQueueAdd).not.toHaveBeenCalled()
  })

  it('writes audit log inside transaction', async () => {
    mockOrgMemberFindFirst.mockResolvedValue(sampleOrgMember)
    mockNotificationCreate.mockResolvedValue(sampleNotification)

    await NotificationService.create({
      orgId: ORG_ID,
      recipientType: 'user',
      recipientUserId: USER_ID,
      message: 'Test notification',
      sourceEntityType: 'execution',
      sourceEntityId: SOURCE_ENTITY_ID,
      actorId: USER_ID,
    })

    expect(mockAuditCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          organizationId: ORG_ID,
          entityType: 'notification',
          action: 'created',
          actorId: USER_ID,
          actorType: 'user',
        }),
      }),
    )
  })
})

// ---------------------------------------------------------------------------
// create — team recipient
// ---------------------------------------------------------------------------

describe('NotificationService.create — team recipient', () => {
  beforeEach(() => jest.clearAllMocks())

  it('fans out to N rows and enqueues N jobs for team recipient', async () => {
    const members = [
      { userId: USER_ID },
      { userId: USER_ID_2 },
      { userId: USER_ID_3 },
    ]
    mockTeamFindFirst.mockResolvedValue(sampleTeam)
    mockTeamMemberFindMany.mockResolvedValue(members)

    const notif1 = { ...sampleNotification, id: 'notif-1', recipientUserId: USER_ID }
    const notif2 = { ...sampleNotification, id: 'notif-2', recipientUserId: USER_ID_2 }
    const notif3 = { ...sampleNotification, id: 'notif-3', recipientUserId: USER_ID_3 }
    // Transaction calls notification.create for each member
    mockNotificationCreate
      .mockResolvedValueOnce(notif1)
      .mockResolvedValueOnce(notif2)
      .mockResolvedValueOnce(notif3)

    const result = await NotificationService.create({
      orgId: ORG_ID,
      recipientType: 'team',
      recipientTeamId: TEAM_ID,
      message: 'Team notification',
      sourceEntityType: 'execution',
      sourceEntityId: SOURCE_ENTITY_ID,
    })

    expect(result).toHaveLength(3)
    expect(mockNotificationCreate).toHaveBeenCalledTimes(3)
    expect(mockQueueAdd).toHaveBeenCalledTimes(3)
    // Each job has correct notificationId
    expect(mockQueueAdd).toHaveBeenCalledWith('send-notification', { notificationId: 'notif-1', orgId: ORG_ID })
    expect(mockQueueAdd).toHaveBeenCalledWith('send-notification', { notificationId: 'notif-2', orgId: ORG_ID })
    expect(mockQueueAdd).toHaveBeenCalledWith('send-notification', { notificationId: 'notif-3', orgId: ORG_ID })
  })

  it('throws 422 when team is archived', async () => {
    mockTeamFindFirst.mockResolvedValue({ ...sampleTeam, status: 'archived' })

    await expect(
      NotificationService.create({
        orgId: ORG_ID,
        recipientType: 'team',
        recipientTeamId: TEAM_ID,
        message: 'Test notification',
        sourceEntityType: 'execution',
        sourceEntityId: SOURCE_ENTITY_ID,
      }),
    ).rejects.toMatchObject({ statusCode: 422 })

    expect(mockTransaction).not.toHaveBeenCalled()
    expect(mockQueueAdd).not.toHaveBeenCalled()
  })

  it('returns [] and creates no rows when team has 0 active members', async () => {
    mockTeamFindFirst.mockResolvedValue(sampleTeam)
    mockTeamMemberFindMany.mockResolvedValue([])

    const result = await NotificationService.create({
      orgId: ORG_ID,
      recipientType: 'team',
      recipientTeamId: TEAM_ID,
      message: 'Test notification',
      sourceEntityType: 'execution',
      sourceEntityId: SOURCE_ENTITY_ID,
    })

    expect(result).toEqual([])
    expect(mockTransaction).not.toHaveBeenCalled()
    expect(mockQueueAdd).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// markRead
// ---------------------------------------------------------------------------

describe('NotificationService.markRead', () => {
  beforeEach(() => jest.clearAllMocks())

  it('sets isRead=true and readAt when notification exists', async () => {
    const readNotif = { ...sampleNotification, isRead: true, readAt: new Date() }
    mockNotificationFindFirst.mockResolvedValue(sampleNotification)
    mockNotificationUpdate.mockResolvedValue(readNotif)

    const result = await NotificationService.markRead(NOTIF_ID, ORG_ID, USER_ID)

    expect(result.isRead).toBe(true)
    expect(result.readAt).toBeTruthy()
    expect(mockNotificationFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: NOTIF_ID,
          organizationId: ORG_ID,
          recipientUserId: USER_ID,
        },
      }),
    )
    expect(mockNotificationUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: NOTIF_ID },
        data: expect.objectContaining({ isRead: true, readAt: expect.any(Date) }),
      }),
    )
  })

  it('throws 404 when notification not found (tenant safety)', async () => {
    mockNotificationFindFirst.mockResolvedValue(null)

    await expect(
      NotificationService.markRead(NOTIF_ID, ORG_ID, 'wrong-user-id'),
    ).rejects.toMatchObject({ statusCode: 404 })

    expect(mockNotificationUpdate).not.toHaveBeenCalled()
  })

  it('throws 404 when notification belongs to different user', async () => {
    // findFirst returns null because recipientUserId doesn't match
    mockNotificationFindFirst.mockResolvedValue(null)

    await expect(
      NotificationService.markRead(NOTIF_ID, ORG_ID, USER_ID_2),
    ).rejects.toMatchObject({ statusCode: 404 })
  })

  it('writes audit log with before/after read state inside transaction', async () => {
    const readNotif = { ...sampleNotification, isRead: true, readAt: new Date('2024-06-01T12:00:00Z') }
    mockNotificationFindFirst.mockResolvedValue(sampleNotification)
    mockNotificationUpdate.mockResolvedValue(readNotif)

    await NotificationService.markRead(NOTIF_ID, ORG_ID, USER_ID)

    expect(mockAuditCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          organizationId: ORG_ID,
          entityType: 'notification',
          entityId: NOTIF_ID,
          action: 'status_changed',
          actorType: 'user',
          actorId: USER_ID,
          beforeState: { isRead: false },
          afterState: expect.objectContaining({ isRead: true }),
        }),
      }),
    )
  })
})

// ---------------------------------------------------------------------------
// markAllRead
// ---------------------------------------------------------------------------

describe('NotificationService.markAllRead', () => {
  beforeEach(() => jest.clearAllMocks())

  it('batch-updates unread notifications and returns the count', async () => {
    mockNotificationUpdateMany.mockResolvedValue({ count: 5 })

    const count = await NotificationService.markAllRead(ORG_ID, USER_ID)

    expect(count).toBe(5)
    expect(mockNotificationUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          organizationId: ORG_ID,
          recipientUserId: USER_ID,
          isRead: false,
        },
        data: expect.objectContaining({ isRead: true, readAt: expect.any(Date) }),
      }),
    )
  })

  it('returns 0 when all notifications are already read', async () => {
    mockNotificationUpdateMany.mockResolvedValue({ count: 0 })

    const count = await NotificationService.markAllRead(ORG_ID, USER_ID)

    expect(count).toBe(0)
  })

  it('writes aggregate audit log entry with markedReadCount', async () => {
    mockNotificationUpdateMany.mockResolvedValue({ count: 7 })

    await NotificationService.markAllRead(ORG_ID, USER_ID)

    expect(mockAuditCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          organizationId: ORG_ID,
          entityType: 'notification',
          action: 'status_changed',
          actorType: 'user',
          actorId: USER_ID,
          afterState: expect.objectContaining({ markedReadCount: 7 }),
        }),
      }),
    )
  })
})

// ---------------------------------------------------------------------------
// list
// ---------------------------------------------------------------------------

describe('NotificationService.list', () => {
  beforeEach(() => jest.clearAllMocks())

  it('returns notifications with default pagination', async () => {
    const notifications = [sampleNotification, { ...sampleNotification, id: 'notif-2' }]
    mockNotificationFindMany.mockResolvedValue(notifications)

    const result = await NotificationService.list(ORG_ID, USER_ID)

    expect(result.data).toHaveLength(2)
    expect(result.pagination.hasNextPage).toBe(false)
    expect(mockNotificationFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ organizationId: ORG_ID, recipientUserId: USER_ID }),
        take: 21, // limit + 1
      }),
    )
  })

  it('indicates next page when more results exist', async () => {
    const notifications = Array.from({ length: 21 }, (_, i) => ({
      ...sampleNotification,
      id: `notif-${i}`,
    }))
    mockNotificationFindMany.mockResolvedValue(notifications)

    const result = await NotificationService.list(ORG_ID, USER_ID, {}, { limit: 20 })

    expect(result.pagination.hasNextPage).toBe(true)
    expect(result.data).toHaveLength(20)
    expect(result.pagination.nextCursor).toBe('notif-19')
  })

  it('applies isRead filter', async () => {
    mockNotificationFindMany.mockResolvedValue([])

    await NotificationService.list(ORG_ID, USER_ID, { isRead: false })

    expect(mockNotificationFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ isRead: false }),
      }),
    )
  })

  it('applies date range filter', async () => {
    mockNotificationFindMany.mockResolvedValue([])
    const fromDate = new Date('2024-01-01')
    const toDate = new Date('2024-12-31')

    await NotificationService.list(ORG_ID, USER_ID, { fromDate, toDate })

    expect(mockNotificationFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          createdAt: { gte: fromDate, lte: toDate },
        }),
      }),
    )
  })

  it('caps limit at 100', async () => {
    mockNotificationFindMany.mockResolvedValue([])

    await NotificationService.list(ORG_ID, USER_ID, {}, { limit: 9999 })

    expect(mockNotificationFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 101 }), // 100 + 1
    )
  })

  it('applies cursor pagination', async () => {
    mockNotificationFindMany.mockResolvedValue([])

    await NotificationService.list(ORG_ID, USER_ID, {}, { after: NOTIF_ID })

    expect(mockNotificationFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        cursor: { id: NOTIF_ID },
        skip: 1,
      }),
    )
  })
})
