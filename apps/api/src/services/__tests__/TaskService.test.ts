/**
 * Unit tests for TaskService — Tasks 6.1, 6.5
 *
 * ESM-native mocking via jest.unstable_mockModule + dynamic imports.
 * Follows the same pattern as EventService.test.ts and WorkflowService.test.ts.
 */

import { jest, describe, it, expect, beforeEach } from '@jest/globals'

// ---------------------------------------------------------------------------
// Prisma mocks
// ---------------------------------------------------------------------------

const mockTaskFindFirst = jest.fn()
const mockTaskFindMany = jest.fn()
const mockTaskCreate = jest.fn()
const mockTaskUpdate = jest.fn()
const mockTaskDelete = jest.fn()

const mockTeamFindFirst = jest.fn()
const mockOrgMemberFindFirst = jest.fn()
const mockTaskAssignmentFindFirst = jest.fn()
const mockTaskAssignmentFindMany = jest.fn()
const mockTaskAssignmentCreate = jest.fn()
const mockTaskAssignmentDelete = jest.fn()

const mockTaskCommentCreate = jest.fn<(args: unknown) => Promise<unknown>>()
const mockTaskCommentFindMany = jest.fn<(args: unknown) => Promise<unknown>>()

const mockAuditCreate = jest.fn().mockResolvedValue({})

const mockTransaction = jest.fn(async (fn: (tx: unknown) => Promise<unknown>) =>
  fn({
    task: {
      create: mockTaskCreate,
      update: mockTaskUpdate,
      delete: mockTaskDelete,
    },
    taskAssignment: {
      create: mockTaskAssignmentCreate,
      delete: mockTaskAssignmentDelete,
    },
    taskComment: { create: mockTaskCommentCreate },
    auditLog: { create: mockAuditCreate },
  }),
)

