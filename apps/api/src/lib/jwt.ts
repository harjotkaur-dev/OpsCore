/**
 * JWT utilities for OpsCore authentication (RS256).
 *
 * Access tokens:      signed with RS256, 15-minute TTL
 * Refresh tokens:     opaque UUID v4, 7-day TTL (stored as SHA-256 hash in DB)
 * Invitation tokens:  signed with RS256, 24-hour TTL
 *
 * Keys are loaded from environment variables at module initialisation time.
 * If either key is missing or malformed the process will fail fast with a
 * clear startup error rather than silently issuing invalid tokens.
 */

import jwt from 'jsonwebtoken'
import { createHash } from 'node:crypto'
import { v4 as uuidv4 } from 'uuid'
import { config } from '@opscore/config'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * The shape of the JWT access token payload (claims embedded in the token).
 * `sub` → userId, `org` → orgId, `role` → member role, `permissions` → RBAC.
 */
export interface AccessTokenPayload {
  /** User ID (maps to `users.id`) */
  sub: string
  /** Organization ID (maps to `organizations.id`) */
  org: string
  /** Role name within the organization */
  role: string
  /** List of `resource:action` permission strings */
  permissions: string[]
}

/**
 * Decoded access token — the registered JWT claims are added by jsonwebtoken
 * alongside the application claims above.
 */
export interface DecodedAccessToken extends AccessTokenPayload {
  iat: number
  exp: number
}

/**
 * The shape of the invitation JWT payload.
 */
export interface InvitationTokenPayload {
  /** Discriminator so tokens cannot be used as access tokens */
  type: 'invitation'
  /** Organization the invitation is for */
  orgId: string
  /** Email address being invited */
  email: string
  /** Role that will be assigned on acceptance */
  role: string
}

/**
 * Decoded invitation token — registered JWT claims added by jsonwebtoken.
 */
export interface DecodedInvitationToken extends InvitationTokenPayload {
  iat: number
  exp: number
}

/**
 * A signed refresh token and its expiry date, ready to be stored / set in a
 * cookie.  The raw value is an opaque UUID v4; store only the hash in the DB.
 */
export interface RefreshTokenResult {
  /** Raw opaque token — set in the HttpOnly cookie */
  token: string
  /** Absolute expiry timestamp */
  expiresAt: Date
}

// ---------------------------------------------------------------------------
// Key loading — fail fast at startup
// ---------------------------------------------------------------------------

function loadPrivateKey(): string {
  const raw = config.JWT_PRIVATE_KEY
  // Env vars often have literal \n sequences; normalise them to real newlines.
  const key = raw.replace(/\\n/g, '\n')
  if (!key.includes('-----BEGIN') || !key.includes('PRIVATE KEY-----')) {
    throw new Error(
      'JWT_PRIVATE_KEY is set but does not appear to be a valid PEM private key. ' +
        'Expected a PEM block starting with "-----BEGIN RSA PRIVATE KEY-----" or ' +
        '"-----BEGIN PRIVATE KEY-----".',
    )
  }
  return key
}

function loadPublicKey(): string {
  const raw = config.JWT_PUBLIC_KEY
  const key = raw.replace(/\\n/g, '\n')
  if (!key.includes('-----BEGIN PUBLIC KEY-----') && !key.includes('-----BEGIN RSA PUBLIC KEY-----')) {
    throw new Error(
      'JWT_PUBLIC_KEY is set but does not appear to be a valid PEM public key. ' +
        'Expected a PEM block starting with "-----BEGIN PUBLIC KEY-----".',
    )
  }
  return key
}

/**
 * Keys are resolved once at module load time.  Any misconfiguration is
 * surfaced immediately rather than on the first request.
 */
const PRIVATE_KEY: string = loadPrivateKey()
const PUBLIC_KEY: string = loadPublicKey()

// ---------------------------------------------------------------------------
// TTL constants
// ---------------------------------------------------------------------------

const ACCESS_TOKEN_TTL_SECONDS = 15 * 60 // 15 minutes
const REFRESH_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000 // 7 days
const INVITATION_TOKEN_TTL = '24h'

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Issue a short-lived RS256-signed JWT access token.
 *
 * @param payload - The application claims to embed in the token.
 * @returns A signed JWT string.
 */
export function signAccessToken(payload: AccessTokenPayload): string {
  return jwt.sign(payload, PRIVATE_KEY, {
    algorithm: 'RS256',
    expiresIn: ACCESS_TOKEN_TTL_SECONDS,
  })
}

/**
 * Verify and decode an RS256 access token.
 *
 * @param token - The raw JWT string from the `Authorization: Bearer` header.
 * @returns The decoded payload with all registered and application claims.
 * @throws `JsonWebTokenError` | `TokenExpiredError` | `NotBeforeError` on
 *         any verification failure — callers should catch and return 401.
 */
export function verifyAccessToken(token: string): DecodedAccessToken {
  const decoded = jwt.verify(token, PUBLIC_KEY, {
    algorithms: ['RS256'],
  })
  return decoded as DecodedAccessToken
}

/**
 * Generate an opaque refresh token (UUID v4) with a 7-day expiry.
 *
 * The caller is responsible for:
 * - Storing `hashToken(result.token)` in `refresh_tokens.token_hash`
 * - Setting `result.token` in an `HttpOnly` cookie
 *
 * @returns `{ token, expiresAt }`
 */
export function signRefreshToken(): RefreshTokenResult {
  return {
    token: uuidv4(),
    expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_MS),
  }
}

/**
 * Compute the SHA-256 hex digest of a raw token string.
 *
 * Used to hash refresh tokens before persisting them so the DB never stores
 * plaintext bearer credentials.
 *
 * @param raw - The raw token value (e.g. a UUID v4 refresh token).
 * @returns Lowercase hex SHA-256 digest string.
 */
export function hashToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex')
}

/**
 * Issue a signed RS256 invitation JWT with a 24-hour TTL.
 *
 * The payload carries `{ type: 'invitation', orgId, email, role }` so it
 * cannot be mistaken for or used as an access token.
 *
 * @param payload - Invitation claims to embed.
 * @returns A signed JWT string.
 */
export function signInvitationToken(payload: InvitationTokenPayload): string {
  return jwt.sign(payload, PRIVATE_KEY, {
    algorithm: 'RS256',
    expiresIn: INVITATION_TOKEN_TTL,
  })
}

/**
 * Verify and decode an RS256 invitation token.
 *
 * @param token - The raw JWT string from the invitation link.
 * @returns The decoded invitation payload.
 * @throws `JsonWebTokenError` | `TokenExpiredError` on any verification
 *         failure — callers should catch and return 401.
 */
export function verifyInvitationToken(token: string): DecodedInvitationToken {
  const decoded = jwt.verify(token, PUBLIC_KEY, {
    algorithms: ['RS256'],
  }) as DecodedInvitationToken

  if (decoded.type !== 'invitation') {
    throw new jwt.JsonWebTokenError('Token is not an invitation token')
  }

  return decoded
}
