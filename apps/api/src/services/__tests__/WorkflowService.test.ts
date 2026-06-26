/**
 * Unit tests for WorkflowService — Task 4.1
 */

import { jest, describe, it, expect, beforeEach } from '@jest/globals'

// ---------------------------------------------------------------------------
// Prisma mocks
// ---------------------------------------------------------------------------

const mockWorkflowFindFirst = jest.fn()
const mockWorkflowFindMany = jest.fn()
const mockWorkflowCreate = jest.fn()
const mockWorkflowUpdate = jest.fn()

const mockVersionFindFirst = jest.fn()
const mockVersionFindMany = jest.fn()
const mockVersionCreate = jest.fn()
const mockVersionUpdate = jest.fn()
const mockVersionUpdateMany = jest.fn()

const mockAuditCreate = jest.fn().mockResolvedValue({})

const mockTransaction = jest.fn(async (fn: (tx: unknown) => Promise<unknown>) =>
  fn({
    workflow: { create: mockWorkflowCreate, update: mockWorkflowUpdate, findFirst: mockWorkflowFindFirst },
    workflowVersion: { create: mockVersionCreate, update: mockVersionUpdate, updateMany: mockVersionUpdateMany },
    auditLog: { create: mockAuditCreate },
  }),
)

const mockEventTypeFindFirst = jest.fn()
const mockTeamFindFirst = jest.fn()
const mockOrgMemberFindFirst = jest.fn()

jest.unstable_mockModule('../../lib/prisma.js', () => ({
  prisma: {
    workflow: {
      findFirst: mockWorkflowFindFirst,
      findMany: mockWorkflowFindMany,
    },
    workflowVersion: {
      findFirst: mockVersionFindFirst,
      findMany: mockVersionFindMany,
    },
    eventType: { findFirst: mockEventTypeFindFirst },
    team: { findFirst: mockTeamFindFirst },
    organizationMember: { findFirst: mockOrgMemberFindFirst },
    $transaction: mockTransaction,
  },
  PrismaClient: jest.fn(),
}))

jest.unstable_mockModule('@prisma/client', () => ({
  Prisma: { JsonNull: 'JsonNull', InputJsonValue: {} },
}))

// Mock ruleEvaluator and actionConfigValidator so createVersion doesn't error
jest.unstable_mockModule('../../lib/ruleEvaluator.js', () => ({
  validateExpression: jest.fn().mockReturnValue(true),
  evaluateRule: jest.fn().mockReturnValue(true),
  ExpressionSyntaxError: class ExpressionSyntaxError extends Error {},
}))

jest.unstable_mockModule('../../lib/actionConfigValidator.js', () => ({
  validateActionConfig: jest.fn().mockReturnValue({ valid: true, errors: [] }),
  validateAllActions: jest.fn().mockReturnValue(new Map()),
}))

const { WorkflowService } = await import('../WorkflowService.js')

// ---------------------------------------------------------------------------
// Sample data
// ---------------------------------------------------------------------------

const ORG_ID = 'org-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
const WF_ID  = 'wf-bbbb-bbbb-bbbb-bbbbbbbbbbbb'
const VER_ID = 'ver-cccc-cccc-cccc-cccccccccccc'
const USER_ID = 'user-dddd-dddd-dddd-dddddddddddd'
const ET_ID   = 'et-eeee-eeee-eeee-eeeeeeeeeeee'

const sampleWorkflow = {
  id: WF_ID,
  organizationId: ORG_ID,
  name: 'Abandoned Cart Recovery',
  description: null,
  currentVersionId: null,
  status: 'active',
  createdBy: USER_ID,
  createdAt: new Date('2024-01-01'),
  updatedAt: new Date('2024-01-01'),
  deletedAt: null,
}

const sampleDefinition = {
  triggerEventTypeId: ET_ID,
  rules: [{ id: 'r1', expression: 'event.payload.quantity < 10' }],
  actions: [{ id: 'a1', type: 'create_task' as const, orderIndex: 0, config: { title_template: 'Reorder' } }],
}

