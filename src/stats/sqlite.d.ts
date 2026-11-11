/**
 * Minimal types for Node's built-in `node:sqlite` (Node >= 22.13), covering only what src/stats/store.ts uses.
 * Written by hand so the project does not need @types/node. Docs: https://nodejs.org/api/sqlite.html
 */
declare module 'node:sqlite' {
  export type SQLInputValue = null | number | bigint | string | Uint8Array;
  export type SQLOutputValue = null | number | bigint | string | Uint8Array;
  export type Row = Record<string, SQLOutputValue>;

  export interface StatementResultingChanges {
    readonly changes: number | bigint;
    readonly lastInsertRowid: number | bigint;
  }

  export class StatementSync {
    run(...params: SQLInputValue[]): StatementResultingChanges;
    get(...params: SQLInputValue[]): Row | undefined;
    all(...params: SQLInputValue[]): Row[];
    columns(): { readonly name: string }[];
  }

  export class DatabaseSync {
    constructor(path: string, options?: { readonly open?: boolean; readonly readOnly?: boolean });
    exec(sql: string): void;
    prepare(sql: string): StatementSync;
    close(): void;
  }
}
