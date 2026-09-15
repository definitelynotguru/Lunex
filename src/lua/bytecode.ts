/** Lunex Lua register-VM bytecode (Lua 5.2–inspired, educational encoding). */

export const Op = {
  MOVE: 'MOVE',
  LOADK: 'LOADK',
  LOADBOOL: 'LOADBOOL',
  LOADNIL: 'LOADNIL',
  GETGLOBAL: 'GETGLOBAL',
  SETGLOBAL: 'SETGLOBAL',
  GETUPVAL: 'GETUPVAL',
  SETUPVAL: 'SETUPVAL',
  GETTABLE: 'GETTABLE',
  SETTABLE: 'SETTABLE',
  NEWTABLE: 'NEWTABLE',
  SELF: 'SELF',
  ADD: 'ADD',
  SUB: 'SUB',
  MUL: 'MUL',
  DIV: 'DIV',
  MOD: 'MOD',
  POW: 'POW',
  UNM: 'UNM',
  NOT: 'NOT',
  LEN: 'LEN',
  CONCAT: 'CONCAT',
  JMP: 'JMP',
  EQ: 'EQ',
  LT: 'LT',
  LE: 'LE',
  TEST: 'TEST',
  CALL: 'CALL',
  RETURN: 'RETURN',
  FORPREP: 'FORPREP',
  FORLOOP: 'FORLOOP',
  TFORCALL: 'TFORCALL',
  TFORLOOP: 'TFORLOOP',
  CLOSURE: 'CLOSURE',
  VARARG: 'VARARG',
  SETLIST: 'SETLIST',
} as const;

export type OpName = (typeof Op)[keyof typeof Op];

export interface Instruction {
  op: OpName;
  A: number;
  B: number;
  C: number;
  /** Signed jump offset (for JMP/FOR*) or constant/proto index when Bx used */
  sBx?: number;
  Bx?: number;
  line: number;
}

export type LuaConstant = null | boolean | number | string;

export interface UpvalDesc {
  name: string;
  /** true = in enclosing function's registers; false = in enclosing upvals */
  inStack: boolean;
  index: number;
}

export interface Prototype {
  code: Instruction[];
  constants: LuaConstant[];
  prototypes: Prototype[];
  upvalues: UpvalDesc[];
  maxStack: number;
  numParams: number;
  isVararg: boolean;
  sourceName?: string;
  /** Local debug names by register, per pc range (simplified: name at register) */
  locVars: { name: string; reg: number; startPC: number; endPC: number }[];
}

export function disassemble(proto: Prototype, indent = 0): string {
  const pad = '  '.repeat(indent);
  const lines: string[] = [];
  lines.push(`${pad}; proto params=${proto.numParams} vararg=${proto.isVararg ? 1 : 0} stack=${proto.maxStack} nups=${proto.upvalues.length}`);
  proto.constants.forEach((k, i) => {
    lines.push(`${pad}; K[${i}] = ${formatK(k)}`);
  });
  proto.code.forEach((ins, pc) => {
    lines.push(`${pad}${String(pc).padStart(4, ' ')}  [${String(ins.line).padStart(3, ' ')}]  ${formatIns(ins)}`);
  });
  proto.prototypes.forEach((child, i) => {
    lines.push(`${pad}; --- proto ${i} ---`);
    lines.push(disassemble(child, indent + 1));
  });
  return lines.join('\n');
}

function formatK(k: LuaConstant): string {
  if (k === null) return 'nil';
  if (typeof k === 'string') return JSON.stringify(k);
  return String(k);
}

function formatIns(ins: Instruction): string {
  const { op, A, B, C } = ins;
  switch (op) {
    case Op.LOADK:
    case Op.GETGLOBAL:
    case Op.SETGLOBAL:
    case Op.CLOSURE:
      return `${op.padEnd(10)} R[${A}] K[${ins.Bx ?? B}]`;
    case Op.JMP:
    case Op.FORPREP:
    case Op.FORLOOP:
    case Op.TFORLOOP:
      return `${op.padEnd(10)} R[${A}] → ${ins.sBx ?? 0}`;
    case Op.CALL:
    case Op.RETURN:
    case Op.VARARG:
    case Op.SETLIST:
    case Op.TFORCALL:
      return `${op.padEnd(10)} R[${A}] ${B} ${C}`;
    case Op.LOADNIL:
      return `${op.padEnd(10)} R[${A}]..R[${A + B}]`;
    case Op.LOADBOOL:
      return `${op.padEnd(10)} R[${A}] ${B} skip=${C}`;
    case Op.TEST:
      return `${op.padEnd(10)} R[${A}] c=${C}`;
    case Op.EQ:
    case Op.LT:
    case Op.LE:
      return `${op.padEnd(10)} ${A} R[${B}] R[${C}]`;
    default:
      return `${op.padEnd(10)} R[${A}] R[${B}] R[${C}]`;
  }
}
