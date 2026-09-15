// @ts-nocheck — Lua 5.2–inspired register VM with step-debug hooks
import { Op, type Prototype, type Instruction, type LuaConstant } from './bytecode';
import type { DebugHooks, LuaValue } from './types';

export type PrintSink = {
  print: (text: string) => void;
  write: (text: string) => void;
};

export class LuaRuntimeError extends Error {
  line: number;
  constructor(message: string, line = 0) {
    super(line ? `[Line ${line}] ${message}` : message);
    this.name = 'LuaRuntimeError';
    this.line = line;
  }
}

type UpVal = { value: LuaValue } | { reg: number; frame: CallFrame };

interface Closure {
  __luaClosure: true;
  proto: Prototype;
  upvals: Array<{ get: () => LuaValue; set: (v: LuaValue) => void }>;
}

interface CallFrame {
  closure: Closure;
  pc: number;
  base: number; // unused in flat stack — we use local regs
  regs: LuaValue[];
  varargs: LuaValue[];
  wantResults: number;
  returnTo: number; // register in caller for results
  caller: CallFrame | null;
  /** Stack top for multret CALL/RETURN/VARARG (exclusive end index). */
  top: number;
}

export class LuaVM {
  globals: Record<string, LuaValue> = Object.create(null);
  hooks: DebugHooks = {};
  sink: PrintSink;
  private _stepGate: (() => Promise<void>) | null = null;
  private frame: CallFrame | null = null;
  private running = false;
  /** Exposed for inspector */
  lastLocals: Record<string, LuaValue> = {};
  lastPC = 0;
  lastLine = 0;
  lastProto: Prototype | null = null;

  constructor(sink?: PrintSink, hooks?: DebugHooks) {
    this.sink = sink || { print: console.log, write: (t) => process.stdout?.write?.(t) };
    this.hooks = hooks || {};
  }

  setStepGate(gate: (() => Promise<void>) | null) {
    this._stepGate = gate;
  }

  setGlobal(name: string, value: LuaValue) {
    this.globals[name] = value;
  }

  getGlobals() {
    return this.globals;
  }

  async run(proto: Prototype) {
    const closure = this.makeClosure(proto, null);
    const frame: CallFrame = {
      closure,
      pc: 0,
      base: 0,
      regs: new Array(Math.max(proto.maxStack, 2)).fill(null),
      varargs: [],
      wantResults: 0,
      returnTo: 0,
      caller: null,
      top: 0,
    };
    this.frame = frame;
    this.running = true;
    this.lastProto = proto;
    return await this.execute();
  }

  /** Single-step one instruction; returns false when halted */
  async stepOnce(): Promise<boolean> {
    if (!this.frame) return false;
    this.hooks.stepMode = true;
    const cont = await this.execOne(this.frame);
    return cont;
  }

  makeClosure(proto: Prototype, parent: CallFrame | null): Closure {
    const upvals = proto.upvalues.map((uv) => {
      if (!parent) {
        let box: LuaValue = null;
        return {
          get: () => box,
          set: (v: LuaValue) => {
            box = v;
          },
        };
      }
      if (uv.inStack) {
        const reg = uv.index;
        const fr = parent;
        return {
          get: () => fr.regs[reg],
          set: (v: LuaValue) => {
            fr.regs[reg] = v;
          },
        };
      }
      return parent.closure.upvals[uv.index];
    });
    return { __luaClosure: true, proto, upvals };
  }

  private async execute() {
    while (this.frame && this.running) {
      const cont = await this.execOne(this.frame);
      if (!cont) break;
    }
    return null;
  }

  private async execOne(frame: CallFrame): Promise<boolean> {
    const proto = frame.closure.proto;
    if (frame.pc >= proto.code.length) {
      this.running = false;
      return false;
    }
    const ins = proto.code[frame.pc];
    this.lastPC = frame.pc;
    this.lastLine = ins.line;
    this.lastProto = proto;
    this.captureLocals(frame);

    if (this.hooks.stepMode && this.hooks.onStatement) {
      await this.hooks.onStatement({
        node: { type: 'Op', op: ins.op, pc: frame.pc, line: ins.line } as any,
        locals: this.lastLocals,
        line: ins.line,
      });
    }
    if (this.hooks.stepMode && this._stepGate) await this._stepGate();

    frame.pc++;
    try {
      await this.dispatch(frame, ins);
    } catch (e) {
      this.running = false;
      throw e;
    }
    return this.running && !!this.frame;
  }

