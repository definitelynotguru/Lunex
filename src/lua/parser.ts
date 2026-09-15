// @ts-nocheck — fidelity port of Lunex v1 recursive-descent parser
import type { Token, AstNode } from './types';

export class Parser {
  tokens: Token[];
  pos = 0;

  constructor(tokens: Token[]) {
    this.tokens = tokens;
  }

  peek() { return this.tokens[this.pos]; }
  advance() { return this.tokens[this.pos++]; }

  expect(type, value) {
    const tok = this.advance();
    if (tok.type !== type || (value !== undefined && tok.value !== value)) {
      const got = tok.type === 'eof' ? 'end of input' : `'${tok.value}'`;
      throw new Error(`[Line ${tok.line}] Expected '${value || type}', got ${got}`);
    }
    return tok;
  }

  match(type, value) {
    const tok = this.peek();
    if (tok.type === type && (value === undefined || tok.value === value)) {
      return this.advance();
    }
    return null;
  }

  check(type, value) {
    const tok = this.peek();
    return tok.type === type && (value === undefined || tok.value === value);
  }

  // Entry
  parse() {
    const body = this.parseBlock();
    return { type: 'Program', body };
  }

  // block = statement* [return]
  parseBlock() {
    const stmts = [];
    while (!this.isBlockEnd()) {
      if (this.check('keyword', 'return')) {
        stmts.push(this.parseReturn());
        break;
      }
      const stmt = this.parseStatement();
      if (stmt) stmts.push(stmt);
    }
    return { type: 'Block', statements: stmts };
  }

  isBlockEnd() {
    const t = this.peek();
    if (t.type === 'eof') return true;
    if (t.type === 'keyword') {
      return ['end','else','elseif','until'].includes(t.value);
    }
    return false;
  }

  parseStatement() {
    const t = this.peek();
    if (t.type === 'punctuator' && t.value === ';') { this.advance(); return null; }

    if (t.type === 'keyword') {
      switch (t.value) {
        case 'local': return this.parseLocal();
        case 'function': return this.parseFunctionDecl();
        case 'if': return this.parseIf();
        case 'while': return this.parseWhile();
        case 'repeat': return this.parseRepeat();
        case 'for': return this.parseFor();
        case 'do': return this.parseDo();
        case 'break': this.advance(); return { type: 'BreakStatement', line: t.line };
        case 'return': return this.parseReturn();
      }
    }

    // assignment or call
    return this.parseAssignOrCall();
  }

  parseLocal() {
    const line = this.advance().line; // consume 'local'
    if (this.check('keyword', 'function')) {
      this.advance(); // consume 'function'
      const name = this.expect('identifier').value;
      const func = this.parseFuncBody();
      func.line = line;
      return { type: 'LocalFunctionDeclaration', name, func, line };
    }
    // local name [= expr], name [= expr]
    const names = [];
    const values = [];
    names.push(this.expect('identifier').value);
    while (this.match('punctuator', ',')) {
      names.push(this.expect('identifier').value);
    }
    if (this.match('operator', '=')) {
      values.push(...this.parseExprList());
    }
    return { type: 'LocalStatement', names, values, line };
  }

  parseFunctionDecl() {
    const line = this.advance().line; // consume 'function'
    // function Name[.Name]*[:method]
    let name = this.expect('identifier').value;
    let method = null;
    while (this.match('punctuator', '.')) {
      name += '.' + this.expect('identifier').value;
    }
    if (this.match('punctuator', ':')) {
      method = this.expect('identifier').value;
    }
    const func = this.parseFuncBody();
    func.line = line;
    if (method) {
      func.params.unshift('self');
      // We need to store the receiver for assignment
      return { type: 'FunctionDeclaration', name, method, func, line };
    }
    return { type: 'FunctionDeclaration', name, method: null, func, line };
  }

