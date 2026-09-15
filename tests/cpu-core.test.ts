import { describe, it, expect } from 'vitest';
import { CPU } from '../src/vm/cpu-core.js';

describe('CPU loadProgram', () => {
  it('rejects programs longer than 256 bytes', () => {
    const cpu = new CPU();
    const bytes = new Array(257).fill(0);
    expect(() => cpu.loadProgram(bytes, [])).toThrow(/256/);
  });

  it('loads programs up to 256 bytes', () => {
    const cpu = new CPU();
    const bytes = new Array(256).fill(0);
    expect(() => cpu.loadProgram(bytes, [])).not.toThrow();
  });
});
