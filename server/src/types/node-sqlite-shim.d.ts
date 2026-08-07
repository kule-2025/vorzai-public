declare global {
  namespace NodeJS {
    namespace sqlite {
      interface RunResult {
        readonly changes: number;
        readonly lastInsertRowid: bigint;
      }
    }
  }
}

// Augment node:sqlite Statement.run() return type to include `changes`
declare module 'node:sqlite' {
  interface StatementSync {
    run(...params: any[]): sqlite.RunResult;
  }
}
