/**
 * fast-check arbitraries for OpsCore domain types.
 *
 * Used by integration and property-based tests to generate realistic,
 * structurally valid inputs without hand-crafting fixtures for every test.
 *
 * Import selectively — only bring in what a given test file needs.
 */

import * as fc from 'fast-check'

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

/** UUID v4 string */
export const arbUuid = fc.uuid()

/** Lowercase alphanumeric slug, 3–40 chars, no leading/trailing hyphen */
export const arbSlug = fc
  .stringMatching(/^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/)
  .filter((s) => !s.includes('--'))

/** Email address */
export const arbEmail = fc.emailAddress()

/** Non-empty string up to 255 chars */
export const arbName = fc.string({ minLength: 1, maxLength: 255 })

/** Password meeting the 8-char minimum */
export const arbPassword = fc.string({ minLength: 8, maxLength: 72 })

// ---------------------------------------------------------------------------
// Event payload — arbitrary JSON object
// ---------------------------------------------------------------------------

export const arbEventPayload = fc.record({
  orderId: fc.string({ minLength: 1, maxLength: 40 }),
  amount: fc.float({ min: 0.01, max: 100000, noNaN: true }),
  customerId: fc.string({ minLength: 1, maxLength: 40 }),
})

// ---------------------------------------------------------------------------
// Domain-level composites
// ---------------------------------------------------------------------------

export interface OrgInput {
  name: string
  slug: string
}

export const arbOrgInput: fc.Arbitrary<OrgInput> = fc.record({
  name: arbName,
  slug: arbSlug,
})

export interface UserInput {
  email: string
  password: string
  fullName: string
}

export const arbUserInput: fc.Arbitrary<UserInput> = fc.record({
  email: arbEmail,
  password: arbPassword,
  fullName: arbName,
})

export interface RegisterInput extends UserInput {
  organizationName: string
  organizationSlug: string
}

export const arbRegisterInput: fc.Arbitrary<RegisterInput> = fc.record({
  email: arbEmail,
  password: arbPassword,
  fullName: arbName,
  organizationName: arbName,
  organizationSlug: arbSlug,
})

// ---------------------------------------------------------------------------
// Task priorities and statuses
// ---------------------------------------------------------------------------

export const arbTaskPriority = fc.constantFrom('low', 'medium', 'high', 'critical') as fc.Arbitrary<'low' | 'medium' | 'high' | 'critical'>
export const arbTaskStatus = fc.constantFrom('pending', 'in_progress', 'completed', 'cancelled') as fc.Arbitrary<'pending' | 'in_progress' | 'completed' | 'cancelled'>

// ---------------------------------------------------------------------------
// Event source
// ---------------------------------------------------------------------------

export const arbEventSource = fc.constantFrom('api', 'webhook', 'scheduled', 'manual') as fc.Arbitrary<'api' | 'webhook' | 'scheduled' | 'manual'>