  parseFuncBody() {
    this.expect('punctuator', '(');
    const params = [];
    let isVararg = false;
    if (!this.check('punctuator', ')')) {
      if (this.check('vararg')) { this.advance(); isVararg = true; }
      else {
        params.push(this.expect('identifier').value);
        while (this.match('punctuator', ',')) {
          if (this.check('vararg')) { this.advance(); isVararg = true; break; }
          params.push(this.expect('identifier').value);
        }
      }
    }
    this.expect('punctuator', ')');
    const body = this.parseBlock();
    this.expect('keyword', 'end');
    return { type: 'FunctionExpression', params, isVararg, body };
  }

  parseIf() {
    const line = this.advance().line; // consume 'if'
    const clauses = [];
    const cond = this.parseExpression();
    this.expect('keyword', 'then');
    const body = this.parseBlock();
    clauses.push({ condition: cond, body });
    while (this.match('keyword', 'elseif')) {
      const ec = this.parseExpression();
      this.expect('keyword', 'then');
      clauses.push({ condition: ec, body: this.parseBlock() });
    }
    if (this.match('keyword', 'else')) {
      clauses.push({ condition: null, body: this.parseBlock() });
    }
    this.expect('keyword', 'end');
    return { type: 'IfStatement', clauses, line };
  }

  parseWhile() {
    const line = this.advance().line;
    const condition = this.parseExpression();
    this.expect('keyword', 'do');
    const body = this.parseBlock();
    this.expect('keyword', 'end');
    return { type: 'WhileStatement', condition, body, line };
  }

  parseRepeat() {
    const line = this.advance().line;
    const body = this.parseBlock();
    this.expect('keyword', 'until');
    const condition = this.parseExpression();
    return { type: 'RepeatStatement', condition, body, line };
  }

  parseFor() {
    const line = this.advance().line; // consume 'for'
    const name = this.expect('identifier').value;
    if (this.match('operator', '=')) {
      // numeric for
      const start = this.parseExpression();
      this.expect('punctuator', ',');
      const limit = this.parseExpression();
      let step = null;
      if (this.match('punctuator', ',')) step = this.parseExpression();
      this.expect('keyword', 'do');
      const body = this.parseBlock();
      this.expect('keyword', 'end');
      return { type: 'NumericFor', name, start, limit, step, body, line };
    }
    // generic for
    const names = [name];
    while (this.match('punctuator', ',')) names.push(this.expect('identifier').value);
    this.expect('keyword', 'in');
    const iterators = this.parseExprList();
    this.expect('keyword', 'do');
    const body = this.parseBlock();
    this.expect('keyword', 'end');
    return { type: 'GenericFor', names, iterators, body, line };
  }

  parseDo() {
    const line = this.advance().line;
    const body = this.parseBlock();
    this.expect('keyword', 'end');
    return { type: 'DoStatement', body, line };
  }

  parseReturn() {
    const line = this.advance().line;
    const values = [];
    if (!this.isBlockEnd() && !(this.peek().type === 'punctuator' && this.peek().value === ';')) {
      values.push(...this.parseExprList());
    }
    return { type: 'ReturnStatement', values, line };
  }

  parseAssignOrCall() {
    const expr = this.parseSuffixedExpr();
    // assignment?
    if (this.check('operator', '=')) {
      const targets = [this.exprToTarget(expr)];
      while (this.match('punctuator', ',')) {
        targets.push(this.exprToTarget(this.parseSuffixedExpr()));
      }
      this.expect('operator', '=');
      const values = this.parseExprList();
      return { type: 'AssignStatement', targets, values, line: expr.line };
    }
    // call statement?
    if (expr.type === 'CallExpression' || expr.type === 'MethodCall') {
      return { type: 'CallStatement', expression: expr, line: expr.line };
    }
    // standalone expression (discard) — could be e.g. a parenthesized expression
    return { type: 'CallStatement', expression: expr, line: expr.line };
  }