jest.unstable_mockModule('../../lib/prisma.js', () => ({
  prisma: {
    task: {
      findFirst: mockTaskFindFirst,
      findMany: mockTaskFindMany,
    },
    team: {
      findFirst: mockTeamFindFirst,
    },
    organizationMember: {
      findFirst: mockOrgMemberFindFirst,
    },
    taskAssignment: {
      findFirst: mockTaskAssignmentFindFirst,
      findMany: mockTaskAssignmentFindMany,
    },
    taskComment: {
      create: mockTaskCommentCreate,
      findMany: mockTaskCommentFindMany,
    },
    $transaction: mockTransaction,
  },
  PrismaClient: jest.fn(),
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

const { TaskService, isValidTransition, allowedTransitions } = await import('../TaskService.js')

// ---------------------------------------------------------------------------
// Sample data
// ---------------------------------------------------------------------------

const ORG_ID = 'org-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
const TASK_ID = 'task-bbbb-bbbb-bbbb-bbbbbbbbbbbb'
const USER_ID = 'user-cccc-cccc-cccc-cccccccccccc'
const TEAM_ID = 'team-dddd-dddd-dddd-dddddddddddd'
const ASSIGNMENT_ID = 'asgn-eeee-eeee-eeee-eeeeeeeeeeee'

const sampleTask = {
  id: TASK_ID,
  organizationId: ORG_ID,
  title: 'Investigate anomaly',
  description: null,
  priority: 'medium',
  status: 'pending',
  dueDate: null,
  overdue: false,
  createdBy: USER_ID,
  sourceWorkflowId: null,
  sourceExecutionId: null,
  createdAt: new Date('2024-01-01'),
  updatedAt: new Date('2024-01-01'),
}

const sampleTeam = {
  id: TEAM_ID,
  organizationId: ORG_ID,
  name: 'Engineering',
  status: 'active',
  createdAt: new Date('2024-01-01'),
  updatedAt: new Date('2024-01-01'),
}

const sampleOrgMember = {
  id: 'mbr-ffff-ffff-ffff-ffffffffffff',
  organizationId: ORG_ID,
  userId: USER_ID,
  role: 'member',
  status: 'active',
}

const sampleAssignment = {
  id: ASSIGNMENT_ID,
  taskId: TASK_ID,
  organizationId: ORG_ID,
  assigneeType: 'user',
  userId: USER_ID,
  teamId: null,
  assignedAt: new Date('2024-01-01'),
  assignedBy: null,
}

// ---------------------------------------------------------------------------
// Status machine unit tests (isValidTransition, allowedTransitions)
// ---------------------------------------------------------------------------

describe('isValidTransition', () => {
  it('allows pending → in_progress', () => {
    expect(isValidTransition('pending', 'in_progress')).toBe(true)
  })

  it('allows pending → cancelled', () => {
    expect(isValidTransition('pending', 'cancelled')).toBe(true)
  })

  it('allows in_progress → completed', () => {
    expect(isValidTransition('in_progress', 'completed')).toBe(true)
  })

  it('allows in_progress → cancelled', () => {
    expect(isValidTransition('in_progress', 'cancelled')).toBe(true)
  })

  it('disallows in_progress → pending', () => {
    expect(isValidTransition('in_progress', 'pending')).toBe(false)
  })

  it('disallows completed → anything', () => {
    expect(isValidTransition('completed', 'pending')).toBe(false)
    expect(isValidTransition('completed', 'in_progress')).toBe(false)
    expect(isValidTransition('completed', 'cancelled')).toBe(false)
  })

  it('disallows cancelled → anything', () => {
    expect(isValidTransition('cancelled', 'pending')).toBe(false)
    expect(isValidTransition('cancelled', 'in_progress')).toBe(false)
    expect(isValidTransition('cancelled', 'completed')).toBe(false)
  })
})

describe('allowedTransitions', () => {
  it('describes allowed transitions from pending', () => {
    const msg = allowedTransitions('pending')
    expect(msg).toContain('in_progress')
    expect(msg).toContain('cancelled')
  })

  it('describes terminal status message for completed', () => {
    expect(allowedTransitions('completed')).toContain('terminal')
  })

  it('describes terminal status message for cancelled', () => {
    expect(allowedTransitions('cancelled')).toContain('terminal')
  })
})

// ---------------------------------------------------------------------------
// createTask
// ---------------------------------------------------------------------------

describe('TaskService.createTask', () => {
  beforeEach(() => jest.clearAllMocks())

  it('creates a task with defaults and writes an audit log', async () => {
    mockTaskCreate.mockResolvedValue(sampleTask)

    const result = await TaskService.createTask(
      ORG_ID,
      { title: 'Investigate anomaly' },
      { requestId: 'req-1', actorId: USER_ID },
    )

    expect(result).toMatchObject({ id: TASK_ID, title: 'Investigate anomaly', status: 'pending' })
    expect(mockTransaction).toHaveBeenCalledTimes(1)
    expect(mockTaskCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          organizationId: ORG_ID,
          title: 'Investigate anomaly',
          priority: 'medium',
          status: 'pending',
        }),
      }),
    )
    expect(mockAuditCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: 'created',
          entityType: 'task',
          actorId: USER_ID,
        }),
      }),
    )
  })

  it('creates a task with custom priority and dueDate', async () => {
    const dueDate = new Date('2024-06-01T00:00:00.000Z')
    const task = { ...sampleTask, priority: 'high', dueDate }
    mockTaskCreate.mockResolvedValue(task)

    const result = await TaskService.createTask(
      ORG_ID,
      { title: 'Urgent task', priority: 'high', dueDate },
      { actorId: USER_ID },
    )

    expect(result.priority).toBe('high')
    expect(result.dueDate).toEqual(dueDate)
  })

  it('uses system actor type when no actorId is provided', async () => {
    mockTaskCreate.mockResolvedValue({ ...sampleTask, createdBy: null })

    await TaskService.createTask(ORG_ID, { title: 'Workflow task' }, {})

    expect(mockAuditCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ actorType: 'system', actorId: null }),
      }),
    )
  })
})

// ---------------------------------------------------------------------------
// getTask
// ---------------------------------------------------------------------------

