// Minimal types for the few Node.js APIs the tests use, so we don't need the
// @types/node package (not an approved dependency). Tests run in Node via Vitest.
declare module 'node:fs' {
  export function readFileSync(path: string): Uint8Array;
  export function readdirSync(path: string, options: { recursive: true }): string[];
}
declare const process: { cwd(): string; env: Record<string, string | undefined> };