  exprToTarget(expr) {
    if (expr.type === 'Identifier') return { type: 'Identifier', name: expr.name, line: expr.line };
    if (expr.type === 'IndexExpression') return expr;
    if (expr.type === 'FieldExpression') return expr;
    throw new Error(`[Line ${expr.line}] Invalid assignment target`);
  }

  parseExprList() {
    const exprs = [this.parseExpression()];
    while (this.match('punctuator', ',')) {
      exprs.push(this.parseExpression());
    }
    return exprs;
  }

  // ---- Expression parsing with precedence climbing ----
  parseExpression(minPrec = 0) {
    return this.parseOr();
  }

  parseOr() {
    let left = this.parseAnd();
    while (this.check('keyword', 'or')) {
      const op = this.advance();
      const right = this.parseAnd();
      left = { type: 'BinaryExpression', op: 'or', left, right, line: op.line };
    }
    return left;
  }

  parseAnd() {
    let left = this.parseComparison();
    while (this.check('keyword', 'and')) {
      const op = this.advance();
      const right = this.parseComparison();
      left = { type: 'BinaryExpression', op: 'and', left, right, line: op.line };
    }
    return left;
  }

  parseComparison() {
    let left = this.parseConcat();
    while (this.check('operator')) {
      const op = this.peek().value;
      if (['==','~=','<','>','<=','>='].includes(op)) {
        this.advance();
        const right = this.parseConcat();
        left = { type: 'BinaryExpression', op, left, right, line: left.line };
      } else break;
    }
    return left;
  }

  parseConcat() {
    let left = this.parseAddSub();
    if (this.check('operator', '..')) {
      const op = this.advance();
      const right = this.parseConcat(); // right-associative
      left = { type: 'BinaryExpression', op: '..', left, right, line: op.line };
    }
    return left;
  }

  parseAddSub() {
    let left = this.parseMulDiv();
    while (this.check('operator')) {
      const op = this.peek().value;
      if (op === '+' || op === '-') {
        this.advance();
        const right = this.parseMulDiv();
        left = { type: 'BinaryExpression', op, left, right, line: left.line };
      } else break;
    }
    return left;
  }

  parseMulDiv() {
    let left = this.parseUnary();
    while (this.check('operator')) {
      const op = this.peek().value;
      if (op === '*' || op === '/' || op === '%') {
        this.advance();
        const right = this.parseUnary();
        left = { type: 'BinaryExpression', op, left, right, line: left.line };
      } else break;
    }
    return left;
  }

  parseUnary() {
    const t = this.peek();
    if (t.type === 'keyword' && t.value === 'not') {
      this.advance();
      const expr = this.parseUnary();
      return { type: 'UnaryExpression', op: 'not', operand: expr, line: t.line };
    }
    if (t.type === 'operator' && t.value === '-') {
      this.advance();
      const expr = this.parseUnary();
      return { type: 'UnaryExpression', op: '-', operand: expr, line: t.line };
    }
    if (t.type === 'operator' && t.value === '#') {
      this.advance();
      const expr = this.parseUnary();
      return { type: 'UnaryExpression', op: '#', operand: expr, line: t.line };
    }
    return this.parsePower();
  }

  parsePower() {
    let left = this.parsePrimary();
    if (this.check('operator', '^')) {
      const op = this.advance();
      const right = this.parseUnary(); // right-associative
      left = { type: 'BinaryExpression', op: '^', left, right, line: op.line };
    }
    return left;
  }