  private captureLocals(frame: CallFrame) {
    const out: Record<string, LuaValue> = {};
    const pc = frame.pc;
    for (const lv of frame.closure.proto.locVars) {
      if (pc >= lv.startPC && (lv.endPC < 0 || pc < lv.endPC)) {
        out[lv.name] = frame.regs[lv.reg];
      }
    }
    this.lastLocals = out;
  }

  private RK(frame: CallFrame, proto: Prototype, x: number): LuaValue {
    // In our encoding registers are always regs; constants loaded via LOADK
    return frame.regs[x];
  }

  private async dispatch(frame: CallFrame, ins: Instruction) {
    const { op, A, B, C } = ins;
    const proto = frame.closure.proto;
    const R = frame.regs;

    switch (op) {
      case Op.MOVE:
        R[A] = R[B];
        break;
      case Op.LOADK:
        R[A] = proto.constants[ins.Bx ?? B];
        break;
      case Op.LOADBOOL:
        R[A] = B !== 0;
        if (C) frame.pc++;
        break;
      case Op.LOADNIL:
        for (let i = A; i <= A + B; i++) R[i] = null;
        break;
      case Op.GETGLOBAL:
        R[A] = this.globals[proto.constants[ins.Bx ?? B] as string] ?? null;
        break;
      case Op.SETGLOBAL:
        this.globals[proto.constants[ins.Bx ?? B] as string] = R[A];
        break;
      case Op.GETUPVAL:
        R[A] = frame.closure.upvals[B].get();
        break;
      case Op.SETUPVAL:
        frame.closure.upvals[B].set(R[A]);
        break;
      case Op.GETTABLE: {
        const table = R[B];
        const key = R[C];
        R[A] = await this.getTable(table, key, ins.line);
        break;
      }
      case Op.SETTABLE:
        this.setTable(R[A], R[B], R[C], ins.line);
        break;
      case Op.NEWTABLE:
        R[A] = Object.create(null);
        break;
      case Op.SELF: {
        const obj = R[B];
        const key = R[C];
        R[A + 1] = obj;
        R[A] = await this.getTable(obj, key, ins.line);
        break;
      }
      case Op.ADD:
        R[A] = this.arith(R[B], R[C], (x, y) => x + y, ins.line);
        break;
      case Op.SUB:
        R[A] = this.arith(R[B], R[C], (x, y) => x - y, ins.line);
        break;
      case Op.MUL:
        R[A] = this.arith(R[B], R[C], (x, y) => x * y, ins.line);
        break;
      case Op.DIV:
        R[A] = this.arith(R[B], R[C], (x, y) => x / y, ins.line);
        break;
      case Op.MOD:
        R[A] = this.arith(R[B], R[C], (x, y) => x % y, ins.line);
        break;
      case Op.POW:
        R[A] = this.arith(R[B], R[C], (x, y) => x ** y, ins.line);
        break;
      case Op.UNM:
        if (typeof R[B] !== 'number') throw new LuaRuntimeError('attempt to perform arithmetic on a non-number', ins.line);
        R[A] = -R[B];
        break;
      case Op.NOT:
        R[A] = !this.truthy(R[B]);
        break;
      case Op.LEN:
        R[A] = this.len(R[B], ins.line);
        break;
      case Op.CONCAT:
        R[A] = String(R[B] ?? 'nil') + String(R[C] ?? 'nil');
        break;
      case Op.JMP:
        frame.pc += ins.sBx ?? 0;
        break;
      case Op.EQ:
        if ((this.eq(R[B], R[C]) ? 1 : 0) !== A) frame.pc++;
        break;
      case Op.LT:
        if ((this.lt(R[B], R[C], ins.line) ? 1 : 0) !== A) frame.pc++;
        break;
      case Op.LE:
        if ((this.le(R[B], R[C], ins.line) ? 1 : 0) !== A) frame.pc++;
        break;
      case Op.TEST:
        // if (truthy(R[A]) == (C!=0)) then skip next
        if (this.truthy(R[A]) === (C !== 0)) frame.pc++;
        break;
      case Op.CALL:
        await this.opCall(frame, ins);
        break;
      case Op.RETURN:
        this.opReturn(frame, ins);
        break;
      case Op.FORPREP: {
        // R[A]=index-step, R[A+1]=limit, R[A+2]=step; jump sBx
        if (typeof R[A] !== 'number' || typeof R[A + 1] !== 'number' || typeof R[A + 2] !== 'number') {
          throw new LuaRuntimeError("'for' initial/limit/step must be numbers", ins.line);
        }
        R[A] = R[A] - R[A + 2];
        frame.pc += ins.sBx ?? 0;
        break;
      }
      case Op.FORLOOP: {
        R[A] = (R[A] as number) + (R[A + 2] as number);
        const idx = R[A] as number;
        const limit = R[A + 1] as number;
        const step = R[A + 2] as number;
        if ((step > 0 && idx <= limit) || (step <= 0 && idx >= limit)) {
          frame.pc += ins.sBx ?? 0;
          R[A + 3] = idx; // external index — our compiler uses R[A] as visible; also set A+3
          // If local bound to A, it's already idx
        }
        break;
      }
      case Op.TFORCALL: {
        // R[A]=gen, R[A+1]=state, R[A+2]=ctrl; call gen(state,ctrl) → R[A+3]..
        const nresults = C;
        const gen = R[A];
        const args = [R[A + 1], R[A + 2]];
        const results = await this.invoke(gen, args, ins.line);
        for (let i = 0; i < nresults; i++) R[A + 3 + i] = results[i] ?? null;
        break;
      }
      case Op.TFORLOOP: {
        if (R[A + 3] === null || R[A + 3] === undefined) {
          // exit — fall through (sBx points past loop); our compiler sets exit jump
          // If control is nil, skip jump back — fixJump on exit means sBx to after loop
          // Instruction: if R[A+3] ~= nil then R[A+2]=R[A+3]; pc += sBx
        } else {
          R[A + 2] = R[A + 3];
          frame.pc += ins.sBx ?? 0;
        }
        break;
      }
      case Op.CLOSURE: {
        const sub = proto.prototypes[ins.Bx ?? B];
        R[A] = this.makeClosure(sub, frame);
        break;
      }
      case Op.VARARG: {
        const want = B === 0 ? frame.varargs.length : B - 1;
        this.ensureRegs(frame, A + want);
        for (let i = 0; i < want; i++) R[A + i] = frame.varargs[i] ?? null;
        if (B === 0) frame.top = A + want;
        break;
      }
      case Op.SETLIST: {
        const n = B === 0 ? 0 : B;
        const table = R[A];
        for (let i = 1; i <= n; i++) (table as any)[i] = R[A + i];
        break;
      }
      default:
        throw new LuaRuntimeError(`unknown opcode ${op}`, ins.line);
    }
  }

