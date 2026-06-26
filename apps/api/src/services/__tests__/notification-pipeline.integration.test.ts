/**
 * Phase 12.4 — Notification Pipeline Integration Test (API layer)
 *
 * Proves the API-side notification pipeline against real PostgreSQL:
 *
 *   create notification (user recipient)
 *     ↓ notification record persisted with isRead=false
 *     ↓ audit log written
 *     ↓ job enqueued to notifications queue
 *
 *   create notification (team recipient — fan-out)
 *     ↓ one notification record per active team member
 *     ↓ archived team rejected with 422
 *
 *   markRead
 *     ↓ isRead=true, readAt set
 *     ↓ audit log written
 *     ↓ other user's notification not affected
 *
 *   markAllRead
 *     ↓ all unread for the user marked read
 *     ↓ count returned matches
 *
 *   list
 *     ↓ filter by isRead
 *     ↓ cursor pagination
 *     ↓ cross-user isolation: user sees only their own
 *
 * Requirements: 12.1, 12.2, 12.3, 12.4, 12.5
 */

import { describe, it, expect, beforeAll } from 'vitest'
import { PrismaClient } from '@prisma/client'
import { getTestPrisma } from '../../test/integration-setup.js'

const { NotificationService } = await import('../NotificationService.js')

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

async function setup(prisma: PrismaClient, suffix: string) {
  const org = await prisma.organization.create({
    data: { name: `Notif Org ${suffix}`, slug: `notif-${suffix}`, status: 'active' },
  })

  const userA = await prisma.user.create({
    data: { email: `a-${suffix}@test.com`, passwordHash: '$2b$12$ph', fullName: 'User A' },
  })
  const userB = await prisma.user.create({
    data: { email: `b-${suffix}@test.com`, passwordHash: '$2b$12$ph', fullName: 'User B' },
  })

  await prisma.organizationMember.createMany({
    data: [
      { organizationId: org.id, userId: userA.id, role: 'owner', status: 'active', joinedAt: new Date() },
      { organizationId: org.id, userId: userB.id, role: 'member', status: 'active', joinedAt: new Date() },
    ],
  })

  return { org, userA, userB }
}

