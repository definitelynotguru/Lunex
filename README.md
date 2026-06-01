# Lunex

Two projects, both single HTML files, no dependencies. One runs a high-level language, the other runs a CPU from scratch. The idea is to cover the full stack: how software gets interpreted at the top, and how hardware actually executes instructions at the bottom.

**Lunex** (`index.html`) is a Lua interpreter. Lexer, parser, tree-walk interpreter, closures, metatables, the works.

**Lunex VM** (`vm.html`) is an 8-bit virtual CPU with 33 instructions, a two-pass assembler, and a debugger where you step through assembly tick by tick and watch registers change.

---

## Lunex (Lua interpreter)

A Lua interpreter in one file. It handles the language properly: lexical scoping, closures, metatables with `__index`, multi-return values, variadic functions, and a standard library that covers math, string, table, and os. There's a tree-walk interpreter, a recursive descent parser with correct operator precedence (right-associative `^` and `..`), and an environment that manages scope chains.

### What it runs

Types: number, string, boolean, nil, table, function. Block-scoped `local` variables. Control flow: `if/elseif/else/end`, `while`, `repeat/until`, numeric and generic `for`, `break`. Functions with closures, colon syntax (`obj:method()`), and `...` for variadics. Tables work as arrays, dictionaries, or both. Metatables via `setmetatable`/`getmetatable`.

The standard library includes `math` (floor, ceil, sqrt, sin, cos, random, pi, ...), `string` (find, format, match, gsub, plus colon methods like `s:lower()`), `table` (insert, remove, sort, concat), `assert`/`error`/`pcall` for error handling, and `io.write` for output without newlines.

### Running it

```
open index.html
```

Edit code on the left, press Ctrl+Enter (or click Run), output appears on the right. There's a pre-loaded demo that walks through Fibonacci with memoization, a Stack class using metatables, closures, string operations, and error handling with `pcall`.

### How it works

```
Source Code → Lexer → Parser → Environment → Interpreter → StdLib → Console
```

Single `<script>` tag. The lexer tokenizes Lua source, the parser builds an AST, the environment chain manages scoping, and the interpreter walks the tree. Standard library functions are JS closures registered on the global environment. Runtime errors show up in red with line numbers; `pcall` catches them.

### What it doesn't do

No `goto`, no long strings (`[[ ]]`), no coroutines. `string.match` and `gsub` use JS regex, not Lua patterns. The `#` operator counts consecutive integer keys starting from 1. It's single-threaded, no `os.execute` or `io.read`.

---

## Lunex VM (8-bit CPU emulator)

A virtual 8-bit CPU. You write assembly, assemble it, and either run it or step through one instruction at a time while watching the machine state update.

### The CPU

Six registers: A (accumulator), B, C, D (general purpose), SP (stack pointer at 0xFF), PC (program counter). 256 bytes of memory. Four flags: Zero, Carry, Negative, Overflow.

The instruction set covers 33 operations across five categories:

| Category | Instructions |
|----------|-------------|
| Data | `NOP` `HLT` `MOV` `LDI` `LDA` `STA` `LDR` `STR` `PUSH` `POP` |
| Arithmetic | `ADD` `SUB` `INC` `DEC` `MUL` `DIV` `MOD` `CMP` |
| Logic | `AND` `OR` `XOR` `NOT` `SHL` `SHR` |
| Branch | `JMP` `JZ` `JNZ` `JC` `JNC` `JN` `CALL` `RET` |
| System | `INT` `OUT` |

`PUSH` decrements SP before writing, `POP` reads before incrementing. `DIV` by zero halts with an error. `CALL` pushes the return address, `RET` pops it. `INT 0x01` prints A as a decimal number, `INT 0x02` prints A as a character.

### The assembler

Two passes. First pass collects labels and calculates instruction addresses. Second pass emits machine code. Supports `DB` (raw bytes), `DW` (16-bit, little-endian), and `DS` (null-terminated strings). Immediates work in decimal (`42`), hex (`0xFF`), or binary (`0b10101010`). Errors include line numbers. Comments use `;`.

```asm
; 10 + 20, print result
start:
    LDI A, 10
    LDI B, 20
    ADD A, B
    INT 0x01        ; print A
    HLT

data:
    DB 0x41, 0x42
    DS "hello", 0
```

### The debugger

This is the part I spent the most time on. You write assembly in the editor, click Assemble, then step through it. Each step, the right panel updates: register values (hex, binary, a proportional bar), flag indicators (lit or dim), the memory hex dump with the current PC highlighted, and the output console.

You can run continuously at 1 to 1000 Hz, set breakpoints by clicking line numbers, and use keyboard shortcuts for everything (Ctrl+Enter to assemble, Ctrl+R to run/pause, Ctrl+. to step, Ctrl+Shift+R to reset).

### Included programs

There's a dropdown with four demos:

- Fibonacci (first 15 numbers, wraps at 8 bits)
- Bubble Sort (sorts a 4-element array in memory)
- String Reverse (pushes "HELLO" onto the stack, pops it backward)
- Countdown (10 down to 1)

### Running it

```
open vm.html
```

---

## Visual design

Both files use the same look: dark background, Geist Mono font, green accent color, noise texture overlay, glassmorphism panels. They look like they belong together when you open them side by side.

## Browser support

Chrome, Firefox, Safari, Edge. ES6+ required.

## License

MIT
