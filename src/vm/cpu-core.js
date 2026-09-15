// @ts-nocheck
class Assembler {
  constructor() {
    // Instruction table: mnemonic → { opcode, operandType, size }
    this.instructions = {
      'NOP':  { opcode: 0x00, operandType: 'none',    size: 1 },
      'HLT':  { opcode: 0x01, operandType: 'none',    size: 1 },
      'MOV':  { opcode: 0x02, operandType: 'reg_reg', size: 2 },
      'LDI':  { opcode: 0x03, operandType: 'reg_imm', size: 3 },
      'LDA':  { opcode: 0x04, operandType: 'reg_mem', size: 3 },
      'STA':  { opcode: 0x05, operandType: 'mem_reg', size: 3 },
      'LDR':  { opcode: 0x06, operandType: 'reg_ind', size: 2 },
      'STR':  { opcode: 0x07, operandType: 'ind_reg', size: 2 },
      'PUSH': { opcode: 0x08, operandType: 'reg',     size: 2 },
      'POP':  { opcode: 0x09, operandType: 'reg',     size: 2 },
      'ADD':  { opcode: 0x10, operandType: 'reg_reg', size: 2 },
      'SUB':  { opcode: 0x11, operandType: 'reg_reg', size: 2 },
      'INC':  { opcode: 0x12, operandType: 'reg',     size: 2 },
      'DEC':  { opcode: 0x13, operandType: 'reg',     size: 2 },
      'MUL':  { opcode: 0x14, operandType: 'reg_reg', size: 2 },
      'DIV':  { opcode: 0x15, operandType: 'reg_reg', size: 2 },
      'MOD':  { opcode: 0x16, operandType: 'reg_reg', size: 2 },
      'CMP':  { opcode: 0x17, operandType: 'reg_reg', size: 2 },
      'AND':  { opcode: 0x20, operandType: 'reg_reg', size: 2 },
      'OR':   { opcode: 0x21, operandType: 'reg_reg', size: 2 },
      'XOR':  { opcode: 0x22, operandType: 'reg_reg', size: 2 },
      'NOT':  { opcode: 0x23, operandType: 'reg',     size: 2 },
      'SHL':  { opcode: 0x24, operandType: 'reg_imm', size: 3 },
      'SHR':  { opcode: 0x25, operandType: 'reg_imm', size: 3 },
      'JMP':  { opcode: 0x30, operandType: 'addr',    size: 2 },
      'JZ':   { opcode: 0x31, operandType: 'addr',    size: 2 },
      'JNZ':  { opcode: 0x32, operandType: 'addr',    size: 2 },
      'JC':   { opcode: 0x33, operandType: 'addr',    size: 2 },
      'JNC':  { opcode: 0x34, operandType: 'addr',    size: 2 },
      'JN':   { opcode: 0x35, operandType: 'addr',    size: 2 },
      'CALL': { opcode: 0x36, operandType: 'addr',    size: 2 },
      'RET':  { opcode: 0x37, operandType: 'none',    size: 1 },
      'INT':  { opcode: 0x40, operandType: 'imm',     size: 2 },
      'OUT':  { opcode: 0x41, operandType: 'reg',     size: 2 }
    };
    // Register name → encoding (case-insensitive matching via uppercase keys)
    this.regMap = { A: 0, B: 1, C: 2, D: 3, SP: 4, PC: 5 };
    this.regPattern = /^(A|B|C|D|SP|PC)$/i;
  }

  /**
   * Parse an immediate value: decimal, hex (0x…), binary (0b…).
   * Also resolves labels during pass 2.
   */
  parseImmediate(value, pass, maxValue) {
    const max = maxValue !== undefined ? maxValue : 0xFF;
    const maxLabel = max === 0xFF ? '0-255' : '0-65535';
    if (this.regPattern.test(value)) {
      return { error: 'Expected immediate value, got register: ' + value };
    }
    if (/^0x[0-9a-fA-F]+$/.test(value)) {
      const num = parseInt(value.slice(2), 16);
      if (num < 0 || num > max) return { error: 'Value out of range (' + maxLabel + '): ' + value };
      return num;
    }
    if (/^0b[01]+$/.test(value)) {
      const num = parseInt(value.slice(2), 2);
      if (num < 0 || num > max) return { error: 'Value out of range (' + maxLabel + '): ' + value };
      return num;
    }
    if (/^-?\d+$/.test(value)) {
      const num = parseInt(value, 10);
      if (num < 0 || num > max) return { error: 'Value out of range (' + maxLabel + '): ' + value };
      return num;
    }
    // Check labels (pass 2 only, after all labels collected)
    if (pass === 2 && this.labels[value] !== undefined) {
      return this.labels[value];
    }
    // If it looks like a label name (not a number), give a specific error
    if (/^[A-Za-z_]\w*$/.test(value)) {
      return { error: 'Undefined label: ' + value };
    }
    return { error: 'Invalid value: ' + value };
  }