describe('TaskService.getTask', () => {
  beforeEach(() => jest.clearAllMocks())

  it('returns the task when found', async () => {
    mockTaskFindFirst.mockResolvedValue(sampleTask)

    const result = await TaskService.getTask(ORG_ID, TASK_ID)

    expect(result).toMatchObject({ id: TASK_ID })
    expect(mockTaskFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: TASK_ID, organizationId: ORG_ID },
      }),
    )
  })

  it('returns null when not found', async () => {
    mockTaskFindFirst.mockResolvedValue(null)
    expect(await TaskService.getTask(ORG_ID, 'missing')).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// updateTask
// ---------------------------------------------------------------------------

describe('TaskService.updateTask', () => {
  beforeEach(() => jest.clearAllMocks())

  it('updates and returns the task with audit log', async () => {
    const updated = { ...sampleTask, title: 'Updated title', priority: 'high' }
    mockTaskFindFirst.mockResolvedValue(sampleTask)
    mockTaskUpdate.mockResolvedValue(updated)

    const result = await TaskService.updateTask(
      ORG_ID,
      TASK_ID,
      { title: 'Updated title', priority: 'high' },
      { actorId: USER_ID },
    )

    expect(result).toMatchObject({ title: 'Updated title', priority: 'high' })
    expect(mockTransaction).toHaveBeenCalledTimes(1)
    expect(mockAuditCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: 'updated', entityType: 'task' }),
      }),
    )
  })

  it('throws 404 when task not found', async () => {
    mockTaskFindFirst.mockResolvedValue(null)

    await expect(
      TaskService.updateTask(ORG_ID, 'missing', { title: 'X' }),
    ).rejects.toMatchObject({ statusCode: 404 })

    expect(mockTransaction).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// transitionStatus
// ---------------------------------------------------------------------------

describe('TaskService.transitionStatus', () => {
  beforeEach(() => jest.clearAllMocks())

  it('transitions pending → in_progress and writes audit log', async () => {
    const updated = { ...sampleTask, status: 'in_progress' }
    mockTaskFindFirst.mockResolvedValue(sampleTask) // status: pending
    mockTaskUpdate.mockResolvedValue(updated)

    const result = await TaskService.transitionStatus(ORG_ID, TASK_ID, 'in_progress', {
      actorId: USER_ID,
    })

    expect(result.status).toBe('in_progress')
    expect(mockTransaction).toHaveBeenCalledTimes(1)
    expect(mockAuditCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: 'status_changed',
          entityType: 'task',
          actorId: USER_ID,
        }),
      }),
    )
  })

  it('transitions in_progress → completed', async () => {
    const inProgress = { ...sampleTask, status: 'in_progress' }
    const completed = { ...sampleTask, status: 'completed' }
    mockTaskFindFirst.mockResolvedValue(inProgress)
    mockTaskUpdate.mockResolvedValue(completed)

    const result = await TaskService.transitionStatus(ORG_ID, TASK_ID, 'completed')

    expect(result.status).toBe('completed')
  })

  it('transitions in_progress → cancelled', async () => {
    const inProgress = { ...sampleTask, status: 'in_progress' }
    const cancelled = { ...sampleTask, status: 'cancelled' }
    mockTaskFindFirst.mockResolvedValue(inProgress)
    mockTaskUpdate.mockResolvedValue(cancelled)

    const result = await TaskService.transitionStatus(ORG_ID, TASK_ID, 'cancelled')

    expect(result.status).toBe('cancelled')
  })

  it('throws 422 on invalid transition: in_progress → pending', async () => {
    const inProgress = { ...sampleTask, status: 'in_progress' }
    mockTaskFindFirst.mockResolvedValue(inProgress)

    await expect(
      TaskService.transitionStatus(ORG_ID, TASK_ID, 'pending'),
    ).rejects.toMatchObject({ statusCode: 422 })

    expect(mockTransaction).not.toHaveBeenCalled()
  })

  it('throws 422 on invalid transition from completed', async () => {
    const completed = { ...sampleTask, status: 'completed' }
    mockTaskFindFirst.mockResolvedValue(completed)

    await expect(
      TaskService.transitionStatus(ORG_ID, TASK_ID, 'in_progress'),
    ).rejects.toMatchObject({ statusCode: 422 })
  })

  it('throws 422 on invalid transition from cancelled', async () => {
    const cancelled = { ...sampleTask, status: 'cancelled' }
    mockTaskFindFirst.mockResolvedValue(cancelled)

    await expect(
      TaskService.transitionStatus(ORG_ID, TASK_ID, 'pending'),
    ).rejects.toMatchObject({ statusCode: 422 })
  })

  it('throws 404 when task not found', async () => {
    mockTaskFindFirst.mockResolvedValue(null)

    await expect(
      TaskService.transitionStatus(ORG_ID, 'missing', 'in_progress'),
    ).rejects.toMatchObject({ statusCode: 404 })
  })

  it('resets overdue=false when transitioning to completed', async () => {
    const inProgress = { ...sampleTask, status: 'in_progress', overdue: true }
    const completed = { ...sampleTask, status: 'completed', overdue: false }
    mockTaskFindFirst.mockResolvedValue(inProgress)
    mockTaskUpdate.mockResolvedValue(completed)

    await TaskService.transitionStatus(ORG_ID, TASK_ID, 'completed')

    expect(mockTaskUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'completed', overdue: false }),
      }),
    )
  })

  it('resets overdue=false when transitioning to cancelled', async () => {
    const inProgress = { ...sampleTask, status: 'in_progress', overdue: true }
    const cancelled = { ...sampleTask, status: 'cancelled', overdue: false }
    mockTaskFindFirst.mockResolvedValue(inProgress)
    mockTaskUpdate.mockResolvedValue(cancelled)

    await TaskService.transitionStatus(ORG_ID, TASK_ID, 'cancelled')

    expect(mockTaskUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'cancelled', overdue: false }),
      }),
    )
  })

  it('does NOT include overdue in update data when transitioning to in_progress', async () => {
    const updated = { ...sampleTask, status: 'in_progress' }
    mockTaskFindFirst.mockResolvedValue(sampleTask) // status: pending
    mockTaskUpdate.mockResolvedValue(updated)

    await TaskService.transitionStatus(ORG_ID, TASK_ID, 'in_progress')

    const updateCall = mockTaskUpdate.mock.calls[0] as [{ data: Record<string, unknown> }]
    expect(updateCall[0].data).not.toHaveProperty('overdue')
  })

  it('audit log before/after state captures status transition', async () => {
    const updated = { ...sampleTask, status: 'cancelled' }
    mockTaskFindFirst.mockResolvedValue(sampleTask) // status: pending
    mockTaskUpdate.mockResolvedValue(updated)

    await TaskService.transitionStatus(ORG_ID, TASK_ID, 'cancelled', { actorId: USER_ID })

    expect(mockAuditCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          beforeState: expect.objectContaining({ status: 'pending' }),
          afterState: expect.objectContaining({ status: 'cancelled' }),
        }),
      }),
    )
  })
})

