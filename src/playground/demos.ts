export interface Demo {
  id: string;
  name: string;
  code: string;
}

export const DEMOS: Demo[] = [
  {
    id: 'tour',
    name: 'Tour',
    code: `-- Lunex — Lua 5.2–oriented bytecode VM
local memo = {}
local function fib(n)
  if n <= 1 then return n end
  if memo[n] then return memo[n] end
  memo[n] = fib(n - 1) + fib(n - 2)
  return memo[n]
end

for i = 0, 10 do
  io.write(fib(i) .. " ")
end
print()

local Stack = {}
Stack.__index = Stack
function Stack.new()
  return setmetatable({ items = {}, size = 0 }, Stack)
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
s:push(10); s:push(20); s:push(30)
print("pop", s:pop())

local function makeAdder(n)
  return function(x) return x + n end
end
print("add5(10)", makeAdder(5)(10))

local ok, err = pcall(function() error("intentional") end)
print("pcall", tostring(ok), tostring(err))
print("--- ready ---")
`,
  },
  {
    id: 'fib',
    name: 'Fibonacci',
    code: `local function fib(n)
  if n < 2 then return n end
  return fib(n - 1) + fib(n - 2)
end
for i = 0, 12 do print(i, fib(i)) end
`,
  },
  {
    id: 'stack',
    name: 'Metatable Stack',
    code: `local Stack = {}
Stack.__index = Stack
function Stack.new()
  return setmetatable({ items = {}, size = 0 }, Stack)
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
for i = 1, 5 do s:push(i * 10) end
while s.size > 0 do print(s:pop()) end
`,
  },
  {
    id: 'closures',
    name: 'Closures',
    code: `local function counter()
  local n = 0
  return function()
    n = n + 1
    return n
  end
end
local c = counter()
print(c(), c(), c())
`,
  },
  {
    id: 'errors',
    name: 'Errors / pcall',
    code: `local function risky(x)
  assert(x > 0, "x must be positive")
  return 100 / x
end
print(risky(4))
local ok, err = pcall(risky, 0)
print(ok, err)
`,
  },
  {
    id: 'longstr',
    name: 'Long strings',
    code: `local s = [[
line one
line two
]]
print(s)
print(#s)
`,
  },
];
