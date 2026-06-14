import { Buffer } from "node:buffer";
import process from "node:process";

const globalScope = globalThis as typeof globalThis & {
  Buffer?: typeof Buffer;
  global?: typeof globalThis;
  process?: typeof process;
};

globalScope.Buffer ??= Buffer;
globalScope.global ??= globalThis;
globalScope.process ??= process;
