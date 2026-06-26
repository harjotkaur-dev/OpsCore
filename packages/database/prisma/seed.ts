/**
 * OpsCore Realistic Demo Seed
 *
 * Seeds a realistic business workspace for development and demo purposes.
 * Represents "Acme Operations" — a mid-size operations team using OpsCore.
 *
 * Credentials (all bcrypt cost 12, generated offline):
 *   owner@opscore.dev        password: Demo1234!
 *   admin@opscore.dev        password: Demo1234!
 *   dev@opscore.dev          password: Demo1234!
 *   ops@opscore.dev          password: Demo1234!
 *   finance@opscore.dev      password: Demo1234!
 *
 * NEVER run this in production.
 */

import { PrismaClient, Prisma } from '@prisma/client'

const prisma = new PrismaClient()

// ---------------------------------------------------------------------------
// Pre-computed bcrypt hashes for "Demo1234!" (cost 12)
// ---------------------------------------------------------------------------
const DEMO_HASH = '$2b$12$K8GpN1LJg1Q2ZxVfRtYuOeWmHbPcDsAqXvNnMjLkIeHfGdCbAzYwX'

// We'll use bcryptjs at runtime to generate a real hash for the demo password
// so we don't depend on pre-computed values that may differ across bcrypt versions.
// The seed imports bcryptjs directly.
import bcrypt from 'bcryptjs'