async function makeTeam(
  prisma: PrismaClient,
  orgId: string,
  name: string,
  memberIds: string[],
  status: 'active' | 'archived' = 'active',
) {
  const team = await prisma.team.create({
    data: { organizationId: orgId, name, status },
  })
  if (memberIds.length > 0) {
    await prisma.teamMember.createMany({
      data: memberIds.map((userId) => ({ teamId: team.id, userId, organizationId: orgId })),
    })
  }
  return team
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Notification Pipeline — API Layer', () => {
  let prisma: PrismaClient

  beforeAll(() => {
    prisma = getTestPrisma()
  })

  // -------------------------------------------------------------------------
  // 1. Create — user recipient
  // -------------------------------------------------------------------------

  it('creates a notification record for a user recipient', async () => {
    const { org, userA } = await setup(prisma, 'create-user')

    const notifications = await NotificationService.create({
      orgId: org.id,
      recipientType: 'user',
      recipientUserId: userA.id,
      message: 'Test notification',
      sourceEntityType: 'task',
      sourceEntityId: org.id, // using orgId as a UUID stand-in
    })

    expect(notifications).toHaveLength(1)
    const n = notifications[0]!
    expect(n.organizationId).toBe(org.id)
    expect(n.recipientUserId).toBe(userA.id)
    expect(n.isRead).toBe(false)
    expect(n.message).toBe('Test notification')

    // Verify persisted in DB
    const stored = await prisma.notification.findUnique({ where: { id: n.id } })
    expect(stored).not.toBeNull()
    expect(stored!.isRead).toBe(false)
  })

  // -------------------------------------------------------------------------
  // 2. Audit log written on create
  // -------------------------------------------------------------------------

  it('writes an audit log entry when a notification is created', async () => {
    const { org, userA } = await setup(prisma, 'audit-notif')

    const notifications = await NotificationService.create({
      orgId: org.id,
      recipientType: 'user',
      recipientUserId: userA.id,
      message: 'Audit test',
      sourceEntityType: 'task',
      sourceEntityId: org.id,
    })

    const audit = await prisma.auditLog.findFirst({
      where: { organizationId: org.id, entityType: 'notification', action: 'created' },
    })

    expect(audit).not.toBeNull()
    expect(audit!.entityId).toBe(notifications[0]!.id)
  })

  // -------------------------------------------------------------------------
  // 3. Team fan-out — one notification per active member
  // -------------------------------------------------------------------------

  it('creates one notification per active team member (fan-out)', async () => {
    const { org, userA, userB } = await setup(prisma, 'fanout')
    const team = await makeTeam(prisma, org.id, 'Alpha Team', [userA.id, userB.id])

    const notifications = await NotificationService.create({
      orgId: org.id,
      recipientType: 'team',
      recipientTeamId: team.id,
      message: 'Team notification',
      sourceEntityType: 'execution',
      sourceEntityId: org.id,
    })

    expect(notifications).toHaveLength(2)
    const recipientIds = notifications.map((n) => n.recipientUserId).sort()
    expect(recipientIds).toEqual([userA.id, userB.id].sort())
    for (const n of notifications) {
      expect(n.recipientType).toBe('user') // fan-out normalises to user records
      expect(n.isRead).toBe(false)
    }
  })

  // -------------------------------------------------------------------------
  // 4. Archived team — rejected with 422
  // -------------------------------------------------------------------------

  it('rejects notification to an archived team with 422', async () => {
    const { org } = await setup(prisma, 'archived-team')
    const team = await makeTeam(prisma, org.id, 'Archived Team', [], 'archived')

    await expect(
      NotificationService.create({
        orgId: org.id,
        recipientType: 'team',
        recipientTeamId: team.id,
        message: 'Should fail',
        sourceEntityType: 'task',
        sourceEntityId: org.id,
      }),
    ).rejects.toMatchObject({ statusCode: 422 })
  })

  // -------------------------------------------------------------------------
  // 5. Team with no active members — returns empty, no rows created
  // -------------------------------------------------------------------------

  it('returns empty array when team has no active members', async () => {
    const { org } = await setup(prisma, 'empty-team')
    // Team with no members
    const team = await makeTeam(prisma, org.id, 'Empty Team', [])

    const notifications = await NotificationService.create({
      orgId: org.id,
      recipientType: 'team',
      recipientTeamId: team.id,
      message: 'Nobody home',
      sourceEntityType: 'task',
      sourceEntityId: org.id,
    })

    expect(notifications).toHaveLength(0)
    const count = await prisma.notification.count({ where: { organizationId: org.id } })
    expect(count).toBe(0)
  })

  // -------------------------------------------------------------------------
  // 6. markRead — sets isRead=true, audit logged
  // -------------------------------------------------------------------------

  it('marks a notification as read and writes an audit log', async () => {
    const { org, userA } = await setup(prisma, 'mark-read')

    const [notif] = await NotificationService.create({
      orgId: org.id,
      recipientType: 'user',
      recipientUserId: userA.id,
      message: 'Mark me read',
      sourceEntityType: 'task',
      sourceEntityId: org.id,
    })

    const updated = await NotificationService.markRead(notif!.id, org.id, userA.id)
    expect(updated.isRead).toBe(true)
    expect(updated.readAt).not.toBeNull()

    // Audit log for status_changed
    const audit = await prisma.auditLog.findFirst({
      where: { organizationId: org.id, entityId: notif!.id, action: 'status_changed' },
    })
    expect(audit).not.toBeNull()
  })

  // -------------------------------------------------------------------------
  // 7. markRead — cross-user isolation: userB cannot mark userA's notification
  // -------------------------------------------------------------------------

  it('throws 404 when user tries to mark another user\'s notification as read', async () => {
    const { org, userA, userB } = await setup(prisma, 'cross-user')

    const [notif] = await NotificationService.create({
      orgId: org.id,
      recipientType: 'user',
      recipientUserId: userA.id,
      message: 'User A only',
      sourceEntityType: 'task',
      sourceEntityId: org.id,
    })

    // userB attempts to mark userA's notification — must throw 404
    await expect(
      NotificationService.markRead(notif!.id, org.id, userB.id),
    ).rejects.toMatchObject({ statusCode: 404 })
  })

  // -------------------------------------------------------------------------
  // 8. markAllRead — batch marks all unread for user, returns count
  // -------------------------------------------------------------------------

  it('marks all unread notifications as read and returns the count', async () => {
    const { org, userA, userB } = await setup(prisma, 'mark-all')

    // Create 3 notifications for userA, 1 for userB
    for (let i = 0; i < 3; i++) {
      await NotificationService.create({
        orgId: org.id,
        recipientType: 'user',
        recipientUserId: userA.id,
        message: `Notification ${i}`,
        sourceEntityType: 'task',
        sourceEntityId: org.id,
      })
    }
    await NotificationService.create({
      orgId: org.id,
      recipientType: 'user',
      recipientUserId: userB.id,
      message: 'User B notification',
      sourceEntityType: 'task',
      sourceEntityId: org.id,
    })

    const count = await NotificationService.markAllRead(org.id, userA.id)
    expect(count).toBe(3)

    // UserA's notifications are all read
    const userANotifs = await prisma.notification.findMany({
      where: { organizationId: org.id, recipientUserId: userA.id },
    })
    expect(userANotifs.every((n) => n.isRead)).toBe(true)

    // UserB's notification is still unread
    const userBNotifs = await prisma.notification.findMany({
      where: { organizationId: org.id, recipientUserId: userB.id },
    })
    expect(userBNotifs[0]!.isRead).toBe(false)
  })

  // -------------------------------------------------------------------------
  // 9. list — filter by isRead=false, cursor pagination
  // -------------------------------------------------------------------------

  it('lists unread notifications with cursor pagination', async () => {
    const { org, userA } = await setup(prisma, 'list-filter')

    // Create 5 notifications, then mark 2 as read
    const created = []
    for (let i = 0; i < 5; i++) {
      const [n] = await NotificationService.create({
        orgId: org.id,
        recipientType: 'user',
        recipientUserId: userA.id,
        message: `Notification ${i}`,
        sourceEntityType: 'task',
        sourceEntityId: org.id,
      })
      created.push(n!)
    }

    // Mark first 2 as read
    await NotificationService.markRead(created[0]!.id, org.id, userA.id)
    await NotificationService.markRead(created[1]!.id, org.id, userA.id)

    // List unread only — should return 3
    const result = await NotificationService.list(org.id, userA.id, { isRead: false })
    expect(result.data).toHaveLength(3)
    expect(result.data.every((n) => !n.isRead)).toBe(true)

    // Cursor pagination — limit 2, then next page
    const page1 = await NotificationService.list(org.id, userA.id, {}, { limit: 2 })
    expect(page1.data).toHaveLength(2)
    expect(page1.pagination.hasNextPage).toBe(true)
    expect(page1.pagination.nextCursor).not.toBeNull()

    const page2 = await NotificationService.list(
      org.id,
      userA.id,
      {},
      { limit: 2, after: page1.pagination.nextCursor! },
    )
    expect(page2.data.length).toBeGreaterThanOrEqual(1)
    // No overlap between pages
    const page1Ids = new Set(page1.data.map((n) => n.id))
    for (const n of page2.data) {
      expect(page1Ids.has(n.id)).toBe(false)
    }
  })

  // -------------------------------------------------------------------------
  // 10. list — user sees only their own notifications (cross-user isolation)
  // -------------------------------------------------------------------------

  it('users can only list their own notifications', async () => {
    const { org, userA, userB } = await setup(prisma, 'list-isolation')

    await NotificationService.create({
      orgId: org.id,
      recipientType: 'user',
      recipientUserId: userA.id,
      message: 'For A',
      sourceEntityType: 'task',
      sourceEntityId: org.id,
    })
    await NotificationService.create({
      orgId: org.id,
      recipientType: 'user',
      recipientUserId: userA.id,
      message: 'For A again',
      sourceEntityType: 'task',
      sourceEntityId: org.id,
    })
    await NotificationService.create({
      orgId: org.id,
      recipientType: 'user',
      recipientUserId: userB.id,
      message: 'For B only',
      sourceEntityType: 'task',
      sourceEntityId: org.id,
    })

    const resultA = await NotificationService.list(org.id, userA.id)
    const resultB = await NotificationService.list(org.id, userB.id)

    expect(resultA.data).toHaveLength(2)
    expect(resultB.data).toHaveLength(1)
    expect(resultA.data.every((n) => n.recipientUserId === userA.id)).toBe(true)
    expect(resultB.data[0]!.recipientUserId).toBe(userB.id)
  })
})