const sampleVersion = {
  id: VER_ID,
  workflowId: WF_ID,
  organizationId: ORG_ID,
  version: 1,
  definition: sampleDefinition,
  status: 'draft',
  createdBy: USER_ID,
  createdAt: new Date('2024-01-01'),
}

// ---------------------------------------------------------------------------
// createWorkflow
// ---------------------------------------------------------------------------

describe('WorkflowService.createWorkflow', () => {
  beforeEach(() => jest.clearAllMocks())

  it('creates workflow and writes audit log', async () => {
    mockWorkflowFindFirst.mockResolvedValue(null) // no name conflict
    mockWorkflowCreate.mockResolvedValue(sampleWorkflow)

    const result = await WorkflowService.createWorkflow(
      ORG_ID,
      { name: 'Abandoned Cart Recovery' },
      { actorId: USER_ID },
    )

    expect(result).toMatchObject({ id: WF_ID, name: 'Abandoned Cart Recovery' })
    expect(mockTransaction).toHaveBeenCalledTimes(1)
    expect(mockAuditCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: 'created', entityType: 'workflow' }),
      }),
    )
  })

  it('throws 409 when name already exists', async () => {
    mockWorkflowFindFirst.mockResolvedValue(sampleWorkflow)

    await expect(
      WorkflowService.createWorkflow(ORG_ID, { name: 'Abandoned Cart Recovery' }, { actorId: USER_ID }),
    ).rejects.toMatchObject({ statusCode: 409 })

    expect(mockTransaction).not.toHaveBeenCalled()
  })

  it('throws when actorId is missing', async () => {
    await expect(
      WorkflowService.createWorkflow(ORG_ID, { name: 'Test' }, {}),
    ).rejects.toThrow('actorId is required')
  })
})

// ---------------------------------------------------------------------------
// listWorkflows / getWorkflow
// ---------------------------------------------------------------------------

describe('WorkflowService.listWorkflows', () => {
  beforeEach(() => jest.clearAllMocks())

  it('returns all non-deleted workflows', async () => {
    mockWorkflowFindMany.mockResolvedValue([sampleWorkflow])

    const result = await WorkflowService.listWorkflows(ORG_ID)

    expect(result).toHaveLength(1)
    expect(mockWorkflowFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ organizationId: ORG_ID, deletedAt: null }),
      }),
    )
  })

  it('applies status filter', async () => {
    mockWorkflowFindMany.mockResolvedValue([])

    await WorkflowService.listWorkflows(ORG_ID, 'archived')

    expect(mockWorkflowFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ status: 'archived', deletedAt: null }),
      }),
    )
  })
})

describe('WorkflowService.getWorkflow', () => {
  beforeEach(() => jest.clearAllMocks())

  it('returns workflow when found', async () => {
    mockWorkflowFindFirst.mockResolvedValue(sampleWorkflow)

    const result = await WorkflowService.getWorkflow(ORG_ID, WF_ID)

    expect(result).toMatchObject({ id: WF_ID })
    expect(mockWorkflowFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: WF_ID, organizationId: ORG_ID, deletedAt: null },
      }),
    )
  })

  it('returns null when not found', async () => {
    mockWorkflowFindFirst.mockResolvedValue(null)
    expect(await WorkflowService.getWorkflow(ORG_ID, 'missing')).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// updateWorkflow
// ---------------------------------------------------------------------------

describe('WorkflowService.updateWorkflow', () => {
  beforeEach(() => jest.clearAllMocks())

  it('updates and returns the workflow', async () => {
    const updated = { ...sampleWorkflow, name: 'New Name' }
    mockWorkflowFindFirst
      .mockResolvedValueOnce(sampleWorkflow) // load existing
      .mockResolvedValueOnce(null)            // name conflict check
    mockWorkflowUpdate.mockResolvedValue(updated)

    const result = await WorkflowService.updateWorkflow(ORG_ID, WF_ID, { name: 'New Name' })

    expect(result).toMatchObject({ name: 'New Name' })
    expect(mockAuditCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: 'updated' }),
      }),
    )
  })

  it('throws 404 when not found', async () => {
    mockWorkflowFindFirst.mockResolvedValue(null)

    await expect(
      WorkflowService.updateWorkflow(ORG_ID, 'missing', { name: 'X' }),
    ).rejects.toMatchObject({ statusCode: 404 })
  })

  it('throws 409 on name conflict', async () => {
    const other = { ...sampleWorkflow, id: 'other-id', name: 'Taken' }
    mockWorkflowFindFirst
      .mockResolvedValueOnce(sampleWorkflow)
      .mockResolvedValueOnce(other)

    await expect(
      WorkflowService.updateWorkflow(ORG_ID, WF_ID, { name: 'Taken' }),
    ).rejects.toMatchObject({ statusCode: 409 })
  })
})

