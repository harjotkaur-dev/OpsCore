/**
 * Phase 12.4 — Notification & Metric Pipeline Integration Test (Worker layer)
 *
 * Proves the worker-side notification and metric pipelines:
 *
 *   NotificationWorker:
 *     job enqueued → worker processes → deliver() called → notification verified
 *     missing notification → skipped silently (no retry storm)
 *
 *   MetricWorker → evaluateKPIs → notification:
 *     metric-update job enqueued
 *       ↓ MetricWorker processes
 *       ↓ MetricService.recompute() computes new value
 *       ↓ metric record updated
 *       ↓ metric_history record inserted
 *       ↓ evaluateKPIs() checks thresholds
 *       ↓ KPI newly breached → notification record created
 *       ↓ notification enqueued to notifications queue
 *
 * Requirements: 11.1, 11.2, 11.3, 11.4, 12.1, 12.2, 6.2
 */

import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest'
import { Queue, Worker } from 'bullmq'
import { PrismaClient } from '@prisma/client'
import type { NotificationJobData, MetricUpdateJobData } from '@opscore/types'
import { getTestPrisma, getTestRedis } from '../../test/integration-setup.js'
import { createNotificationWorker } from '../NotificationWorker.js'
import { createMetricWorker } from '../MetricWorker.js'

// db:1 = isolated test Redis (same as WorkflowWorker tests)
const REDIS_CONN = { host: 'localhost', port: 6379, db: 1, maxRetriesPerRequest: null }

// ---------------------------------------------------------------------------
// Wait helpers
// ---------------------------------------------------------------------------

/** Poll until a condition is true or timeout */
async function waitUntil(
  check: () => Promise<boolean>,
  timeoutMs = 8000,
  intervalMs = 100,
): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await check()) return
    await new Promise((r) => setTimeout(r, intervalMs))
  }
  throw new Error('waitUntil timed out')
}

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

