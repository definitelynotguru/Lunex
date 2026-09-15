import type { Token, TokenType } from './types';

const KEYWORDS = [
  'and','break','do','else','elseif','end','false','for','function','if','in',
  'local','nil','not','or','repeat','return','then','true','until','while',
] as const;

export class Lexer {
  source: string;
  pos = 0;
  line = 1;
  col = 1;
  tokens: Token[] = [];

  constructor(source: string) {
    this.source = source;
  }

  peek(offset = 0): string {
    return this.source[this.pos + offset] || '\0';
  }

  advance(): string {
    const ch = this.source[this.pos++];
    if (ch === '\n') { this.line++; this.col = 1; } else { this.col++; }
    return ch;
  }

  makeToken(type: TokenType, value: unknown, line?: number): Token {
    return { type, value, line: line || this.line };
  }

  readString(quote: string): Token {
    const startLine = this.line;
    let str = '';
    while (this.pos < this.source.length) {
      const ch = this.advance();
      if (ch === quote) return this.makeToken('string', str, startLine);
      if (ch === '\\') {
        const esc = this.advance();
        switch (esc) {
          case 'n': str += '\n'; break;
          case 't': str += '\t'; break;
          case 'r': str += '\r'; break;
          case '\\': str += '\\'; break;
          case '"': str += '"'; break;
          case "'": str += "'"; break;
          case '0': str += '\0'; break;
          default: str += esc;
        }
      } else if (ch === '\n') {
        throw new Error(`[Line ${startLine}] Unterminated string`);
      } else {
        str += ch;
      }
    }
    throw new Error(`[Line ${startLine}] Unterminated string`);
  }

  readNumber(): Token {
    const startLine = this.line;
    let num = '';
    if (this.peek() === '0' && (this.peek(1) === 'x' || this.peek(1) === 'X')) {
      num += this.advance() + this.advance();
      while (this.pos < this.source.length && /[0-9a-fA-F]/.test(this.peek())) num += this.advance();
      return this.makeToken('number', parseInt(num, 16), startLine);
    }
    while (this.pos < this.source.length && /[0-9]/.test(this.peek())) num += this.advance();
    if (this.peek() === '.' && /[0-9]/.test(this.peek(1))) {
      num += this.advance();
      while (this.pos < this.source.length && /[0-9]/.test(this.peek())) num += this.advance();
    }
    if (this.peek() === 'e' || this.peek() === 'E') {
      num += this.advance();
      if (this.peek() === '+' || this.peek() === '-') num += this.advance();
      while (this.pos < this.source.length && /[0-9]/.test(this.peek())) num += this.advance();
    }
    return this.makeToken('number', parseFloat(num), startLine);
  }

  readIdentifier(): Token {
    const startLine = this.line;
    let id = '';
    while (this.pos < this.source.length && /[a-zA-Z0-9_]/.test(this.peek())) id += this.advance();
    if ((KEYWORDS as readonly string[]).includes(id)) {
      if (id === 'true' || id === 'false') return this.makeToken('boolean', id === 'true', startLine);
      if (id === 'nil') return this.makeToken('nil', null, startLine);
      return this.makeToken('keyword', id, startLine);
    }
    return this.makeToken('identifier', id, startLine);
  }

  readLongString(): Token {
    const startLine = this.line;
    this.advance(); // [
    let level = 0;
    while (this.peek() === '=') { level++; this.advance(); }
    if (this.peek() !== '[') {
      throw new Error(`[Line ${startLine}] Invalid long string delimiter`);
    }
    this.advance(); // [
    if (this.peek() === '\n') this.advance();
    let str = '';
    while (this.pos < this.source.length) {
      if (this.peek() === ']') {
        let i = 0;
        while (i < level && this.peek(1 + i) === '=') i++;
        if (i === level && this.peek(1 + level) === ']') {
          this.advance();
          for (let j = 0; j < level; j++) this.advance();
          this.advance();
          return this.makeToken('string', str, startLine);
        }
      }
      str += this.advance();
    }
    throw new Error(`[Line ${startLine}] Unterminated long string`);
  }

  tokenize(): Token[] {
    while (this.pos < this.source.length) {
      const ch = this.peek();
      const line = this.line;

      if (/\s/.test(ch)) { this.advance(); continue; }

      if (ch === '-' && this.peek(1) === '-') {
        this.advance(); this.advance();
        if (this.peek() === '[') {
          this.readLongString(); // long comment
        } else {
          while (this.pos < this.source.length && this.peek() !== '\n') this.advance();
        }
        continue;
      }

      if (ch === '[' && (this.peek(1) === '[' || this.peek(1) === '=')) {
        this.tokens.push(this.readLongString());
        continue;
      }

      if (ch === '"' || ch === "'") { this.advance(); this.tokens.push(this.readString(ch)); continue; }
      if (/[0-9]/.test(ch)) { this.tokens.push(this.readNumber()); continue; }
      if (/[a-zA-Z_]/.test(ch)) { this.tokens.push(this.readIdentifier()); continue; }

      if (ch === '.' && this.peek(1) === '.' && this.peek(2) === '.') {
        this.advance(); this.advance(); this.advance();
        this.tokens.push(this.makeToken('vararg', '...', line));
        continue;
      }
      if (ch === '.' && this.peek(1) === '.') {
        this.advance(); this.advance();
        this.tokens.push(this.makeToken('operator', '..', line));
        continue;
      }
      if (ch === '=' && this.peek(1) === '=') {
        this.advance(); this.advance();
        this.tokens.push(this.makeToken('operator', '==', line));
        continue;
      }
      if (ch === '~' && this.peek(1) === '=') {
        this.advance(); this.advance();
        this.tokens.push(this.makeToken('operator', '~=', line));
        continue;
      }
      if (ch === '<' && this.peek(1) === '=') {
        this.advance(); this.advance();
        this.tokens.push(this.makeToken('operator', '<=', line));
        continue;
      }
      if (ch === '>' && this.peek(1) === '=') {
        this.advance(); this.advance();
        this.tokens.push(this.makeToken('operator', '>=', line));
        continue;
      }

      const singleOps = '+-*/%^#<>=~';
      const punct = '(){}[],;:.';
      if (singleOps.includes(ch)) {
        this.advance();
        this.tokens.push(this.makeToken('operator', ch, line));
        continue;
      }
      if (punct.includes(ch)) {
        this.advance();
        this.tokens.push(this.makeToken('punctuator', ch, line));
        continue;
      }

      throw new Error(`[Line ${line}] Unexpected character: '${ch}'`);
    }
    this.tokens.push(this.makeToken('eof', null, this.line));
    return this.tokens;
  }
}
