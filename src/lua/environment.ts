import type { LuaValue } from './types';

export class Environment {
  vars: Record<string, LuaValue>;
  parent: Environment | null;

  constructor(parent?: Environment | null) {
    this.vars = Object.create(null) as Record<string, LuaValue>;
    this.parent = parent || null;
  }

  define(name: string, value: LuaValue): void {
    this.vars[name] = value;
  }

  get(name: string): LuaValue {
    if (Object.prototype.hasOwnProperty.call(this.vars, name) || name in this.vars) {
      return this.vars[name];
    }
    if (this.parent) return this.parent.get(name);
    return undefined;
  }

  set(name: string, value: LuaValue): void {
    if (name in this.vars) { this.vars[name] = value; return; }
    if (this.parent) { this.parent.set(name, value); return; }
    this.vars[name] = value;
  }

  has(name: string): boolean {
    return name in this.vars;
  }

  /** Snapshot of locals in this frame only (for inspector). */
  snapshot(): Record<string, LuaValue> {
    return { ...this.vars };
  }

  /** Walk chain and collect visible names (inner shadows outer). */
  snapshotChain(): Record<string, LuaValue> {
    const out: Record<string, LuaValue> = {};
    const chain: Environment[] = [];
    let cur: Environment | null = this;
    while (cur) { chain.push(cur); cur = cur.parent; }
    for (let i = chain.length - 1; i >= 0; i--) {
      Object.assign(out, chain[i].vars);
    }
    return out;
  }
}

export class LuaError extends Error {
  level: number;
  constructor(message: string, level?: number) {
    super(message);
    this.name = 'LuaError';
    this.level = level || 1;
  }
}

export class BreakSignal extends Error {
  constructor() {
    super('break');
    this.name = 'BreakSignal';
  }
}

export class ReturnSignal extends Error {
  values: LuaValue[];
  constructor(values: LuaValue[]) {
    super('return');
    this.name = 'ReturnSignal';
    this.values = values;
  }
}
