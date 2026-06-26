/**
 * Auth routes — registration, login, refresh, logout, and invitation flow.
 *
 * POST /v1/auth/register              — create a new user + org, return accessToken
 * POST /v1/auth/login                 — verify credentials, return accessToken
 * POST /v1/auth/refresh               — rotate refresh token, return new accessToken
 * POST /v1/auth/logout                — revoke refresh token, clear cookie
 * POST /v1/users/:id/invite           — send invitation (authenticated)
 * POST /v1/auth/invite/:token/accept  — accept an invitation (public)
 *
 * The raw refresh token is set as an HttpOnly, Secure, SameSite=Strict cookie
 * named `refresh_token` with path `/v1/auth`.
 * The access token is returned in the JSON body as { data: { accessToken } }.
 */

import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { AuthService } from '../services/AuthService.js'
import authPlugin from '../plugins/auth.js'

// ---------------------------------------------------------------------------
// Zod validation schemas
// ---------------------------------------------------------------------------

const registerSchema = z.object({
  email: z
    .string()
    .email('Must be a valid email address')
    .max(255),
  password: z
    .string()
    .min(8, 'Password must be at least 8 characters')
    .max(128),
  fullName: z
    .string()
    .min(1, 'fullName is required')
    .max(255),
  organizationName: z
    .string()
    .min(1, 'organizationName is required')
    .max(255),
  organizationSlug: z
    .string()
    .min(1, 'organizationSlug is required')
    .max(63)
    .regex(
      /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
      'organizationSlug must be lowercase alphanumeric with hyphens',
    ),
})

const loginSchema = z.object({
  email: z.string().email('Must be a valid email address').max(255),
  password: z.string().min(1, 'password is required').max(128),
})

const inviteUserSchema = z.object({
  email: z.string().email('Must be a valid email address').max(255),
  role: z.enum(['admin', 'operations_manager', 'team_lead', 'member'], {
    errorMap: () => ({
      message: 'role must be one of: admin, operations_manager, team_lead, member',
    }),
  }),
})

const acceptInviteSchema = z.object({
  fullName: z
    .string()
    .min(1, 'fullName is required')
    .max(255),
  password: z
    .string()
    .min(8, 'Password must be at least 8 characters')
    .max(128),
})

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatZodErrors(errors: z.ZodIssue[]) {
  return errors.map((e) => ({
    field: e.path.join('.'),
    message: e.message,
  }))
}

// ---------------------------------------------------------------------------
// Route registration
// ---------------------------------------------------------------------------

