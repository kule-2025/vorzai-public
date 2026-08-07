// Type declarations for Node.js/Electron specific APIs

declare module 'node:sqlite' {
  export class DatabaseSync {
    constructor(location: string);
    exec(sql: string): void;
    prepare(sql: string): Statement;
    close(): void;
  }
  export interface Statement {
    run(...params: unknown[]): unknown;
    get(...params: unknown[]): unknown;
    all(...params: unknown[]): unknown[];
  }
}

// Electron process extensions
declare namespace NodeJS {
  interface Process {
    resourcesPath?: string;
    ELECTRON_RUN_AS_NODE?: string;
  }
}

// Express.ZodError compatibility
declare module 'zod' {
  interface ZodError<T> {
    errors: Array<{ path: (string | number)[]; message: string; code: string }>;
  }
}