// ---------------------------------------------------------------------------
// deleteWorkflow
// ---------------------------------------------------------------------------

describe('WorkflowService.deleteWorkflow', () => {
  beforeEach(() => jest.clearAllMocks())

  it('soft-deletes the workflow', async () => {
    const deleted = { ...sampleWorkflow, deletedAt: new Date(), status: 'archived' }
    mockWorkflowFindFirst.mockResolvedValue(sampleWorkflow)
    mockWorkflowUpdate.mockResolvedValue(deleted)

    const result = await WorkflowService.deleteWorkflow(ORG_ID, WF_ID, { actorId: USER_ID })

    expect(result.deletedAt).not.toBeNull()
    expect(mockTransaction).toHaveBeenCalledTimes(1)
    expect(mockAuditCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: 'deleted' }),
      }),
    )
  })

  it('is idempotent — returns already-deleted workflow', async () => {
    const already = { ...sampleWorkflow, deletedAt: new Date() }
    mockWorkflowFindFirst.mockResolvedValue(already)

    const result = await WorkflowService.deleteWorkflow(ORG_ID, WF_ID)

    expect(result.deletedAt).not.toBeNull()
    expect(mockTransaction).not.toHaveBeenCalled()
  })

  it('throws 404 when workflow not found', async () => {
    mockWorkflowFindFirst.mockResolvedValue(null)

    await expect(WorkflowService.deleteWorkflow(ORG_ID, 'missing')).rejects.toMatchObject({
      statusCode: 404,
    })
  })
})

// ---------------------------------------------------------------------------
// createVersion
// ---------------------------------------------------------------------------

describe('WorkflowService.createVersion', () => {
  beforeEach(() => jest.clearAllMocks())

  it('creates v1 when no prior versions exist', async () => {
    mockWorkflowFindFirst.mockResolvedValue(sampleWorkflow)
    mockVersionFindFirst.mockResolvedValue(null) // no existing versions
    mockVersionCreate.mockResolvedValue(sampleVersion)

    const result = await WorkflowService.createVersion(
      ORG_ID, WF_ID, { definition: sampleDefinition }, { actorId: USER_ID },
    )

    expect(result.version).toBe(1)
    expect(result.status).toBe('draft')
    expect(mockVersionCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ version: 1, status: 'draft' }),
      }),
    )
  })

  it('auto-increments version number', async () => {
    mockWorkflowFindFirst.mockResolvedValue(sampleWorkflow)
    mockVersionFindFirst.mockResolvedValue({ ...sampleVersion, version: 3 }) // latest is v3
    mockVersionCreate.mockResolvedValue({ ...sampleVersion, version: 4 })

    const result = await WorkflowService.createVersion(
      ORG_ID, WF_ID, { definition: sampleDefinition }, { actorId: USER_ID },
    )

    expect(mockVersionCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ version: 4 }),
      }),
    )
    void result
  })

  it('throws 404 when workflow not found', async () => {
    mockWorkflowFindFirst.mockResolvedValue(null)

    await expect(
      WorkflowService.createVersion(ORG_ID, 'missing', { definition: sampleDefinition }, { actorId: USER_ID }),
    ).rejects.toMatchObject({ statusCode: 404 })
  })
})

