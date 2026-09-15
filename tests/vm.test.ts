import { describe, it, expect } from 'vitest';
import { createRuntime, run } from '../src/lua';

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
`);
    expect(out.join(' ')).toMatch(/false/);
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
});
