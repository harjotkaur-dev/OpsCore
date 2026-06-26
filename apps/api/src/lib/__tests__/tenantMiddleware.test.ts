/**
 * Unit tests for src/lib/tenantMiddleware.ts
 *
 * Covers:
 *  - ForbiddenError — statusCode, code, name, message
 *  - applyTenantScope — injects organizationId into WHERE ops
 *  - applyTenantScope — injects organizationId into create data
 *  - applyTenantScope — does NOT inject into findUnique / findUniqueOrThrow
 *  - applyTenantScope — excluded models (Organization, User) pass through unchanged
 *  - applyTenantScope — passes through when no tenant context is set
 *  - applyTenantScope — upsert injects into where clause
 */

import { jest } from '@jest/globals'
import { ForbiddenError, applyTenantScope } from '../tenantMiddleware.js'
import { runWithOrgId } from '../tenantContext.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeQuery(capture: { args?: Record<string, unknown> }) {
  return jest.fn(async (args: Record<string, unknown>) => {
    capture.args = args
    return { id: 'fake-result' }
  })
}

// ---------------------------------------------------------------------------
// ForbiddenError
// ---------------------------------------------------------------------------

describe('ForbiddenError', () => {
  it('has statusCode 403', () => {
    const err = new ForbiddenError()
    expect(err.statusCode).toBe(403)
  })

  it('has code FORBIDDEN', () => {
    const err = new ForbiddenError()
    expect(err.code).toBe('FORBIDDEN')
  })

  it('has name ForbiddenError', () => {
    const err = new ForbiddenError()
    expect(err.name).toBe('ForbiddenError')
  })

  it('uses a default message when none is provided', () => {
    const err = new ForbiddenError()
    expect(err.message).toBeTruthy()
  })

  it('uses the provided message', () => {
    const err = new ForbiddenError('Custom message')
    expect(err.message).toBe('Custom message')
  })

  it('is an instance of Error', () => {
    expect(new ForbiddenError()).toBeInstanceOf(Error)
  })
})

// ---------------------------------------------------------------------------
// WHERE injection operations
// ---------------------------------------------------------------------------

describe('applyTenantScope — WHERE operations', () => {
  const ORG_ID = 'org-tenant-abc'

  const whereOps = [
    'findMany',
    'findFirst',
    'findFirstOrThrow',
    'update',
    'updateMany',
    'delete',
    'deleteMany',
    'upsert',
  ]

  for (const operation of whereOps) {
    it(`injects organizationId into where for "${operation}"`, async () => {
      const captured: { args?: Record<string, unknown> } = {}
      const query = makeQuery(captured)

      await runWithOrgId(ORG_ID, () =>
        applyTenantScope({ model: 'Task', operation, args: { where: { status: 'pending' } }, query }),
      )

      expect(query).toHaveBeenCalledTimes(1)
      const calledArgs = captured.args as { where: Record<string, unknown> }
      expect(calledArgs.where.organizationId).toBe(ORG_ID)
      // Existing where fields must be preserved
      expect(calledArgs.where.status).toBe('pending')
    })

    it(`creates where object when none exists for "${operation}"`, async () => {
      const captured: { args?: Record<string, unknown> } = {}
      const query = makeQuery(captured)

      await runWithOrgId(ORG_ID, () =>
        applyTenantScope({ model: 'Task', operation, args: {}, query }),
      )

      const calledArgs = captured.args as { where: Record<string, unknown> }
      expect(calledArgs.where.organizationId).toBe(ORG_ID)
    })
  }
})

// ---------------------------------------------------------------------------
// CREATE injection (data)
// ---------------------------------------------------------------------------

describe('applyTenantScope — create operation', () => {
  const ORG_ID = 'org-create-test'

  it('injects organizationId into data for create', async () => {
    const captured: { args?: Record<string, unknown> } = {}
    const query = makeQuery(captured)

    await runWithOrgId(ORG_ID, () =>
      applyTenantScope({
        model: 'Task',
        operation: 'create',
        args: { data: { title: 'My Task' } },
        query,
      }),
    )

    const calledArgs = captured.args as { data: Record<string, unknown> }
    expect(calledArgs.data.organizationId).toBe(ORG_ID)
    expect(calledArgs.data.title).toBe('My Task')
  })

  it('creates data object when none exists for create', async () => {
    const captured: { args?: Record<string, unknown> } = {}
    const query = makeQuery(captured)

    await runWithOrgId(ORG_ID, () =>
      applyTenantScope({ model: 'Task', operation: 'create', args: {}, query }),
    )

    const calledArgs = captured.args as { data: Record<string, unknown> }
    expect(calledArgs.data.organizationId).toBe(ORG_ID)
  })
})

// ---------------------------------------------------------------------------
// findUnique / findUniqueOrThrow — no injection
// ---------------------------------------------------------------------------

describe('applyTenantScope — findUnique operations', () => {
  const ORG_ID = 'org-unique-test'

  for (const operation of ['findUnique', 'findUniqueOrThrow']) {
    it(`does NOT inject organizationId for "${operation}"`, async () => {
      const captured: { args?: Record<string, unknown> } = {}
      const query = makeQuery(captured)
      const originalArgs = { where: { id: 'some-uuid' } }

      await runWithOrgId(ORG_ID, () =>
        applyTenantScope({ model: 'Task', operation, args: originalArgs, query }),
      )

      // Args should be passed through unchanged
      expect(captured.args).toEqual(originalArgs)
      const calledWhere = captured.args?.['where'] as Record<string, unknown>
      expect(calledWhere['organizationId']).toBeUndefined()
    })
  }
})

// ---------------------------------------------------------------------------
// Excluded models
// ---------------------------------------------------------------------------

describe('applyTenantScope — excluded models', () => {
  const ORG_ID = 'org-excluded'

  for (const model of ['Organization', 'User']) {
    it(`passes through unchanged for model "${model}"`, async () => {
      const captured: { args?: Record<string, unknown> } = {}
      const query = makeQuery(captured)
      const originalArgs = { where: { id: 'abc' } }

      await runWithOrgId(ORG_ID, () =>
        applyTenantScope({ model, operation: 'findMany', args: originalArgs, query }),
      )

      // No organizationId injected
      const calledWhere = captured.args?.['where'] as Record<string, unknown>
      expect(calledWhere['organizationId']).toBeUndefined()
    })
  }
})

// ---------------------------------------------------------------------------
// No tenant context — passthrough
// ---------------------------------------------------------------------------

describe('applyTenantScope — no tenant context', () => {
  it('passes args through unchanged when getOrgId returns null', async () => {
    const captured: { args?: Record<string, unknown> } = {}
    const query = makeQuery(captured)
    const originalArgs = { where: { id: 'abc' } }

    // Called OUTSIDE any runWithOrgId scope
    await applyTenantScope({ model: 'Task', operation: 'findMany', args: originalArgs, query })

    expect(captured.args).toEqual(originalArgs)
  })
})
