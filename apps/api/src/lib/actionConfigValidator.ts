/**
 * Workflow action config validator — Task 4.5
 *
 * Validates the `config` JSON of each workflow action type against a
 * type-specific JSON Schema. Used at version creation time to reject
 * malformed action configurations early (422 on failure).
 *
 * Action types:
 *   create_task        — creates a task from a Mustache title template
 *   send_notification  — sends a notification to a user or team
 *   update_metric      — increments/sets a named metric
 *   call_webhook       — HTTP POST to an external URL
 */

import AjvPkg from 'ajv'

const Ajv = AjvPkg.default ?? AjvPkg
const ajv = new Ajv({ allErrors: true, strict: false })

// ---------------------------------------------------------------------------
// Config schemas per action type
// ---------------------------------------------------------------------------

const schemas: Record<string, object> = {
  create_task: {
    type: 'object',
    required: ['title_template', 'priority'],
    properties: {
      title_template: { type: 'string', minLength: 1 },
      priority: { type: 'string', enum: ['low', 'medium', 'high', 'critical'] },
      assignee_type: { type: 'string', enum: ['user', 'team'] },
      assignee_id: { type: 'string' },
      due_in_hours: { type: 'number', minimum: 0 },
    },
    additionalProperties: false,
  },

  send_notification: {
    type: 'object',
    required: ['recipient_type', 'recipient_id', 'message_template'],
    properties: {
      recipient_type: { type: 'string', enum: ['user', 'team'] },
      recipient_id: { type: 'string' },
      message_template: { type: 'string', minLength: 1 },
    },
    additionalProperties: false,
  },

  update_metric: {
    type: 'object',
    required: ['metric_name', 'operation', 'value'],
    properties: {
      metric_name: { type: 'string', minLength: 1 },
      operation: { type: 'string', enum: ['increment', 'decrement', 'set'] },
      value: { type: 'number' },
    },
    additionalProperties: false,
  },

  call_webhook: {
    type: 'object',
    required: ['url', 'method'],
    properties: {
      url: { type: 'string', minLength: 1 },
      method: { type: 'string', enum: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] },
      headers: { type: 'object', additionalProperties: { type: 'string' } },
      body_template: { type: 'string' },
    },
    additionalProperties: false,
  },
}

// Compile validators once
const validators = Object.fromEntries(
  Object.entries(schemas).map(([type, schema]) => [type, ajv.compile(schema)])
)

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface ConfigValidationError {
  field: string
  message: string
}

export interface ConfigValidationResult {
  valid: boolean
  errors: ConfigValidationError[]
}

/**
 * Validate action config against its type-specific schema.
 *
 * @param actionType - One of: create_task | send_notification | update_metric | call_webhook
 * @param config     - The action config object from the workflow definition
 */
export function validateActionConfig(
  actionType: string,
  config: unknown,
): ConfigValidationResult {
  const validate = validators[actionType]
  if (!validate) {
    return {
      valid: false,
      errors: [{ field: 'type', message: `Unknown action type: '${actionType}'` }],
    }
  }

  const valid = validate(config) as boolean
  if (valid) return { valid: true, errors: [] }

  const errors: ConfigValidationError[] = (validate.errors ?? []).map((err) => ({
    field: err.instancePath || '/',
    message: `${err.instancePath || '/'} ${err.message ?? 'is invalid'}`.trim(),
  }))

  return { valid: false, errors }
}

/**
 * Validate all actions in a workflow definition.
 * Returns a map of action id → errors (only for invalid actions).
 */
export function validateAllActions(
  actions: Array<{ id: string; type: string; config: unknown }>,
): Map<string, ConfigValidationError[]> {
  const failures = new Map<string, ConfigValidationError[]>()
  for (const action of actions) {
    const result = validateActionConfig(action.type, action.config)
    if (!result.valid) {
      failures.set(action.id, result.errors)
    }
  }
  return failures
}