  private ensureRegs(frame: CallFrame, need: number) {
    while (frame.regs.length < need) frame.regs.push(null);
  }

  private async opCall(frame: CallFrame, ins: Instruction) {
    const { A, B, C } = ins;
    const fn = frame.regs[A];
    const nargs = B === 0 ? Math.max(0, frame.top - A - 1) : B - 1;
    const args: LuaValue[] = [];
    for (let i = 1; i <= nargs; i++) args.push(frame.regs[A + i]);
    const nwant = C === 0 ? -1 : C - 1;
    const results = await this.invoke(fn, args, ins.line);
    if (nwant === 0) {
      frame.top = A;
      return;
    }
    if (nwant === -1) {
      this.ensureRegs(frame, A + results.length);
      for (let i = 0; i < results.length; i++) frame.regs[A + i] = results[i];
      frame.top = A + results.length;
    } else {
      this.ensureRegs(frame, A + nwant);
      for (let i = 0; i < nwant; i++) frame.regs[A + i] = results[i] ?? null;
      frame.top = A + nwant;
    }
  }

  private collectReturn(frame: CallFrame, A: number, B: number): LuaValue[] {
    if (B === 1) return [];
    if (B > 1) {
      const results: LuaValue[] = [];
      for (let i = 0; i < B - 1; i++) results.push(frame.regs[A + i]);
      return results;
    }
    // B==0 multret — from A to top
    const end = Math.max(frame.top, A);
    const results: LuaValue[] = [];
    for (let i = A; i < end; i++) results.push(frame.regs[i]);
    return results;
  }

  private opReturn(frame: CallFrame, ins: Instruction) {
    const { A, B } = ins;
    // Results are consumed by invoke()'s RETURN handling for nested calls.
    void this.collectReturn(frame, A, B);
    if (!frame.caller) {
      this.running = false;
      this.frame = null;
      return;
    }
    this.frame = frame.caller;
  }

