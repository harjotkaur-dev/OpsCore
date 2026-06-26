/**
 * Phase 12.2 — Event Pipeline Integration Test
 *
 * Proves the full event ingestion pipeline against a real PostgreSQL database
 * and real Redis instance (DB 1):
 *
 *   POST event
 *     ↓ event record persisted
 *     ↓ audit log written
 *     ↓ idempotency key marked completed
 *     ↓ active workflow versions matched by triggerEventTypeId
 *     ↓ rules evaluated against payload
 *     ↓ execution record created (status='queued')
 *     ↓ BullMQ job enqueued on workflow-exec queue
 *
 * This validates: Event Hub + Workflow Engine + Execution Engine in one pass.
 *
 * Requires:
 *   - TEST_DATABASE_URL pointing at opscore_test
 *   - Redis running on localhost:6379 (DB 1 is flushed between tests)
 */

import { describe, it, expect, beforeAll } from 'vitest'
import { PrismaClient } from '@prisma/client'
import Redis from 'ioredis'
import { Queue } from 'bullmq'
import { getTestPrisma, getTestRedis } from '../../test/integration-setup.js'

// ---------------------------------------------------------------------------
// Module imports — loaded AFTER env vars are set by integration-setup.ts
// ---------------------------------------------------------------------------
// Dynamic imports ensure modules pick up the TEST_DATABASE_URL set in setup
const { EventService } = await import('../EventService.js')
const { ExecutionService } = await import('../ExecutionService.js')

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function createOrg(prisma: PrismaClient, slug: string) {
  return prisma.organization.create({
    data: { name: `Test Org ${slug}`, slug, status: 'active' },
  })
}

async function createUser(prisma: PrismaClient, email: string) {
  return prisma.user.create({
    data: {
      email,
      passwordHash: '$2b$12$placeholder',
      fullName: 'Test User',
    },
  })
}

async function joinOrg(
  prisma: PrismaClient,
  orgId: string,
  userId: string,
  role = 'owner',
) {
  return prisma.organizationMember.create({
    data: { organizationId: orgId, userId, role, status: 'active', joinedAt: new Date() },
  })
}

async function createEventType(
  prisma: PrismaClient,
  orgId: string,
  userId: string,
  name: string,
) {
  return prisma.eventType.create({
    data: {
      organizationId: orgId,
      name,
      description: `Integration test event type: ${name}`,
      payloadSchema: {
        $schema: 'http://json-schema.org/draft-07/schema#',
        type: 'object',
        required: ['orderId', 'amount'],
        properties: {
          orderId: { type: 'string' },
          amount: { type: 'number', minimum: 0 },
        },
        additionalProperties: true,
      },
      source: 'api',
      status: 'active',
      version: 1,
      createdBy: userId,
    },
  })
}

