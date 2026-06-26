/**
 * MetricHistoryCleanupWorker Unit Tests — Task 8.4
 *
 * Tests runMetricHistoryCleanup:
 *  - deletes records older than 90 days
 *  - returns the count of deleted records
 *  - handles zero deletions gracefully
 */

import { jest, describe, it, expect, beforeEach } from '@jest/globals'

const mockMetricHistoryDeleteMany = jest.fn<(args: unknown) => Promise<unknown>>()

jest.unstable_mockModule('@opscore/database', () => ({
  prisma: {
    metricHistory: {
      deleteMany: mockMetricHistoryDeleteMany,
    },
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

const { runMetricHistoryCleanup } = await import('../MetricHistoryCleanupWorker.js')

describe('runMetricHistoryCleanup', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockMetricHistoryDeleteMany.mockResolvedValue({ count: 0 })
  })

  it('deletes records older than 90 days', async () => {
    mockMetricHistoryDeleteMany.mockResolvedValue({ count: 42 })

    const count = await runMetricHistoryCleanup()

    expect(count).toBe(42)
    expect(mockMetricHistoryDeleteMany).toHaveBeenCalledTimes(1)
    expect(mockMetricHistoryDeleteMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          recordedAt: expect.objectContaining({ lt: expect.any(Date) }),
        }),
      }),
    )
  })

  it('cutoff date is approximately 90 days ago', async () => {
    mockMetricHistoryDeleteMany.mockResolvedValue({ count: 0 })
    const before = new Date()

    await runMetricHistoryCleanup()

    const callArgs = (mockMetricHistoryDeleteMany.mock.calls[0] as [{ where: { recordedAt: { lt: Date } } }])[0]
    const cutoff = callArgs.where.recordedAt.lt

    const ninetyDaysAgo = new Date()
    ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90)

    // Allow ±5 second tolerance for test execution time
    expect(Math.abs(cutoff.getTime() - ninetyDaysAgo.getTime())).toBeLessThan(5000)
  })

  it('returns 0 when no records match', async () => {
    mockMetricHistoryDeleteMany.mockResolvedValue({ count: 0 })

    const count = await runMetricHistoryCleanup()

    expect(count).toBe(0)
    expect(mockMetricHistoryDeleteMany).toHaveBeenCalledTimes(1)
  })

  it('handles zero deletions gracefully without throwing', async () => {
    mockMetricHistoryDeleteMany.mockResolvedValue({ count: 0 })

    await expect(runMetricHistoryCleanup()).resolves.not.toThrow()
  })
})
