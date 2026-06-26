/**
 * Typed error classes — Task 10.3
 *
 * Additive only. Existing services continue using @fastify/error createError.
 * New code should use these named classes for clarity and consistency.
 *
 * All classes carry a statusCode that Fastify's setErrorHandler maps to the
 * correct HTTP response via the existing error envelope shape:
 *   { error: { code, message, request_id } }
 *
 * Requirements: 13.3, 13.4
 */

import createError from '@fastify/error'

/**
 * 422 Unprocessable Entity — request body or params failed validation.
 * Attach a `details` array for field-level error messages.
 */
export const ValidationError = createError('VALIDATION_ERROR', '%s', 422)

/**
 * 403 Forbidden — authenticated but lacking required permission.
 */
export const ForbiddenError = createError('FORBIDDEN', '%s', 403)

/**
 * 404 Not Found — resource does not exist (or is invisible due to tenant scope).
 */
export const NotFoundError = createError('NOT_FOUND', '%s', 404)

/**
 * 409 Conflict — duplicate resource or concurrent modification.
 */
export const ConflictError = createError('CONFLICT', '%s', 409)

/**
 * 429 Too Many Requests — per-org rate limit exceeded.
 * Include a Retry-After header in the response.
 */
export const RateLimitError = createError('RATE_LIMIT_EXCEEDED', '%s', 429)
