/**
 * Unit tests for AuditService — Task 7.1
 *
 * Tests:
 *  - scrubSensitiveFields: strips password_hash, token variants, secrets
 *  - AuditService.log: correct data written to tx.auditLog.create
 *  - AuditService.log: scrubbing applied before persist
 *  - AuditService.log: works inside a transaction
 *
 * Uses the same jest.unstable_mockModule + dynamic import pattern as other
 * service tests in this codebase.
 */

import { jest, describe, it, expect, beforeEach } from '@jest/globals'

// ---------------------------------------------------------------------------
// Prisma mock — AuditService only needs a transaction client
// ---------------------------------------------------------------------------

const mockAuditCreate = jest.fn().mockResolvedValue({})

// Mock the prisma module — AuditService does NOT import prisma directly
// (it only accepts a TransactionClient). We provide the mock here so that
// any transitive imports don't fail.
jest.unstable_mockModule('../../lib/prisma.js', () => ({
  prisma: {
    $transaction: jest.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn({
      auditLog: { create: mockAuditCreate },
    })),
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

const { AuditService, scrubSensitiveFields } = await import('../AuditService.js')

// ---------------------------------------------------------------------------
// Helper: build a minimal mock TransactionClient
// ---------------------------------------------------------------------------

function makeTx() {
  return {
    auditLog: { create: mockAuditCreate },
  } as unknown as Parameters<typeof AuditService.log>[0]
}

// ---------------------------------------------------------------------------
// scrubSensitiveFields
// ---------------------------------------------------------------------------

describe('scrubSensitiveFields', () => {
  it('returns null for null input', () => {
    expect(scrubSensitiveFields(null)).toBeNull()
  })

  it('returns null for undefined input', () => {
    expect(scrubSensitiveFields(undefined)).toBeNull()
  })

  it('passes through fields that are not sensitive', () => {
    const state = { id: 'abc', name: 'Alice', status: 'active' }
    expect(scrubSensitiveFields(state)).toEqual(state)
  })

  it('strips password_hash', () => {
    const state = { id: 'u1', password_hash: 'bcrypt-hash', email: 'a@b.com' }
    const result = scrubSensitiveFields(state)
    expect(result).not.toHaveProperty('password_hash')
    expect(result).toMatchObject({ id: 'u1', email: 'a@b.com' })
  })

  it('strips passwordHash (camelCase)', () => {
    const state = { id: 'u1', passwordHash: 'bcrypt-hash' }
    const result = scrubSensitiveFields(state)
    expect(result).not.toHaveProperty('passwordHash')
  })

  it('strips token', () => {
    const state = { id: 'rt1', token: 'raw-token', userId: 'u1' }
    const result = scrubSensitiveFields(state)
    expect(result).not.toHaveProperty('token')
    expect(result).toMatchObject({ id: 'rt1', userId: 'u1' })
  })

  it('strips tokenHash', () => {
    expect(scrubSensitiveFields({ tokenHash: 'hash', id: '1' })).not.toHaveProperty('tokenHash')
  })

  it('strips token_hash', () => {
    expect(scrubSensitiveFields({ token_hash: 'hash', id: '1' })).not.toHaveProperty('token_hash')
  })

  it('strips refreshToken', () => {
    expect(scrubSensitiveFields({ refreshToken: 'rt', id: '1' })).not.toHaveProperty('refreshToken')
  })

  it('strips refresh_token', () => {
    expect(scrubSensitiveFields({ refresh_token: 'rt', id: '1' })).not.toHaveProperty('refresh_token')
  })

  it('strips invitationToken', () => {
    expect(scrubSensitiveFields({ invitationToken: 'inv', id: '1' })).not.toHaveProperty('invitationToken')
  })

  it('strips invitation_token', () => {
    expect(scrubSensitiveFields({ invitation_token: 'inv', id: '1' })).not.toHaveProperty('invitation_token')
  })

  it('strips secret', () => {
    expect(scrubSensitiveFields({ secret: 's3cr3t', id: '1' })).not.toHaveProperty('secret')
  })

  it('strips privateKey', () => {
    expect(scrubSensitiveFields({ privateKey: 'key', id: '1' })).not.toHaveProperty('privateKey')
  })

  it('strips private_key', () => {
    expect(scrubSensitiveFields({ private_key: 'key', id: '1' })).not.toHaveProperty('private_key')
  })

  it('strips multiple sensitive fields at once', () => {
    const state = {
      id: 'u1',
      email: 'a@b.com',
      password_hash: 'h1',
      token: 't1',
      secret: 's1',
      fullName: 'Alice',
    }
    const result = scrubSensitiveFields(state)
    expect(result).toEqual({ id: 'u1', email: 'a@b.com', fullName: 'Alice' })
  })

  it('preserves non-sensitive fields containing "token" in their value (not key)', () => {
    const state = { id: '1', description: 'token-based auth' }
    expect(scrubSensitiveFields(state)).toEqual(state)
  })
})

// ---------------------------------------------------------------------------
// AuditService.log
// ---------------------------------------------------------------------------

const ORG_ID = 'org-1111-aaaa-bbbb-cccccccccccc'
const ENTITY_ID = 'ent-2222-aaaa-bbbb-cccccccccccc'
const ACTOR_ID = 'usr-3333-aaaa-bbbb-cccccccccccc'

describe('AuditService.log', () => {
  beforeEach(() => jest.clearAllMocks())

  it('calls tx.auditLog.create with correct base fields', async () => {
    const tx = makeTx()

    await AuditService.log(tx, {
      orgId: ORG_ID,
      entityType: 'workflow',
      entityId: ENTITY_ID,
      action: 'created',
      actorType: 'user',
      actorId: ACTOR_ID,
      beforeState: null,
      afterState: { id: ENTITY_ID, name: 'My Workflow' },
      requestId: 'req-abc-123',
    })

    expect(mockAuditCreate).toHaveBeenCalledTimes(1)
    expect(mockAuditCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          organizationId: ORG_ID,
          entityType: 'workflow',
          entityId: ENTITY_ID,
          action: 'created',
          actorType: 'user',
          actorId: ACTOR_ID,
          requestId: 'req-abc-123',
        }),
      }),
    )
  })

  it('stores afterState without sensitive fields', async () => {
    const tx = makeTx()

    await AuditService.log(tx, {
      orgId: ORG_ID,
      entityType: 'user',
      entityId: ENTITY_ID,
      action: 'created',
      actorType: 'system',
      afterState: {
        id: ENTITY_ID,
        email: 'alice@example.com',
        password_hash: 'bcrypt$...',
        fullName: 'Alice',
        token: 'raw-token',
      },
    })

    const callArg = (mockAuditCreate.mock.calls[0] as [{ data: { afterState: Record<string, unknown> } }])[0]
    const afterState = callArg.data.afterState
    expect(afterState).not.toHaveProperty('password_hash')
    expect(afterState).not.toHaveProperty('token')
    expect(afterState).toMatchObject({ id: ENTITY_ID, email: 'alice@example.com', fullName: 'Alice' })
  })

  it('stores beforeState without sensitive fields', async () => {
    const tx = makeTx()

    await AuditService.log(tx, {
      orgId: ORG_ID,
      entityType: 'user',
      entityId: ENTITY_ID,
      action: 'updated',
      actorType: 'user',
      actorId: ACTOR_ID,
      beforeState: {
        id: ENTITY_ID,
        passwordHash: 'old-hash',
        refreshToken: 'old-rt',
        email: 'old@example.com',
      },
      afterState: { id: ENTITY_ID, email: 'new@example.com' },
    })

    const callArg = (mockAuditCreate.mock.calls[0] as [{ data: { beforeState: Record<string, unknown> } }])[0]
    const beforeState = callArg.data.beforeState
    expect(beforeState).not.toHaveProperty('passwordHash')
    expect(beforeState).not.toHaveProperty('refreshToken')
    expect(beforeState).toMatchObject({ id: ENTITY_ID, email: 'old@example.com' })
  })

  it('stores null beforeState when input is null', async () => {
    const tx = makeTx()

    await AuditService.log(tx, {
      orgId: ORG_ID,
      entityType: 'task',
      entityId: ENTITY_ID,
      action: 'created',
      actorType: 'system',
      beforeState: null,
      afterState: { id: ENTITY_ID, status: 'pending' },
    })

    const callArg = (mockAuditCreate.mock.calls[0] as [{ data: { beforeState: unknown } }])[0]
    // Prisma.JsonNull is 'JsonNull' in test environment (mocked @prisma/client)
    // The important thing is the service passes a JSON null sentinel (not undefined)
    expect(callArg.data.beforeState).toBeTruthy() // Prisma.JsonNull sentinel
  })

  it('defaults actorId to null when omitted', async () => {
    const tx = makeTx()

    await AuditService.log(tx, {
      orgId: ORG_ID,
      entityType: 'event',
      entityId: ENTITY_ID,
      action: 'created',
      actorType: 'system',
    })

    expect(mockAuditCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ actorId: null }),
      }),
    )
  })

  it('defaults requestId to null when omitted', async () => {
    const tx = makeTx()

    await AuditService.log(tx, {
      orgId: ORG_ID,
      entityType: 'event',
      entityId: ENTITY_ID,
      action: 'created',
      actorType: 'system',
    })

    expect(mockAuditCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ requestId: null }),
      }),
    )
  })

  it('propagates errors thrown by tx.auditLog.create', async () => {
    const tx = makeTx()
    mockAuditCreate.mockRejectedValueOnce(new Error('DB constraint violation'))

    await expect(
      AuditService.log(tx, {
        orgId: ORG_ID,
        entityType: 'task',
        entityId: ENTITY_ID,
        action: 'created',
        actorType: 'system',
      }),
    ).rejects.toThrow('DB constraint violation')
  })

  it('works when called inside a simulated prisma.$transaction', async () => {
    // Simulate being called inside a transaction callback, as intended
    const txAuditCreate = jest.fn().mockResolvedValue({})
    const mockTx = { auditLog: { create: txAuditCreate } } as unknown as Parameters<typeof AuditService.log>[0]

    // Simulate transaction callback
    const transactionCallback = async (tx: typeof mockTx) => {
      // Some other DB write would happen here first...
      await AuditService.log(tx, {
        orgId: ORG_ID,
        entityType: 'organization',
        entityId: ENTITY_ID,
        action: 'updated',
        actorType: 'user',
        actorId: ACTOR_ID,
        beforeState: { name: 'Old Name' },
        afterState: { name: 'New Name' },
        requestId: 'req-xyz',
      })
    }

    await transactionCallback(mockTx)

    expect(txAuditCreate).toHaveBeenCalledTimes(1)
    expect(txAuditCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          organizationId: ORG_ID,
          entityType: 'organization',
          entityId: ENTITY_ID,
          action: 'updated',
          actorId: ACTOR_ID,
          requestId: 'req-xyz',
          beforeState: { name: 'Old Name' },
          afterState: { name: 'New Name' },
        }),
      }),
    )
  })

  it('handles status_changed action correctly', async () => {
    const tx = makeTx()

    await AuditService.log(tx, {
      orgId: ORG_ID,
      entityType: 'task',
      entityId: ENTITY_ID,
      action: 'status_changed',
      actorType: 'user',
      actorId: ACTOR_ID,
      beforeState: { status: 'pending' },
      afterState: { status: 'in_progress' },
    })

    expect(mockAuditCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: 'status_changed',
          beforeState: { status: 'pending' },
          afterState: { status: 'in_progress' },
        }),
      }),
    )
  })
})