// ---------------------------------------------------------------------------
// cancelTask
// ---------------------------------------------------------------------------

describe('TaskService.cancelTask', () => {
  beforeEach(() => jest.clearAllMocks())

  it('cancels a pending task', async () => {
    const cancelled = { ...sampleTask, status: 'cancelled' }
    mockTaskFindFirst.mockResolvedValue(sampleTask) // status: pending
    mockTaskUpdate.mockResolvedValue(cancelled)

    const result = await TaskService.cancelTask(ORG_ID, TASK_ID, { actorId: USER_ID })

    expect(result.status).toBe('cancelled')
  })

  it('throws 422 when task is already completed', async () => {
    const completed = { ...sampleTask, status: 'completed' }
    mockTaskFindFirst.mockResolvedValue(completed)

    await expect(
      TaskService.cancelTask(ORG_ID, TASK_ID),
    ).rejects.toMatchObject({ statusCode: 422 })
  })
})

// ---------------------------------------------------------------------------
// listTasks
// ---------------------------------------------------------------------------

describe('TaskService.listTasks', () => {
  beforeEach(() => jest.clearAllMocks())

  it('returns tasks with default pagination', async () => {
    const tasks = [sampleTask, { ...sampleTask, id: 'task-2' }]
    mockTaskFindMany.mockResolvedValue(tasks)

    const result = await TaskService.listTasks(ORG_ID)

    expect(result.data).toHaveLength(2)
    expect(result.pagination.hasNextPage).toBe(false)
    expect(mockTaskFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ organizationId: ORG_ID }),
        take: 21, // limit+1
      }),
    )
  })

  it('indicates next page when more results exist', async () => {
    // Return limit+1 (21) tasks to signal another page
    const tasks = Array.from({ length: 21 }, (_, i) => ({ ...sampleTask, id: `task-${i}` }))
    mockTaskFindMany.mockResolvedValue(tasks)

    const result = await TaskService.listTasks(ORG_ID, {}, { limit: 20 })

    expect(result.pagination.hasNextPage).toBe(true)
    expect(result.data).toHaveLength(20)
    expect(result.pagination.nextCursor).toBe('task-19')
  })

  it('applies status filter', async () => {
    mockTaskFindMany.mockResolvedValue([])

    await TaskService.listTasks(ORG_ID, { status: 'pending' })

    expect(mockTaskFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ organizationId: ORG_ID, status: 'pending' }),
      }),
    )
  })

  it('applies priority filter', async () => {
    mockTaskFindMany.mockResolvedValue([])

    await TaskService.listTasks(ORG_ID, { priority: 'high' })

    expect(mockTaskFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ priority: 'high' }),
      }),
    )
  })

  it('caps limit at 100', async () => {
    mockTaskFindMany.mockResolvedValue([])

    await TaskService.listTasks(ORG_ID, {}, { limit: 9999 })

    expect(mockTaskFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 101 }), // 100 + 1
    )
  })
})

