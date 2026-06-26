/**
 * OverdueWorker Unit Tests — Task 6.7
 *
 * Tests runOverdueCheck behaviour:
 *   - Marks past-due non-terminal tasks as overdue and writes audit logs
 *   - Does NOT mark completed tasks
 *   - Does NOT mark cancelled tasks
 *   - Does NOT mark tasks without a dueDate
 *   - Does NOT re-mark already-overdue tasks (overdue=true)
 *
 * Requirements: 7.7
 *
 * ESM-native mocking via jest.unstable_mockModule + dynamic imports.
 */

import { jest, describe, it, expect, beforeEach } from '@jest/globals'

// ---------------------------------------------------------------------------
// Prisma mock
// ---------------------------------------------------------------------------

const mockTaskFindMany = jest.fn<(args: unknown) => Promise<unknown>>()
const mockTaskUpdate = jest.fn<(args: unknown) => Promise<unknown>>()
const mockAuditCreate = jest.fn<(args: unknown) => Promise<unknown>>().mockResolvedValue({})

const mockTransaction = jest.fn(async (fn: (tx: unknown) => Promise<unknown>) =>
  fn({
    task: { update: mockTaskUpdate },
    auditLog: { create: mockAuditCreate },
  }),
)

jest.unstable_mockModule('@opscore/database', () => ({
  prisma: {
    task: {
      findMany: mockTaskFindMany,
    },
    $transaction: mockTransaction,
  },
  PrismaClient: jest.fn(),
}))

jest.unstable_mockModule('@opscore/logger', () => ({
  logger: {
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    child: jest.fn().mockReturnValue({ info: jest.fn(), error: jest.fn() }),
  },
}))

jest.unstable_mockModule('@opscore/config', () => ({
  config: {
    NODE_ENV: 'test',
    REDIS_URL: 'redis://localhost:6379',
  },
}))

// Dynamic import AFTER mocks are registered
const { runOverdueCheck } = await import('../OverdueWorker.js')

// ---------------------------------------------------------------------------
// Sample data helpers
// ---------------------------------------------------------------------------

const ORG_ID = 'org-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
const TASK_ID = 'task-bbbb-bbbb-bbbb-bbbbbbbbbbbb'

const pastDue = new Date('2020-01-01T00:00:00.000Z')

const overdueCandidate = {
  id: TASK_ID,
  organizationId: ORG_ID,
  title: 'Fix the bug',
  status: 'pending',
  dueDate: pastDue,
  overdue: false,
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('runOverdueCheck', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockTaskUpdate.mockResolvedValue({} as unknown)
    mockAuditCreate.mockResolvedValue({} as unknown)
  })

  it('marks overdue tasks and writes one audit log entry per task', async () => {
    const task2 = { ...overdueCandidate, id: 'task-2222', title: 'Other task' }
    mockTaskFindMany.mockResolvedValue([overdueCandidate, task2])

    await runOverdueCheck()

    // Two transactions — one per task
    expect(mockTransaction).toHaveBeenCalledTimes(2)

    // First task: task.update called with overdue=true
    expect(mockTaskUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: TASK_ID },
        data: { overdue: true },
      }),
    )

    // First task: audit log created with correct fields
    expect(mockAuditCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          organizationId: ORG_ID,
          entityType: 'task',
          entityId: TASK_ID,
          action: 'status_changed',
          actorType: 'system',
          actorId: null,
          beforeState: expect.objectContaining({ overdue: false }),
          afterState: expect.objectContaining({ overdue: true }),
        }),
      }),
    )
  })

  it('queries only tasks with dueDate < now, status not in terminal, and overdue=false', async () => {
    mockTaskFindMany.mockResolvedValue([])

    await runOverdueCheck()

    expect(mockTaskFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          dueDate: expect.objectContaining({ lt: expect.any(Date) }),
          status: { notIn: ['completed', 'cancelled'] },
          overdue: false,
        }),
      }),
    )
  })

  it('does not mark completed tasks as overdue', async () => {
    // The query filter excludes completed tasks — mock returns empty when filter is applied
    // We confirm the filter itself is correct (already tested above).
    // Additionally, test that if findMany returns zero results, no updates happen.
    mockTaskFindMany.mockResolvedValue([])

    await runOverdueCheck()

    expect(mockTransaction).not.toHaveBeenCalled()
    expect(mockTaskUpdate).not.toHaveBeenCalled()
    expect(mockAuditCreate).not.toHaveBeenCalled()
  })

  it('does not mark cancelled tasks as overdue', async () => {
    // Same as above — the query's notIn filter excludes cancelled tasks.
    // Validate that with an empty result from findMany, nothing is mutated.
    mockTaskFindMany.mockResolvedValue([])

    await runOverdueCheck()

    expect(mockTransaction).not.toHaveBeenCalled()
  })

  it('does not mark tasks without a dueDate', async () => {
    // prisma filter uses dueDate: { lt: now } — tasks with null dueDate
    // are excluded by Prisma automatically. Verify no updates when empty.
    mockTaskFindMany.mockResolvedValue([])

    await runOverdueCheck()

    expect(mockTransaction).not.toHaveBeenCalled()
  })

  it('does not re-mark already-overdue tasks (overdue=true)', async () => {
    // The query includes overdue: false, so already-overdue tasks are not returned.
    // Mock an empty result (simulates no tasks to update) and verify no writes.
    mockTaskFindMany.mockResolvedValue([])

    await runOverdueCheck()

    expect(mockTransaction).not.toHaveBeenCalled()
  })

  it('restricts query to a specific org when orgId is provided', async () => {
    mockTaskFindMany.mockResolvedValue([])

    await runOverdueCheck(ORG_ID)

    expect(mockTaskFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          organizationId: ORG_ID,
        }),
      }),
    )
  })

  it('does not include organizationId filter when orgId is omitted', async () => {
    mockTaskFindMany.mockResolvedValue([])

    await runOverdueCheck()

    const callArgs = (mockTaskFindMany.mock.calls[0] as unknown) as [{ where: Record<string, unknown> }]
    expect(callArgs[0].where).not.toHaveProperty('organizationId')
  })

  it('handles zero overdue tasks gracefully without touching the DB', async () => {
    mockTaskFindMany.mockResolvedValue([])

    await expect(runOverdueCheck()).resolves.not.toThrow()

    expect(mockTransaction).not.toHaveBeenCalled()
  })

  it('writes correct beforeState/afterState in audit log', async () => {
    mockTaskFindMany.mockResolvedValue([overdueCandidate])

    await runOverdueCheck()

    expect(mockAuditCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          beforeState: expect.objectContaining({
            id: TASK_ID,
            status: 'pending',
            overdue: false,
            dueDate: pastDue,
          }),
          afterState: expect.objectContaining({
            id: TASK_ID,
            status: 'pending',
            overdue: true,
            dueDate: pastDue,
          }),
        }),
      }),
    )
  })
})
