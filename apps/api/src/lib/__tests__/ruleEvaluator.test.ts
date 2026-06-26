/**
 * Unit tests for ruleEvaluator — Task 4.3
 */

import { describe, it, expect } from '@jest/globals'
import { evaluateRule, validateExpression, ExpressionSyntaxError } from '../ruleEvaluator.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function eval_(expr: string, payload: Record<string, unknown> = {}): boolean {
  return evaluateRule(expr, payload)
}

// ---------------------------------------------------------------------------
// Comparison operators
// ---------------------------------------------------------------------------

describe('comparison operators', () => {
  const p = { quantity: 5, price: 10.5, status: 'low' }

  it('< true', () => expect(eval_('event.payload.quantity < 10', p)).toBe(true))
  it('< false', () => expect(eval_('event.payload.quantity < 3', p)).toBe(false))
  it('> true', () => expect(eval_('event.payload.quantity > 3', p)).toBe(true))
  it('> false', () => expect(eval_('event.payload.quantity > 10', p)).toBe(false))
  it('<= equal', () => expect(eval_('event.payload.quantity <= 5', p)).toBe(true))
  it('<= less', () => expect(eval_('event.payload.quantity <= 6', p)).toBe(true))
  it('<= false', () => expect(eval_('event.payload.quantity <= 4', p)).toBe(false))
  it('>= equal', () => expect(eval_('event.payload.quantity >= 5', p)).toBe(true))
  it('>= more', () => expect(eval_('event.payload.quantity >= 4', p)).toBe(true))
  it('>= false', () => expect(eval_('event.payload.quantity >= 6', p)).toBe(false))
  it('== equal strings', () => expect(eval_("event.payload.status == 'low'", p)).toBe(true))
  it('== not equal', () => expect(eval_("event.payload.status == 'high'", p)).toBe(false))
  it('=== strict equality', () => expect(eval_('event.payload.quantity === 5', p)).toBe(true))
  it('!= not equal', () => expect(eval_("event.payload.status != 'high'", p)).toBe(true))
  it('!= equal (returns false)', () => expect(eval_("event.payload.status != 'low'", p)).toBe(false))
  it('!== strict inequality', () => expect(eval_('event.payload.quantity !== 6', p)).toBe(true))
  it('decimal comparison', () => expect(eval_('event.payload.price > 10.0', p)).toBe(true))
})

// ---------------------------------------------------------------------------
// Logical operators
// ---------------------------------------------------------------------------

describe('logical operators', () => {
  const p = { a: 5, b: 10 }

  it('&& both true', () => expect(eval_('event.payload.a < 10 && event.payload.b > 5', p)).toBe(true))
  it('&& one false', () => expect(eval_('event.payload.a < 3 && event.payload.b > 5', p)).toBe(false))
  it('|| first true', () => expect(eval_('event.payload.a < 3 || event.payload.b > 5', p)).toBe(true))
  it('|| both false', () => expect(eval_('event.payload.a > 100 || event.payload.b > 100', p)).toBe(false))
  it('! negates false', () => expect(eval_('!false', p)).toBe(true))
  it('! negates comparison', () => expect(eval_('!(event.payload.a > 100)', p)).toBe(true))
})

// ---------------------------------------------------------------------------
// Operator precedence
// ---------------------------------------------------------------------------

