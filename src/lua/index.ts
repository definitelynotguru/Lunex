import { Lexer } from './lexer';
import { Parser } from './parser';
import { compile } from './compiler';
import { disassemble, type Prototype } from './bytecode';
import { LuaVM, type PrintSink } from './vm';
import { registerStdLib } from './stdlib-vm';
import type { AstNode, DebugHooks } from './types';

export type { Prototype, AstNode, DebugHooks, PrintSink };
export { Lexer, Parser, compile, disassemble, LuaVM, registerStdLib };

export interface RunResult {
  ast: AstNode;
  proto: Prototype;
  disasm: string;
  outputs: string[];
}

export interface Runtime {
  vm: LuaVM;
  parse(source: string): AstNode;
  compile(source: string): { ast: AstNode; proto: Prototype; disasm: string };
  run(source: string): Promise<RunResult>;
  setStepGate(gate: (() => Promise<void>) | null): void;
  setHooks(hooks: DebugHooks): void;
}

export function createRuntime(opts: {
  sink?: PrintSink;
  hooks?: DebugHooks;
} = {}): Runtime {
  const outputs: string[] = [];
  let lineBuf = '';
  const userSink = opts.sink;
  const sink: PrintSink = {
    print: (text) => {
      if (lineBuf) {
        outputs.push(lineBuf + text);
        lineBuf = '';
      } else outputs.push(text);
      userSink?.print(text);
    },
    write: (text) => {
      lineBuf += text;
      if (lineBuf.includes('\n')) {
        const parts = lineBuf.split('\n');
        lineBuf = parts.pop() || '';
        for (const p of parts) outputs.push(p);
      }
      userSink?.write(text);
    },
  };

  const vm = new LuaVM(sink, opts.hooks);
  registerStdLib(vm);

  return {
    vm,
    parse(source: string) {
      const tokens = new Lexer(source).tokenize();
      return new Parser(tokens).parse() as AstNode;
    },
    compile(source: string) {
      const ast = this.parse(source);
      const proto = compile(ast);
      return { ast, proto, disasm: disassemble(proto) };
    },
    async run(source: string) {
      outputs.length = 0;
      lineBuf = '';
      const { ast, proto, disasm } = this.compile(source);
      await vm.run(proto);
      if (lineBuf) {
        outputs.push(lineBuf);
        lineBuf = '';
      }
      return { ast, proto, disasm, outputs: [...outputs] };
    },
    setStepGate(gate) {
      vm.setStepGate(gate);
    },
    setHooks(hooks) {
      vm.hooks = { ...vm.hooks, ...hooks };
    },
  };
}

/** Convenience: compile + execute, return printed lines */
export async function run(source: string, sink?: PrintSink): Promise<string[]> {
  const rt = createRuntime({ sink });
  const result = await rt.run(source);
  return result.outputs;
}