  async invoke(fn: LuaValue, args: LuaValue[], line: number): Promise<LuaValue[]> {
    if (typeof fn === 'function') {
      const r = await (fn as any)(...args);
      if (r === undefined || r === null) return [r ?? null];
      if (Array.isArray(r) && (r as any).__multi) return [...r];
      return [r];
    }
    if (fn && (fn as any).__luaClosure) {
      const closure = fn as Closure;
      const child: CallFrame = {
        closure,
        pc: 0,
        base: 0,
        regs: new Array(Math.max(closure.proto.maxStack, args.length + 2)).fill(null),
        varargs: [],
        wantResults: -1,
        returnTo: 0,
        caller: this.frame,
        top: 0,
      };
      for (let i = 0; i < closure.proto.numParams; i++) child.regs[i] = args[i] ?? null;
      if (closure.proto.isVararg) child.varargs = args.slice(closure.proto.numParams);
      const prev = this.frame;
      this.frame = child;
      const rets: LuaValue[] = [];
      // Run until return
      while (this.frame === child && this.running) {
        if (child.pc >= closure.proto.code.length) break;
        const ins = closure.proto.code[child.pc];
        if (ins.op === Op.RETURN) {
          child.pc++;
          const { A, B } = ins;
          rets.push(...this.collectReturn(child, A, B));
          break;
        }
        this.lastPC = child.pc;
        this.lastLine = ins.line;
        this.captureLocals(child);
        if (this.hooks.stepMode && this.hooks.onStatement) {
          await this.hooks.onStatement({
            node: { type: 'Op', op: ins.op, pc: child.pc, line: ins.line } as any,
            locals: this.lastLocals,
            line: ins.line,
          });
        }
        if (this.hooks.stepMode && this._stepGate) await this._stepGate();
        child.pc++;
        await this.dispatch(child, ins);
      }
      this.frame = prev;
      return rets;
    }
    throw new LuaRuntimeError(`attempt to call a ${this.typeName(fn)} value`, line);
  }

  truthy(v: LuaValue) {
    return v !== null && v !== undefined && v !== false;
  }

  eq(a: LuaValue, b: LuaValue) {
    return a === b;
  }

  lt(a: LuaValue, b: LuaValue, line: number) {
    if (typeof a === 'number' && typeof b === 'number') return a < b;
    if (typeof a === 'string' && typeof b === 'string') return a < b;
    throw new LuaRuntimeError('attempt to compare ' + this.typeName(a) + ' with ' + this.typeName(b), line);
  }

  le(a: LuaValue, b: LuaValue, line: number) {
    if (typeof a === 'number' && typeof b === 'number') return a <= b;
    if (typeof a === 'string' && typeof b === 'string') return a <= b;
    throw new LuaRuntimeError('attempt to compare ' + this.typeName(a) + ' with ' + this.typeName(b), line);
  }

  arith(a: LuaValue, b: LuaValue, fn: (x: number, y: number) => number, line: number) {
    if (typeof a !== 'number' || typeof b !== 'number') {
      throw new LuaRuntimeError('attempt to perform arithmetic on a non-number', line);
    }
    return fn(a, b);
  }

  len(v: LuaValue, line: number) {
    if (typeof v === 'string') return v.length;
    if (v && typeof v === 'object') {
      let i = 1;
      while ((v as any)[i] !== undefined && (v as any)[i] !== null) i++;
      return i - 1;
    }
    throw new LuaRuntimeError('attempt to get length of a ' + this.typeName(v) + ' value', line);
  }

  async getTable(table: LuaValue, key: LuaValue, line: number): Promise<LuaValue> {
    if (typeof table === 'string') {
      const lib = this.globals.string as any;
      const method = lib && lib[key as any];
      if (typeof method === 'function') {
        return (self: any, ...args: any[]) => method(self, ...args);
      }
      return null;
    }
    if (!table || typeof table !== 'object') {
      throw new LuaRuntimeError('attempt to index a ' + this.typeName(table) + ' value', line);
    }
    const t = table as any;
    const k = key as any;
    if (t[k] !== undefined && t[k] !== null) return t[k];
    const mt = t.__metatable;
    if (mt && mt.__index != null) {
      const idx = mt.__index;
      if (typeof idx === 'function') {
        const r = await idx(t, k);
        return r === undefined ? null : r;
      }
      if (idx && idx.__luaClosure) {
        const results = await this.invoke(idx, [t, k], line);
        return results[0] ?? null;
      }
      if (idx && typeof idx === 'object') {
        return idx[k] !== undefined ? idx[k] : null;
      }
    }
    return t[k] !== undefined ? t[k] : null;
  }

  setTable(table: LuaValue, key: LuaValue, value: LuaValue, line: number) {
    if (!table || typeof table !== 'object') {
      throw new LuaRuntimeError('attempt to index a ' + this.typeName(table) + ' value', line);
    }
    (table as any)[key as any] = value;
  }

  typeName(v: LuaValue) {
    if (v === null || v === undefined) return 'nil';
    if (typeof v === 'number') return 'number';
    if (typeof v === 'string') return 'string';
    if (typeof v === 'boolean') return 'boolean';
    if (typeof v === 'function' || (v && (v as any).__luaClosure)) return 'function';
    return 'table';
  }
}
