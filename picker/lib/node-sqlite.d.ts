// Minimal ambient typing for node:sqlite.
//
// The installed @types/node (20.x) predates this module — it landed in Node's
// own types around 22.5. Node 24, which actually runs this app, has it built
// in and working (confirmed at the REPL); this file exists only so the
// compiler stops treating a real, present module as missing. Only the surface
// lib/rimsort.ts actually uses is declared.
declare module "node:sqlite" {
  export class DatabaseSync {
    constructor(path: string, options?: { readOnly?: boolean; timeout?: number });
    prepare(sql: string): StatementSync;
    exec(sql: string): void;
    close(): void;
  }
  export class StatementSync {
    run(...params: unknown[]): unknown;
    get(...params: unknown[]): unknown;
    all(...params: unknown[]): unknown[];
  }
}
