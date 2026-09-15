// @ts-nocheck — Lua 5.2–style register compiler (AST → bytecode)
import { Op, type Prototype, type LuaConstant, type UpvalDesc, type Instruction } from './bytecode';
import type { AstNode } from './types';

class FuncState {
  code: Instruction[] = [];
  constants: LuaConstant[] = [];
  prototypes: Prototype[] = [];
  upvalues: UpvalDesc[] = [];
  locVars: { name: string; reg: number; startPC: number; endPC: number }[] = [];
  parent: FuncState | null;
  freeReg = 0;
  maxStack = 0;
  numParams = 0;
  isVararg = false;
  scopes: Map<string, number>[] = [];
  breaks: number[][] = [];

  constructor(parent: FuncState | null = null) {
    this.parent = parent;
    this.scopes.push(new Map());
  }

  emit(op: string, A = 0, B = 0, C = 0, extra: Partial<Instruction> = {}, line = 0): number {
    const pc = this.code.length;
    this.code.push({ op: op as any, A, B, C, line, ...extra });
    return pc;
  }

  fixJump(pc: number, target?: number) {
    this.code[pc].sBx = (target ?? this.code.length) - pc - 1;
  }

  k(v: LuaConstant): number {
    for (let i = 0; i < this.constants.length; i++) {
      if (this.constants[i] === v) return i;
    }
    this.constants.push(v);
    return this.constants.length - 1;
  }

  reserve(n = 1): number {
    const r = this.freeReg;
    this.freeReg += n;
    if (this.freeReg > this.maxStack) this.maxStack = this.freeReg;
    return r;
  }

  freeTo(r: number) {
    this.freeReg = r;
  }

  enterScope() {
    this.scopes.push(new Map());
  }

  leaveScope() {
    const scope = this.scopes.pop()!;
    for (const lv of this.locVars) {
      if (lv.endPC < 0 && scope.get(lv.name) === lv.reg) lv.endPC = this.code.length;
    }
    let max = this.numParams;
    for (const sc of this.scopes) for (const reg of sc.values()) max = Math.max(max, reg + 1);
    this.freeReg = Math.max(max, this.numParams);
  }

  bindLocal(name: string, reg: number) {
    this.scopes[this.scopes.length - 1].set(name, reg);
    this.locVars.push({ name, reg, startPC: this.code.length, endPC: -1 });
  }

  resolveLocal(name: string): number | null {
    for (let i = this.scopes.length - 1; i >= 0; i--) {
      if (this.scopes[i].has(name)) return this.scopes[i].get(name)!;
    }
    return null;
  }

  resolveUpval(name: string): number | null {
    if (!this.parent) return null;
    const loc = this.parent.resolveLocal(name);
    if (loc !== null) return this.addUpval(name, true, loc);
    const up = this.parent.resolveUpval(name);
    if (up !== null) return this.addUpval(name, false, up);
    return null;
  }

  addUpval(name: string, inStack: boolean, index: number): number {
    const existing = this.upvalues.findIndex((u) => u.name === name);
    if (existing >= 0) return existing;
    this.upvalues.push({ name, inStack, index });
    return this.upvalues.length - 1;
  }

  toProto(): Prototype {
    for (const lv of this.locVars) if (lv.endPC < 0) lv.endPC = this.code.length;
    return {
      code: this.code,
      constants: this.constants,
      prototypes: this.prototypes,
      upvalues: this.upvalues,
      maxStack: Math.max(this.maxStack, 2),
      numParams: this.numParams,
      isVararg: this.isVararg,
      locVars: this.locVars,
    };
  }
}

export function compile(ast: AstNode): Prototype {
  const fs = new FuncState(null);
  fs.isVararg = true;
  const block = (ast as any).type === 'Program' ? (ast as any).body : ast;
  compileBlock(fs, block);
  fs.emit(Op.RETURN, 0, 1, 0, {}, 0);
  return fs.toProto();
}

function compileBlock(fs: FuncState, block: any) {
  const stmts = block?.statements ?? [];
  fs.enterScope();
  for (const s of stmts) compileStmt(fs, s);
  fs.leaveScope();
}