  parsePrimary() {
    const t = this.peek();
    if (t.type === 'number') { this.advance(); return { type: 'NumberLiteral', value: t.value, line: t.line }; }
    if (t.type === 'string') { this.advance(); return this.parseSuffixes({ type: 'StringLiteral', value: t.value, line: t.line }); }
    if (t.type === 'boolean') { this.advance(); return { type: 'BooleanLiteral', value: t.value, line: t.line }; }
    if (t.type === 'nil') { this.advance(); return { type: 'NilLiteral', line: t.line }; }
    if (t.type === 'vararg') { this.advance(); return { type: 'VarargExpression', line: t.line }; }
    if (t.type === 'keyword' && t.value === 'function') {
      this.advance();
      const func = this.parseFuncBody();
      func.line = t.line;
      return func;
    }
    if (t.type === 'punctuator' && t.value === '{') {
      return this.parseTableConstructor();
    }
    if (t.type === 'punctuator' && t.value === '(') {
      this.advance();
      const expr = this.parseExpression();
      this.expect('punctuator', ')');
      return this.parseSuffixes(expr);
    }
    if (t.type === 'identifier') {
      this.advance();
      const id = { type: 'Identifier', name: t.value, line: t.line };
      return this.parseSuffixes(id);
    }
    throw new Error(`[Line ${t.line}] Unexpected token: ${t.type === 'eof' ? 'end of input' : `'${t.value}'`}`);
  }

  parseSuffixes(expr) {
    while (true) {
      if (this.check('punctuator', '[')) {
        this.advance();
        const index = this.parseExpression();
        this.expect('punctuator', ']');
        expr = { type: 'IndexExpression', object: expr, index, line: expr.line };
      } else if (this.check('punctuator', '.')) {
        this.advance();
        const field = this.expect('identifier').value;
        expr = { type: 'FieldExpression', object: expr, field, line: expr.line };
      } else if (this.check('punctuator', ':')) {
        this.advance();
        const method = this.expect('identifier').value;
        this.expect('punctuator', '(');
        const args = this.parseArgList();
        this.expect('punctuator', ')');
        expr = { type: 'MethodCall', object: expr, method, args, line: expr.line };
      } else if (this.check('punctuator', '(')) {
        this.advance();
        const args = this.parseArgList();
        this.expect('punctuator', ')');
        expr = { type: 'CallExpression', callee: expr, args, line: expr.line };
      } else if (this.check('string')) {
        // f"str" sugar for f("str")
        const arg = this.advance();
        expr = { type: 'CallExpression', callee: expr, args: [{ type: 'StringLiteral', value: arg.value, line: arg.line }], line: expr.line };
      } else if (this.check('punctuator', '{')) {
        // f{table} sugar for f({table})
        const arg = this.parseTableConstructor();
        expr = { type: 'CallExpression', callee: expr, args: [arg], line: expr.line };
      } else {
        break;
      }
    }
    return expr;
  }

  parseSuffixedExpr() {
    return this.parseSuffixes(this.parsePrimary());
  }

  parseArgList() {
    if (this.check('punctuator', ')')) return [];
    return this.parseExprList();
  }

  parseTableConstructor() {
    const line = this.expect('punctuator', '{').line;
    const fields = [];
    let arrayIndex = 1;
    while (!this.check('punctuator', '}')) {
      if (this.check('punctuator', '[')) {
        // [expr] = expr
        this.advance();
        const key = this.parseExpression();
        this.expect('punctuator', ']');
        this.expect('operator', '=');
        const value = this.parseExpression();
        fields.push({ key, value });
      } else if (this.check('identifier') && this.tokens[this.pos + 1] && this.tokens[this.pos + 1].type === 'operator' && this.tokens[this.pos + 1].value === '=') {
        // name = expr
        const name = this.advance().value;
        this.advance(); // =
        const value = this.parseExpression();
        fields.push({ key: { type: 'StringLiteral', value: name, line: this.line }, value });
      } else {
        // positional
        const value = this.parseExpression();
        fields.push({ key: { type: 'NumberLiteral', value: arrayIndex++, line: value.line }, value });
      }
      if (this.match('punctuator', ',') || this.match('punctuator', ';')) continue;
      break;
    }
    this.expect('punctuator', '}');
    return { type: 'TableConstructor', fields, line };
  }
}
