/**
 * JSON Schema payload validator — Task 3.3
 *
 * Compiles event_types.payload_schema (JSON Schema draft-07) with Ajv and
 * caches the compiled ValidateFunction keyed by event_type_id so the
 * expensive compilation step only runs once per unique schema.
 *
 * Usage:
 *   const result = validate(eventType.id, eventType.payloadSchema, payload)
 *   if (!result.valid) return reply.status(422).send({ errors: result.errors })
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
import AjvDefault from 'ajv'
import type { Ajv as AjvType, ValidateFunction } from 'ajv'

// ajv ships as CJS (module.exports = Ajv class).
// Under NodeNext ESM, the default import gives us the class directly.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const AjvClass = (AjvDefault as any) as new (opts: {
  allErrors: boolean
  strict: boolean
}) => AjvType

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface FieldError {
  /** JSON Pointer path, e.g. "/quantity" or "/address/city" */
  field: string
  /** Human-readable validation message */
  message: string
}

export interface ValidationResult {
  valid: boolean
  errors: FieldError[]
}

// ---------------------------------------------------------------------------
// Ajv singleton
// ---------------------------------------------------------------------------

const ajv: AjvType = new AjvClass({ allErrors: true, strict: false })

// ---------------------------------------------------------------------------
// Compiled-validator cache
// ---------------------------------------------------------------------------

/** Map from eventTypeId → compiled ValidateFunction */
const cache = new Map<string, ValidateFunction>()

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Validate a payload against the given JSON Schema.
 *
 * The compiled validator is cached by `eventTypeId`. Pass the same id on
 * repeated calls to benefit from cache hits.
 *
 * @param eventTypeId - Cache key (typically the event_type UUID)
 * @param schema      - JSON Schema draft-07 object
 * @param payload     - The event payload to validate
 */
export function validate(
  eventTypeId: string,
  schema: unknown,
  payload: unknown,
): ValidationResult {
  let validateFn = cache.get(eventTypeId)

  if (!validateFn) {
    validateFn = ajv.compile(schema as object)
    cache.set(eventTypeId, validateFn)
  }

  const compiledFn: ValidateFunction = validateFn
  const valid = compiledFn(payload) as boolean

  if (valid) {
    return { valid: true, errors: [] }
  }

  const errors: FieldError[] = (compiledFn.errors ?? []).map((err) => {
    const field = err.instancePath || '/'
    const message = `${field} ${err.message ?? 'is invalid'}`.trim()
    return { field, message }
  })

  return { valid: false, errors }
}

/**
 * Clear the compiled-validator cache.
 */
export function clearCache(eventTypeId?: string): void {
  if (eventTypeId !== undefined) {
    cache.delete(eventTypeId)
  } else {
    cache.clear()
  }
}

/** Exposed for testing — returns the current cache size */
export function cacheSize(): number {
  return cache.size
}