function compileStmt(fs: FuncState, node: any) {
  if (!node) return;
  const line = node.line || 0;
  switch (node.type) {
    case 'LocalStatement': {
      const names: string[] = node.names;
      const base = fs.freeReg;
      if (node.values?.length) compileExprList(fs, node.values, names.length);
      else for (let i = 0; i < names.length; i++) fs.emit(Op.LOADNIL, fs.reserve(1), 0, 0, {}, line);
      for (let i = 0; i < names.length; i++) fs.bindLocal(names[i], base + i);
      fs.freeReg = Math.max(fs.freeReg, base + names.length);
      break;
    }
    case 'LocalFunctionDeclaration': {
      const reg = fs.reserve(1);
      fs.bindLocal(node.name, reg);
      const pi = compileFunction(fs, node.func, node.name);
      fs.emit(Op.CLOSURE, reg, 0, 0, { Bx: pi }, line);
      break;
    }
    case 'FunctionDeclaration':
      compileFunctionDecl(fs, node);
      break;
    case 'AssignStatement':
      compileAssignment(fs, node);
      break;
    case 'CallStatement':
    case 'ExpressionStatement': {
      const expr = node.expression ?? node.call ?? node;
      const base = fs.freeReg;
      compileExpr(fs, expr, base, 0);
      fs.freeTo(base);
      break;
    }
    case 'IfStatement':
      compileIf(fs, node);
      break;
    case 'WhileStatement':
      compileWhile(fs, node);
      break;
    case 'RepeatStatement':
      compileRepeat(fs, node);
      break;
    case 'NumericFor':
      compileForNumeric(fs, node);
      break;
    case 'GenericFor':
      compileForGeneric(fs, node);
      break;
    case 'DoStatement':
      compileBlock(fs, node.body);
      break;
    case 'BreakStatement': {
      if (!fs.breaks.length) throw new Error(`[Line ${line}] no loop to break`);
      fs.breaks[fs.breaks.length - 1].push(fs.emit(Op.JMP, 0, 0, 0, { sBx: 0 }, line));
      break;
    }
    case 'ReturnStatement': {
      const base = fs.freeReg;
      const vals = node.values || [];
      if (!vals.length) fs.emit(Op.RETURN, 0, 1, 0, {}, line);
      else {
        const n = compileExprList(fs, vals, -1);
        fs.emit(Op.RETURN, base, n === -1 ? 0 : n + 1, 0, {}, line);
      }
      fs.freeTo(base);
      break;
    }
    case 'CallExpression':
    case 'MethodCall': {
      const base = fs.freeReg;
      compileExpr(fs, node, base, 0);
      fs.freeTo(base);
      break;
    }
  }
}

function compileExprList(fs: FuncState, exprs: any[], want: number): number {
  if (!exprs.length) {
    if (want > 0) for (let i = 0; i < want; i++) fs.emit(Op.LOADNIL, fs.reserve(1), 0, 0, {}, 0);
    return want < 0 ? 0 : want;
  }
  const base = fs.freeReg;
  for (let i = 0; i < exprs.length; i++) {
    const last = i === exprs.length - 1;
    if (last && want < 0) compileExpr(fs, exprs[i], fs.freeReg, -1);
    else if (last && want >= 0) compileExpr(fs, exprs[i], fs.freeReg, Math.max(1, want - i));
    else compileExpr(fs, exprs[i], fs.freeReg, 1);
  }
  if (want >= 0) {
    const have = fs.freeReg - base;
    if (have < want) for (let i = have; i < want; i++) fs.emit(Op.LOADNIL, fs.reserve(1), 0, 0, {}, 0);
    fs.freeTo(base + want);
    return want;
  }
  return -1;
}

