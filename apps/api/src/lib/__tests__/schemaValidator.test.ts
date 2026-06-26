/**
 * Unit tests for schemaValidator (Task 3.3)
 */

import { describe, it, expect, beforeEach, afterEach } from '@jest/globals'
import { validate, clearCache, cacheSize } from '../schemaValidator.js'

// ---------------------------------------------------------------------------
// Sample schemas
// ---------------------------------------------------------------------------

const simpleSchema = {
  type: 'object',
  required: ['quantity', 'productId'],
  properties: {
    quantity: { type: 'number', minimum: 1 },
    productId: { type: 'string' },
    notes: { type: 'string' },
  },
  additionalProperties: false,
}

const nestedSchema = {
  type: 'object',
  required: ['order'],
  properties: {
    order: {
      type: 'object',
      required: ['id', 'amount'],
      properties: {
        id: { type: 'string' },
        amount: { type: 'number', minimum: 0 },
      },
    },
  },
}

// ---------------------------------------------------------------------------
// Cleanup cache between tests
// ---------------------------------------------------------------------------

beforeEach(() => clearCache())
afterEach(() => clearCache())

// ---------------------------------------------------------------------------
// validate — happy path
// ---------------------------------------------------------------------------

describe('validate — valid payloads', () => {
  it('returns valid=true for a matching payload', () => {
    const result = validate('et-1', simpleSchema, { quantity: 5, productId: 'sku-123' })
    expect(result.valid).toBe(true)
    expect(result.errors).toHaveLength(0)
  })

  it('returns valid=true with all optional fields present', () => {
    const result = validate('et-1', simpleSchema, {
      quantity: 10,
      productId: 'sku-456',
      notes: 'urgent',
    })
    expect(result.valid).toBe(true)
  })

  it('returns valid=true for nested object schema', () => {
    const result = validate('et-2', nestedSchema, { order: { id: 'ord-1', amount: 99.99 } })
    expect(result.valid).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// validate — invalid payloads
// ---------------------------------------------------------------------------

describe('validate — invalid payloads', () => {
  it('returns valid=false for missing required field', () => {
    const result = validate('et-1', simpleSchema, { quantity: 5 }) // missing productId
    expect(result.valid).toBe(false)
    expect(result.errors.length).toBeGreaterThan(0)
    const fields = result.errors.map((e) => e.field)
    expect(fields.some((f) => f.includes('/') || f === '/')).toBe(true)
  })

  it('returns valid=false for wrong type', () => {
    const result = validate('et-1', simpleSchema, { quantity: 'five', productId: 'sku' })
    expect(result.valid).toBe(false)
    expect(result.errors.some((e) => e.field.includes('quantity'))).toBe(true)
  })

  it('returns valid=false for value below minimum', () => {
    const result = validate('et-1', simpleSchema, { quantity: 0, productId: 'sku' })
    expect(result.valid).toBe(false)
  })

  it('returns valid=false for additional properties when disallowed', () => {
    const result = validate('et-1', simpleSchema, {
      quantity: 1,
      productId: 'sku',
      extraField: 'oops',
    })
    expect(result.valid).toBe(false)
  })

  it('returns all errors when multiple fields fail (allErrors: true)', () => {
    const result = validate('et-1', simpleSchema, {}) // missing both required fields
    expect(result.valid).toBe(false)
    expect(result.errors.length).toBeGreaterThanOrEqual(2)
  })

  it('returns valid=false for nested field violations', () => {
    const result = validate('et-2', nestedSchema, { order: { id: 'x', amount: -5 } })
    expect(result.valid).toBe(false)
    expect(result.errors.some((e) => e.field.includes('amount'))).toBe(true)
  })

  it('each error has a non-empty message', () => {
    const result = validate('et-1', simpleSchema, {})
    for (const err of result.errors) {
      expect(err.message.length).toBeGreaterThan(0)
    }
  })
})

// ---------------------------------------------------------------------------
// Caching behaviour
// ---------------------------------------------------------------------------

describe('validator caching', () => {
  it('cache is empty before first call', () => {
    expect(cacheSize()).toBe(0)
  })

  it('caches the compiled validator after first call', () => {
    validate('et-cache-1', simpleSchema, { quantity: 1, productId: 'sku' })
    expect(cacheSize()).toBe(1)
  })

  it('does not add a second entry when called again with the same id', () => {
    validate('et-cache-1', simpleSchema, { quantity: 1, productId: 'sku' })
    validate('et-cache-1', simpleSchema, { quantity: 2, productId: 'sku' })
    expect(cacheSize()).toBe(1)
  })

  it('creates separate cache entries for different event type ids', () => {
    validate('et-a', simpleSchema, { quantity: 1, productId: 'sku' })
    validate('et-b', nestedSchema, { order: { id: 'x', amount: 0 } })
    expect(cacheSize()).toBe(2)
  })
})

// ---------------------------------------------------------------------------
// clearCache
// ---------------------------------------------------------------------------

describe('clearCache', () => {
  it('clearCache() with no args clears everything', () => {
    validate('et-x', simpleSchema, {})
    validate('et-y', nestedSchema, {})
    expect(cacheSize()).toBe(2)

    clearCache()
    expect(cacheSize()).toBe(0)
  })

  it('clearCache(id) removes only the specified entry', () => {
    validate('et-x', simpleSchema, {})
    validate('et-y', nestedSchema, {})
    clearCache('et-x')
    expect(cacheSize()).toBe(1)
  })

  it('clearCache(unknown-id) is a no-op', () => {
    validate('et-x', simpleSchema, {})
    clearCache('et-does-not-exist')
    expect(cacheSize()).toBe(1)
  })
})