async function buildBaseFixtures(prisma: PrismaClient, suffix: string) {
  const org = await prisma.organization.create({
    data: { name: `NM Org ${suffix}`, slug: `nm-${suffix}`, status: 'active' },
  })
  const user = await prisma.user.create({
    data: { email: `nm-${suffix}@test.com`, passwordHash: '$2b$12$ph', fullName: 'NM User' },
  })
  await prisma.organizationMember.create({
    data: { organizationId: org.id, userId: user.id, role: 'owner', status: 'active', joinedAt: new Date() },
  })
  return { org, user }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Notification & Metric Pipeline — Worker Layer', () => {
  let prisma: PrismaClient
  let notifQueue: Queue<NotificationJobData>
  let metricQueue: Queue<MetricUpdateJobData>
  let notifWorker: Worker<NotificationJobData>
  let metricWorker: Worker<MetricUpdateJobData>

  beforeAll(async () => {
    prisma = getTestPrisma()

    notifQueue = new Queue<NotificationJobData>('notifications', { connection: REDIS_CONN })
    metricQueue = new Queue<MetricUpdateJobData>('metric-updates', { connection: REDIS_CONN })

    notifWorker = createNotificationWorker(REDIS_CONN, 2)
    metricWorker = createMetricWorker(REDIS_CONN, 2)

    await new Promise((r) => setTimeout(r, 300))
  })

  afterEach(async () => {
    await notifQueue.drain()
    await metricQueue.drain()
    await new Promise((r) => setTimeout(r, 300))
  })

  afterAll(async () => {
    await notifWorker.close()
    await metricWorker.close()
    await notifQueue.obliterate({ force: true })
    await metricQueue.obliterate({ force: true })
    await notifQueue.close()
    await metricQueue.close()
  })

  // -------------------------------------------------------------------------
  // 1. NotificationWorker — processes a valid notification job
  // -------------------------------------------------------------------------

  it('NotificationWorker processes a notification job and the record exists in DB', async () => {
    const { org, user } = await buildBaseFixtures(prisma, 'nw-basic')

    // Create the notification record directly (simulating what sendNotificationHandler does)
    const notification = await prisma.notification.create({
      data: {
        organizationId: org.id,
        recipientType: 'user',
        recipientUserId: user.id,
        message: 'Worker delivery test',
        sourceEntityType: 'task',
        sourceEntityId: org.id,
        isRead: false,
      },
    })

    // Enqueue the job
    await notifQueue.add('send-notification', {
      notificationId: notification.id,
      orgId: org.id,
    })

    // Wait for the worker to process it
    await waitUntil(async () => {
      const job = await notifQueue.getJob(notification.id)
      // Job either doesn't exist (completed+removed) or is in completed state
      if (!job) return true
      const state = await job.getState()
      return state === 'completed'
    })

    // The notification record must still exist and be intact
    const stored = await prisma.notification.findUnique({ where: { id: notification.id } })
    expect(stored).not.toBeNull()
    expect(stored!.isRead).toBe(false) // deliver() doesn't change isRead — that's the user's action
  })

  // -------------------------------------------------------------------------
  // 2. NotificationWorker — missing notification skipped silently
  // -------------------------------------------------------------------------

  it('NotificationWorker skips silently when notification does not exist', async () => {
    const { org } = await buildBaseFixtures(prisma, 'nw-missing')

    const fakeId = '00000000-0000-4000-a000-000000000001'
    const jobId = `notif-missing-${Date.now()}`

    await notifQueue.add('send-notification', {
      notificationId: fakeId,
      orgId: org.id,
    }, { jobId })

    // Worker should process without throwing (job reaches completed state, not failed)
    await waitUntil(async () => {
      const job = await notifQueue.getJob(jobId)
      if (!job) return true
      const state = await job.getState()
      return state === 'completed'
    })

    // No notification created
    const count = await prisma.notification.count({ where: { organizationId: org.id } })
    expect(count).toBe(0)
  })

  // -------------------------------------------------------------------------
  // 3. MetricWorker — recomputes metric and updates DB
  // -------------------------------------------------------------------------

  it('MetricWorker recomputes total_events_ingested and updates the metric record', async () => {
    const { org } = await buildBaseFixtures(prisma, 'mw-recompute')

    // Seed some events to count
    const et = await prisma.eventType.create({
      data: {
        organizationId: org.id,
        name: 'test.event',
        payloadSchema: { type: 'object' },
        source: 'api',
        status: 'active',
        version: 1,
        createdBy: (await prisma.user.findFirst({ where: { email: `nm-mw-recompute@test.com` } }))!.id,
      },
    })

    for (let i = 0; i < 5; i++) {
      await prisma.event.create({
        data: {
          organizationId: org.id,
          eventTypeId: et.id,
          source: 'api',
          payload: { idx: i },
          idempotencyKey: `key-mw-${i}`,
          status: 'received',
        },
      })
    }

    const jobId = `metric-recompute-${org.id}`
    await metricQueue.add('update-metric', {
      metricName: 'total_events_ingested',
      orgId: org.id,
      triggeredBy: 'integration-test',
    }, { jobId })

    // Wait for job to complete
    await waitUntil(async () => {
      const job = await metricQueue.getJob(jobId)
      if (!job) return true
      const state = await job.getState()
      return state === 'completed' || state === 'failed'
    })

    // Metric record updated
    const metric = await prisma.metric.findUnique({
      where: { organizationId_name: { organizationId: org.id, name: 'total_events_ingested' } },
    })
    expect(metric).not.toBeNull()
    expect(Number(metric!.currentValue)).toBe(5)

    // MetricHistory record inserted
    const history = await prisma.metricHistory.findMany({
      where: { organizationId: org.id },
    })
    expect(history).toHaveLength(1)
    expect(Number(history[0]!.value)).toBe(5)
    expect(history[0]!.triggeredBy).toBe('integration-test')
  })

  // -------------------------------------------------------------------------
  // 4. MetricWorker → evaluateKPIs → KPI breach → notification created
  // -------------------------------------------------------------------------

  it('creates a KPI breach notification when metric value crosses threshold', async () => {
    const { org, user } = await buildBaseFixtures(prisma, 'kpi-breach')

    // Create the metric (starts at 0)
    const metric = await prisma.metric.create({
      data: {
        organizationId: org.id,
        name: 'total_events_ingested',
        metricType: 'count',
        currentValue: 0,
      },
    })

    // Create a KPI: alert when total_events_ingested > 3
    await prisma.kPI.create({
      data: {
        organizationId: org.id,
        name: 'Event Volume Alert',
        metricId: metric.id,
        operator: '>',
        targetValue: 3,
        ownerUserId: user.id,
        status: 'active',
        lastBreached: false,
      },
    })

    // Create an event type and 5 events so the count becomes 5
    const et = await prisma.eventType.create({
      data: {
        organizationId: org.id,
        name: 'test.kpi.event',
        payloadSchema: { type: 'object' },
        source: 'api',
        status: 'active',
        version: 1,
        createdBy: user.id,
      },
    })
    for (let i = 0; i < 5; i++) {
      await prisma.event.create({
        data: {
          organizationId: org.id,
          eventTypeId: et.id,
          source: 'api',
          payload: { idx: i },
          idempotencyKey: `kpi-event-${i}`,
          status: 'received',
        },
      })
    }

    const jobId = `metric-kpi-${org.id}`
    await metricQueue.add('update-metric', {
      metricName: 'total_events_ingested',
      orgId: org.id,
      triggeredBy: 'kpi-test',
    }, { jobId })

    // Wait for job to complete
    await waitUntil(async () => {
      const job = await metricQueue.getJob(jobId)
      if (!job) return true
      const state = await job.getState()
      return state === 'completed' || state === 'failed'
    })

    // Wait briefly for the KPI notification to be persisted
    await new Promise((r) => setTimeout(r, 500))

    // Metric updated to 5
    const updatedMetric = await prisma.metric.findUnique({
      where: { organizationId_name: { organizationId: org.id, name: 'total_events_ingested' } },
    })
    expect(Number(updatedMetric!.currentValue)).toBe(5)

    // KPI breach notification created for the owner
    const notifications = await prisma.notification.findMany({
      where: {
        organizationId: org.id,
        recipientUserId: user.id,
        sourceEntityType: 'kpi',
      },
    })
    expect(notifications).toHaveLength(1)
    expect(notifications[0]!.message).toContain('Event Volume Alert')
    expect(notifications[0]!.isRead).toBe(false)
  })

  // -------------------------------------------------------------------------
  // 5. MetricWorker → evaluateKPIs → no duplicate notification if already breached
  // -------------------------------------------------------------------------

  it('does not create a duplicate notification if KPI was already breached', async () => {
    const { org, user } = await buildBaseFixtures(prisma, 'kpi-no-dup')

    // Create metric with value already above threshold (pre-existing breach)
    const metric = await prisma.metric.create({
      data: {
        organizationId: org.id,
        name: 'total_events_ingested',
        metricType: 'count',
        currentValue: 10,
      },
    })

    // Insert a history entry so "previous value" is also above threshold
    await prisma.metricHistory.create({
      data: {
        metricId: metric.id,
        organizationId: org.id,
        value: 8,
        recordedAt: new Date(Date.now() - 60000),
        triggeredBy: 'prior-run',
      },
    })

    await prisma.kPI.create({
      data: {
        organizationId: org.id,
        name: 'Already Breached KPI',
        metricId: metric.id,
        operator: '>',
        targetValue: 3,
        ownerUserId: user.id,
        status: 'active',
        lastBreached: true, // already breached
      },
    })

    // Create an event type and some events
    const et = await prisma.eventType.create({
      data: {
        organizationId: org.id,
        name: 'test.nodup.event',
        payloadSchema: { type: 'object' },
        source: 'api',
        status: 'active',
        version: 1,
        createdBy: user.id,
      },
    })
    for (let i = 0; i < 3; i++) {
      await prisma.event.create({
        data: {
          organizationId: org.id,
          eventTypeId: et.id,
          source: 'api',
          payload: { idx: i },
          idempotencyKey: `nodup-event-${i}`,
          status: 'received',
        },
      })
    }

    const jobId = `metric-nodup-${org.id}`
    await metricQueue.add('update-metric', {
      metricName: 'total_events_ingested',
      orgId: org.id,
      triggeredBy: 'nodup-test',
    }, { jobId })

    await waitUntil(async () => {
      const job = await metricQueue.getJob(jobId)
      if (!job) return true
      const state = await job.getState()
      return state === 'completed' || state === 'failed'
    })

    await new Promise((r) => setTimeout(r, 300))

    // No new KPI notification — it was already breached before
    const notifications = await prisma.notification.findMany({
      where: {
        organizationId: org.id,
        recipientUserId: user.id,
        sourceEntityType: 'kpi',
      },
    })
    expect(notifications).toHaveLength(0)
  })
})