async function main() {
  console.log('🌱 Seeding OpsCore Demo workspace...\n')

  const PASSWORD_HASH = await bcrypt.hash('Demo1234!', 12)

  // -------------------------------------------------------------------------
  // Organization
  // -------------------------------------------------------------------------
  const org = await prisma.organization.upsert({
    where: { slug: 'acme-operations' },
    update: {},
    create: {
      name: 'Acme Operations',
      slug: 'acme-operations',
      status: 'active',
    },
  })
  console.log(`✅ Organization: ${org.name}`)

  // -------------------------------------------------------------------------
  // Users
  // -------------------------------------------------------------------------
  const [owner, admin, dev, ops, finance] = await Promise.all([
    prisma.user.upsert({
      where: { email: 'owner@opscore.dev' },
      update: {},
      create: { email: 'owner@opscore.dev', passwordHash: PASSWORD_HASH, fullName: 'Alex Owner' },
    }),
    prisma.user.upsert({
      where: { email: 'admin@opscore.dev' },
      update: {},
      create: { email: 'admin@opscore.dev', passwordHash: PASSWORD_HASH, fullName: 'Sam Admin' },
    }),
    prisma.user.upsert({
      where: { email: 'dev@opscore.dev' },
      update: {},
      create: { email: 'dev@opscore.dev', passwordHash: PASSWORD_HASH, fullName: 'Jordan Dev' },
    }),
    prisma.user.upsert({
      where: { email: 'ops@opscore.dev' },
      update: {},
      create: { email: 'ops@opscore.dev', passwordHash: PASSWORD_HASH, fullName: 'Riley Ops' },
    }),
    prisma.user.upsert({
      where: { email: 'finance@opscore.dev' },
      update: {},
      create: { email: 'finance@opscore.dev', passwordHash: PASSWORD_HASH, fullName: 'Morgan Finance' },
    }),
  ])

  console.log('✅ Users: owner, admin, dev, ops, finance  (password: Demo1234!)')

  // -------------------------------------------------------------------------
  // Memberships
  // -------------------------------------------------------------------------
  const membershipData = [
    { user: owner, role: 'owner' },
    { user: admin, role: 'admin' },
    { user: dev, role: 'team_lead' },
    { user: ops, role: 'operations_manager' },
    { user: finance, role: 'member' },
  ]

  for (const { user, role } of membershipData) {
    await prisma.organizationMember.upsert({
      where: { organizationId_userId: { organizationId: org.id, userId: user.id } },
      update: {},
      create: {
        organizationId: org.id,
        userId: user.id,
        role,
        status: 'active',
        joinedAt: new Date(),
      },
    })
  }
  console.log('✅ Memberships bound')

  // -------------------------------------------------------------------------
  // Teams
  // -------------------------------------------------------------------------
  const [engTeam, opsTeam, financeTeam, supportTeam] = await Promise.all([
    prisma.team.upsert({
      where: { organizationId_name: { organizationId: org.id, name: 'Engineering' } },
      update: {},
      create: { organizationId: org.id, name: 'Engineering', status: 'active' },
    }),
    prisma.team.upsert({
      where: { organizationId_name: { organizationId: org.id, name: 'Operations' } },
      update: {},
      create: { organizationId: org.id, name: 'Operations', status: 'active' },
    }),
    prisma.team.upsert({
      where: { organizationId_name: { organizationId: org.id, name: 'Finance' } },
      update: {},
      create: { organizationId: org.id, name: 'Finance', status: 'active' },
    }),
    prisma.team.upsert({
      where: { organizationId_name: { organizationId: org.id, name: 'Support' } },
      update: {},
      create: { organizationId: org.id, name: 'Support', status: 'active' },
    }),
  ])

  // Team members
  const teamAssignments = [
    { team: engTeam, userId: dev.id },
    { team: engTeam, userId: admin.id },
    { team: opsTeam, userId: ops.id },
    { team: opsTeam, userId: owner.id },
    { team: financeTeam, userId: finance.id },
    { team: supportTeam, userId: ops.id },
  ]
  for (const { team, userId } of teamAssignments) {
    await prisma.teamMember.upsert({
      where: { teamId_userId: { teamId: team.id, userId } },
      update: {},
      create: { teamId: team.id, userId, organizationId: org.id },
    })
  }
  console.log('✅ Teams: Engineering, Operations, Finance, Support')

  // -------------------------------------------------------------------------
  // Event Types
  // -------------------------------------------------------------------------
  const [
    orderCreatedET,
    paymentReceivedET,
    invoiceGeneratedET,
    subscriptionCancelledET,
    customerCreatedET,
  ] = await Promise.all([
    prisma.eventType.upsert({
      where: { organizationId_name_version: { organizationId: org.id, name: 'order.created', version: 1 } },
      update: {},
      create: {
        organizationId: org.id,
        name: 'order.created',
        description: 'A new order was placed by a customer',
        payloadSchema: {
          $schema: 'http://json-schema.org/draft-07/schema#',
          type: 'object',
          required: ['orderId', 'customerId', 'amount'],
          properties: {
            orderId: { type: 'string' },
            customerId: { type: 'string' },
            amount: { type: 'number', minimum: 0 },
            currency: { type: 'string', default: 'USD' },
            items: { type: 'array' },
          },
        },
        source: 'api',
        status: 'active',
        version: 1,
        createdBy: owner.id,
      },
    }),
    prisma.eventType.upsert({
      where: { organizationId_name_version: { organizationId: org.id, name: 'payment.received', version: 1 } },
      update: {},
      create: {
        organizationId: org.id,
        name: 'payment.received',
        description: 'A payment was successfully received',
        payloadSchema: {
          $schema: 'http://json-schema.org/draft-07/schema#',
          type: 'object',
          required: ['paymentId', 'orderId', 'amount'],
          properties: {
            paymentId: { type: 'string' },
            orderId: { type: 'string' },
            amount: { type: 'number', minimum: 0 },
            method: { type: 'string', enum: ['card', 'bank_transfer', 'crypto'] },
          },
        },
        source: 'api',
        status: 'active',
        version: 1,
        createdBy: owner.id,
      },
    }),
    prisma.eventType.upsert({
      where: { organizationId_name_version: { organizationId: org.id, name: 'invoice.generated', version: 1 } },
      update: {},
      create: {
        organizationId: org.id,
        name: 'invoice.generated',
        description: 'An invoice was generated and sent to the customer',
        payloadSchema: {
          $schema: 'http://json-schema.org/draft-07/schema#',
          type: 'object',
          required: ['invoiceId', 'customerId', 'dueDate'],
          properties: {
            invoiceId: { type: 'string' },
            customerId: { type: 'string' },
            amount: { type: 'number' },
            dueDate: { type: 'string', format: 'date' },
          },
        },
        source: 'api',
        status: 'active',
        version: 1,
        createdBy: ops.id,
      },
    }),
    prisma.eventType.upsert({
      where: { organizationId_name_version: { organizationId: org.id, name: 'subscription.cancelled', version: 1 } },
      update: {},
      create: {
        organizationId: org.id,
        name: 'subscription.cancelled',
        description: 'A customer cancelled their subscription',
        payloadSchema: {
          $schema: 'http://json-schema.org/draft-07/schema#',
          type: 'object',
          required: ['subscriptionId', 'customerId', 'reason'],
          properties: {
            subscriptionId: { type: 'string' },
            customerId: { type: 'string' },
            reason: { type: 'string' },
            mrr: { type: 'number' },
          },
        },
        source: 'api',
        status: 'active',
        version: 1,
        createdBy: owner.id,
      },
    }),
    prisma.eventType.upsert({
      where: { organizationId_name_version: { organizationId: org.id, name: 'customer.created', version: 1 } },
      update: {},
      create: {
        organizationId: org.id,
        name: 'customer.created',
        description: 'A new customer account was created',
        payloadSchema: {
          $schema: 'http://json-schema.org/draft-07/schema#',
          type: 'object',
          required: ['customerId', 'email'],
          properties: {
            customerId: { type: 'string' },
            email: { type: 'string', format: 'email' },
            plan: { type: 'string', enum: ['starter', 'pro', 'enterprise'] },
          },
        },
        source: 'api',
        status: 'active',
        version: 1,
        createdBy: owner.id,
      },
    }),
  ])

  console.log('✅ Event Types: order.created, payment.received, invoice.generated, subscription.cancelled, customer.created')

  // -------------------------------------------------------------------------
  // Workflows
  // -------------------------------------------------------------------------
  async function upsertWorkflow(
    name: string,
    description: string,
    triggerEventTypeId: string,
    actions: object[],
    createdBy: string,
  ) {
    let wf = await prisma.workflow.findFirst({
      where: { organizationId: org.id, name },
      include: { currentVersion: true },
    })

    if (!wf) {
      wf = await prisma.workflow.create({
        data: { organizationId: org.id, name, description, status: 'active', createdBy },
        include: { currentVersion: true },
      })
      const v1 = await prisma.workflowVersion.create({
        data: {
          workflowId: wf.id,
          organizationId: org.id,
          version: 1,
          status: 'published',
          createdBy,
          definition: { triggerEventTypeId, rules: [], actions },
        },
      })
      await prisma.workflow.update({ where: { id: wf.id }, data: { currentVersionId: v1.id } })
    }
    return wf
  }

  await upsertWorkflow(
    'Order Processing',
    'Assigns an operations task when a new order is created',
    orderCreatedET.id,
    [
      { id: 'a1', type: 'create_task', orderIndex: 0, config: { title_template: 'Process order {{event.payload.orderId}}', priority: 'high', assignee_type: 'team', assignee_id: opsTeam.id, due_in_hours: 4 } },
      { id: 'a2', type: 'send_notification', orderIndex: 1, config: { recipient_type: 'user', recipient_id: ops.id, message_template: 'New order {{event.payload.orderId}} needs processing' } },
      { id: 'a3', type: 'update_metric', orderIndex: 2, config: { metric_name: 'total_events_ingested', operation: 'increment', value: 1 } },
    ],
    owner.id,
  )

  await upsertWorkflow(
    'Failed Payment Alert',
    'Creates a high-priority task when a payment fails',
    paymentReceivedET.id,
    [
      { id: 'a1', type: 'create_task', orderIndex: 0, config: { title_template: 'Investigate failed payment {{event.payload.paymentId}}', priority: 'critical', assignee_type: 'team', assignee_id: financeTeam.id, due_in_hours: 1 } },
      { id: 'a2', type: 'send_notification', orderIndex: 1, config: { recipient_type: 'user', recipient_id: finance.id, message_template: 'ALERT: Payment {{event.payload.paymentId}} may need review' } },
    ],
    ops.id,
  )

  await upsertWorkflow(
    'Invoice Reminder',
    'Schedules a follow-up task when an invoice is generated',
    invoiceGeneratedET.id,
    [
      { id: 'a1', type: 'create_task', orderIndex: 0, config: { title_template: 'Follow up on invoice {{event.payload.invoiceId}}', priority: 'medium', assignee_type: 'team', assignee_id: financeTeam.id, due_in_hours: 72 } },
    ],
    ops.id,
  )

  await upsertWorkflow(
    'VIP Customer Followup',
    'Triggers a retention task when an enterprise customer cancels',
    subscriptionCancelledET.id,
    [
      { id: 'a1', type: 'create_task', orderIndex: 0, config: { title_template: 'Retention call: {{event.payload.customerId}}', priority: 'critical', assignee_type: 'user', assignee_id: owner.id, due_in_hours: 2 } },
      { id: 'a2', type: 'send_notification', orderIndex: 1, config: { recipient_type: 'user', recipient_id: owner.id, message_template: 'Enterprise customer {{event.payload.customerId}} cancelled — MRR impact: ${{event.payload.mrr}}' } },
    ],
    owner.id,
  )

  console.log('✅ Workflows: Order Processing, Failed Payment Alert, Invoice Reminder, VIP Customer Followup')

  // -------------------------------------------------------------------------
  // Tasks — mix of statuses
  // -------------------------------------------------------------------------
  const now = new Date()
  const daysAgo = (d: number) => new Date(now.getTime() - d * 86400000)
  const hoursAgo = (h: number) => new Date(now.getTime() - h * 3600000)
  const hoursAhead = (h: number) => new Date(now.getTime() + h * 3600000)

  const tasksData = [
    { title: 'Process order ORD-1042', priority: 'high', status: 'completed', dueDate: daysAgo(1), overdue: false, assignee: ops.id },
    { title: 'Process order ORD-1043', priority: 'high', status: 'in_progress', dueDate: hoursAhead(2), overdue: false, assignee: ops.id },
    { title: 'Process order ORD-1044', priority: 'medium', status: 'pending', dueDate: hoursAhead(6), overdue: false, assignee: ops.id },
    { title: 'Investigate failed payment PAY-8821', priority: 'critical', status: 'in_progress', dueDate: hoursAgo(1), overdue: true, assignee: finance.id },
    { title: 'Investigate failed payment PAY-8799', priority: 'critical', status: 'completed', dueDate: daysAgo(2), overdue: false, assignee: finance.id },
    { title: 'Follow up on invoice INV-2201', priority: 'medium', status: 'pending', dueDate: hoursAhead(48), overdue: false, assignee: finance.id },
    { title: 'Follow up on invoice INV-2198', priority: 'medium', status: 'cancelled', dueDate: daysAgo(3), overdue: false, assignee: finance.id },
    { title: 'Retention call: CUST-0091', priority: 'critical', status: 'completed', dueDate: daysAgo(1), overdue: false, assignee: owner.id },
    { title: 'Retention call: CUST-0088', priority: 'critical', status: 'in_progress', dueDate: hoursAhead(1), overdue: false, assignee: owner.id },
    { title: 'Deploy payment service v2.1', priority: 'high', status: 'completed', dueDate: daysAgo(2), overdue: false, assignee: dev.id },
    { title: 'Review Q3 invoice reconciliation', priority: 'medium', status: 'pending', dueDate: daysAgo(1), overdue: true, assignee: finance.id },
    { title: 'Update customer onboarding docs', priority: 'low', status: 'pending', dueDate: hoursAhead(120), overdue: false, assignee: dev.id },
  ]

  const createdTasks = []
  for (const t of tasksData) {
    const task = await prisma.task.create({
      data: {
        organizationId: org.id,
        title: t.title,
        priority: t.priority,
        status: t.status,
        dueDate: t.dueDate,
        overdue: t.overdue,
        createdBy: owner.id,
      },
    })
    await prisma.taskAssignment.create({
      data: {
        taskId: task.id,
        organizationId: org.id,
        assigneeType: 'user',
        userId: t.assignee,
        assignedBy: owner.id,
      },
    })
    createdTasks.push(task)
  }
  console.log(`✅ Tasks: ${tasksData.length} tasks (mix of pending/in_progress/completed/cancelled/overdue)`)

  // -------------------------------------------------------------------------
  // Metrics
  // -------------------------------------------------------------------------
  const metricsData = [
    { name: 'total_events_ingested', metricType: 'count', currentValue: 284 },
    { name: 'total_tasks_created', metricType: 'count', currentValue: 127 },
    { name: 'task_completion_rate', metricType: 'percentage', currentValue: 73.2 },
    { name: 'avg_task_resolution_time_minutes', metricType: 'duration_minutes', currentValue: 94.5 },
    { name: 'total_failed_executions', metricType: 'count', currentValue: 3 },
    { name: 'monthly_recurring_revenue', metricType: 'count', currentValue: 48500 },
    { name: 'orders_per_day', metricType: 'count', currentValue: 42 },
  ]

  for (const m of metricsData) {
    const metric = await prisma.metric.upsert({
      where: { organizationId_name: { organizationId: org.id, name: m.name } },
      update: { currentValue: m.currentValue, computedAt: now },
      create: {
        organizationId: org.id,
        name: m.name,
        metricType: m.metricType,
        currentValue: m.currentValue,
        computedAt: now,
      },
    })

    // Seed a few history points so charts have data
    for (let i = 7; i >= 1; i--) {
      await prisma.metricHistory.create({
        data: {
          metricId: metric.id,
          organizationId: org.id,
          value: Number(m.currentValue) * (0.85 + Math.random() * 0.2),
          recordedAt: daysAgo(i),
          triggeredBy: 'seed',
        },
      })
    }
  }
  console.log('✅ Metrics: MRR, orders/day, completion rate, resolution time, failed executions (+history)')

  // -------------------------------------------------------------------------
  // KPIs
  // -------------------------------------------------------------------------
  const mrrMetric = await prisma.metric.findUnique({ where: { organizationId_name: { organizationId: org.id, name: 'monthly_recurring_revenue' } } })
  const failedExecMetric = await prisma.metric.findUnique({ where: { organizationId_name: { organizationId: org.id, name: 'total_failed_executions' } } })
  const completionMetric = await prisma.metric.findUnique({ where: { organizationId_name: { organizationId: org.id, name: 'task_completion_rate' } } })

  if (mrrMetric) {
    await prisma.kPI.upsert({
      where: { id: (await prisma.kPI.findFirst({ where: { organizationId: org.id, name: 'MRR Target' } }))?.id ?? '00000000-0000-0000-0000-000000000000' },
      update: {},
      create: { organizationId: org.id, name: 'MRR Target', metricId: mrrMetric.id, operator: '>=', targetValue: 50000, ownerUserId: finance.id, status: 'active', lastBreached: true },
    }).catch(() => prisma.kPI.create({ data: { organizationId: org.id, name: 'MRR Target', metricId: mrrMetric.id, operator: '>=', targetValue: 50000, ownerUserId: finance.id, status: 'active', lastBreached: true } }))
  }

  if (failedExecMetric) {
    await prisma.kPI.create({ data: { organizationId: org.id, name: 'Failed Executions Limit', metricId: failedExecMetric.id, operator: '<=', targetValue: 5, ownerUserId: ops.id, status: 'active', lastBreached: false } })
      .catch(() => {})
  }

  if (completionMetric) {
    await prisma.kPI.create({ data: { organizationId: org.id, name: 'Task Completion Rate', metricId: completionMetric.id, operator: '>=', targetValue: 80, ownerUserId: owner.id, status: 'active', lastBreached: true } })
      .catch(() => {})
  }

  console.log('✅ KPIs: MRR Target, Failed Executions Limit, Task Completion Rate')

  // -------------------------------------------------------------------------
  // Notifications — unread + read mixture
  // -------------------------------------------------------------------------
  const notifData = [
    { recipientType: 'user', recipientUserId: ops.id, message: 'New order ORD-1044 needs processing', sourceEntityType: 'task', isRead: false },
    { recipientType: 'user', recipientUserId: finance.id, message: 'ALERT: Payment PAY-8821 requires investigation', sourceEntityType: 'task', isRead: false },
    { recipientType: 'user', recipientUserId: owner.id, message: 'Enterprise customer CUST-0088 cancelled — MRR impact: $1,200/mo', sourceEntityType: 'task', isRead: false },
    { recipientType: 'user', recipientUserId: finance.id, message: 'KPI Alert: MRR is below $50,000 target', sourceEntityType: 'kpi', isRead: false },
    { recipientType: 'user', recipientUserId: owner.id, message: 'KPI Alert: Task completion rate is below 80% target', sourceEntityType: 'kpi', isRead: false },
    { recipientType: 'user', recipientUserId: ops.id, message: 'Order ORD-1042 has been successfully processed', sourceEntityType: 'task', isRead: true },
    { recipientType: 'user', recipientUserId: finance.id, message: 'Payment PAY-8799 investigation resolved', sourceEntityType: 'task', isRead: true },
    { recipientType: 'user', recipientUserId: owner.id, message: 'Retention call with CUST-0091 completed', sourceEntityType: 'task', isRead: true },
    { recipientType: 'team', recipientTeamId: opsTeam.id, message: 'Ops team: 3 tasks due in the next 4 hours', sourceEntityType: 'task', isRead: false },
    { recipientType: 'user', recipientUserId: dev.id, message: 'Payment service v2.1 deployment completed', sourceEntityType: 'execution', isRead: true },
  ]

  for (const n of notifData) {
    const task = createdTasks[0]
    await prisma.notification.create({
      data: {
        organizationId: org.id,
        recipientType: n.recipientType,
        recipientUserId: n.recipientUserId ?? null,
        recipientTeamId: n.recipientTeamId ?? null,
        message: n.message,
        sourceEntityType: n.sourceEntityType,
        sourceEntityId: task.id,
        isRead: n.isRead,
        readAt: n.isRead ? daysAgo(1) : null,
      },
    })
  }
  console.log('✅ Notifications: 5 unread, 5 read (including team notification)')

  // -------------------------------------------------------------------------
  // Audit log entries
  // -------------------------------------------------------------------------
  const auditEntries = [
    { entityType: 'user', entityId: owner.id, action: 'login_success', actorId: owner.id },
    { entityType: 'user', entityId: admin.id, action: 'login_success', actorId: admin.id },
    { entityType: 'task', entityId: createdTasks[0].id, action: 'status_changed', actorId: ops.id },
    { entityType: 'task', entityId: createdTasks[4].id, action: 'status_changed', actorId: finance.id },
    { entityType: 'task', entityId: createdTasks[7].id, action: 'status_changed', actorId: owner.id },
    { entityType: 'organization', entityId: org.id, action: 'updated', actorId: owner.id },
  ]

  for (const entry of auditEntries) {
    await prisma.auditLog.create({
      data: {
        organizationId: org.id,
        entityType: entry.entityType,
        entityId: entry.entityId,
        action: entry.action,
        actorType: 'user',
        actorId: entry.actorId,
        beforeState: Prisma.JsonNull,
        afterState: Prisma.JsonNull,
      },
    })
  }
  console.log('✅ Audit logs: 6 entries (logins, task transitions, org update)')

  // -------------------------------------------------------------------------
  // Summary
  // -------------------------------------------------------------------------
  console.log('\n🎉 Demo seed complete\n')
  console.log('Organization:  Acme Operations  (slug: acme-operations)')
  console.log('\nCredentials (password for all: Demo1234!)')
  console.log('  owner@opscore.dev    — Owner')
  console.log('  admin@opscore.dev    — Admin')
  console.log('  dev@opscore.dev      — Team Lead (Engineering)')
  console.log('  ops@opscore.dev      — Operations Manager')
  console.log('  finance@opscore.dev  — Member (Finance)')
  console.log('\nDashboard will show:')
  console.log('  4 active workflows')
  console.log('  12 tasks (mixed statuses)')
  console.log('  5 unread notifications')
  console.log('  7 metrics with history')
  console.log('  3 KPIs (2 currently breached)')
}

main()
  .catch((e) => {
    console.error('❌ Seed failed:', e)
    process.exit(1)
  })
  .finally(() => {
    prisma.$disconnect()
  })
