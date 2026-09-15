import { describe, it, expect } from 'vitest';
import { createRuntime, run } from '../src/lua';
import { LuaRuntimeError } from '../src/lua/vm';

describe('Lua register VM', () => {
  it('runs arithmetic and print', async () => {
    const out = await run('print(1 + 2 * 3)');
    expect(out.join('\n')).toContain('7');
  });

  it('supports locals and closures', async () => {
    const out = await run(`
local function makeAdder(n)
  return function(x) return x + n end
end
local add5 = makeAdder(5)
print(add5(10))
`);
    expect(out.some((l) => l.includes('15'))).toBe(true);
  });

  it('supports numeric for', async () => {
    const out = await run(`
local s = 0
for i = 1, 5 do s = s + i end
print(s)
`);
    expect(out.some((l) => l.includes('15'))).toBe(true);
  });

  it('supports metatables __index', async () => {
    const out = await run(`
local Stack = {}
Stack.__index = Stack
function Stack.new()
  return setmetatable({items = {}, size = 0}, Stack)
end
function Stack:push(v)
  self.size = self.size + 1
  self.items[self.size] = v
end
function Stack:pop()
  local v = self.items[self.size]
  self.items[self.size] = nil
  self.size = self.size - 1
  return v
end
local s = Stack.new()
s:push(10)
s:push(20)
print(s:pop())
`);
    expect(out.some((l) => l.includes('20'))).toBe(true);
  });

  it('supports pcall', async () => {
    const out = await run(`
local ok, err = pcall(function() error("boom") end)
print(tostring(ok), tostring(err))
local ok2, err2 = pcall(function()
  return pcall(function() error("inner") end)
end)
print(tostring(ok2))
`);
    const joined = out.join('\n');
    expect(joined).toMatch(/false/);
    expect(joined).toMatch(/boom/);
    expect(out[0]).toMatch(/false/);
    expect(out[0]).toMatch(/boom/);
  });

  it('supports ipairs / tables', async () => {
    const out = await run(`
local t = {3, 1, 4}
table.sort(t)
print(table.concat(t, ","))
`);
    expect(out.some((l) => l.includes('1,3,4'))).toBe(true);
  });

  it('emits bytecode disassembly', async () => {
    const rt = createRuntime();
    const { disasm, proto } = rt.compile('local x = 1 + 2; print(x)');
    expect(proto.code.length).toBeGreaterThan(0);
    expect(disasm).toMatch(/LOADK|ADD|CALL/);
  });

  it('supports long strings', async () => {
    const out = await run('print([[ab]])');
    expect(out.some((l) => l.includes('ab'))).toBe(true);
  });

  it('forwards multret on assign, return, and select', async () => {
    const out = await run(`
local function f() return 1, 2, 3 end
local a, b, c = f()
print(a, b, c)
print(select('#', f()))
local function g() return f() end
local x, y, z = g()
print(x, y, z)
`);
    expect(out[0]).toBe('1\t2\t3');
    expect(out[1]).toBe('3');
    expect(out[2]).toBe('1\t2\t3');
  });

  it('passes all multret tail args into calls', async () => {
    const out = await run(`
local function g() return 10, 20, 30 end
local function f(...)
  print(select('#', ...))
  print(...)
end
f(g())
`);
    expect(out[0]).toBe('3');
    expect(out[1]).toBe('10\t20\t30');
  });

  it('runs generic-for with pairs and break', async () => {
    const out = await run(`
local n = 0
local seen = 0
for k, v in pairs({x = 1, y = 2, z = 3}) do
  n = n + 1
  if n == 2 then break end
  seen = seen + 1
end
print(n, seen)
local total = 0
for k, v in pairs({a = 1, b = 2, c = 3}) do
  total = total + 1
end
print(total)
`);
    expect(out[0]).toBe('2\t1');
    expect(out[1]).toBe('3');
  });

  it('forwards varargs to select and nested calls', async () => {
    const out = await run(`
local function s(...)
  return select('#', ...)
end
print(s(1, 2, 3))
local function f(...)
  return select('#', ...)
end
local function g(...)
  return f(...)
end
print(g(1, 2, 3, 4))
`);
    expect(out[0]).toBe('3');
    expect(out[1]).toBe('4');
  });

  it('raises LuaRuntimeError on invalid gsub pattern', async () => {
    await expect(run(`string.gsub('abc', '(', 'x')`)).rejects.toBeInstanceOf(LuaRuntimeError);
  });

  it('validates string.rep count', async () => {
    const ok = await run(`print(string.rep('ab', 3))`);
    expect(ok.some((l) => l.includes('ababab'))).toBe(true);
    await expect(run(`string.rep('x', -1)`)).rejects.toBeInstanceOf(LuaRuntimeError);
    await expect(run(`string.rep('x', 1.5)`)).rejects.toBeInstanceOf(LuaRuntimeError);
  });

  it('invokes function __index metamethod', async () => {
    const out = await run(`
local t = setmetatable({}, {
  __index = function(tbl, key)
    return 42
  end
})
print(t.missing)
`);
    expect(out.some((l) => l.includes('42'))).toBe(true);
  });

  it('tees custom sink into RunResult.outputs', async () => {
    const seen: string[] = [];
    const rt = createRuntime({
      sink: {
        print: (t) => seen.push(t),
        write: () => {},
      },
    });
    const result = await rt.run('print(9)');
    expect(seen.some((l) => l.includes('9'))).toBe(true);
    expect(result.outputs.some((l) => l.includes('9'))).toBe(true);
  });
});
