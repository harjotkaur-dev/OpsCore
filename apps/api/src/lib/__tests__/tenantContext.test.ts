/**
 * Unit tests for src/lib/tenantContext.ts
 *
 * Covers:
 *  - runWithOrgId stores the orgId in AsyncLocalStorage
 *  - getOrgId returns null outside any runWithOrgId scope
 *  - getOrgId returns the correct orgId inside a scope
 *  - Nested scopes shadow the outer orgId correctly
 *  - Sibling scopes are isolated from each other
 *  - Async operations inside the scope retain the orgId
 */

import { tenantStorage, runWithOrgId, getOrgId } from '../tenantContext.js'

// ---------------------------------------------------------------------------
// getOrgId outside any scope
// ---------------------------------------------------------------------------

describe('getOrgId', () => {
  it('returns null when called outside a runWithOrgId scope', () => {
    // Ensure we are not accidentally inside a scope from a previous test.
    // AsyncLocalStorage contexts do not leak across independent test runs.
    const orgId = getOrgId()
    expect(orgId).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// runWithOrgId
// ---------------------------------------------------------------------------

describe('runWithOrgId', () => {
  it('makes getOrgId return the correct orgId inside the callback', () => {
    const expected = 'org-abc-123'
    runWithOrgId(expected, () => {
      expect(getOrgId()).toBe(expected)
    })
  })

  it('returns the value produced by the callback function', () => {
    const result = runWithOrgId('org-1', () => 42)
    expect(result).toBe(42)
  })

  it('restores null context after the callback returns', () => {
    runWithOrgId('org-temp', () => {
      // inside scope
    })
    // After the scope, getOrgId should be null again
    expect(getOrgId()).toBeNull()
  })

  it('supports async callbacks — getOrgId is available after an awaited tick', async () => {
    const expected = 'org-async-456'
    await runWithOrgId(expected, async () => {
      await Promise.resolve() // yield to the event loop
      expect(getOrgId()).toBe(expected)
    })
  })

  it('propagates orgId into nested async calls', async () => {
    const expected = 'org-propagate'
    const inner = async () => {
      await Promise.resolve()
      return getOrgId()
    }

    const result = await runWithOrgId(expected, () => inner())
    expect(result).toBe(expected)
  })

  it('nested runWithOrgId shadows the outer orgId', () => {
    const outer = 'org-outer'
    const inner = 'org-inner'

    runWithOrgId(outer, () => {
      expect(getOrgId()).toBe(outer)

      runWithOrgId(inner, () => {
        expect(getOrgId()).toBe(inner)
      })

      // After inner scope exits, outer scope is restored
      expect(getOrgId()).toBe(outer)
    })
  })

  it('sibling scopes are isolated from each other', async () => {
    const results: Array<string | null> = []

    const task = (orgId: string, delay: number) =>
      new Promise<void>((resolve) => {
        runWithOrgId(orgId, () => {
          setTimeout(() => {
            results.push(getOrgId())
            resolve()
          }, delay)
        })
      })

    // Start two concurrent scopes; they should not bleed into each other
    await Promise.all([task('org-A', 10), task('org-B', 5)])

    // Both should have recorded their own orgId
    expect(results).toContain('org-A')
    expect(results).toContain('org-B')
  })

  it('tenantStorage.getStore() returns the TenantStore within a scope', () => {
    runWithOrgId('org-store-check', () => {
      const store = tenantStorage.getStore()
      expect(store).toBeDefined()
      expect(store?.orgId).toBe('org-store-check')
    })
  })
})