function compileExpr(fs: FuncState, node: any, dest: number, nresults: number) {
  const line = node.line || 0;
  ensureDest(fs, dest);

  switch (node.type) {
    case 'NumberLiteral':
    case 'StringLiteral':
    case 'BooleanLiteral': {
      fs.emit(Op.LOADK, dest, 0, 0, { Bx: fs.k(node.value) }, line);
      finishResults(fs, dest, nresults);
      return;
    }
    case 'NilLiteral':
      fs.emit(Op.LOADNIL, dest, 0, 0, {}, line);
      finishResults(fs, dest, nresults);
      return;
    case 'VarargExpression':
      fs.emit(Op.VARARG, dest, nresults < 0 ? 0 : nresults + 1, 0, {}, line);
      if (nresults === 1) fs.freeReg = Math.max(fs.freeReg, dest + 1);
      else if (nresults > 1) fs.freeReg = Math.max(fs.freeReg, dest + nresults);
      else if (nresults < 0) fs.freeReg = Math.max(fs.freeReg, dest + 1);
      else fs.freeTo(dest);
      return;
    case 'Identifier':
      loadVar(fs, node.name, dest, line);
      finishResults(fs, dest, nresults);
      return;
    case 'BinaryExpression':
      compileBinary(fs, node, dest);
      finishResults(fs, dest, nresults);
      return;
    case 'UnaryExpression':
      compileUnary(fs, node, dest);
      finishResults(fs, dest, nresults);
      return;
    case 'TableConstructor':
      compileTable(fs, node, dest);
      finishResults(fs, dest, nresults);
      return;
    case 'FunctionExpression': {
      const pi = compileFunction(fs, node, null);
      fs.emit(Op.CLOSURE, dest, 0, 0, { Bx: pi }, line);
      finishResults(fs, dest, nresults);
      return;
    }
    case 'CallExpression':
      compileCall(fs, node, dest, nresults);
      return;
    case 'MethodCall':
      compileMethodCall(fs, node, dest, nresults);
      return;
    case 'IndexExpression': {
      const t = Math.max(fs.freeReg, dest + 1);
      fs.freeReg = t;
      compileExpr(fs, node.object, t, 1);
      compileExpr(fs, node.index, t + 1, 1);
      fs.emit(Op.GETTABLE, dest, t, t + 1, {}, line);
      fs.freeTo(dest + 1);
      finishResults(fs, dest, nresults);
      return;
    }
    case 'MemberExpression':
    case 'FieldExpression': {
      const t = Math.max(fs.freeReg, dest + 1);
      fs.freeReg = t;
      compileExpr(fs, node.object, t, 1);
      const key = node.property ?? node.field ?? node.name;
      fs.emit(Op.LOADK, t + 1, 0, 0, { Bx: fs.k(key) }, line);
      fs.freeReg = t + 2;
      fs.emit(Op.GETTABLE, dest, t, t + 1, {}, line);
      fs.freeTo(dest + 1);
      finishResults(fs, dest, nresults);
      return;
    }
    default:
      fs.emit(Op.LOADNIL, dest, 0, 0, {}, line);
      finishResults(fs, dest, nresults);
  }
}

function ensureDest(fs: FuncState, dest: number) {
  if (fs.freeReg <= dest) {
    fs.freeReg = dest + 1;
    if (fs.freeReg > fs.maxStack) fs.maxStack = fs.freeReg;
  }
}

function finishResults(fs: FuncState, dest: number, nresults: number) {
  if (nresults === 0) fs.freeTo(dest);
  else if (nresults === 1) fs.freeReg = Math.max(fs.freeReg, dest + 1);
  else if (nresults > 1) {
    for (let i = 1; i < nresults; i++) fs.emit(Op.LOADNIL, dest + i, 0, 0, {}, 0);
    fs.freeReg = Math.max(fs.freeReg, dest + nresults);
  }
}

function loadVar(fs: FuncState, name: string, dest: number, line: number) {
  const loc = fs.resolveLocal(name);
  if (loc !== null) {
    if (dest !== loc) fs.emit(Op.MOVE, dest, loc, 0, {}, line);
    return;
  }
  const up = fs.resolveUpval(name);
  if (up !== null) {
    fs.emit(Op.GETUPVAL, dest, up, 0, {}, line);
    return;
  }
  fs.emit(Op.GETGLOBAL, dest, 0, 0, { Bx: fs.k(name) }, line);
}

