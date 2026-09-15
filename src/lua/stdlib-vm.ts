// @ts-nocheck
import type { LuaVM, PrintSink } from './vm';
import { LuaRuntimeError } from './vm';

export function registerStdLib(vm: LuaVM) {
  const g = vm.globals;
  const sink = vm.sink;

  g.print = (...args: any[]) => {
    const parts = args.map(stringify);
    sink.print(parts.join('\t'));
  };

  g.io = {
    write: (...args: any[]) => sink.write(args.map(stringify).join('')),
    flush: () => {},
  };

  g.type = (v: any) => vm.typeName(v);
  g.tostring = (v: any) => stringify(v);
  g.tonumber = (v: any) => {
    if (typeof v === 'number') return v;
    if (typeof v === 'string') {
      const n = Number(v);
      return isNaN(n) ? null : n;
    }
    return null;
  };

  g.assert = (v: any, msg?: any) => {
    if (!vm.truthy(v)) throw new LuaRuntimeError(msg != null ? String(msg) : 'assertion failed!');
    return v;
  };

  g.error = (msg?: any) => {
    throw new LuaRuntimeError(msg != null ? String(msg) : 'error');
  };

  g.pcall = async (fn: any, ...args: any[]) => {
    try {
      const result = await vm.invoke(fn, args, 0);
      const r = [true, ...result];
      (r as any).__multi = true;
      return r;
    } catch (e: any) {
      const r = [false, e?.message ?? String(e)];
      (r as any).__multi = true;
      return r;
    }
  };

  g.select = (index: any, ...args: any[]) => {
    if (index === '#') return args.length;
    const n = Number(index);
    if (isNaN(n) || n < 1) return null;
    const slice = args.slice(n - 1);
    if (slice.length > 1) (slice as any).__multi = true;
    return slice.length === 1 ? slice[0] : slice;
  };

  g.ipairs = (t: any) => {
    let i = 0;
    const iter = (_table: any, _prev: any) => {
      i++;
      if (t[i] === undefined || t[i] === null) return null;
      const r = [i, t[i]];
      (r as any).__multi = true;
      return r;
    };
    const r = [iter, t, 0];
    (r as any).__multi = true;
    return r;
  };

  g.pairs = (t: any) => {
    const keys: string[] = [];
    if (t && typeof t === 'object') {
      const numKeys: number[] = [];
      const strKeys: string[] = [];
      for (const k of Object.keys(t)) {
        if (k === '__metatable') continue;
        const n = Number(k);
        if (!isNaN(n) && String(n) === k && n >= 1) numKeys.push(n);
        else strKeys.push(k);
      }
      numKeys.sort((a, b) => a - b);
      keys.push(...numKeys.map(String), ...strKeys);
    }
    let idx = 0;
    const iter = () => {
      if (idx >= keys.length) return null;
      const key = keys[idx++];
      const n = Number(key);
      const actual = !isNaN(n) && String(n) === key ? n : key;
      const r = [actual, t[key]];
      (r as any).__multi = true;
      return r;
    };
    const r = [iter, t, null];
    (r as any).__multi = true;
    return r;
  };

  g.setmetatable = (t: any, mt: any) => {
    if (t == null) throw new LuaRuntimeError("bad argument #1 to 'setmetatable' (table expected)");
    t.__metatable = mt;
    return t;
  };
  g.getmetatable = (t: any) => (t && t.__metatable) || null;

  g.rawget = (t: any, k: any) => (t && t[k] !== undefined ? t[k] : null);
  g.rawset = (t: any, k: any, v: any) => {
    if (t) t[k] = v;
    return t;
  };
  g.rawequal = (a: any, b: any) => a === b;
  g.collectgarbage = () => 0;

  g.next = (t: any, key: any) => {
    const keys: string[] = [];
    for (const k in t) if (k !== '__metatable') keys.push(k);
    if (key == null) {
      if (!keys.length) return null;
      const k = keys[0];
      const n = Number(k);
      const r = [!isNaN(n) && String(n) === k ? n : k, t[k]];
      (r as any).__multi = true;
      return r;
    }
    const idx = keys.indexOf(String(key));
    if (idx < 0 || idx + 1 >= keys.length) return null;
    const nk = keys[idx + 1];
    const n = Number(nk);
    const r = [!isNaN(n) && String(n) === nk ? n : nk, t[nk]];
    (r as any).__multi = true;
    return r;
  };

  const mathLib: any = {
    floor: Math.floor,
    ceil: Math.ceil,
    sqrt: Math.sqrt,
    abs: Math.abs,
    sin: Math.sin,
    cos: Math.cos,
    tan: Math.tan,
    asin: Math.asin,
    acos: Math.acos,
    atan: Math.atan,
    atan2: Math.atan2,
    log: Math.log,
    exp: Math.exp,
    pi: Math.PI,
    huge: Infinity,
    max: (...a: number[]) => Math.max(...a.filter((x) => typeof x === 'number')),
    min: (...a: number[]) => Math.min(...a.filter((x) => typeof x === 'number')),
    pow: Math.pow,
    random: (m?: number, n?: number) => {
      if (m === undefined) return Math.random();
      if (n === undefined) return Math.floor(Math.random() * Math.floor(m)) + 1;
      m = Math.floor(m);
      n = Math.floor(n);
      return Math.floor(Math.random() * (n - m + 1)) + m;
    },
    randomseed: () => {},
    fmod: (x: number, y: number) => x % y,
    modf: (x: number) => {
      const r = [Math.floor(x), x - Math.floor(x)];
      (r as any).__multi = true;
      return r;
    },
  };
  g.math = mathLib;

  const stringLib: any = {
    len: (s: any) => String(s).length,
    upper: (s: any) => String(s).toUpperCase(),
    lower: (s: any) => String(s).toLowerCase(),
    sub: (s: any, i: number, j?: number) => {
      s = String(s);
      if (i < 0) i = s.length + i + 1;
      if (j == null) j = s.length;
      if (j < 0) j = s.length + j + 1;
      return s.substring(i - 1, j);
    },
    rep: (s: any, n: number) => String(s).repeat(n),
    reverse: (s: any) => String(s).split('').reverse().join(''),
    byte: (s: any, i?: number) => String(s).charCodeAt((i || 1) - 1),
    char: (...args: number[]) => String.fromCharCode(...args),
    find: (s: any, pattern: string, init?: number) => {
      s = String(s);
      let offset = 0;
      if (init) {
        if (init < 0) init = s.length + init + 1;
        offset = init - 1;
        s = s.substring(offset);
      }
      const idx = s.indexOf(pattern);
      if (idx < 0) return null;
      const start = idx + offset + 1;
      const r = [start, start + pattern.length - 1];
      (r as any).__multi = true;
      return r;
    },
    format: (fmt: any, ...args: any[]) => {
      let argIdx = 0;
      return String(fmt).replace(/%([%diouxXeEfgGcspq])/g, (match, spec) => {
        if (spec === '%') return '%';
        const val = args[argIdx++];
        if (val === undefined) return match;
        switch (spec) {
          case 'd':
          case 'i':
            return String(Math.floor(Number(val)));
          case 'f':
            return Number(val).toFixed(6);
          case 's':
            return String(val);
          case 'q':
            return '"' + String(val).replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
          default:
            return String(val);
        }
      });
    },
    match: (s: any, pattern: string) => {
      try {
        const m = String(s).match(new RegExp(pattern));
        return m ? m[0] : null;
      } catch {
        return null;
      }
    },
    gsub: (s: any, pattern: string, repl: any) => String(s).replace(new RegExp(pattern, 'g'), repl),
  };
  g.string = stringLib;

  // String __index metamethod simulation on getTable — patch vm later if needed

  const tableLib: any = {
    insert: (t: any, posOrVal: any, val?: any) => {
      if (val === undefined) {
        let maxKey = 0;
        for (const k in t) {
          const n = Number(k);
          if (!isNaN(n) && String(n) === k && n > maxKey) maxKey = n;
        }
        t[maxKey + 1] = posOrVal;
      } else {
        const pos = posOrVal;
        let maxKey = 0;
        for (const k in t) {
          const n = Number(k);
          if (!isNaN(n) && String(n) === k && n > maxKey) maxKey = n;
        }
        for (let i = maxKey; i >= pos; i--) t[i + 1] = t[i];
        t[pos] = val;
      }
    },
    remove: (t: any, pos?: number) => {
      let maxKey = 0;
      for (const k in t) {
        const n = Number(k);
        if (!isNaN(n) && String(n) === k && n > maxKey) maxKey = n;
      }
      if (pos === undefined) pos = maxKey;
      const v = t[pos];
      for (let i = pos; i < maxKey; i++) t[i] = t[i + 1];
      delete t[maxKey];
      return v;
    },
    sort: (t: any) => {
      const arr: any[] = [];
      let maxKey = 0;
      for (const k in t) {
        const n = Number(k);
        if (!isNaN(n) && String(n) === k && n > maxKey) maxKey = n;
      }
      for (let i = 1; i <= maxKey; i++) arr.push(t[i]);
      arr.sort((a, b) => {
        if (typeof a === 'number' && typeof b === 'number') return a - b;
        if (typeof a === 'string' && typeof b === 'string') return a < b ? -1 : a > b ? 1 : 0;
        return 0;
      });
      for (let i = 0; i < arr.length; i++) t[i + 1] = arr[i];
    },
    concat: (t: any, sep = '') => {
      const arr: string[] = [];
      let maxKey = 0;
      for (const k in t) {
        const n = Number(k);
        if (!isNaN(n) && String(n) === k && n > maxKey) maxKey = n;
      }
      for (let i = 1; i <= maxKey; i++) if (t[i] != null) arr.push(String(t[i]));
      return arr.join(sep);
    },
    pack: (...args: any[]) => {
      const t: any = Object.create(null);
      for (let i = 0; i < args.length; i++) t[i + 1] = args[i];
      t.n = args.length;
      return t;
    },
    unpack: (t: any, i = 1, j?: number) => {
      let maxKey = 0;
      for (const k in t) {
        const n = Number(k);
        if (!isNaN(n) && String(n) === k && n > maxKey) maxKey = n;
      }
      j = j ?? maxKey;
      const result: any[] = [];
      for (let k = i; k <= j; k++) result.push(t[k] ?? null);
      if (result.length > 1) (result as any).__multi = true;
      return result.length === 1 ? result[0] : result;
    },
  };
  g.table = tableLib;
  g.unpack = tableLib.unpack;

  const start = typeof performance !== 'undefined' ? performance.now() : Date.now();
  g.os = {
    clock: () => ((typeof performance !== 'undefined' ? performance.now() : Date.now()) - start) / 1000,
    time: () => Math.floor(Date.now() / 1000),
  };

  function stringify(a: any) {
    if (a === null || a === undefined) return 'nil';
    if (typeof a === 'boolean') return a ? 'true' : 'false';
    if (typeof a === 'object') {
      if (a.__luaClosure) return 'function';
      try {
        return JSON.stringify(a);
      } catch {
        return 'table';
      }
    }
    return String(a);
  }
}
