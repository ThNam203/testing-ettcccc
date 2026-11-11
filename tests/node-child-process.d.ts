// Minimal types for the one Node API the server-module test uses (the project has no @types/node).
declare module 'node:child_process' {
  export function execFileSync(file: string, args: readonly string[], options: { encoding: 'utf8' }): string;
}

declare const process: { readonly execPath: string };
