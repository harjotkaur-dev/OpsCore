/**
 * Safe rule expression evaluator — Task 4.3
 *
 * Parses and evaluates workflow rule expressions against an event payload.
 * Expressions are restricted to a safe subset:
 *   - Field access via dot notation:  event.payload.quantity
 *   - Comparison operators:           <  >  <=  >=  ==  !=  ===  !==
 *   - Logical operators:              &&  ||  !
 *   - String and number literals:     "low"  42  3.14
 *   - Boolean literals:               true  false
 *   - Null literal:                   null
 *
 * Explicitly FORBIDDEN (throws ExpressionSyntaxError):
 *   - Function calls:   foo()  event.toString()
 *   - Assignments:      x = 1  x += 1
 *   - new expressions:  new Foo()
 *   - Template literals, regex literals
 *   - Any other statement or expression not in the allow-list above
 *
 * The evaluator uses a hand-written recursive-descent parser.
 * No eval(), no Function(), no external dependencies.
 */

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class ExpressionSyntaxError extends Error {
  constructor(message: string, public readonly expression?: string) {
    super(message)
    this.name = 'ExpressionSyntaxError'
  }
}

// ---------------------------------------------------------------------------
// Token types
// ---------------------------------------------------------------------------

type TokenType =
  | 'NUMBER' | 'STRING' | 'BOOL' | 'NULL'
  | 'IDENT'
  | 'DOT'
  | 'LPAREN' | 'RPAREN'
  | 'NOT'
  | 'AND' | 'OR'
  | 'LT' | 'GT' | 'LTE' | 'GTE' | 'EQ' | 'NEQ'
  | 'EOF'

interface Token {
  type: TokenType
  value: string | number | boolean | null
  pos: number
}

// ---------------------------------------------------------------------------
// Lexer
// ---------------------------------------------------------------------------

function tokenize(expr: string): Token[] {
  const tokens: Token[] = []
  let i = 0

  while (i < expr.length) {
    // Skip whitespace
    if (/\s/.test(expr[i] ?? '')) { i++; continue }

    const pos = i
    const ch = expr[i] ?? ''

    // Numbers
    if (/[0-9]/.test(ch) || (ch === '-' && /[0-9]/.test(expr[i + 1] ?? ''))) {
      let num = ch; i++
      while (i < expr.length && /[0-9.]/.test(expr[i] ?? '')) { num += expr[i]; i++ }
      tokens.push({ type: 'NUMBER', value: Number(num), pos })
      continue
    }

    // Strings
    if (ch === '"' || ch === "'") {
      const quote = ch; i++
      let str = ''
      while (i < expr.length && expr[i] !== quote) {
        if (expr[i] === '\\') { i++; str += expr[i] ?? '' } else { str += expr[i] }
        i++
      }
      if (expr[i] !== quote) throw new ExpressionSyntaxError('Unterminated string', expr)
      i++
      tokens.push({ type: 'STRING', value: str, pos })
      continue
    }

    // Three-char operators (must check BEFORE two-char)
    const three = expr.slice(i, i + 3)
    if (three === '===') { tokens.push({ type: 'EQ', value: '===', pos }); i += 3; continue }
    if (three === '!==') { tokens.push({ type: 'NEQ', value: '!==', pos }); i += 3; continue }

    // Two-char operators
    const two = expr.slice(i, i + 2)
    if (two === '<=') { tokens.push({ type: 'LTE', value: '<=', pos }); i += 2; continue }
    if (two === '>=') { tokens.push({ type: 'GTE', value: '>=', pos }); i += 2; continue }
    if (two === '==') { tokens.push({ type: 'EQ', value: '==', pos }); i += 2; continue }
    if (two === '!=') { tokens.push({ type: 'NEQ', value: '!=', pos }); i += 2; continue }
    if (two === '&&') { tokens.push({ type: 'AND', value: '&&', pos }); i += 2; continue }
    if (two === '||') { tokens.push({ type: 'OR', value: '||', pos }); i += 2; continue }

    // Single-char operators
    if (ch === '<') { tokens.push({ type: 'LT', value: '<', pos }); i++; continue }
    if (ch === '>') { tokens.push({ type: 'GT', value: '>', pos }); i++; continue }
    if (ch === '!') { tokens.push({ type: 'NOT', value: '!', pos }); i++; continue }
    if (ch === '(') { tokens.push({ type: 'LPAREN', value: '(', pos }); i++; continue }
    if (ch === ')') { tokens.push({ type: 'RPAREN', value: ')', pos }); i++; continue }
    if (ch === '.') { tokens.push({ type: 'DOT', value: '.', pos }); i++; continue }

    // Identifiers and keywords
    if (/[a-zA-Z_$]/.test(ch)) {
      let ident = ch; i++
      while (i < expr.length && /[a-zA-Z0-9_$]/.test(expr[i] ?? '')) { ident += expr[i]; i++ }
      if (ident === 'true')  { tokens.push({ type: 'BOOL', value: true, pos }); continue }
      if (ident === 'false') { tokens.push({ type: 'BOOL', value: false, pos }); continue }
      if (ident === 'null')  { tokens.push({ type: 'NULL', value: null, pos }); continue }
      tokens.push({ type: 'IDENT', value: ident, pos })
      continue
    }

    throw new ExpressionSyntaxError(`Unexpected character '${ch}' at position ${i}`, expr)
  }

  tokens.push({ type: 'EOF', value: '', pos: i })
  return tokens
}

