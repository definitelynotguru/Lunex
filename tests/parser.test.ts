import { describe, it, expect } from 'vitest';
import { Lexer } from '../src/lua/lexer';
import { Parser } from '../src/lua/parser';

function parse(src: string) {
  return new Parser(new Lexer(src).tokenize()).parse();
}

describe('parser', () => {
  it('parses locals and function', () => {
    const ast: any = parse('local function f(a, b) return a + b end');
    expect(ast.type).toBe('Program');
    expect(ast.body.statements[0].type).toBe('LocalFunctionDeclaration');
  });

  it('parses numeric for', () => {
    const ast: any = parse('for i = 1, 10, 2 do print(i) end');
    expect(ast.body.statements[0].type).toBe('NumericFor');
  });

  it('parses table and metatable-ish call', () => {
    const ast: any = parse('local t = {a = 1, 2}; setmetatable(t, {})');
    expect(ast.body.statements.length).toBeGreaterThan(0);
  });
});