  /**
   * Parse a register operand, returning its encoding.
   */
  parseRegister(regStr) {
    const upper = regStr.toUpperCase();
    if (this.regMap[upper] !== undefined) return this.regMap[upper];
    return null;
  }

  /**
   * Split a comma-separated operand string, respecting quoted strings.
   */
  splitOperands(opsStr) {
    const parts = [];
    let current = '';
    let inQuote = false;
    for (let i = 0; i < opsStr.length; i++) {
      const ch = opsStr[i];
      if (ch === '"') {
        inQuote = !inQuote;
        current += ch;
      } else if (ch === ',' && !inQuote) {
        parts.push(current.trim());
        current = '';
      } else {
        current += ch;
      }
    }
    if (current.trim()) parts.push(current.trim());
    return parts;
  }

  /**
   * Assemble source code into machine code bytes.
   * Returns { bytes, errors, labels, lineMap }.
   */
  assemble(source) {
    this.labels = {};
    const errors = [];
    const lines = source.split('\n');
    const lineMap = [];  // address → source line number (0-indexed)

    // ── PASS 1: Collect labels, calculate instruction sizes ──
    let addr = 0;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].replace(/;.*$/, '').trim();
      if (!line) continue;

      // Strip label prefix
      let rest = line;
      const labelMatch = line.match(/^([A-Za-z_]\w*)\s*:\s*(.*)?$/);
      if (labelMatch) {
        const name = labelMatch[1];
        if (this.labels[name] !== undefined) {
          errors.push({ line: i + 1, message: 'Duplicate label: ' + name });
        }
        this.labels[name] = addr;
        rest = (labelMatch[2] || '').trim();
        if (!rest) continue;
      }

      // Directive
      const dirMatch = rest.match(/^(DB|DW|DS)\s+(.*)$/i);
      if (dirMatch) {
        const directive = dirMatch[1].toUpperCase();
        const operands = this.splitOperands(dirMatch[2]);
        if (directive === 'DB') {
          for (const op of operands) {
            if (op.startsWith('"') && op.endsWith('"')) {
              addr += op.length - 2;
            } else {
              addr += 1;
            }
          }
        } else if (directive === 'DW') {
          addr += operands.length * 2;
        } else if (directive === 'DS') {
          for (const op of operands) {
            if (op.startsWith('"') && op.endsWith('"')) {
              addr += op.length - 2; // string chars only, null terminator is explicit
            } else {
              addr += 1;
            }
          }
        }
        continue;
      }