// ---------------------------------------------------------------------------
// deleteTask
// ---------------------------------------------------------------------------

describe('TaskService.deleteTask', () => {
  beforeEach(() => jest.clearAllMocks())

  it('deletes the task and writes audit log', async () => {
    mockTaskFindFirst.mockResolvedValue(sampleTask)
    mockTaskDelete.mockResolvedValue(undefined)

    await TaskService.deleteTask(ORG_ID, TASK_ID, { actorId: USER_ID })

    expect(mockTransaction).toHaveBeenCalledTimes(1)
    expect(mockTaskDelete).toHaveBeenCalledWith({ where: { id: TASK_ID } })
    expect(mockAuditCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: 'deleted',
          entityType: 'task',
          entityId: TASK_ID,
        }),
      }),
    )
  })

  it('throws 404 when task not found', async () => {
    mockTaskFindFirst.mockResolvedValue(null)

    await expect(
      TaskService.deleteTask(ORG_ID, 'missing'),
    ).rejects.toMatchObject({ statusCode: 404 })

    expect(mockTransaction).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// assignTask
// ---------------------------------------------------------------------------

describe('TaskService.assignTask', () => {
  beforeEach(() => jest.clearAllMocks())

  it('creates assignment for user', async () => {
    mockTaskFindFirst.mockResolvedValue(sampleTask)
    mockOrgMemberFindFirst.mockResolvedValue(sampleOrgMember)
    mockTaskAssignmentFindFirst.mockResolvedValue(null)
    mockTaskAssignmentCreate.mockResolvedValue(sampleAssignment)

    const result = await TaskService.assignTask(
      ORG_ID,
      TASK_ID,
      { assigneeType: 'user', userId: USER_ID, assignedBy: USER_ID },
      { actorId: USER_ID },
    )

    expect(result).toMatchObject({ id: ASSIGNMENT_ID, assigneeType: 'user', userId: USER_ID })
    expect(mockTransaction).toHaveBeenCalledTimes(1)
    expect(mockTaskAssignmentCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          taskId: TASK_ID,
          organizationId: ORG_ID,
          assigneeType: 'user',
          userId: USER_ID,
          teamId: null,
        }),
      }),
    )
    expect(mockAuditCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: 'updated',
          entityType: 'task',
          entityId: TASK_ID,
        }),
      }),
    )
  })

  it('creates assignment for team', async () => {
    const teamAssignment = { ...sampleAssignment, id: 'asgn-2', assigneeType: 'team', userId: null, teamId: TEAM_ID }
    mockTaskFindFirst.mockResolvedValue(sampleTask)
    mockTeamFindFirst.mockResolvedValue(sampleTeam)
    mockTaskAssignmentFindFirst.mockResolvedValue(null)
    mockTaskAssignmentCreate.mockResolvedValue(teamAssignment)

    const result = await TaskService.assignTask(
      ORG_ID,
      TASK_ID,
      { assigneeType: 'team', teamId: TEAM_ID },
    )

    expect(result).toMatchObject({ assigneeType: 'team', teamId: TEAM_ID })
    expect(mockTransaction).toHaveBeenCalledTimes(1)
    expect(mockTaskAssignmentCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          assigneeType: 'team',
          teamId: TEAM_ID,
          userId: null,
        }),
      }),
    )
  })

  it('rejects archived team with 422', async () => {
    mockTaskFindFirst.mockResolvedValue(sampleTask)
    mockTeamFindFirst.mockResolvedValue({ ...sampleTeam, status: 'archived' })

    await expect(
      TaskService.assignTask(ORG_ID, TASK_ID, { assigneeType: 'team', teamId: TEAM_ID }),
    ).rejects.toMatchObject({ statusCode: 422 })

    expect(mockTransaction).not.toHaveBeenCalled()
  })

  it('rejects non-member user with 422', async () => {
    mockTaskFindFirst.mockResolvedValue(sampleTask)
    mockOrgMemberFindFirst.mockResolvedValue(null)

    await expect(
      TaskService.assignTask(ORG_ID, TASK_ID, { assigneeType: 'user', userId: USER_ID }),
    ).rejects.toMatchObject({ statusCode: 422 })

    expect(mockTransaction).not.toHaveBeenCalled()
  })

  it('is idempotent on exact duplicate', async () => {
    mockTaskFindFirst.mockResolvedValue(sampleTask)
    mockOrgMemberFindFirst.mockResolvedValue(sampleOrgMember)
    mockTaskAssignmentFindFirst.mockResolvedValue(sampleAssignment) // already exists

    const result = await TaskService.assignTask(
      ORG_ID,
      TASK_ID,
      { assigneeType: 'user', userId: USER_ID },
    )

    // Returns existing, no transaction needed
    expect(result).toMatchObject({ id: ASSIGNMENT_ID })
    expect(mockTransaction).not.toHaveBeenCalled()
  })

  it('allows assigning both a user and a team to the same task', async () => {
    const teamAssignment = { ...sampleAssignment, id: 'asgn-2', assigneeType: 'team', userId: null, teamId: TEAM_ID }
    // First call: user assignment (no duplicate)
    mockTaskFindFirst.mockResolvedValue(sampleTask)
    mockOrgMemberFindFirst.mockResolvedValue(sampleOrgMember)
    mockTaskAssignmentFindFirst.mockResolvedValue(null)
    mockTaskAssignmentCreate.mockResolvedValue(sampleAssignment)

    const userResult = await TaskService.assignTask(
      ORG_ID,
      TASK_ID,
      { assigneeType: 'user', userId: USER_ID },
    )
    expect(userResult).toMatchObject({ assigneeType: 'user' })

    // Second call: team assignment (different assigneeType — not a duplicate)
    jest.clearAllMocks()
    mockAuditCreate.mockResolvedValue({})
    mockTaskFindFirst.mockResolvedValue(sampleTask)
    mockTeamFindFirst.mockResolvedValue(sampleTeam)
    mockTaskAssignmentFindFirst.mockResolvedValue(null) // no exact match for team
    mockTaskAssignmentCreate.mockResolvedValue(teamAssignment)

    const teamResult = await TaskService.assignTask(
      ORG_ID,
      TASK_ID,
      { assigneeType: 'team', teamId: TEAM_ID },
    )
    expect(teamResult).toMatchObject({ assigneeType: 'team' })
    expect(mockTransaction).toHaveBeenCalledTimes(1)
  })

  it('throws 404 when task not found', async () => {
    mockTaskFindFirst.mockResolvedValue(null)

    await expect(
      TaskService.assignTask(ORG_ID, 'missing', { assigneeType: 'user', userId: USER_ID }),
    ).rejects.toMatchObject({ statusCode: 404 })

    expect(mockTransaction).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// unassignTask
// ---------------------------------------------------------------------------

describe('TaskService.unassignTask', () => {
  beforeEach(() => jest.clearAllMocks())

  it('hard-deletes assignment with audit log', async () => {
    mockTaskAssignmentFindFirst.mockResolvedValue(sampleAssignment)
    mockTaskAssignmentDelete.mockResolvedValue(undefined)

    await TaskService.unassignTask(ORG_ID, TASK_ID, ASSIGNMENT_ID, { actorId: USER_ID })

    expect(mockTransaction).toHaveBeenCalledTimes(1)
    expect(mockTaskAssignmentDelete).toHaveBeenCalledWith({ where: { id: ASSIGNMENT_ID } })
    expect(mockAuditCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: 'updated',
          entityType: 'task',
          entityId: TASK_ID,
          actorId: USER_ID,
        }),
      }),
    )
  })

  it('throws 404 when assignment not found', async () => {
    mockTaskAssignmentFindFirst.mockResolvedValue(null)

    await expect(
      TaskService.unassignTask(ORG_ID, TASK_ID, 'missing'),
    ).rejects.toMatchObject({ statusCode: 404 })

    expect(mockTransaction).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// listAssignments
// ---------------------------------------------------------------------------

describe('TaskService.listAssignments', () => {
  beforeEach(() => jest.clearAllMocks())

  it('returns all assignments for a task', async () => {
    const teamAssignment = { ...sampleAssignment, id: 'asgn-2', assigneeType: 'team', userId: null, teamId: TEAM_ID }
    mockTaskAssignmentFindMany.mockResolvedValue([sampleAssignment, teamAssignment])

    const result = await TaskService.listAssignments(ORG_ID, TASK_ID)

    expect(result).toHaveLength(2)
    expect(mockTaskAssignmentFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { taskId: TASK_ID, organizationId: ORG_ID },
      }),
    )
  })

  it('returns empty array when no assignments exist', async () => {
    mockTaskAssignmentFindMany.mockResolvedValue([])

    const result = await TaskService.listAssignments(ORG_ID, TASK_ID)

    expect(result).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// Sample comment data
// ---------------------------------------------------------------------------

const COMMENT_ID = 'cmnt-1111-1111-1111-111111111111'

const sampleCommentWithAuthor = {
  id: COMMENT_ID,
  taskId: TASK_ID,
  organizationId: ORG_ID,
  authorId: USER_ID,
  body: 'This is a comment',
  createdAt: new Date('2024-01-02T10:00:00Z'),
  author: { id: USER_ID, fullName: 'Alice Smith' },
}

// ---------------------------------------------------------------------------
// addComment (Req 7.9)
// ---------------------------------------------------------------------------

describe('TaskService.addComment', () => {
  beforeEach(() => jest.clearAllMocks())

  it('creates comment and writes audit log', async () => {
    mockTaskFindFirst.mockResolvedValue(sampleTask)
    mockOrgMemberFindFirst.mockResolvedValue(sampleOrgMember)
    mockTaskCommentCreate.mockResolvedValue(sampleCommentWithAuthor)

    const result = await TaskService.addComment(
      ORG_ID,
      TASK_ID,
      { body: 'This is a comment', authorId: USER_ID },
      { requestId: 'req-1', actorId: USER_ID },
    )

    expect(result).toMatchObject({ id: COMMENT_ID, body: 'This is a comment' })
    expect(result.author).toMatchObject({ id: USER_ID, fullName: 'Alice Smith' })
    expect(mockTransaction).toHaveBeenCalledTimes(1)
    expect(mockTaskCommentCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          taskId: TASK_ID,
          organizationId: ORG_ID,
          authorId: USER_ID,
          body: 'This is a comment',
        }),
        include: { author: { select: { id: true, fullName: true } } },
      }),
    )
    expect(mockAuditCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: 'updated',
          entityType: 'task',
          entityId: TASK_ID,
          afterState: expect.objectContaining({ action: 'comment_added', authorId: USER_ID }),
        }),
      }),
    )
  })

  it('throws 422 when author is not an active org member', async () => {
    mockTaskFindFirst.mockResolvedValue(sampleTask)
    mockOrgMemberFindFirst.mockResolvedValue(null)

    await expect(
      TaskService.addComment(ORG_ID, TASK_ID, { body: 'Hello', authorId: USER_ID }),
    ).rejects.toMatchObject({ statusCode: 422 })

    expect(mockTransaction).not.toHaveBeenCalled()
  })

  it('throws 404 when task not found', async () => {
    mockTaskFindFirst.mockResolvedValue(null)

    await expect(
      TaskService.addComment(ORG_ID, 'missing-task', { body: 'Hello', authorId: USER_ID }),
    ).rejects.toMatchObject({ statusCode: 404 })

    expect(mockTransaction).not.toHaveBeenCalled()
  })

  it('returns comment with author info', async () => {
    mockTaskFindFirst.mockResolvedValue(sampleTask)
    mockOrgMemberFindFirst.mockResolvedValue(sampleOrgMember)
    mockTaskCommentCreate.mockResolvedValue(sampleCommentWithAuthor)

    const result = await TaskService.addComment(
      ORG_ID,
      TASK_ID,
      { body: 'This is a comment', authorId: USER_ID },
      { actorId: USER_ID },
    )

    expect(result.author).toBeDefined()
    expect(result.author.id).toBe(USER_ID)
    expect(result.author.fullName).toBe('Alice Smith')
  })
})

