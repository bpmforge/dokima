/**
 * Safe predicate expression language for catalog `condition`/`verify` strings
 * (FR-PLAN1, docs/design/IMPROVEMENT_PLANS.md §1). Deliberately NOT `eval`/
 * `Function` — the catalog is versioned content (CLAUDE.md law #6) and a
 * predicate evaluator over untrusted-shaped data must not be a code
 * execution surface (OWASP injection). Grammar (recursive descent):
 *
 *   expr       := or
 *   or         := and ( '||' and )*
 *   and        := not ( '&&' not )*
 *   not        := '!' not | comparison
 *   comparison := operand ( ('==' | '!=' | '>=' | '<=' | '>' | '<') operand )?
 *   operand    := NUMBER | STRING | 'true' | 'false' | PATH | '(' expr ')'
 *
 * A bare `operand` (no comparator) must evaluate to a boolean — no implicit
 * truthiness on numbers/strings, so a malformed condition fails loudly
 * rather than silently matching.
 */

export type ExprValue = number | string | boolean;

type Node =
  | { readonly kind: 'or'; readonly left: Node; readonly right: Node }
  | { readonly kind: 'and'; readonly left: Node; readonly right: Node }
  | { readonly kind: 'not'; readonly operand: Node }
  | {
      readonly kind: 'cmp';
      readonly op: CmpOp;
      readonly left: Node;
      readonly right: Node | null;
    }
  | { readonly kind: 'path'; readonly path: string }
  | { readonly kind: 'num'; readonly value: number }
  | { readonly kind: 'str'; readonly value: string }
  | { readonly kind: 'bool'; readonly value: boolean };

type CmpOp = '==' | '!=' | '>' | '>=' | '<' | '<=';

export class ExprSyntaxError extends Error {
  constructor(message: string, source: string) {
    super(`invalid predicate expression "${source}": ${message}`);
    this.name = 'ExprSyntaxError';
  }
}

export class ExprEvalError extends Error {
  constructor(message: string, source: string) {
    super(`cannot evaluate predicate "${source}": ${message}`);
    this.name = 'ExprEvalError';
  }
}

// --- Tokenizer ---------------------------------------------------------------

type Token =
  | { readonly kind: 'op'; readonly value: string }
  | { readonly kind: 'num'; readonly value: number }
  | { readonly kind: 'str'; readonly value: string }
  | { readonly kind: 'ident'; readonly value: string };

const TOKEN_RE =
  /\s*(?:(&&|\|\||==|!=|>=|<=|[><!()])|(-?\d+(?:\.\d+)?)|'([^']*)'|"([^"]*)"|([a-zA-Z_][a-zA-Z0-9_.]*))/y;

function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  TOKEN_RE.lastIndex = 0;
  let index = 0;
  while (index < source.length) {
    TOKEN_RE.lastIndex = index;
    const match = TOKEN_RE.exec(source);
    if (!match || match.index !== index) {
      throw new ExprSyntaxError(`unexpected character at offset ${index}`, source);
    }
    const [full, op, num, sq, dq, ident] = match;
    if (op !== undefined) tokens.push({ kind: 'op', value: op });
    else if (num !== undefined) tokens.push({ kind: 'num', value: Number(num) });
    else if (sq !== undefined) tokens.push({ kind: 'str', value: sq });
    else if (dq !== undefined) tokens.push({ kind: 'str', value: dq });
    else if (ident !== undefined) tokens.push({ kind: 'ident', value: ident });
    index += full.length;
  }
  return tokens;
}

// --- Parser --------------------------------------------------------------------

class Parser {
  private readonly tokens: Token[];
  private pos = 0;
  private readonly source: string;

  constructor(tokens: Token[], source: string) {
    this.tokens = tokens;
    this.source = source;
  }

  parse(): Node {
    const node = this.parseOr();
    if (this.pos < this.tokens.length) {
      throw new ExprSyntaxError(
        `unexpected trailing token near position ${this.pos}`,
        this.source,
      );
    }
    return node;
  }

  private peek(): Token | undefined {
    return this.tokens[this.pos];
  }

  private consumeOp(value: string): boolean {
    const tok = this.peek();
    if (tok?.kind === 'op' && tok.value === value) {
      this.pos += 1;
      return true;
    }
    return false;
  }

  private parseOr(): Node {
    let left = this.parseAnd();
    while (this.consumeOp('||')) {
      const right = this.parseAnd();
      left = { kind: 'or', left, right };
    }
    return left;
  }

  private parseAnd(): Node {
    let left = this.parseNot();
    while (this.consumeOp('&&')) {
      const right = this.parseNot();
      left = { kind: 'and', left, right };
    }
    return left;
  }

  private parseNot(): Node {
    if (this.consumeOp('!')) {
      return { kind: 'not', operand: this.parseNot() };
    }
    return this.parseComparison();
  }

  /**
   * A parenthesized group can itself be a full boolean sub-expression (e.g.
   * `(a || b) && c`) — `parseGroup` returns it as-is (already boolean, kind
   * `or`/`and`/`not`/`cmp`) so `parseComparison` must NOT re-wrap it in
   * another `cmp`; only a genuine scalar operand (num/str/bool/path) gets
   * that treatment.
   */
  private parseComparison(): Node {
    const left = this.parseGroup();
    if (isBooleanComposite(left)) {
      return left;
    }
    const cmpTok = this.peek();
    if (cmpTok?.kind === 'op' && isCmpOp(cmpTok.value)) {
      this.pos += 1;
      const right = this.parseGroup();
      return { kind: 'cmp', op: cmpTok.value, left, right };
    }
    return { kind: 'cmp', op: '==', left, right: null };
  }