      // Instruction
      const parts = rest.split(/\s+/);
      const mnemonic = parts[0].toUpperCase();
      if (!this.instructions[mnemonic]) {
        errors.push({ line: i + 1, message: 'Unknown mnemonic: ' + parts[0] });
        continue;
      }
      addr += this.instructions[mnemonic].size;
    }

    if (errors.length > 0) return { bytes: null, errors, labels: this.labels, lineMap };

    // ── PASS 2: Emit machine code ──
    const bytes = [];
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].replace(/;.*$/, '').trim();
      if (!line) continue;

      // Strip label prefix
      let rest = line;
      const labelMatch = line.match(/^([A-Za-z_]\w*)\s*:\s*(.*)?$/);
      if (labelMatch) {
        rest = (labelMatch[2] || '').trim();
        if (!rest) continue;
      }

      // Directive
      const dirMatch = rest.match(/^(DB|DW|DS)\s+(.*)$/i);
      if (dirMatch) {
        const directive = dirMatch[1].toUpperCase();
        const operands = this.splitOperands(dirMatch[2]);
        if (directive === 'DB') {
          for (const op of operands) {
            if (op.startsWith('"') && op.endsWith('"')) {
              const str = op.slice(1, -1);
              for (let j = 0; j < str.length; j++) {
                bytes.push(str.charCodeAt(j));
                lineMap[bytes.length - 1] = i;
              }
            } else {
              const val = this.parseImmediate(op, 2);
              if (val && typeof val === 'object' && val.error) {
                errors.push({ line: i + 1, message: val.error });
                break;
              }
              bytes.push(val);
              lineMap[bytes.length - 1] = i;
            }
          }
        } else if (directive === 'DW') {
          for (const op of operands) {
            const val = this.parseImmediate(op, 2, 0xFFFF);
            if (val && typeof val === 'object' && val.error) {
              errors.push({ line: i + 1, message: val.error });
              break;
            }
            bytes.push(val & 0xFF);       // Low byte (little-endian)
            lineMap[bytes.length - 1] = i;
            bytes.push((val >> 8) & 0xFF); // High byte
            lineMap[bytes.length - 1] = i;
          }
        } else if (directive === 'DS') {
          for (const op of operands) {
            if (op.startsWith('"') && op.endsWith('"')) {
              const str = op.slice(1, -1);
              for (let j = 0; j < str.length; j++) {
                bytes.push(str.charCodeAt(j));
                lineMap[bytes.length - 1] = i;
              }
              // No automatic null terminator — user must specify 0 explicitly
            } else {
              const val = this.parseImmediate(op, 2);
              if (val && typeof val === 'object' && val.error) {
                errors.push({ line: i + 1, message: val.error });
                break;
              }
              bytes.push(val);
              lineMap[bytes.length - 1] = i;
            }
          }
        }
        continue;
      }

      // Instruction
      const result = this._emitInstruction(rest, i, bytes.length, bytes, lineMap, errors, 2);
      if (result) { errors.push(result); break; }
    }

    return { bytes, errors, labels: this.labels, lineMap };
  }

  /**
   * Emit bytes for a single instruction (pass 2).
   * Returns an error object if there's an error, or null on success.
   */
  _emitInstruction(line, lineIdx, addr, bytes, lineMap, errors, pass) {
    const parts = line.split(/\s+/);
    const mnemonic = parts[0].toUpperCase();
    const info = this.instructions[mnemonic];
    if (!info) {
      return { line: lineIdx + 1, message: 'Unknown mnemonic: ' + parts[0] };
    }

    const operandStr = parts.slice(1).join(' ').trim();
    const operands = operandStr ? this.splitOperands(operandStr) : [];

    switch (info.operandType) {
      case 'none': {
        if (operands.length > 0) {
          return { line: lineIdx + 1, message: 'Unexpected operands for ' + mnemonic };
        }
        bytes.push(info.opcode);
        lineMap[bytes.length - 1] = lineIdx;
        break;
      }
      case 'reg': {
        if (operands.length !== 1) {
          return { line: lineIdx + 1, message: mnemonic + ' expects 1 operand' };
        }
        const rd = this.parseRegister(operands[0]);
        if (rd === null) {
          return { line: lineIdx + 1, message: 'Invalid register: ' + operands[0] };
        }
        bytes.push(info.opcode, rd);
        lineMap[bytes.length - 2] = lineIdx;
        lineMap[bytes.length - 1] = lineIdx;
        break;
      }
      case 'reg_reg': {
        if (operands.length !== 2) {
          return { line: lineIdx + 1, message: mnemonic + ' expects 2 operands' };
        }
        const rd = this.parseRegister(operands[0].replace(/[\[\]]/g, ''));
        if (rd === null) {
          return { line: lineIdx + 1, message: 'Invalid register: ' + operands[0] };
        }
        const rs = this.parseRegister(operands[1].replace(/[\[\]]/g, ''));
        if (rs === null) {
          return { line: lineIdx + 1, message: 'Invalid register: ' + operands[1] };
        }
        bytes.push(info.opcode, (rd << 4) | rs);
        lineMap[bytes.length - 2] = lineIdx;
        lineMap[bytes.length - 1] = lineIdx;
        break;
      }
      case 'reg_imm': {
        if (operands.length !== 2) {
          return { line: lineIdx + 1, message: mnemonic + ' expects 2 operands' };
        }
        const rd = this.parseRegister(operands[0]);
        if (rd === null) {
          return { line: lineIdx + 1, message: 'Invalid register: ' + operands[0] };
        }
        const imm = this.parseImmediate(operands[1], pass);
        if (imm && typeof imm === 'object' && imm.error) {
          return { line: lineIdx + 1, message: imm.error };
        }
        bytes.push(info.opcode, rd, imm);
        lineMap[bytes.length - 3] = lineIdx;
        lineMap[bytes.length - 2] = lineIdx;
        lineMap[bytes.length - 1] = lineIdx;
        break;
      }
      case 'reg_mem':
      case 'mem_reg': {
        if (operands.length !== 2) {
          return { line: lineIdx + 1, message: mnemonic + ' expects 2 operands' };
        }
        const regIdx = info.operandType === 'reg_mem' ? 0 : 1;
        const addrIdx = info.operandType === 'reg_mem' ? 1 : 0;
        const rd = this.parseRegister(operands[regIdx].replace(/[\[\]]/g, ''));
        if (rd === null) {
          return { line: lineIdx + 1, message: 'Invalid register: ' + operands[regIdx] };
        }
        const memAddr = this.parseImmediate(operands[addrIdx].replace(/[\[\]]/g, ''), pass);
        if (memAddr && typeof memAddr === 'object' && memAddr.error) {
          return { line: lineIdx + 1, message: memAddr.error };
        }
        if (info.operandType === 'reg_mem') {
          bytes.push(info.opcode, rd, memAddr);
        } else {
          bytes.push(info.opcode, memAddr, rd);
        }
        lineMap[bytes.length - 3] = lineIdx;
        lineMap[bytes.length - 2] = lineIdx;
        lineMap[bytes.length - 1] = lineIdx;
        break;
      }
      case 'reg_ind':
      case 'ind_reg': {
        if (operands.length !== 2) {
          return { line: lineIdx + 1, message: mnemonic + ' expects 2 operands' };
        }
        const firstOp = operands[0].replace(/[\[\]]/g, '');
        const secondOp = operands[1].replace(/[\[\]]/g, '');
        const reg1 = this.parseRegister(firstOp);
        const reg2 = this.parseRegister(secondOp);
        if (reg1 === null) {
          return { line: lineIdx + 1, message: 'Invalid register: ' + firstOp };
        }
        if (reg2 === null) {
          return { line: lineIdx + 1, message: 'Invalid register: ' + secondOp };
        }
        if (info.operandType === 'reg_ind') {
          bytes.push(info.opcode, (reg1 << 4) | reg2);
        } else {
          bytes.push(info.opcode, (reg1 << 4) | reg2);
        }
        lineMap[bytes.length - 2] = lineIdx;
        lineMap[bytes.length - 1] = lineIdx;
        break;
      }
      case 'imm': {
        if (operands.length !== 1) {
          return { line: lineIdx + 1, message: mnemonic + ' expects 1 operand' };
        }
        const val = this.parseImmediate(operands[0], pass);
        if (val && typeof val === 'object' && val.error) {
          return { line: lineIdx + 1, message: val.error };
        }
        bytes.push(info.opcode, val);
        lineMap[bytes.length - 2] = lineIdx;
        lineMap[bytes.length - 1] = lineIdx;
        break;
      }
      case 'addr': {
        if (operands.length !== 1) {
          return { line: lineIdx + 1, message: mnemonic + ' expects 1 operand' };
        }
        const target = this.parseImmediate(operands[0], pass);
        if (target && typeof target === 'object' && target.error) {
          return { line: lineIdx + 1, message: target.error };
        }
        bytes.push(info.opcode, target);
        lineMap[bytes.length - 2] = lineIdx;
        lineMap[bytes.length - 1] = lineIdx;
        break;
      }
    }
    return null;
  }
}