// ---------------------------------------------------------------------------
// listComments (Req 7.9)
// ---------------------------------------------------------------------------

describe('TaskService.listComments', () => {
  beforeEach(() => jest.clearAllMocks())

  it('returns comments in chronological order', async () => {
    const comment1 = { ...sampleCommentWithAuthor, id: 'cmnt-1', createdAt: new Date('2024-01-02T10:00:00Z') }
    const comment2 = { ...sampleCommentWithAuthor, id: 'cmnt-2', createdAt: new Date('2024-01-02T11:00:00Z') }
    mockTaskCommentFindMany.mockResolvedValue([comment1, comment2])

    const result = await TaskService.listComments(ORG_ID, TASK_ID)

    expect(result).toHaveLength(2)
    expect(result[0].id).toBe('cmnt-1')
    expect(result[1].id).toBe('cmnt-2')
    expect(mockTaskCommentFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { taskId: TASK_ID, organizationId: ORG_ID },
        orderBy: { createdAt: 'asc' },
        include: { author: { select: { id: true, fullName: true } } },
      }),
    )
  })

  it('returns empty array when no comments', async () => {
    mockTaskCommentFindMany.mockResolvedValue([])

    const result = await TaskService.listComments(ORG_ID, TASK_ID)

    expect(result).toEqual([])
  })

  it('includes author name in response', async () => {
    mockTaskCommentFindMany.mockResolvedValue([sampleCommentWithAuthor])

    const result = await TaskService.listComments(ORG_ID, TASK_ID)

    expect(result[0].author).toMatchObject({ id: USER_ID, fullName: 'Alice Smith' })
  })
})