function storeVar(fs: FuncState, name: string, src: number, line: number) {
  const loc = fs.resolveLocal(name);
  if (loc !== null) {
    if (loc !== src) fs.emit(Op.MOVE, loc, src, 0, {}, line);
    return;
  }
  const up = fs.resolveUpval(name);
  if (up !== null) {
    fs.emit(Op.SETUPVAL, src, up, 0, {}, line);
    return;
  }
  fs.emit(Op.SETGLOBAL, src, 0, 0, { Bx: fs.k(name) }, line);
}

function compileBinary(fs: FuncState, node: any, dest: number) {
  const line = node.line || 0;
  const op = node.op;

  if (op === 'and' || op === 'or') {
    compileExpr(fs, node.left, dest, 1);
    // TEST A C: if (truthy(RA) == (C!=0)) then skip next instr
    fs.emit(Op.TEST, dest, 0, op === 'and' ? 0 : 1, {}, line);
    const j = fs.emit(Op.JMP, 0, 0, 0, { sBx: 0 }, line);
    compileExpr(fs, node.right, dest, 1);
    fs.fixJump(j);
    return;
  }

  if (op === '..') {
    ensureDest(fs, dest);
    compileExpr(fs, node.left, dest, 1);
    compileExpr(fs, node.right, dest + 1, 1);
    fs.emit(Op.CONCAT, dest, dest, dest + 1, {}, line);
    fs.freeTo(dest + 1);
    return;
  }

  const b = Math.max(fs.freeReg, dest + 1);
  fs.freeReg = b;
  compileExpr(fs, node.left, b, 1);
  compileExpr(fs, node.right, b + 1, 1);

  const arith: Record<string, string> = {
    '+': Op.ADD, '-': Op.SUB, '*': Op.MUL, '/': Op.DIV, '%': Op.MOD, '^': Op.POW,
  };
  if (arith[op]) {
    fs.emit(arith[op], dest, b, b + 1, {}, line);
    fs.freeTo(dest + 1);
    return;
  }

  let left = b;
  let right = b + 1;
  let invert = 0;
  let cop = op;
  if (op === '~=') {
    cop = '==';
    invert = 1;
  } else if (op === '>') {
    cop = '<';
    left = b + 1;
    right = b;
  } else if (op === '>=') {
    cop = '<=';
    left = b + 1;
    right = b;
  }
  const opc = cop === '==' ? Op.EQ : cop === '<' ? Op.LT : Op.LE;
  // EQ A B C: if ((RB==RC) != A) pc++
  fs.emit(opc, invert, left, right, {}, line);
  fs.emit(Op.JMP, 0, 0, 0, { sBx: 1 }, line);
  fs.emit(Op.LOADBOOL, dest, 0, 1, {}, line);
  fs.emit(Op.LOADBOOL, dest, 1, 0, {}, line);
  fs.freeTo(dest + 1);
}

function compileUnary(fs: FuncState, node: any, dest: number) {
  const line = node.line || 0;
  compileExpr(fs, node.operand ?? node.argument ?? node.expr, dest, 1);
  if (node.op === '-') fs.emit(Op.UNM, dest, dest, 0, {}, line);
  else if (node.op === 'not') fs.emit(Op.NOT, dest, dest, 0, {}, line);
  else if (node.op === '#') fs.emit(Op.LEN, dest, dest, 0, {}, line);
}

function compileTable(fs: FuncState, node: any, dest: number) {
  const line = node.line || 0;
  fs.emit(Op.NEWTABLE, dest, 0, 0, {}, line);
  ensureDest(fs, dest);
  const fields = node.fields || [];
  let arrIdx = 1;
  for (const f of fields) {
    if (f.type === 'IndexField' || f.key) {
      const t = Math.max(fs.freeReg, dest + 1);
      fs.freeReg = t;
      if (f.key) compileExpr(fs, f.key, t, 1);
      else {
        fs.emit(Op.LOADK, t, 0, 0, { Bx: fs.k(f.name) }, line);
        fs.freeReg = t + 1;
      }
      compileExpr(fs, f.value, t + 1, 1);
      fs.emit(Op.SETTABLE, dest, t, t + 1, {}, line);
      fs.freeTo(dest + 1);
    } else {
      const t = Math.max(fs.freeReg, dest + 1);
      fs.freeReg = t;
      fs.emit(Op.LOADK, t, 0, 0, { Bx: fs.k(arrIdx++) }, line);
      fs.freeReg = t + 1;
      compileExpr(fs, f.value ?? f, t + 1, 1);
      fs.emit(Op.SETTABLE, dest, t, t + 1, {}, line);
      fs.freeTo(dest + 1);
    }
  }
}