// ---------------------------------------------------------------------------
// AST node types
// ---------------------------------------------------------------------------

type AstNode =
  | { kind: 'literal'; value: string | number | boolean | null }
  | { kind: 'field'; path: string[] }
  | { kind: 'unary'; op: '!'; operand: AstNode }
  | { kind: 'binary'; op: string; left: AstNode; right: AstNode }

// ---------------------------------------------------------------------------
// Parser (recursive descent)
// ---------------------------------------------------------------------------

class Parser {
  private pos = 0
  constructor(private readonly tokens: Token[], private readonly expr: string) {}

  private peek(): Token {
    return this.tokens[this.pos] ?? { type: 'EOF', value: '', pos: -1 }
  }

  private consume(): Token {
    const t = this.tokens[this.pos]
    if (!t) throw new ExpressionSyntaxError('Unexpected end of expression', this.expr)
    this.pos++
    return t
  }

  private expect(type: TokenType): Token {
    const t = this.consume()
    if (t.type !== type) {
      throw new ExpressionSyntaxError(
        `Expected ${type} but got ${t.type} ('${String(t.value)}') at position ${t.pos}`,
        this.expr,
      )
    }
    return t
  }

  parse(): AstNode {
    const node = this.parseOr()
    if (this.peek().type !== 'EOF') {
      const t = this.peek()
      throw new ExpressionSyntaxError(
        `Unexpected token '${String(t.value)}' at position ${t.pos}`,
        this.expr,
      )
    }
    return node
  }

  private parseOr(): AstNode {
    let left = this.parseAnd()
    while (this.peek().type === 'OR') {
      this.consume()
      const right = this.parseAnd()
      left = { kind: 'binary', op: '||', left, right }
    }
    return left
  }

  private parseAnd(): AstNode {
    let left = this.parseComparison()
    while (this.peek().type === 'AND') {
      this.consume()
      const right = this.parseComparison()
      left = { kind: 'binary', op: '&&', left, right }
    }
    return left
  }

  private parseComparison(): AstNode {
    const left = this.parseUnary()
    const op = this.peek().type
    if (['LT', 'GT', 'LTE', 'GTE', 'EQ', 'NEQ'].includes(op)) {
      const tok = this.consume()
      const right = this.parseUnary()
      return { kind: 'binary', op: String(tok.value), left, right }
    }
    return left
  }

  private parseUnary(): AstNode {
    if (this.peek().type === 'NOT') {
      this.consume()
      const operand = this.parsePrimary()
      return { kind: 'unary', op: '!', operand }
    }
    return this.parsePrimary()
  }