/* ═══════════════════════════════════════════════════════════════
   CPU — 8-bit virtual CPU engine
   ═══════════════════════════════════════════════════════════════ */
class CPU {
  constructor() {
    // Register encoding indices
    this.REG_A  = 0;
    this.REG_B  = 1;
    this.REG_C  = 2;
    this.REG_D  = 3;
    this.REG_SP = 4;
    this.REG_PC = 5;

    // Flag bit positions within the F register
    this.FLAG_Z = 0; // Zero
    this.FLAG_C = 1; // Carry
    this.FLAG_N = 2; // Negative
    this.FLAG_V = 3; // Overflow

    this.reset();
  }

  /** Reset all CPU state to initial values. */
  reset() {
    this.registers = new Uint8Array(6);  // A, B, C, D, SP, PC
    this.registers[this.REG_SP] = 0xFF;  // Stack pointer starts at top
    this.memory = new Uint8Array(256);
    this.flags = 0;    // All flags cleared
    this.state = 'ready';  // 'ready' | 'running' | 'halted' | 'error'
    this.error = null;      // Error message string
    this.ticks = 0;
    this.output = [];       // Output buffer for INT/OUT results
    this.recentWrites = {}; // address → true (for UI highlight)
    this.lineMap = [];      // address → source line index
    this.breakpoints = new Set(); // breakpoint addresses
  }

  // ── Register access ──

  readRegister(index) { return this.registers[index]; }

  writeRegister(index, value) {
    this.registers[index] = value & 0xFF;
  }

  // ── Flag access ──

  getFlag(bit)    { return (this.flags >> bit) & 1; }
  setFlag(bit, v) {
    if (v) this.flags |= (1 << bit);
    else   this.flags &= ~(1 << bit);
  }

  // ── Memory access ──

  readMemory(address) { return this.memory[address & 0xFF]; }

  writeMemory(address, value) {
    const addr = address & 0xFF;
    this.memory[addr] = value & 0xFF;
    this.recentWrites[addr] = true;
  }

  // ── Flag computation helpers ──

