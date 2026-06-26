/**
 * callWebhookHandler — Task 5.2
 *
 * Performs an HTTP POST (or configured method) to a configured URL with
 * optional headers and a Mustache body template.
 *
 * Security — `env.*` resolution:
 *   References like `{{env.MY_VAR}}` in `body_template` or header values
 *   are resolved ONLY from environment variables whose names begin with
 *   `WEBHOOK_ENV_`. All other `process.env` access is blocked by the
 *   allowlist filter to prevent accidental secret leakage.
 *
 * Config schema (validated at workflow-publish time):
 *   {
 *     url: string
 *     method: "GET"|"POST"|"PUT"|"PATCH"|"DELETE"
 *     headers?: Record<string, string>        — may contain "{{env.WEBHOOK_ENV_*}}" tokens
 *     body_template?: string                  — Mustache template
 *   }
 *
 * Requirements: 5.4, 6.6
 */

import Mustache from 'mustache'
import fetch from 'node-fetch'
import type { ActionExecutionContext } from './index.js'

// ---------------------------------------------------------------------------
// Env allowlist
// ---------------------------------------------------------------------------

/** Prefix that env vars must start with to be accessible in templates. */
const ALLOWED_ENV_PREFIX = 'WEBHOOK_ENV_'

/**
 * Build a view object containing only allowlisted env vars (prefix-stripped
 * for ergonomics so templates use `{{env.MY_VALUE}}` rather than
 * `{{env.WEBHOOK_ENV_MY_VALUE}}`).
 */
export function buildEnvView(): Record<string, string> {
  const view: Record<string, string> = {}
  for (const [key, value] of Object.entries(process.env)) {
    if (key.startsWith(ALLOWED_ENV_PREFIX) && typeof value === 'string') {
      const shortKey = key.slice(ALLOWED_ENV_PREFIX.length)
      view[shortKey] = value
    }
  }
  return view
}

// ---------------------------------------------------------------------------
// Template helpers
// ---------------------------------------------------------------------------

/**
 * Render a Mustache template with event + env context.
 */
function renderTemplate(
  template: string,
  event: ActionExecutionContext['event'],
  envView: Record<string, string>,
): string {
  return Mustache.render(template, { event, env: envView })
}

/**
 * Resolve `env.*` token references in a header value string.
 * Uses Mustache so header values like `Bearer {{env.MY_TOKEN}}` are expanded.
 */
function renderHeaderValue(
  value: string,
  envView: Record<string, string>,
  event: ActionExecutionContext['event'],
): string {
  return Mustache.render(value, { event, env: envView })
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export interface CallWebhookConfig {
  url: string
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  headers?: Record<string, string>
  body_template?: string
}

export class WebhookError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
    public readonly responseBody: string,
  ) {
    super(message)
    this.name = 'WebhookError'
  }
}

export async function callWebhookHandler(context: ActionExecutionContext): Promise<void> {
  const { config, event, executionId, logger } = context
  const cfg = config as unknown as CallWebhookConfig

  const envView = buildEnvView()

  // Render body template if provided
  const body =
    cfg.body_template !== undefined && cfg.body_template !== ''
      ? renderTemplate(cfg.body_template, event, envView)
      : undefined

  // Resolve env tokens in header values
  const resolvedHeaders: Record<string, string> = {
    'Content-Type': 'application/json',
  }
  if (cfg.headers) {
    for (const [key, value] of Object.entries(cfg.headers)) {
      resolvedHeaders[key] = renderHeaderValue(value, envView, event)
    }
  }

  logger.info(
    { url: cfg.url, method: cfg.method, executionId },
    'Calling webhook via workflow action',
  )

  const response = await fetch(cfg.url, {
    method: cfg.method,
    headers: resolvedHeaders,
    body: body !== undefined ? body : undefined,
  })

  if (!response.ok) {
    const responseText = await response.text().catch(() => '<unreadable>')
    throw new WebhookError(
      `Webhook request failed: ${cfg.method} ${cfg.url} → ${response.status} ${response.statusText}`,
      response.status,
      responseText,
    )
  }

  logger.info(
    { url: cfg.url, method: cfg.method, status: response.status },
    'Webhook call succeeded',
  )
}