function compileCall(fs: FuncState, node: any, dest: number, nresults: number) {
  const line = node.line || 0;
  ensureDest(fs, dest);
  compileExpr(fs, node.callee ?? node.base ?? node.func, dest, 1);
  const args = node.arguments ?? node.args ?? [];
  let nargs: number;
  if (!args.length) nargs = 0;
  else {
    const start = dest + 1;
    fs.freeReg = start;
    for (let i = 0; i < args.length; i++) {
      const last = i === args.length - 1;
      compileExpr(fs, args[i], fs.freeReg, last ? -1 : 1);
    }
    nargs = -1; // treat as unknown / multret from last — simplify: fixed
    nargs = fs.freeReg - start;
  }
  // CALL A B C: A=fn, B=nargs+1 (0=multret), C=nresults+1 (0=multret)
  const B = nargs + 1;
  const C = nresults < 0 ? 0 : nresults + 1;
  fs.emit(Op.CALL, dest, B, C, {}, line);
  if (nresults === 0) fs.freeTo(dest);
  else if (nresults === 1) fs.freeReg = dest + 1;
  else if (nresults > 1) fs.freeReg = dest + nresults;
  else fs.freeReg = dest + 1;
}

function compileMethodCall(fs: FuncState, node: any, dest: number, nresults: number) {
  const line = node.line || 0;
  ensureDest(fs, dest);
  const t = dest;
  compileExpr(fs, node.object ?? node.base, t, 1);
  // SELF A B C : R[A+1]=R[B]; R[A]=R[B][RK[C]]
  fs.emit(Op.LOADK, t + 1, 0, 0, { Bx: fs.k(node.method ?? node.name) }, line);
  fs.freeReg = t + 2;
  fs.emit(Op.SELF, t, t, t + 1, {}, line);
  // SELF leaves fn at t, self at t+1
  fs.freeReg = t + 2;
  const args = node.arguments ?? node.args ?? [];
  for (let i = 0; i < args.length; i++) {
    const last = i === args.length - 1;
    compileExpr(fs, args[i], fs.freeReg, last ? 1 : 1);
  }
  const nargs = fs.freeReg - t - 1; // includes self
  const B = nargs + 1;
  const C = nresults < 0 ? 0 : nresults + 1;
  fs.emit(Op.CALL, t, B, C, {}, line);
  if (nresults === 0) fs.freeTo(dest);
  else if (nresults === 1) fs.freeReg = dest + 1;
  else if (nresults > 1) fs.freeReg = dest + nresults;
  else fs.freeReg = dest + 1;
}

function compileAssignment(fs: FuncState, node: any) {
  const line = node.line || 0;
  const targets = node.targets || node.variables || [];
  const values = node.values || node.expressions || [];
  const base = fs.freeReg;
  compileExprList(fs, values, targets.length);
  // assign from last to first for safety
  for (let i = targets.length - 1; i >= 0; i--) {
    const t = targets[i];
    const src = base + i;
    if (t.type === 'Identifier' || t.name) {
      storeVar(fs, t.name, src, line);
    } else if (t.type === 'IndexExpression') {
      const tmp = Math.max(fs.freeReg, base + targets.length);
      fs.freeReg = tmp;
      compileExpr(fs, t.object, tmp, 1);
      compileExpr(fs, t.index, tmp + 1, 1);
      fs.emit(Op.SETTABLE, tmp, tmp + 1, src, {}, line);
    } else if (t.type === 'MemberExpression' || t.type === 'FieldExpression') {
      const tmp = Math.max(fs.freeReg, base + targets.length);
      fs.freeReg = tmp;
      compileExpr(fs, t.object, tmp, 1);
      fs.emit(Op.LOADK, tmp + 1, 0, 0, { Bx: fs.k(t.property ?? t.field ?? t.name) }, line);
      fs.emit(Op.SETTABLE, tmp, tmp + 1, src, {}, line);
    }
  }
  fs.freeTo(base);
}