// ---------------------------------------------------------------------------
// publishVersion
// ---------------------------------------------------------------------------

describe('WorkflowService.publishVersion', () => {
  beforeEach(() => jest.clearAllMocks())

  it('publishes a draft version and archives the previously published one', async () => {
    const published = { ...sampleVersion, status: 'published' }
    mockVersionFindFirst.mockResolvedValue(sampleVersion) // draft version
    // Reference validation mocks
    mockEventTypeFindFirst.mockResolvedValue({ id: ET_ID, status: 'active' })
    mockTeamFindFirst.mockResolvedValue(null)    // no team refs in sample def
    mockOrgMemberFindFirst.mockResolvedValue(null)
    mockVersionUpdateMany.mockResolvedValue({ count: 1 })
    mockVersionUpdate.mockResolvedValue(published)
    mockWorkflowUpdate.mockResolvedValue({}) // update currentVersionId

    const result = await WorkflowService.publishVersion(ORG_ID, VER_ID, { actorId: USER_ID })

    expect(result.status).toBe('published')
    // Old published versions archived
    expect(mockVersionUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ status: 'published' }),
        data: { status: 'archived' },
      }),
    )
    // workflow.currentVersionId updated
    expect(mockWorkflowUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: { currentVersionId: VER_ID } }),
    )
  })

  it('throws 404 when version not found', async () => {
    mockVersionFindFirst.mockResolvedValue(null)

    await expect(
      WorkflowService.publishVersion(ORG_ID, 'missing'),
    ).rejects.toMatchObject({ statusCode: 404 })
  })

  it('throws 422 when version is not in draft status', async () => {
    mockVersionFindFirst.mockResolvedValue({ ...sampleVersion, status: 'published' })

    await expect(
      WorkflowService.publishVersion(ORG_ID, VER_ID),
    ).rejects.toMatchObject({ statusCode: 422 })
  })
})

// ---------------------------------------------------------------------------
// archiveVersion
// ---------------------------------------------------------------------------

describe('WorkflowService.archiveVersion', () => {
  beforeEach(() => jest.clearAllMocks())

  it('archives a draft version', async () => {
    const archived = { ...sampleVersion, status: 'archived' }
    mockVersionFindFirst.mockResolvedValue(sampleVersion) // draft
    mockVersionUpdate.mockResolvedValue(archived)
    mockWorkflowFindFirst.mockResolvedValue(sampleWorkflow) // currentVersionId = null

    const result = await WorkflowService.archiveVersion(ORG_ID, VER_ID)

    expect(result.status).toBe('archived')
    expect(mockAuditCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: 'status_changed' }),
      }),
    )
  })

  it('is idempotent — returns already-archived version', async () => {
    mockVersionFindFirst.mockResolvedValue({ ...sampleVersion, status: 'archived' })

    const result = await WorkflowService.archiveVersion(ORG_ID, VER_ID)

    expect(result.status).toBe('archived')
    expect(mockTransaction).not.toHaveBeenCalled()
  })

  it('throws 404 when version not found', async () => {
    mockVersionFindFirst.mockResolvedValue(null)

    await expect(WorkflowService.archiveVersion(ORG_ID, 'missing')).rejects.toMatchObject({
      statusCode: 404,
    })
  })
})

// ---------------------------------------------------------------------------
// publishVersion — reference validation branches (coverage gap closure)
// These tests cover the action-reference validation paths in publishVersion
// that were previously uncovered (lines 420-453, 538 in WorkflowService.ts)
// ---------------------------------------------------------------------------