async function createActiveWorkflow(
  prisma: PrismaClient,
  orgId: string,
  userId: string,
  triggerEventTypeId: string,
  rules: Array<{ id: string; expression: string }> = [],
) {
  const wf = await prisma.workflow.create({
    data: {
      organizationId: orgId,
      name: 'Integration Test Workflow',
      description: 'Created by integration test',
      status: 'active',
      createdBy: userId,
    },
  })

  const version = await prisma.workflowVersion.create({
    data: {
      workflowId: wf.id,
      organizationId: orgId,
      version: 1,
      status: 'published',
      createdBy: userId,
      definition: {
        triggerEventTypeId,
        rules,
        actions: [
          {
            id: 'action-1',
            type: 'create_task',
            orderIndex: 0,
            config: { title_template: 'Handle order {{event.payload.orderId}}', priority: 'high' },
          },
        ],
      },
    },
  })

  await prisma.workflow.update({
    where: { id: wf.id },
    data: { currentVersionId: version.id },
  })

  return { workflow: wf, version }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Event Pipeline Integration', () => {
  let prisma: PrismaClient
  let redis: Redis
  let orgId: string
  let userId: string
  let eventTypeId: string

  beforeAll(async () => {
    prisma = getTestPrisma()
    redis = getTestRedis()
  })

  // Per-test setup — each test gets a fresh org + user + event type
  async function setupFixtures(suffix: string) {
    const org = await createOrg(prisma, `test-org-${suffix}`)
    const user = await createUser(prisma, `user-${suffix}@test.com`)
    await joinOrg(prisma, org.id, user.id)
    const et = await createEventType(prisma, org.id, user.id, `order.created.${suffix}`)
    return { orgId: org.id, userId: user.id, eventTypeId: et.id }
  }

  // ---------------------------------------------------------------------------
  // 1. Event persistence
  // ---------------------------------------------------------------------------

  it('persists an event record with status=received', async () => {
    const fixtures = await setupFixtures('persist')
    const payload = { orderId: 'ORD-001', amount: 99.99 }

    const event = await EventService.ingest(
      fixtures.orgId,
      { eventTypeId: fixtures.eventTypeId, source: 'api', payload },
      { requestId: 'req-persist-001' },
    )

    // Event record must exist in DB
    const stored = await prisma.event.findUnique({ where: { id: event.id } })
    expect(stored).not.toBeNull()
    expect(stored!.organizationId).toBe(fixtures.orgId)
    expect(stored!.eventTypeId).toBe(fixtures.eventTypeId)
    expect(stored!.status).toBe('received')
    expect(stored!.source).toBe('api')
    expect(stored!.payload).toMatchObject(payload)
  })

  // ---------------------------------------------------------------------------
  // 2. Audit log
  // ---------------------------------------------------------------------------

  it('writes an audit log entry for the ingested event', async () => {
    const fixtures = await setupFixtures('audit')
    const payload = { orderId: 'ORD-002', amount: 150.0 }

    const event = await EventService.ingest(
      fixtures.orgId,
      { eventTypeId: fixtures.eventTypeId, source: 'api', payload },
      { requestId: 'req-audit-001' },
    )

    const audit = await prisma.auditLog.findFirst({
      where: { organizationId: fixtures.orgId, entityId: event.id, entityType: 'event' },
    })

    expect(audit).not.toBeNull()
    expect(audit!.action).toBe('created')
    expect(audit!.requestId).toBe('req-audit-001')
  })

  // ---------------------------------------------------------------------------
  // 3. Idempotency — duplicate key returns same event, no second DB record
  // ---------------------------------------------------------------------------

  it('returns the original event on duplicate idempotency key without creating a second record', async () => {
    const fixtures = await setupFixtures('idemp')
    const payload = { orderId: 'ORD-003', amount: 250.0 }
    const key = 'client-key-unique-abc'

    const first = await EventService.ingest(
      fixtures.orgId,
      { eventTypeId: fixtures.eventTypeId, source: 'api', payload, idempotencyKey: key },
    )

    const second = await EventService.ingest(
      fixtures.orgId,
      { eventTypeId: fixtures.eventTypeId, source: 'api', payload, idempotencyKey: key },
    )

    expect(second.id).toBe(first.id)

    // Only one event record
    const count = await prisma.event.count({
      where: { organizationId: fixtures.orgId, idempotencyKey: key },
    })
    expect(count).toBe(1)
  })

  // ---------------------------------------------------------------------------
  // 4. No workflow match — no execution created
  // ---------------------------------------------------------------------------

  it('does not create an execution record when no active workflow matches the event type', async () => {
    const fixtures = await setupFixtures('nomatch')
    const payload = { orderId: 'ORD-010', amount: 10.0 }

    // No workflow registered for this org/eventType

    await EventService.ingest(
      fixtures.orgId,
      { eventTypeId: fixtures.eventTypeId, source: 'api', payload },
    )

    const executions = await prisma.execution.findMany({
      where: { organizationId: fixtures.orgId },
    })
    expect(executions).toHaveLength(0)
  })

  // ---------------------------------------------------------------------------
  // 5. Workflow match — execution record created
  // ---------------------------------------------------------------------------

  it('creates an execution record with status=queued when a matching active workflow exists', async () => {
    const fixtures = await setupFixtures('match')
    await createActiveWorkflow(prisma, fixtures.orgId, fixtures.userId, fixtures.eventTypeId)

    const payload = { orderId: 'ORD-020', amount: 500.0 }

    await EventService.ingest(
      fixtures.orgId,
      { eventTypeId: fixtures.eventTypeId, source: 'api', payload },
      { requestId: 'req-match-001' },
    )

    const executions = await prisma.execution.findMany({
      where: { organizationId: fixtures.orgId },
    })
    expect(executions).toHaveLength(1)
    expect(executions[0]!.status).toBe('queued')
    expect(executions[0]!.organizationId).toBe(fixtures.orgId)
  })

  // ---------------------------------------------------------------------------
  // 6. BullMQ job enqueued
  // ---------------------------------------------------------------------------

  it('enqueues a BullMQ job on the workflow-exec queue when a workflow matches', async () => {
    const fixtures = await setupFixtures('queue')
    await createActiveWorkflow(
      prisma,
      fixtures.orgId,
      fixtures.userId,
      fixtures.eventTypeId,
    )

    const payload = { orderId: 'ORD-030', amount: 999.0 }

    await EventService.ingest(
      fixtures.orgId,
      { eventTypeId: fixtures.eventTypeId, source: 'api', payload },
    )

    // Verify the execution record was created with a non-empty jobId
    const execution = await prisma.execution.findFirst({
      where: { organizationId: fixtures.orgId },
    })
    expect(execution).not.toBeNull()
    expect(execution!.jobId).toBeTruthy()
    expect(execution!.jobId).toBe(execution!.id) // jobId === executionId by convention

    // Verify the BullMQ job exists — queue uses the same Redis DB as the API
    const queue = new Queue('workflow-exec', {
      connection: { host: 'localhost', port: 6379 }, // same db as API (default db 0)
    })
    const job = await queue.getJob(execution!.id)
    await queue.close()

    expect(job).not.toBeNull()
    expect(job!.data.executionId).toBe(execution!.id)
    expect(job!.data.orgId).toBe(fixtures.orgId)
  })

  // ---------------------------------------------------------------------------
  // 7. Rule filtering — workflow with failing rule does not trigger execution
  // ---------------------------------------------------------------------------

  it('does not enqueue an execution when workflow rule evaluates to false', async () => {
    const fixtures = await setupFixtures('rule-fail')
    // Rule: amount > 1000 — our payload has amount=50, so rule fails
    await createActiveWorkflow(
      prisma,
      fixtures.orgId,
      fixtures.userId,
      fixtures.eventTypeId,
      [{ id: 'r1', expression: 'event.payload.amount > 1000' }],
    )

    const payload = { orderId: 'ORD-040', amount: 50 }

    await EventService.ingest(
      fixtures.orgId,
      { eventTypeId: fixtures.eventTypeId, source: 'api', payload },
    )

    const executions = await prisma.execution.findMany({
      where: { organizationId: fixtures.orgId },
    })
    expect(executions).toHaveLength(0)
  })

  // ---------------------------------------------------------------------------
  // 8. Rule filtering — workflow with passing rule triggers execution
  // ---------------------------------------------------------------------------

  it('enqueues an execution when workflow rule evaluates to true', async () => {
    const fixtures = await setupFixtures('rule-pass')
    // Rule: amount > 100 — our payload has amount=500, so rule passes
    await createActiveWorkflow(
      prisma,
      fixtures.orgId,
      fixtures.userId,
      fixtures.eventTypeId,
      [{ id: 'r1', expression: 'event.payload.amount > 100' }],
    )

    const payload = { orderId: 'ORD-050', amount: 500 }

    await EventService.ingest(
      fixtures.orgId,
      { eventTypeId: fixtures.eventTypeId, source: 'api', payload },
    )

    const executions = await prisma.execution.findMany({
      where: { organizationId: fixtures.orgId },
    })
    expect(executions).toHaveLength(1)
    expect(executions[0]!.status).toBe('queued')
  })

  // ---------------------------------------------------------------------------
  // 9. Multi-workflow fan-out — N matching workflows → N executions
  // ---------------------------------------------------------------------------

  it('creates one execution per matching active workflow (fan-out)', async () => {
    const fixtures = await setupFixtures('fanout')

    // Register 3 workflows all triggered by the same event type
    await createActiveWorkflow(prisma, fixtures.orgId, fixtures.userId, fixtures.eventTypeId)
    await createActiveWorkflow(prisma, fixtures.orgId, fixtures.userId, fixtures.eventTypeId)
    await createActiveWorkflow(prisma, fixtures.orgId, fixtures.userId, fixtures.eventTypeId)

    // Need unique workflow names — patch names to avoid collision
    const workflows = await prisma.workflow.findMany({ where: { organizationId: fixtures.orgId } })
    for (let i = 0; i < workflows.length; i++) {
      await prisma.workflow.update({
        where: { id: workflows[i]!.id },
        data: { name: `Workflow ${i + 1}` },
      })
    }

    const payload = { orderId: 'ORD-060', amount: 200 }

    await EventService.ingest(
      fixtures.orgId,
      { eventTypeId: fixtures.eventTypeId, source: 'api', payload },
    )

    const executions = await prisma.execution.findMany({
      where: { organizationId: fixtures.orgId },
    })
    expect(executions).toHaveLength(3)
    for (const ex of executions) {
      expect(ex.status).toBe('queued')
    }
  })

  // ---------------------------------------------------------------------------
  // 10. Deprecated event type rejects ingestion with 422
  // ---------------------------------------------------------------------------

  it('rejects ingestion for a deprecated event type with 422', async () => {
    const fixtures = await setupFixtures('deprecated')

    // Deprecate the event type
    await prisma.eventType.update({
      where: { id: fixtures.eventTypeId },
      data: { status: 'deprecated' },
    })

    const payload = { orderId: 'ORD-070', amount: 75 }

    await expect(
      EventService.ingest(
        fixtures.orgId,
        { eventTypeId: fixtures.eventTypeId, source: 'api', payload },
      ),
    ).rejects.toMatchObject({ statusCode: 422 })
  })

  // ---------------------------------------------------------------------------
  // 11. Schema validation — invalid payload rejects with 422
  // ---------------------------------------------------------------------------

  it('rejects ingestion when payload fails JSON Schema validation', async () => {
    const fixtures = await setupFixtures('schema-fail')

    // Missing required field 'amount', wrong type for 'orderId'
    const invalidPayload = { orderId: 123 } // orderId should be string, amount missing

    await expect(
      EventService.ingest(
        fixtures.orgId,
        { eventTypeId: fixtures.eventTypeId, source: 'api', payload: invalidPayload },
      ),
    ).rejects.toMatchObject({ statusCode: 422 })
  })
})
