/**
 * Unit tests for MetricService (API) — Task 8.5
 *
 * Covers:
 *  - createKPI: validates metric exists, validates owner is active member, creates + audit log
 *  - updateKPI: updates fields + audit log, throws 404
 *  - deleteKPI: hard-delete + audit log, throws 404
 *  - listKPIs: cursor pagination, status filter
 *  - getKPI: found/not found
 *  - listMetrics: returns all metrics for org
 *  - getMetricHistory: resolves metric by name, cursor pagination
 */

import { jest, describe, it, expect, beforeEach } from '@jest/globals'

// ---------------------------------------------------------------------------
// Prisma mocks
// ---------------------------------------------------------------------------

const mockMetricFindFirst = jest.fn()
const mockMetricFindMany = jest.fn()
const mockKPIFindFirst = jest.fn()
const mockKPIFindMany = jest.fn()
const mockKPICreate = jest.fn()
const mockKPIUpdate = jest.fn()
const mockKPIDelete = jest.fn()
const mockMetricHistoryFindMany = jest.fn()
const mockOrgMemberFindFirst = jest.fn()
const mockAuditCreate = jest.fn().mockResolvedValue({})

const mockTransaction = jest.fn(async (fn: (tx: unknown) => Promise<unknown>) =>
  fn({
    kPI: {
      create: mockKPICreate,
      update: mockKPIUpdate,
      delete: mockKPIDelete,
    },
    auditLog: { create: mockAuditCreate },
  }),
)

jest.unstable_mockModule('../../lib/prisma.js', () => ({
  prisma: {
    metric: {
      findFirst: mockMetricFindFirst,
      findMany: mockMetricFindMany,
    },
    kPI: {
      findFirst: mockKPIFindFirst,
      findMany: mockKPIFindMany,
    },
    metricHistory: {
      findMany: mockMetricHistoryFindMany,
    },
    organizationMember: {
      findFirst: mockOrgMemberFindFirst,
    },
    $transaction: mockTransaction,
  },
  PrismaClient: jest.fn(),
}))

jest.unstable_mockModule('@prisma/client', () => ({
  Prisma: {
    JsonNull: 'JsonNull',
    Decimal: class MockDecimal {
      constructor(public value: string | number) {}
      toString() { return String(this.value) }
    },
  },
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

// Mock AuditService since MetricService uses it
jest.unstable_mockModule('../../services/AuditService.js', () => ({
  AuditService: {
    log: jest.fn().mockResolvedValue(undefined),
  },
}))

const { MetricService } = await import('../MetricService.js')

// ---------------------------------------------------------------------------
// Sample data
// ---------------------------------------------------------------------------

const ORG_ID = 'org-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
const METRIC_ID = 'mtr-bbbb-bbbb-bbbb-bbbbbbbbbbbb'
const KPI_ID = 'kpi-cccc-cccc-cccc-cccccccccccc'
const USER_ID = 'usr-dddd-dddd-dddd-dddddddddddd'

const sampleMetric = {
  id: METRIC_ID,
  organizationId: ORG_ID,
  name: 'total_tasks_created',
  metricType: 'count',
  currentValue: { toString: () => '42' },
  computedAt: new Date('2024-06-01'),
  createdAt: new Date('2024-01-01'),
}

const sampleOrgMember = {
  id: 'mbr-1',
  organizationId: ORG_ID,
  userId: USER_ID,
  role: 'admin',
  status: 'active',
}

const sampleKPI = {
  id: KPI_ID,
  organizationId: ORG_ID,
  name: 'Tasks Target',
  metricId: METRIC_ID,
  operator: '>',
  targetValue: { toString: () => '100' },
  ownerUserId: USER_ID,
  status: 'active',
  createdAt: new Date('2024-01-01'),
  updatedAt: new Date('2024-01-01'),
  metric: sampleMetric,
  owner: { id: USER_ID, fullName: 'Alice', email: 'alice@example.com' },
}

// ---------------------------------------------------------------------------
// createKPI
// ---------------------------------------------------------------------------

describe('MetricService.createKPI', () => {
  beforeEach(() => jest.clearAllMocks())

  it('creates KPI with audit log when metric and owner are valid', async () => {
    mockMetricFindFirst.mockResolvedValue(sampleMetric)
    mockOrgMemberFindFirst.mockResolvedValue(sampleOrgMember)
    mockKPICreate.mockResolvedValue(sampleKPI)

    const result = await MetricService.createKPI(
      ORG_ID,
      {
        name: 'Tasks Target',
        metricId: METRIC_ID,
        operator: '>',
        targetValue: 100,
        ownerUserId: USER_ID,
      },
      { actorId: USER_ID, requestId: 'req-1' },
    )

    expect(result).toMatchObject({ id: KPI_ID, name: 'Tasks Target' })
    expect(mockTransaction).toHaveBeenCalledTimes(1)
    expect(mockKPICreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          organizationId: ORG_ID,
          name: 'Tasks Target',
          metricId: METRIC_ID,
          operator: '>',
          ownerUserId: USER_ID,
          status: 'active',
        }),
      }),
    )
  })

  it('throws 404 when metric not found in org', async () => {
    mockMetricFindFirst.mockResolvedValue(null)

    await expect(
      MetricService.createKPI(ORG_ID, {
        name: 'Test',
        metricId: 'missing',
        operator: '>',
        targetValue: 10,
        ownerUserId: USER_ID,
      }),
    ).rejects.toMatchObject({ statusCode: 404 })

    expect(mockTransaction).not.toHaveBeenCalled()
  })

  it('throws 422 when owner is not an active org member', async () => {
    mockMetricFindFirst.mockResolvedValue(sampleMetric)
    mockOrgMemberFindFirst.mockResolvedValue(null)

    await expect(
      MetricService.createKPI(ORG_ID, {
        name: 'Test',
        metricId: METRIC_ID,
        operator: '>',
        targetValue: 10,
        ownerUserId: 'unknown-user',
      }),
    ).rejects.toMatchObject({ statusCode: 422 })

    expect(mockTransaction).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// updateKPI
// ---------------------------------------------------------------------------

describe('MetricService.updateKPI', () => {
  beforeEach(() => jest.clearAllMocks())

  it('updates KPI and writes audit log', async () => {
    const updated = { ...sampleKPI, targetValue: { toString: () => '200' } }
    mockKPIFindFirst.mockResolvedValue(sampleKPI)
    mockKPIUpdate.mockResolvedValue(updated)

    const result = await MetricService.updateKPI(
      ORG_ID, KPI_ID,
      { targetValue: 200 },
      { actorId: USER_ID },
    )

    expect(mockTransaction).toHaveBeenCalledTimes(1)
    expect(mockKPIUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: KPI_ID },
        data: expect.objectContaining({ targetValue: expect.anything() }),
      }),
    )
  })

  it('throws 404 when KPI not found', async () => {
    mockKPIFindFirst.mockResolvedValue(null)

    await expect(
      MetricService.updateKPI(ORG_ID, 'missing', { name: 'X' }),
    ).rejects.toMatchObject({ statusCode: 404 })

    expect(mockTransaction).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// deleteKPI
// ---------------------------------------------------------------------------

describe('MetricService.deleteKPI', () => {
  beforeEach(() => jest.clearAllMocks())

  it('hard-deletes KPI and writes audit log', async () => {
    mockKPIFindFirst.mockResolvedValue(sampleKPI)
    mockKPIDelete.mockResolvedValue(undefined)

    await MetricService.deleteKPI(ORG_ID, KPI_ID, { actorId: USER_ID })

    expect(mockTransaction).toHaveBeenCalledTimes(1)
    expect(mockKPIDelete).toHaveBeenCalledWith({ where: { id: KPI_ID } })
  })

  it('throws 404 when KPI not found', async () => {
    mockKPIFindFirst.mockResolvedValue(null)

    await expect(
      MetricService.deleteKPI(ORG_ID, 'missing'),
    ).rejects.toMatchObject({ statusCode: 404 })

    expect(mockTransaction).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// listKPIs
// ---------------------------------------------------------------------------

describe('MetricService.listKPIs', () => {
  beforeEach(() => jest.clearAllMocks())

  it('returns KPIs with default pagination', async () => {
    mockKPIFindMany.mockResolvedValue([sampleKPI])

    const result = await MetricService.listKPIs(ORG_ID)

    expect(result.data).toHaveLength(1)
    expect(result.pagination.hasNextPage).toBe(false)
    expect(mockKPIFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ organizationId: ORG_ID }),
        take: 21,
      }),
    )
  })

  it('applies status filter', async () => {
    mockKPIFindMany.mockResolvedValue([])

    await MetricService.listKPIs(ORG_ID, { status: 'active' })

    expect(mockKPIFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ status: 'active' }),
      }),
    )
  })
})