// ---------------------------------------------------------------------------
// listTasks extended filters (Req 7.8)
// ---------------------------------------------------------------------------

describe('TaskService.listTasks — extended filters', () => {
  beforeEach(() => jest.clearAllMocks())

  it('applies overdue=true filter', async () => {
    mockTaskFindMany.mockResolvedValue([{ ...sampleTask, overdue: true }])

    await TaskService.listTasks(ORG_ID, { overdue: true })

    expect(mockTaskFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ organizationId: ORG_ID, overdue: true }),
      }),
    )
  })

  it('applies overdue=false filter', async () => {
    mockTaskFindMany.mockResolvedValue([sampleTask])

    await TaskService.listTasks(ORG_ID, { overdue: false })

    expect(mockTaskFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ organizationId: ORG_ID, overdue: false }),
      }),
    )
  })

  it('applies sourceWorkflowId filter', async () => {
    const workflowId = 'wf-1234-1234-1234-123456789012'
    mockTaskFindMany.mockResolvedValue([{ ...sampleTask, sourceWorkflowId: workflowId }])

    await TaskService.listTasks(ORG_ID, { sourceWorkflowId: workflowId })

    expect(mockTaskFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ organizationId: ORG_ID, sourceWorkflowId: workflowId }),
      }),
    )
  })

  it('does not include overdue in where when filter is undefined', async () => {
    mockTaskFindMany.mockResolvedValue([])

    await TaskService.listTasks(ORG_ID, {})

    const call = mockTaskFindMany.mock.calls[0] as [{ where: Record<string, unknown> }]
    expect(call[0].where).not.toHaveProperty('overdue')
  })
})