export async function authRoutes(app: FastifyInstance) {
  /**
   * POST /v1/auth/register
   *
   * Creates a new user + organization.
   * Returns 201 with { data: { accessToken } } and sets refresh_token cookie.
   * Returns 409 on duplicate email / slug.
   * Returns 422 on validation failure.
   */
  app.post(
    '/v1/auth/register',
    {
      schema: {
        body: {
          type: 'object',
          required: ['email', 'password', 'fullName', 'organizationName', 'organizationSlug'],
          properties: {
            email: { type: 'string' },
            password: { type: 'string' },
            fullName: { type: 'string' },
            organizationName: { type: 'string' },
            organizationSlug: { type: 'string' },
          },
        },
      },
    },
    async (request, reply) => {
      const parse = registerSchema.safeParse(request.body)
      if (!parse.success) {
        return reply.status(422).send({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Request validation failed',
            details: formatZodErrors(parse.error.errors),
            request_id: request.id,
          },
        })
      }

      const result = await AuthService.register(parse.data, {
        requestId: request.id,
      })

      reply.setCookie('refresh_token', result.refreshToken, {
        httpOnly: true,
        secure: true,
        sameSite: 'strict',
        path: '/v1/auth',
        expires: result.refreshTokenExpiresAt,
      })

      return reply.status(201).send({
        data: {
          accessToken: result.accessToken,
          user: {
            id: result.userId,
            email: result.email,
            fullName: result.fullName,
          },
          organizationId: result.orgId,
          role: result.role,
        },
      })
    },
  )

  /**
   * POST /v1/auth/login
   *
   * Authenticates an existing user.
   * Returns 200 with { data: { accessToken } } and sets refresh_token cookie.
   * Returns 401 on invalid credentials or deactivated org.
   * Returns 422 on validation failure.
   */
  app.post(
    '/v1/auth/login',
    {
      schema: {
        body: {
          type: 'object',
          required: ['email', 'password'],
          properties: {
            email: { type: 'string' },
            password: { type: 'string' },
          },
        },
      },
    },
    async (request, reply) => {
      const parse = loginSchema.safeParse(request.body)
      if (!parse.success) {
        return reply.status(422).send({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Request validation failed',
            details: formatZodErrors(parse.error.errors),
            request_id: request.id,
          },
        })
      }

      const result = await AuthService.login(parse.data, {
        requestId: request.id,
      })

      reply.setCookie('refresh_token', result.refreshToken, {
        httpOnly: true,
        secure: true,
        sameSite: 'strict',
        path: '/v1/auth',
        expires: result.refreshTokenExpiresAt,
      })

      return reply.status(200).send({
        data: {
          accessToken: result.accessToken,
          user: {
            id: result.userId,
            email: result.email,
            fullName: result.fullName,
          },
          organizationId: result.orgId,
          role: result.role,
        },
      })
    },
  )

  /**
   * POST /v1/auth/refresh
   *
   * Rotates the refresh token: reads the `refresh_token` cookie, revokes the
   * old token, and issues a new access token + refresh token pair.
   * Returns 200 with { data: { accessToken } } and sets a new refresh_token cookie.
   * Returns 401 if the cookie is missing or the token is invalid/expired/revoked.
   */
  app.post('/v1/auth/refresh', async (request, reply) => {
    const rawRefreshToken = (request.cookies as Record<string, string | undefined>)?.refresh_token

    if (!rawRefreshToken) {
      return reply.status(401).send({
        error: {
          code: 'UNAUTHORIZED',
          message: 'Missing refresh token',
          request_id: request.id,
        },
      })
    }

    const result = await AuthService.refresh(rawRefreshToken, { requestId: request.id })

    reply.setCookie('refresh_token', result.refreshToken, {
      httpOnly: true,
      secure: true,
      sameSite: 'strict',
      path: '/v1/auth',
      expires: result.refreshTokenExpiresAt,
    })

    return reply.status(200).send({
      data: {
        accessToken: result.accessToken,
      },
    })
  })

  /**
   * POST /v1/auth/logout
   *
   * Revokes the current refresh token and clears the cookie.
   * Always returns 200, even if the cookie is absent or the token was already
   * revoked (idempotent).
   */
  app.post('/v1/auth/logout', async (request, reply) => {
    const rawRefreshToken = (request.cookies as Record<string, string | undefined>)?.refresh_token

    if (rawRefreshToken) {
      await AuthService.logout(rawRefreshToken, { requestId: request.id })
    }

    // Clear the cookie by setting it to an expired date
    reply.setCookie('refresh_token', '', {
      httpOnly: true,
      secure: true,
      sameSite: 'strict',
      path: '/v1/auth',
      expires: new Date(0),
    })

    return reply.status(200).send({})
  })

  /**
   * POST /v1/users/:id/invite
   *
   * Invites a user by email to the authenticated user's organization.
   * Requires authentication — wrapped in a scoped enclosure that registers authPlugin.
   * Returns 201 with { data: { inviteLink, token } }.
   * Returns 409 if the email already has an active membership.
   * Returns 422 on validation failure.
   */
  await app.register(async (authedScope) => {
    await authedScope.register(authPlugin)

    authedScope.post(
      '/v1/users/:id/invite',
      {
        schema: {
          body: {
            type: 'object',
            required: ['email', 'role'],
            properties: {
              email: { type: 'string' },
              role: { type: 'string' },
            },
          },
        },
      },
      async (request, reply) => {
        const parse = inviteUserSchema.safeParse(request.body)
        if (!parse.success) {
          return reply.status(422).send({
            error: {
              code: 'VALIDATION_ERROR',
              message: 'Request validation failed',
              details: formatZodErrors(parse.error.errors),
              request_id: request.id,
            },
          })
        }

        const result = await AuthService.inviteUser(
          request.orgId,
          parse.data.email,
          parse.data.role,
          { requestId: request.id, actorId: request.userId },
        )

        return reply.status(201).send({
          data: result,
        })
      },
    )
  })

  /**
   * POST /v1/auth/invite/:token/accept
   *
   * Accepts an invitation using the signed JWT from the invite link.
   * Public — no authentication required.
   * Body: { fullName, password } — used to create the user account if new.
   * Returns 200 with { data: { userId, orgId } }.
   * Returns 401 if the token is invalid or expired.
   * Returns 422 on validation failure.
   */
  app.post(
    '/v1/auth/invite/:token/accept',
    {
      schema: {
        params: {
          type: 'object',
          required: ['token'],
          properties: {
            token: { type: 'string' },
          },
        },
        body: {
          type: 'object',
          required: ['fullName', 'password'],
          properties: {
            fullName: { type: 'string' },
            password: { type: 'string' },
          },
        },
      },
    },
    async (request, reply) => {
      const { token } = request.params as { token: string }

      const parse = acceptInviteSchema.safeParse(request.body)
      if (!parse.success) {
        return reply.status(422).send({
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Request validation failed',
            details: formatZodErrors(parse.error.errors),
            request_id: request.id,
          },
        })
      }

      const result = await AuthService.acceptInvite(
        token,
        { fullName: parse.data.fullName, password: parse.data.password },
        { requestId: request.id },
      )

      return reply.status(200).send({
        data: result,
      })
    },
  )
}