function compileFunction(fs: FuncState, node: any, name: string | null): number {
  const child = new FuncState(fs);
  const params = node.params || node.parameters || [];
  child.numParams = params.length;
  child.isVararg = !!(node.isVararg || node.vararg);
  for (let i = 0; i < params.length; i++) {
    const pname = typeof params[i] === 'string' ? params[i] : params[i].name;
    child.reserve(1);
    child.bindLocal(pname, i);
  }
  // method sugar: first param self already in params if parser added it
  compileBlock(child, node.body);
  child.emit(Op.RETURN, 0, 1, 0, {}, node.line || 0);
  const proto = child.toProto();
  fs.prototypes.push(proto);
  return fs.prototypes.length - 1;
}

function compileFunctionDecl(fs: FuncState, node: any) {
  const line = node.line || 0;
  const pi = compileFunction(fs, node.func || node, node.name);
  const reg = fs.reserve(1);
  fs.emit(Op.CLOSURE, reg, 0, 0, { Bx: pi }, line);
  // name may be "Stack" or "Stack.new"; method is colon method name
  const raw = String(node.name || '');
  const parts = raw.split('.');
  if (node.method) {
    // function obj:method() — assign to obj.method with self already in params
    const tmp = Math.max(fs.freeReg, reg + 1);
    fs.freeReg = tmp;
    loadVar(fs, parts[0], tmp, line);
    for (let i = 1; i < parts.length; i++) {
      fs.emit(Op.LOADK, tmp + 1, 0, 0, { Bx: fs.k(parts[i]) }, line);
      fs.emit(Op.GETTABLE, tmp, tmp, tmp + 1, {}, line);
    }
    fs.emit(Op.LOADK, tmp + 1, 0, 0, { Bx: fs.k(node.method) }, line);
    fs.emit(Op.SETTABLE, tmp, tmp + 1, reg, {}, line);
  } else if (parts.length === 1) {
    storeVar(fs, parts[0], reg, line);
  } else {
    const tmp = Math.max(fs.freeReg, reg + 1);
    fs.freeReg = tmp;
    loadVar(fs, parts[0], tmp, line);
    for (let i = 1; i < parts.length - 1; i++) {
      fs.emit(Op.LOADK, tmp + 1, 0, 0, { Bx: fs.k(parts[i]) }, line);
      fs.emit(Op.GETTABLE, tmp, tmp, tmp + 1, {}, line);
    }
    fs.emit(Op.LOADK, tmp + 1, 0, 0, { Bx: fs.k(parts[parts.length - 1]) }, line);
    fs.emit(Op.SETTABLE, tmp, tmp + 1, reg, {}, line);
  }
  fs.freeTo(reg);
}

function compileIf(fs: FuncState, node: any) {
  const line = node.line || 0;
  const endJumps: number[] = [];
  const clauses = node.clauses || [];
  // Also support node.condition / node.then / elseifs
  if (!clauses.length && node.condition) {
    clauses.push({ condition: node.condition, body: node.consequent || node.body });
    for (const e of node.elseifs || []) clauses.push(e);
    if (node.elseBody || node.alternate) clauses.push({ condition: null, body: node.elseBody || node.alternate });
  }

  for (let i = 0; i < clauses.length; i++) {
    const cl = clauses[i];
    if (cl.condition) {
      const condReg = fs.freeReg;
      compileExpr(fs, cl.condition, condReg, 1);
      fs.emit(Op.TEST, condReg, 0, 0, {}, line); // skip next if falsy
      const jf = fs.emit(Op.JMP, 0, 0, 0, { sBx: 0 }, line);
      fs.freeTo(condReg);
      compileBlock(fs, cl.body);
      if (i < clauses.length - 1) endJumps.push(fs.emit(Op.JMP, 0, 0, 0, { sBx: 0 }, line));
      fs.fixJump(jf);
    } else {
      compileBlock(fs, cl.body);
    }
  }
  for (const j of endJumps) fs.fixJump(j);
}

