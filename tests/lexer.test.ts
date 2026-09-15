import { describe, it, expect } from 'vitest';
import { Lexer } from '../src/lua/lexer';

describe('lexer', () => {
  it('tokenizes numbers, strings, keywords', () => {
    const tokens = new Lexer('local x = 1.5 + 0x10 -- c\n"hi"').tokenize();
    const types = tokens.map((t) => t.type);
    expect(types).toContain('keyword');
    expect(types).toContain('number');
    expect(types).toContain('string');
    expect(tokens.find((t) => t.type === 'number' && t.value === 16)).toBeTruthy();
  });

  it('supports long strings', () => {
    const tokens = new Lexer('[[hello\nworld]]').tokenize();
    const s = tokens.find((t) => t.type === 'string');
    expect(s?.value).toBe('hello\nworld');
  });

  it('supports long comments', () => {
    const tokens = new Lexer('--[[ comment ]] local a').tokenize();
    expect(tokens.some((t) => t.type === 'keyword' && t.value === 'local')).toBe(true);
  });
});
