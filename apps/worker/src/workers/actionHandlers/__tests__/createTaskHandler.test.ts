/**
 * createTaskHandler unit tests
 *
 * Tests task creation, idempotent UUID derivation, and task assignment.
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals'
import type { ActionExecutionContext } from '../index.js'

// ---------------------------------------------------------------------------
// Mock Prisma
// ---------------------------------------------------------------------------

const mockUpsert = jest.fn<(args: unknown) => Promise<unknown>>()
const mockFindFirst = jest.fn<(args: unknown) => Promise<unknown>>()
const mockCreate = jest.fn<(args: unknown) => Promise<unknown>>()
const mockTransaction = jest.fn<(fn: (tx: unknown) => Promise<unknown>) => Promise<unknown>>()

jest.unstable_mockModule('@opscore/database', () => ({
  prisma: {
    $transaction: mockTransaction,
    task: { upsert: mockUpsert },
    taskAssignment: { findFirst: mockFindFirst, create: mockCreate },
  },
}))

// Dynamic import after mock registration
const { createTaskHandler, deriveIdempotentTaskId } = await import('../createTaskHandler.js')

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeContext(overrides: Partial<ActionExecutionContext> = {}): ActionExecutionContext {
  return {
    actionType: 'create_task',
    config: {
      title_template: 'Task for {{event.source}}',
      priority: 'medium',
    },
    event: {
      id: 'evt-001',
      eventTypeId: 'et-001',
      payload: { quantity: 5 },
      source: 'api',
    },
    executionId: 'exec-001',
    orgId: 'org-001',
    orderIndex: 0,
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

describe('deriveIdempotentTaskId', () => {
  it('produces a valid UUID v4 format', () => {
    const id = deriveIdempotentTaskId('exec-001', 0)
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
  })

  it('is deterministic — same inputs produce the same UUID', () => {
    const a = deriveIdempotentTaskId('exec-abc', 2)
    const b = deriveIdempotentTaskId('exec-abc', 2)
    expect(a).toBe(b)
  })

  it('produces different IDs for different executionIds', () => {
    const a = deriveIdempotentTaskId('exec-001', 0)
    const b = deriveIdempotentTaskId('exec-002', 0)
    expect(a).not.toBe(b)
  })

  it('produces different IDs for different orderIndexes', () => {
    const a = deriveIdempotentTaskId('exec-001', 0)
    const b = deriveIdempotentTaskId('exec-001', 1)
    expect(a).not.toBe(b)
  })

  it('sets the version nibble to 4', () => {
    const id = deriveIdempotentTaskId('execution-xyz', 5)
    // The 13th hex digit (position 14 in "xxxxxxxx-xxxx-4xxx") must be 4
    expect(id[14]).toBe('4')
  })

  it('sets the variant bits correctly (8, 9, a, or b)', () => {
    const id = deriveIdempotentTaskId('execution-xyz', 5)
    // The 17th char (position 19 after the third dash) must be 8, 9, a, or b
    expect(['8', '9', 'a', 'b']).toContain(id[19])
  })
})

describe('createTaskHandler', () => {
  beforeEach(() => {
    jest.clearAllMocks()

    // Default: transaction executes the callback
    mockTransaction.mockImplementation(async (fn) => {
      const fakeTx = {
        task: { upsert: mockUpsert },
        taskAssignment: { findFirst: mockFindFirst, create: mockCreate },
      }
      return fn(fakeTx)
    })

    mockUpsert.mockResolvedValue({ id: 'task-seeded', title: 'Task for api' })
    mockFindFirst.mockResolvedValue(null) // no existing assignment
    mockCreate.mockResolvedValue({})
  })

  it('renders the title template with event data', async () => {
    const ctx = makeContext()
    await createTaskHandler(ctx)

    expect(mockUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          title: 'Task for api',
        }),
      }),
    )
  })

  it('uses the deterministic seeded id for the upsert', async () => {
    const ctx = makeContext()
    const expectedId = deriveIdempotentTaskId('exec-001', 0)

    await createTaskHandler(ctx)

    expect(mockUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: expectedId },
        create: expect.objectContaining({ id: expectedId }),
      }),
    )
  })

  it('creates a task assignment when assignee_type and assignee_id are provided', async () => {
    const ctx = makeContext({
      config: {
        title_template: 'Alert: {{event.source}}',
        priority: 'high',
        assignee_type: 'user',
        assignee_id: 'user-999',
      },
    })

    await createTaskHandler(ctx)

    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          assigneeType: 'user',
          userId: 'user-999',
          teamId: null,
        }),
      }),
    )
  })

  it('assigns to a team when assignee_type is team', async () => {
    const ctx = makeContext({
      config: {
        title_template: 'Team task',
        priority: 'low',
        assignee_type: 'team',
        assignee_id: 'team-555',
      },
    })

    await createTaskHandler(ctx)

    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          assigneeType: 'team',
          teamId: 'team-555',
          userId: null,
        }),
      }),
    )
  })

  it('skips assignment creation when no assignee is configured', async () => {
    const ctx = makeContext() // no assignee in config
    await createTaskHandler(ctx)

    expect(mockCreate).not.toHaveBeenCalled()
  })

  it('skips assignment creation when assignment already exists (idempotency)', async () => {
    mockFindFirst.mockResolvedValue({ id: 'existing-assignment' })

    const ctx = makeContext({
      config: {
        title_template: 'Dup task',
        priority: 'medium',
        assignee_type: 'user',
        assignee_id: 'user-1',
      },
    })

    await createTaskHandler(ctx)

    expect(mockCreate).not.toHaveBeenCalled()
  })

  it('computes due date correctly when due_in_hours is provided', async () => {
    const before = Date.now()
    const ctx = makeContext({
      config: {
        title_template: 'Due task',
        priority: 'critical',
        due_in_hours: 24,
      },
    })

    await createTaskHandler(ctx)

    const call = (mockUpsert as jest.Mock).mock.calls[0]?.[0] as {
      create: { dueDate: Date }
    }
    const dueDate = call.create.dueDate
    expect(dueDate).toBeInstanceOf(Date)
    const expectedDue = before + 24 * 60 * 60 * 1000
    // Allow a small drift (1 second)
    expect(Math.abs(dueDate.getTime() - expectedDue)).toBeLessThan(1000)
  })

  it('sets dueDate to null when due_in_hours is not provided', async () => {
    const ctx = makeContext()
    await createTaskHandler(ctx)

    const call = (mockUpsert as jest.Mock).mock.calls[0]?.[0] as {
      create: { dueDate: Date | null }
    }
    expect(call.create.dueDate).toBeNull()
  })

  it('sets createdBy to null (workflow-created tasks have no user creator)', async () => {
    const ctx = makeContext()
    await createTaskHandler(ctx)

    const call = (mockUpsert as jest.Mock).mock.calls[0]?.[0] as {
      create: { createdBy: string | null }
    }
    expect(call.create.createdBy).toBeNull()
  })
})