function compileWhile(fs: FuncState, node: any) {
  const line = node.line || 0;
  const loopStart = fs.code.length;
  fs.breaks.push([]);
  const condReg = fs.freeReg;
  compileExpr(fs, node.condition, condReg, 1);
  fs.emit(Op.TEST, condReg, 0, 0, {}, line);
  const exit = fs.emit(Op.JMP, 0, 0, 0, { sBx: 0 }, line);
  fs.freeTo(condReg);
  compileBlock(fs, node.body);
  fs.emit(Op.JMP, 0, 0, 0, { sBx: loopStart - fs.code.length - 1 }, line);
  fs.fixJump(exit);
  for (const b of fs.breaks.pop()!) fs.fixJump(b);
}

function compileRepeat(fs: FuncState, node: any) {
  const line = node.line || 0;
  const loopStart = fs.code.length;
  fs.breaks.push([]);
  compileBlock(fs, node.body);
  const condReg = fs.freeReg;
  compileExpr(fs, node.condition, condReg, 1);
  // until cond → exit when truthy
  fs.emit(Op.TEST, condReg, 0, 1, {}, line); // skip jmp if truthy
  fs.emit(Op.JMP, 0, 0, 0, { sBx: loopStart - fs.code.length - 1 }, line);
  fs.freeTo(condReg);
  for (const b of fs.breaks.pop()!) fs.fixJump(b);
}

function compileForNumeric(fs: FuncState, node: any) {
  const line = node.line || 0;
  fs.breaks.push([]);
  fs.enterScope();
  const base = fs.freeReg;
  // R[base]=index, R[base+1]=limit, R[base+2]=step
  compileExpr(fs, node.start, base, 1);
  compileExpr(fs, node.end ?? node.limit, base + 1, 1);
  if (node.step) compileExpr(fs, node.step, base + 2, 1);
  else {
    ensureDest(fs, base + 2);
    fs.emit(Op.LOADK, base + 2, 0, 0, { Bx: fs.k(1) }, line);
    fs.freeReg = base + 3;
  }
  fs.bindLocal(node.name, base); // visible index (Lua uses internal + copy — simplify: use base as index)
  const prep = fs.emit(Op.FORPREP, base, 0, 0, { sBx: 0 }, line);
  const bodyPC = fs.code.length;
  compileBlock(fs, node.body);
  const loop = fs.emit(Op.FORLOOP, base, 0, 0, { sBx: 0 }, line);
  fs.fixJump(prep, loop);
  fs.code[loop].sBx = bodyPC - loop - 1;
  fs.leaveScope();
  for (const b of fs.breaks.pop()!) fs.fixJump(b);
  fs.freeTo(base);
}

function compileForGeneric(fs: FuncState, node: any) {
  const line = node.line || 0;
  fs.breaks.push([]);
  fs.enterScope();
  const base = fs.freeReg;
  const iters = node.iterators || node.expressions || [];
  compileExprList(fs, iters, 3);
  const names: string[] = node.names || [];
  for (let i = 0; i < names.length; i++) fs.bindLocal(names[i], base + 3 + i);
  // JMP to TFORLOOP; body; TFORCALL; TFORLOOP → body
  const jmpToLoop = fs.emit(Op.JMP, 0, 0, 0, { sBx: 0 }, line);
  const bodyPC = fs.code.length;
  compileBlock(fs, node.body);
  const callPC = fs.code.length;
  fs.emit(Op.TFORCALL, base, 0, names.length, {}, line);
  const tfor = fs.emit(Op.TFORLOOP, base, 0, 0, { sBx: 0 }, line);
  fs.code[tfor].sBx = bodyPC - tfor - 1;
  fs.fixJump(jmpToLoop, tfor);
  fs.leaveScope();
  for (const b of fs.breaks.pop()!) fs.fixJump(b);
  fs.freeTo(base);
}