  /** Set Zero and Negative flags from a result byte. */
  setZN(result) {
    const r = result & 0xFF;
    this.setFlag(this.FLAG_Z, r === 0 ? 1 : 0);
    this.setFlag(this.FLAG_N, (r >> 7) & 1);
  }

  /** Set flags for an addition: Z, C, N. */
  setAddFlags(a, b) {
    const result = a + b;
    const r = result & 0xFF;
    this.setFlag(this.FLAG_Z, r === 0 ? 1 : 0);
    this.setFlag(this.FLAG_C, result > 0xFF ? 1 : 0);
    this.setFlag(this.FLAG_N, (r >> 7) & 1);
    // Signed overflow: both positive→negative or both negative→positive
    const sv = ((~(a ^ b)) & (a ^ r)) >> 7;
    this.setFlag(this.FLAG_V, sv & 1);
  }

  /** Set flags for a subtraction: Z, C (borrow), N. */
  setSubFlags(a, b) {
    const result = a - b;
    const r = result & 0xFF;
    this.setFlag(this.FLAG_Z, r === 0 ? 1 : 0);
    this.setFlag(this.FLAG_C, a < b ? 1 : 0);  // borrow
    this.setFlag(this.FLAG_N, (r >> 7) & 1);
  }

  /** Set flags for logic operations: Z, N only. */
  setLogicFlags(result) {
    const r = result & 0xFF;
    this.setFlag(this.FLAG_Z, r === 0 ? 1 : 0);
    this.setFlag(this.FLAG_N, (r >> 7) & 1);
  }

  /** Set flags for shift operations: Z, C, N. */
  setShiftLeftFlags(original, result, amount) {
    const r = result & 0xFF;
    this.setFlag(this.FLAG_Z, r === 0 ? 1 : 0);
    this.setFlag(this.FLAG_N, (r >> 7) & 1);
    // Carry = last bit shifted out (bit 7 for shift of 1)
    const carryBit = amount >= 8 ? (original > 0 ? 1 : 0) : ((original >> (8 - amount)) & 1);
    this.setFlag(this.FLAG_C, carryBit);
  }

  setShiftRightFlags(original, result, amount) {
    const r = result & 0xFF;
    this.setFlag(this.FLAG_Z, r === 0 ? 1 : 0);
    this.setFlag(this.FLAG_N, 0);  // Right shift can't set negative
    // Carry = last bit shifted out (LSB for shift of 1)
    const carryBit = amount >= 8 ? (original > 0 ? 1 : 0) : ((original >> (amount - 1)) & 1);
    this.setFlag(this.FLAG_C, carryBit);
  }

  // ── Stack operations ──

  pushStack(value) {
    const sp = this.readRegister(this.REG_SP);
    this.writeRegister(this.REG_SP, sp - 1);
    this.writeMemory(this.readRegister(this.REG_SP), value);
    // Stack overflow: SP has decremented to 0x00 (all 256 bytes used) or wrapped
    if (this.readRegister(this.REG_SP) === 0x00) {
      this.state = 'error';
      this.error = 'Stack overflow';
      this.output.push('ERROR: Stack overflow at tick ' + this.ticks);
    }
  }

  popStack() {
    const sp = this.readRegister(this.REG_SP);
    if (sp === 0xFF) {
      this.state = 'error';
      this.error = 'Stack underflow';
      this.output.push('ERROR: Stack underflow at tick ' + this.ticks);
      return 0;
    }
    const value = this.readMemory(sp);
    this.writeRegister(this.REG_SP, sp + 1);
    return value;
  }

  /** Helper to decode register pair from operand byte (high=Rd, low=Rs). */
  decodeRegPair(operand) {
    return { rd: (operand >> 4) & 0x0F, rs: operand & 0x0F };
  }

  // ── Execute one instruction ──

