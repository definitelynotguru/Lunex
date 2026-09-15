import { describe, it, expect } from 'vitest';
import { encodeShare, decodeShare } from '../src/playground/share';

describe('share codec', () => {
  it('roundtrips ascii, unicode, and multiline', () => {
    for (const code of [
      'print(1)',
      'print("你好")',
      'local x = 1\nprint(x)\n-- café',
    ]) {
      expect(decodeShare(encodeShare(code))).toBe(code);
    }
  });

  it('returns null for invalid payload', () => {
    expect(decodeShare('!!!')).toBeNull();
  });
});