  private parseGroup(): Node {
    if (this.consumeOp('(')) {
      const inner = this.parseOr();
      if (!this.consumeOp(')')) {
        throw new ExprSyntaxError('expected closing ")"', this.source);
      }
      return inner;
    }
    return this.parseOperand();
  }

  private parseOperand(): Node {
    const tok = this.peek();
    if (!tok) {
      throw new ExprSyntaxError('unexpected end of input', this.source);
    }
    if (tok.kind === 'num') {
      this.pos += 1;
      return { kind: 'num', value: tok.value };
    }
    if (tok.kind === 'str') {
      this.pos += 1;
      return { kind: 'str', value: tok.value };
    }
    if (tok.kind === 'ident') {
      this.pos += 1;
      if (tok.value === 'true' || tok.value === 'false') {
        return { kind: 'bool', value: tok.value === 'true' };
      }
      return { kind: 'path', path: tok.value };
    }
    throw new ExprSyntaxError(`unexpected token near position ${this.pos}`, this.source);
  }
}

function isBooleanComposite(
  node: Node,
): node is Extract<Node, { kind: 'or' | 'and' | 'not' | 'cmp' }> {
  return (
    node.kind === 'or' ||
    node.kind === 'and' ||
    node.kind === 'not' ||
    node.kind === 'cmp'
  );
}

function isCmpOp(value: string): value is CmpOp {
  return (
    value === '==' ||
    value === '!=' ||
    value === '>' ||
    value === '>=' ||
    value === '<' ||
    value === '<='
  );
}

export function parseExpr(source: string): Node {
  return new Parser(tokenize(source), source).parse();
}

// --- Path resolution -----------------------------------------------------------

export function getPath(root: unknown, path: string): unknown {
  let cursor: unknown = root;
  for (const segment of path.split('.')) {
    if (cursor === null || typeof cursor !== 'object') return undefined;
    cursor = (cursor as Record<string, unknown>)[segment];
  }
  return cursor;
}

// --- Evaluation ------------------------------------------------------------------

function evalOperand(node: Node, snapshot: unknown, source: string): ExprValue {
  switch (node.kind) {
    case 'num':
      return node.value;
    case 'str':
      return node.value;
    case 'bool':
      return node.value;
    case 'path': {
      const value = getPath(snapshot, node.path);
      if (
        typeof value !== 'number' &&
        typeof value !== 'string' &&
        typeof value !== 'boolean'
      ) {
        throw new ExprEvalError(
          `path "${node.path}" resolved to a non-scalar value`,
          source,
        );
      }
      return value;
    }
    default:
      throw new ExprEvalError('expected a scalar operand', source);
  }
}

function evalNode(node: Node, snapshot: unknown, source: string): boolean {
  switch (node.kind) {
    case 'or':
      return (
        evalNode(node.left, snapshot, source) || evalNode(node.right, snapshot, source)
      );
    case 'and':
      return (
        evalNode(node.left, snapshot, source) && evalNode(node.right, snapshot, source)
      );
    case 'not':
      return !evalNode(node.operand, snapshot, source);
    case 'cmp': {
      const left = evalOperand(node.left, snapshot, source);
      if (node.right === null) {
        if (typeof left !== 'boolean') {
          throw new ExprEvalError(
            'bare operand must be boolean (no implicit truthiness)',
            source,
          );
        }
        return left;
      }
      const right = evalOperand(node.right, snapshot, source);
      return compare(node.op, left, right, source);
    }
    default:
      // Unreachable: the parser only ever produces or/and/not/cmp at
      // positions evalNode is called from (parseComparison wraps every
      // bare scalar operand in a cmp node — see isBooleanComposite).
      throw new ExprEvalError('non-boolean expression', source);
  }
}

function compare(op: CmpOp, left: ExprValue, right: ExprValue, source: string): boolean {
  if (typeof left !== typeof right) {
    throw new ExprEvalError(
      `type mismatch comparing ${typeof left} to ${typeof right}`,
      source,
    );
  }
  switch (op) {
    case '==':
      return left === right;
    case '!=':
      return left !== right;
    case '>':
      return left > right;
    case '>=':
      return left >= right;
    case '<':
      return left < right;
    case '<=':
      return left <= right;
  }
}

/** Parses + evaluates `source` as a boolean predicate against `snapshot`. */
export function evaluatePredicate(source: string, snapshot: unknown): boolean {
  const ast = parseExpr(source);
  return evalNode(ast, snapshot, source);
}

/**
 * Leftmost path reference in `source`'s AST (pre-order, left-first) — the
 * "subject" a condition is about, used to resolve `{n}` in recommendation
 * templates. Returns null when the expression references no path (e.g. a
 * literal-only predicate).
 */
export function primaryPath(source: string): string | null {
  return firstPath(parseExpr(source));
}

function firstPath(node: Node): string | null {
  switch (node.kind) {
    case 'or':
    case 'and':
      return firstPath(node.left) ?? firstPath(node.right);
    case 'not':
      return firstPath(node.operand);
    case 'cmp':
      return firstPath(node.left) ?? (node.right ? firstPath(node.right) : null);
    case 'path':
      return node.path;
    default:
      return null;
  }
}