  step() {
    if (this.state === 'halted' || this.state === 'error') return;

    this.ticks++;
    const pc = this.readRegister(this.REG_PC);
    const opcode = this.readMemory(pc);
    const line = this.lineMap[pc] !== undefined ? this.lineMap[pc] : -1;

    // Advance PC (wrap at 0xFF → 0x00)
    this.writeRegister(this.REG_PC, (pc + 1) & 0xFF);

    switch (opcode) {
      // ── Data Movement ──
      case 0x00: // NOP
        break;

      case 0x01: // HLT
        this.state = 'halted';
        break;

      case 0x02: { // MOV Rd, Rs
        const operand = this.readMemory((pc + 1) & 0xFF);
        this.writeRegister(this.REG_PC, (this.readRegister(this.REG_PC) + 1) & 0xFF);
        const { rd, rs } = this.decodeRegPair(operand);
        this.writeRegister(rd, this.readRegister(rs));
        break;
      }

      case 0x03: { // LDI Rd, imm8
        const rd = this.readMemory((pc + 1) & 0xFF);
        const imm = this.readMemory((pc + 2) & 0xFF);
        this.writeRegister(this.REG_PC, (this.readRegister(this.REG_PC) + 2) & 0xFF);
        this.writeRegister(rd, imm);
        break;
      }

      case 0x04: { // LDA Rd, [addr]
        const rd = this.readMemory((pc + 1) & 0xFF);
        const addr = this.readMemory((pc + 2) & 0xFF);
        this.writeRegister(this.REG_PC, (this.readRegister(this.REG_PC) + 2) & 0xFF);
        this.writeRegister(rd, this.readMemory(addr));
        break;
      }

      case 0x05: { // STA [addr], Rs
        const addr = this.readMemory((pc + 1) & 0xFF);
        const rs = this.readMemory((pc + 2) & 0xFF);
        this.writeRegister(this.REG_PC, (this.readRegister(this.REG_PC) + 2) & 0xFF);
        this.writeMemory(addr, this.readRegister(rs));
        break;
      }

      case 0x06: { // LDR Rd, [Rs]
        const operand = this.readMemory((pc + 1) & 0xFF);
        this.writeRegister(this.REG_PC, (this.readRegister(this.REG_PC) + 1) & 0xFF);
        const { rd, rs } = this.decodeRegPair(operand);
        this.writeRegister(rd, this.readMemory(this.readRegister(rs)));
        break;
      }

      case 0x07: { // STR [Rd], Rs
        const operand = this.readMemory((pc + 1) & 0xFF);
        this.writeRegister(this.REG_PC, (this.readRegister(this.REG_PC) + 1) & 0xFF);
        const { rd, rs } = this.decodeRegPair(operand);
        this.writeMemory(this.readRegister(rd), this.readRegister(rs));
        break;
      }

      case 0x08: { // PUSH Rs
        const rs = this.readMemory((pc + 1) & 0xFF);
        this.writeRegister(this.REG_PC, (this.readRegister(this.REG_PC) + 1) & 0xFF);
        this.pushStack(this.readRegister(rs));
        break;
      }

      case 0x09: { // POP Rd
        const rd = this.readMemory((pc + 1) & 0xFF);
        this.writeRegister(this.REG_PC, (this.readRegister(this.REG_PC) + 1) & 0xFF);
        this.writeRegister(rd, this.popStack());
        break;
      }

      // ── Arithmetic ──
      case 0x10: { // ADD Rd, Rs
        const operand = this.readMemory((pc + 1) & 0xFF);
        this.writeRegister(this.REG_PC, (this.readRegister(this.REG_PC) + 1) & 0xFF);
        const { rd, rs } = this.decodeRegPair(operand);
        const a = this.readRegister(rd);
        const b = this.readRegister(rs);
        this.writeRegister(rd, a + b);
        this.setAddFlags(a, b);
        break;
      }

      case 0x11: { // SUB Rd, Rs
        const operand = this.readMemory((pc + 1) & 0xFF);
        this.writeRegister(this.REG_PC, (this.readRegister(this.REG_PC) + 1) & 0xFF);
        const { rd, rs } = this.decodeRegPair(operand);
        const a = this.readRegister(rd);
        const b = this.readRegister(rs);
        this.writeRegister(rd, a - b);
        this.setSubFlags(a, b);
        break;
      }

      case 0x12: { // INC Rd
        const rd = this.readMemory((pc + 1) & 0xFF);
        this.writeRegister(this.REG_PC, (this.readRegister(this.REG_PC) + 1) & 0xFF);
        const val = this.readRegister(rd);
        this.writeRegister(rd, val + 1);
        this.setZN(val + 1);
        break;
      }

      case 0x13: { // DEC Rd
        const rd = this.readMemory((pc + 1) & 0xFF);
        this.writeRegister(this.REG_PC, (this.readRegister(this.REG_PC) + 1) & 0xFF);
        const val = this.readRegister(rd);
        this.writeRegister(rd, val - 1);
        this.setZN(val - 1);
        break;
      }

      case 0x14: { // MUL Rd, Rs
        const operand = this.readMemory((pc + 1) & 0xFF);
        this.writeRegister(this.REG_PC, (this.readRegister(this.REG_PC) + 1) & 0xFF);
        const { rd, rs } = this.decodeRegPair(operand);
        const a = this.readRegister(rd);
        const b = this.readRegister(rs);
        const result = a * b;
        this.writeRegister(rd, result & 0xFF);
        this.setZN(result & 0xFF);
        this.setFlag(this.FLAG_C, result > 0xFF ? 1 : 0);
        break;
      }

      case 0x15: { // DIV Rd, Rs
        const operand = this.readMemory((pc + 1) & 0xFF);
        this.writeRegister(this.REG_PC, (this.readRegister(this.REG_PC) + 1) & 0xFF);
        const { rd, rs } = this.decodeRegPair(operand);
        const b = this.readRegister(rs);
        if (b === 0) {
          this.state = 'error';
          this.error = 'Division by zero';
          this.output.push('ERROR: Division by zero at tick ' + this.ticks);
          break;
        }
        const a = this.readRegister(rd);
        const result = Math.floor(a / b);
        this.writeRegister(rd, result & 0xFF);
        this.setZN(result & 0xFF);
        break;
      }

      case 0x16: { // MOD Rd, Rs
        const operand = this.readMemory((pc + 1) & 0xFF);
        this.writeRegister(this.REG_PC, (this.readRegister(this.REG_PC) + 1) & 0xFF);
        const { rd, rs } = this.decodeRegPair(operand);
        const b = this.readRegister(rs);
        if (b === 0) {
          this.state = 'error';
          this.error = 'Division by zero (MOD)';
          this.output.push('ERROR: Division by zero (MOD) at tick ' + this.ticks);
          break;
        }
        const a = this.readRegister(rd);
        const result = a % b;
        this.writeRegister(rd, result & 0xFF);
        this.setZN(result & 0xFF);
        break;
      }

      case 0x17: { // CMP Rd, Rs
        const operand = this.readMemory((pc + 1) & 0xFF);
        this.writeRegister(this.REG_PC, (this.readRegister(this.REG_PC) + 1) & 0xFF);
        const { rd, rs } = this.decodeRegPair(operand);
        const a = this.readRegister(rd);
        const b = this.readRegister(rs);
        this.setSubFlags(a, b);  // Sets flags only, doesn't modify registers
        break;
      }

      // ── Logic & Shift ──
      case 0x20: { // AND Rd, Rs
        const operand = this.readMemory((pc + 1) & 0xFF);
        this.writeRegister(this.REG_PC, (this.readRegister(this.REG_PC) + 1) & 0xFF);
        const { rd, rs } = this.decodeRegPair(operand);
        const result = this.readRegister(rd) & this.readRegister(rs);
        this.writeRegister(rd, result);
        this.setLogicFlags(result);
        break;
      }

      case 0x21: { // OR Rd, Rs
        const operand = this.readMemory((pc + 1) & 0xFF);
        this.writeRegister(this.REG_PC, (this.readRegister(this.REG_PC) + 1) & 0xFF);
        const { rd, rs } = this.decodeRegPair(operand);
        const result = this.readRegister(rd) | this.readRegister(rs);
        this.writeRegister(rd, result);
        this.setLogicFlags(result);
        break;
      }

      case 0x22: { // XOR Rd, Rs
        const operand = this.readMemory((pc + 1) & 0xFF);
        this.writeRegister(this.REG_PC, (this.readRegister(this.REG_PC) + 1) & 0xFF);
        const { rd, rs } = this.decodeRegPair(operand);
        const result = this.readRegister(rd) ^ this.readRegister(rs);
        this.writeRegister(rd, result);
        this.setLogicFlags(result);
        break;
      }

      case 0x23: { // NOT Rd
        const rd = this.readMemory((pc + 1) & 0xFF);
        this.writeRegister(this.REG_PC, (this.readRegister(this.REG_PC) + 1) & 0xFF);
        const result = (~this.readRegister(rd)) & 0xFF;
        this.writeRegister(rd, result);
        this.setLogicFlags(result);
        break;
      }

      case 0x24: { // SHL Rd, n
        const rd = this.readMemory((pc + 1) & 0xFF);
        const n = this.readMemory((pc + 2) & 0xFF);
        this.writeRegister(this.REG_PC, (this.readRegister(this.REG_PC) + 2) & 0xFF);
        const original = this.readRegister(rd);
        const result = (original << n) & 0xFF;
        this.writeRegister(rd, result);
        this.setShiftLeftFlags(original, result, n);
        break;
      }

      case 0x25: { // SHR Rd, n
        const rd = this.readMemory((pc + 1) & 0xFF);
        const n = this.readMemory((pc + 2) & 0xFF);
        this.writeRegister(this.REG_PC, (this.readRegister(this.REG_PC) + 2) & 0xFF);
        const original = this.readRegister(rd);
        const result = (original >> n) & 0xFF;
        this.writeRegister(rd, result);
        this.setShiftRightFlags(original, result, n);
        break;
      }

      // ── Branch & Control ──
      case 0x30: { // JMP addr
        const addr = this.readMemory((pc + 1) & 0xFF);
        this.writeRegister(this.REG_PC, addr & 0xFF);
        break;
      }

      case 0x31: { // JZ addr
        const addr = this.readMemory((pc + 1) & 0xFF);
        if (this.getFlag(this.FLAG_Z)) {
          this.writeRegister(this.REG_PC, addr & 0xFF);
        } else {
          this.writeRegister(this.REG_PC, (pc + 2) & 0xFF);
        }
        break;
      }

      case 0x32: { // JNZ addr
        const addr = this.readMemory((pc + 1) & 0xFF);
        if (!this.getFlag(this.FLAG_Z)) {
          this.writeRegister(this.REG_PC, addr & 0xFF);
        } else {
          this.writeRegister(this.REG_PC, (pc + 2) & 0xFF);
        }
        break;
      }

      case 0x33: { // JC addr
        const addr = this.readMemory((pc + 1) & 0xFF);
        if (this.getFlag(this.FLAG_C)) {
          this.writeRegister(this.REG_PC, addr & 0xFF);
        } else {
          this.writeRegister(this.REG_PC, (pc + 2) & 0xFF);
        }
        break;
      }

      case 0x34: { // JNC addr
        const addr = this.readMemory((pc + 1) & 0xFF);
        if (!this.getFlag(this.FLAG_C)) {
          this.writeRegister(this.REG_PC, addr & 0xFF);
        } else {
          this.writeRegister(this.REG_PC, (pc + 2) & 0xFF);
        }
        break;
      }

      case 0x35: { // JN addr
        const addr = this.readMemory((pc + 1) & 0xFF);
        if (this.getFlag(this.FLAG_N)) {
          this.writeRegister(this.REG_PC, addr & 0xFF);
        } else {
          this.writeRegister(this.REG_PC, (pc + 2) & 0xFF);
        }
        break;
      }

      case 0x36: { // CALL addr — push return address (PC+2 = address after CALL instruction)
        const addr = this.readMemory((pc + 1) & 0xFF);
        const returnAddr = (pc + 2) & 0xFF; // Return to instruction after CALL (pc = CALL addr, +2 for 2-byte instruction)
        // Decrement SP then write (PUSH semantics)
        this.writeRegister(this.REG_SP, (this.readRegister(this.REG_SP) - 1) & 0xFF);
        this.writeMemory(this.readRegister(this.REG_SP), returnAddr);
        // Check overflow (SP at 0x00 means stack full)
        if (this.readRegister(this.REG_SP) === 0x00) {
          this.state = 'error';
          this.error = 'Stack overflow';
        }
        this.writeRegister(this.REG_PC, addr & 0xFF);
        break;
      }

      case 0x37: { // RET — pop return address and jump
        const sp = this.readRegister(this.REG_SP);
        if (sp === 0xFF) {
          this.state = 'error';
          this.error = 'Stack underflow';
          break;
        }
        const returnAddr = this.readMemory(sp);
        this.writeRegister(this.REG_SP, (sp + 1) & 0xFF);
        this.writeRegister(this.REG_PC, returnAddr & 0xFF);
        break;
      }

      // ── System & I/O ──
      case 0x40: { // INT imm8
        const intType = this.readMemory((pc + 1) & 0xFF);
        this.writeRegister(this.REG_PC, (this.readRegister(this.REG_PC) + 1) & 0xFF);
        if (intType === 0x01) {
          // INT 0x01: print A as decimal number
          this.output.push(this.readRegister(this.REG_A).toString());
        } else if (intType === 0x02) {
          // INT 0x02: print A as ASCII character
          this.output.push(String.fromCharCode(this.readRegister(this.REG_A)));
        }
        break;
      }

      case 0x41: { // OUT Rs
        const rs = this.readMemory((pc + 1) & 0xFF);
        this.writeRegister(this.REG_PC, (this.readRegister(this.REG_PC) + 1) & 0xFF);
        this.output.push('0x' + this.readRegister(rs).toString(16).toUpperCase().padStart(2, '0'));
        break;
      }

      default:
        // Unknown opcode — halt with error
        this.state = 'error';
        this.error = 'Unknown opcode: 0x' + opcode.toString(16).toUpperCase().padStart(2, '0');
        this.output.push('ERROR: ' + this.error + ' at tick ' + this.ticks);
        break;
    }

    // Update display after each step
    
  }

  /** Load assembled bytes into memory and set up line mapping. */
  loadProgram(assembledBytes, lineMap) {
    this.reset();
    for (let i = 0; i < assembledBytes.length && i < 256; i++) {
      this.memory[i] = assembledBytes[i];
    }
    this.lineMap = lineMap || [];
    
  }

  /** Full reset to initial state. */
  fullReset() {
    this.reset();
    
  }
}

export { Assembler, CPU };