describe('WorkflowService.publishVersion — reference validation', () => {
  beforeEach(() => jest.clearAllMocks())

  const versionWithActions = (actions: object[]) => ({
    ...sampleVersion,
    definition: { ...sampleDefinition, actions },
  })

  it('throws 422 when triggerEventTypeId does not exist or is inactive', async () => {
    mockVersionFindFirst.mockResolvedValue(sampleVersion)
    mockEventTypeFindFirst.mockResolvedValue(null) // event type not found

    await expect(
      WorkflowService.publishVersion(ORG_ID, VER_ID),
    ).rejects.toMatchObject({ statusCode: 422 })
  })

  it('throws 422 when create_task references a non-existent team', async () => {
    const version = versionWithActions([{
      id: 'a1', type: 'create_task', orderIndex: 0,
      config: { title_template: 'Task', assignee_type: 'team', assignee_id: 'team-missing' },
    }])
    mockVersionFindFirst.mockResolvedValue(version)
    mockEventTypeFindFirst.mockResolvedValue({ id: ET_ID, status: 'active' })
    mockTeamFindFirst.mockResolvedValue(null) // team not found
    mockOrgMemberFindFirst.mockResolvedValue(null)

    await expect(
      WorkflowService.publishVersion(ORG_ID, VER_ID),
    ).rejects.toMatchObject({ statusCode: 422 })
  })

  it('throws 422 when create_task references a non-existent user', async () => {
    const version = versionWithActions([{
      id: 'a1', type: 'create_task', orderIndex: 0,
      config: { title_template: 'Task', assignee_type: 'user', assignee_id: 'user-missing' },
    }])
    mockVersionFindFirst.mockResolvedValue(version)
    mockEventTypeFindFirst.mockResolvedValue({ id: ET_ID, status: 'active' })
    mockOrgMemberFindFirst.mockResolvedValue(null) // user not an active member

    await expect(
      WorkflowService.publishVersion(ORG_ID, VER_ID),
    ).rejects.toMatchObject({ statusCode: 422 })
  })

  it('throws 422 when send_notification references a non-existent team', async () => {
    const version = versionWithActions([{
      id: 'a1', type: 'send_notification', orderIndex: 0,
      config: { recipient_type: 'team', recipient_id: 'team-missing', message_template: 'hi' },
    }])
    mockVersionFindFirst.mockResolvedValue(version)
    mockEventTypeFindFirst.mockResolvedValue({ id: ET_ID, status: 'active' })
    mockTeamFindFirst.mockResolvedValue(null) // team not found

    await expect(
      WorkflowService.publishVersion(ORG_ID, VER_ID),
    ).rejects.toMatchObject({ statusCode: 422 })
  })

  it('throws 422 when send_notification references a non-existent user', async () => {
    const version = versionWithActions([{
      id: 'a1', type: 'send_notification', orderIndex: 0,
      config: { recipient_type: 'user', recipient_id: 'user-missing', message_template: 'hi' },
    }])
    mockVersionFindFirst.mockResolvedValue(version)
    mockEventTypeFindFirst.mockResolvedValue({ id: ET_ID, status: 'active' })
    mockOrgMemberFindFirst.mockResolvedValue(null) // user not active

    await expect(
      WorkflowService.publishVersion(ORG_ID, VER_ID),
    ).rejects.toMatchObject({ statusCode: 422 })
  })

  it('accumulates multiple invalid refs into one 422 error', async () => {
    const version = versionWithActions([
      { id: 'a1', type: 'create_task', orderIndex: 0, config: { title_template: 'T', assignee_type: 'team', assignee_id: 'bad-team' } },
      { id: 'a2', type: 'send_notification', orderIndex: 1, config: { recipient_type: 'user', recipient_id: 'bad-user', message_template: 'm' } },
    ])
    mockVersionFindFirst.mockResolvedValue(version)
    mockEventTypeFindFirst.mockResolvedValue({ id: ET_ID, status: 'active' })
    mockTeamFindFirst.mockResolvedValue(null)     // team not found
    mockOrgMemberFindFirst.mockResolvedValue(null) // user not active

    await expect(
      WorkflowService.publishVersion(ORG_ID, VER_ID),
    ).rejects.toMatchObject({ statusCode: 422 })
  })
})