  private parsePrimary(): AstNode {
    const t = this.peek()

    // Parenthesised expression
    if (t.type === 'LPAREN') {
      this.consume()
      const inner = this.parseOr()
      this.expect('RPAREN')
      return inner
    }

    // Literals
    if (t.type === 'NUMBER') { this.consume(); return { kind: 'literal', value: t.value as number } }
    if (t.type === 'STRING') { this.consume(); return { kind: 'literal', value: t.value as string } }
    if (t.type === 'BOOL')   { this.consume(); return { kind: 'literal', value: t.value as boolean } }
    if (t.type === 'NULL')   { this.consume(); return { kind: 'literal', value: null } }

    // Field access: ident(.ident)*
    if (t.type === 'IDENT') {
      this.consume()
      const path: string[] = [String(t.value)]
      while (this.peek().type === 'DOT') {
        this.consume()
        const field = this.peek()
        if (field.type !== 'IDENT') {
          throw new ExpressionSyntaxError(
            `Expected field name after '.' at position ${field.pos}`,
            this.expr,
          )
        }
        this.consume()
        path.push(String(field.value))
      }
      // Reject function calls
      if (this.peek().type === 'LPAREN') {
        throw new ExpressionSyntaxError(
          `Function calls are not allowed in rule expressions: '${path.join('.')}()'`,
          this.expr,
        )
      }
      return { kind: 'field', path }
    }

    throw new ExpressionSyntaxError(
      `Unexpected token '${String(t.value)}' at position ${t.pos}`,
      this.expr,
    )
  }
}

// ---------------------------------------------------------------------------
// Evaluator
// ---------------------------------------------------------------------------

function getFieldValue(path: string[], payload: Record<string, unknown>): unknown {
  let current: unknown = payload
  for (const key of path) {
    if (current === null || current === undefined || typeof current !== 'object') return null
    current = (current as Record<string, unknown>)[key]
  }
  // Return null for undefined fields so null comparisons work naturally
  return current === undefined ? null : current
}

function evalNode(node: AstNode, payload: Record<string, unknown>): unknown {
  switch (node.kind) {
    case 'literal': return node.value

    case 'field': return getFieldValue(node.path, payload)

    case 'unary':
      return !evalNode(node.operand, payload)

    case 'binary': {
      const l = evalNode(node.left, payload)
      const r = evalNode(node.right, payload)
      switch (node.op) {
        case '<':   return (l as number) < (r as number)
        case '>':   return (l as number) > (r as number)
        case '<=':  return (l as number) <= (r as number)
        case '>=':  return (l as number) >= (r as number)
        case '==':
        case '===': return l === r
        case '!=':
        case '!==': return l !== r
        case '&&':  return Boolean(l) && Boolean(r)
        case '||':  return Boolean(l) || Boolean(r)
        default:    throw new ExpressionSyntaxError(`Unknown operator: ${node.op}`)
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Evaluate a rule expression against an event payload.
 *
 * @param expression - Rule expression string, e.g. "event.payload.quantity < 10"
 * @param payload    - The event payload object to evaluate against.
 *                     The expression accesses it via the `event.payload.*` path.
 * @returns `true` if the rule matches, `false` otherwise.
 * @throws `ExpressionSyntaxError` if the expression is invalid or uses forbidden constructs.
 */
export function evaluateRule(expression: string, payload: Record<string, unknown>): boolean {
  const trimmed = expression.trim()
  if (!trimmed) throw new ExpressionSyntaxError('Expression cannot be empty')

  const tokens = tokenize(trimmed)
  const parser = new Parser(tokens, trimmed)
  const ast = parser.parse()

  // Wrap payload so expressions can use `event.payload.*`
  const context: Record<string, unknown> = { event: { payload } }

  const result = evalNode(ast, context)
  return Boolean(result)
}

/**
 * Validate that an expression is syntactically valid without evaluating it.
 * Returns true if valid, throws ExpressionSyntaxError if not.
 */
export function validateExpression(expression: string): true {
  const trimmed = expression.trim()
  if (!trimmed) throw new ExpressionSyntaxError('Expression cannot be empty')
  const tokens = tokenize(trimmed)
  new Parser(tokens, trimmed).parse()
  return true
}