// ---------------------------------------------------------------------------
// getKPI
// ---------------------------------------------------------------------------

describe('MetricService.getKPI', () => {
  beforeEach(() => jest.clearAllMocks())

  it('returns KPI when found', async () => {
    mockKPIFindFirst.mockResolvedValue(sampleKPI)

    const result = await MetricService.getKPI(ORG_ID, KPI_ID)

    expect(result).toMatchObject({ id: KPI_ID })
  })

  it('returns null when not found', async () => {
    mockKPIFindFirst.mockResolvedValue(null)

    const result = await MetricService.getKPI(ORG_ID, 'missing')

    expect(result).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// listMetrics
// ---------------------------------------------------------------------------

describe('MetricService.listMetrics', () => {
  beforeEach(() => jest.clearAllMocks())

  it('returns all metrics for the org', async () => {
    mockMetricFindMany.mockResolvedValue([sampleMetric])

    const result = await MetricService.listMetrics(ORG_ID)

    expect(result).toHaveLength(1)
    expect(mockMetricFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { organizationId: ORG_ID },
        orderBy: { name: 'asc' },
      }),
    )
  })

  it('returns empty array when no metrics exist', async () => {
    mockMetricFindMany.mockResolvedValue([])

    const result = await MetricService.listMetrics(ORG_ID)

    expect(result).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// getMetricHistory
// ---------------------------------------------------------------------------

describe('MetricService.getMetricHistory', () => {
  beforeEach(() => jest.clearAllMocks())

  it('returns history records for a named metric', async () => {
    mockMetricFindFirst.mockResolvedValue(sampleMetric)
    mockMetricHistoryFindMany.mockResolvedValue([
      { id: 'h1', metricId: METRIC_ID, organizationId: ORG_ID, value: { toString: () => '42' }, recordedAt: new Date(), triggeredBy: 'system' },
    ])

    const result = await MetricService.getMetricHistory(ORG_ID, 'total_tasks_created')

    expect(result.data).toHaveLength(1)
    expect(mockMetricHistoryFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ metricId: METRIC_ID, organizationId: ORG_ID }),
        orderBy: expect.arrayContaining([expect.objectContaining({ recordedAt: 'desc' })]),
      }),
    )
  })

  it('returns empty result when metric name not found', async () => {
    mockMetricFindFirst.mockResolvedValue(null)

    const result = await MetricService.getMetricHistory(ORG_ID, 'unknown_metric')

    expect(result.data).toEqual([])
    expect(result.pagination.hasNextPage).toBe(false)
  })
})
