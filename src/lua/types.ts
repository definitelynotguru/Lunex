/** Shared Lua runtime & AST types */

export type TokenType =
  | 'string' | 'number' | 'boolean' | 'nil' | 'keyword'
  | 'identifier' | 'operator' | 'punctuator' | 'vararg' | 'eof';

export interface Token {
  type: TokenType;
  value: unknown;
  line: number;
}

export type AstNode = Record<string, unknown> & { type: string; line?: number };

export type LuaValue =
  | null
  | undefined
  | number
  | string
  | boolean
  | LuaTable
  | LuaFunction
  | NativeFunction;

export interface LuaTable {
  [key: string | number]: unknown;
  __metatable?: LuaTable | null;
}

export interface LuaFunction {
  __luaFunc: true;
  params: string[];
  isVararg: boolean;
  body: AstNode;
  closure: unknown;
  name?: string | null;
}

export type NativeFunction = ((...args: LuaValue[]) => LuaValue | LuaValue[]) & {
  __luaFunc?: false;
};

export interface DebugHooks {
  /** Called before each statement when step mode is on. Return false to stop. */
  onStatement?: (info: {
    node: AstNode;
    locals: Record<string, LuaValue>;
    line?: number;
  }) => boolean | void | Promise<boolean | void>;
  stepMode?: boolean;
}