describe('operator precedence', () => {
  const p = { x: 5, y: 10, z: 15 }

  it('&& binds tighter than ||', () => {
    // (false && true) || true == true
    expect(eval_('event.payload.x > 100 && event.payload.y > 5 || event.payload.z > 10', p)).toBe(true)
  })

  it('parentheses override precedence', () => {
    // false && (true || true) == false
    expect(eval_('event.payload.x > 100 && (event.payload.y > 5 || event.payload.z > 10)', p)).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Literals
// ---------------------------------------------------------------------------

describe('literals', () => {
  it('number literal', () => expect(eval_('5 < 10')).toBe(true))
  it('string literal double quotes', () => expect(eval_('"hello" == "hello"')).toBe(true))
  it('string literal single quotes', () => expect(eval_("'world' == 'world'")).toBe(true))
  it('boolean true', () => expect(eval_('true')).toBe(true))
  it('boolean false', () => expect(eval_('false')).toBe(false))
  it('null == null', () => expect(eval_('null == null')).toBe(true))
  it('null comparison', () => expect(eval_('event.payload.missing == null', {})).toBe(true))
})

// ---------------------------------------------------------------------------
// Nested field access
// ---------------------------------------------------------------------------

describe('nested field access', () => {
  const p = { order: { items: { count: 3 }, status: 'pending' } }

  it('two levels deep', () => expect(eval_("event.payload.order.status == 'pending'", p)).toBe(true))
  it('three levels deep', () => expect(eval_('event.payload.order.items.count > 2', p)).toBe(true))
  it('missing field returns undefined (== null is false)', () => {
    expect(eval_('event.payload.order.missing == null', p)).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Real-world rule expressions
// ---------------------------------------------------------------------------

describe('real-world expressions', () => {
  it('low inventory rule', () => {
    expect(eval_('event.payload.quantity < 10', { quantity: 3 })).toBe(true)
    expect(eval_('event.payload.quantity < 10', { quantity: 15 })).toBe(false)
  })

  it('critical severity rule', () => {
    expect(eval_("event.payload.severity === 'critical'", { severity: 'critical' })).toBe(true)
    expect(eval_("event.payload.severity === 'critical'", { severity: 'warning' })).toBe(false)
  })

  it('combined threshold rule', () => {
    const p = { amount: 1000, currency: 'USD' }
    expect(eval_("event.payload.amount > 500 && event.payload.currency == 'USD'", p)).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Determinism
// ---------------------------------------------------------------------------

describe('determinism', () => {
  it('same expression + payload always produces same result', () => {
    const expr = 'event.payload.x > 5 && event.payload.y < 10'
    const p = { x: 7, y: 3 }
    const results = Array.from({ length: 10 }, () => evaluateRule(expr, p))
    expect(new Set(results).size).toBe(1)
    expect(results[0]).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// ExpressionSyntaxError — forbidden constructs
// ---------------------------------------------------------------------------

describe('forbidden constructs', () => {
  it('throws on function call', () => {
    expect(() => eval_('event.payload.toString()')).toThrow(ExpressionSyntaxError)
    expect(() => eval_('parseInt(event.payload.x)')).toThrow(ExpressionSyntaxError)
  })

  it('throws on assignment operator', () => {
    // '=' is not in our token set — it results in an unexpected character error
    expect(() => eval_('event.payload.x = 5')).toThrow(ExpressionSyntaxError)
  })

  it('throws on empty expression', () => {
    expect(() => eval_('')).toThrow(ExpressionSyntaxError)
    expect(() => eval_('   ')).toThrow(ExpressionSyntaxError)
  })

  it('throws on unterminated string', () => {
    expect(() => eval_('"unclosed')).toThrow(ExpressionSyntaxError)
  })

  it('throws on unexpected token', () => {
    expect(() => eval_('event.payload.x @ 5')).toThrow(ExpressionSyntaxError)
  })

  it('throws on dangling operator', () => {
    expect(() => eval_('event.payload.x >')).toThrow(ExpressionSyntaxError)
  })
})

// ---------------------------------------------------------------------------
// validateExpression
// ---------------------------------------------------------------------------

describe('validateExpression', () => {
  it('returns true for valid expression', () => {
    expect(validateExpression('event.payload.x < 10')).toBe(true)
  })

  it('throws ExpressionSyntaxError for invalid expression', () => {
    expect(() => validateExpression('event.payload.x()')).toThrow(ExpressionSyntaxError)
  })
})
