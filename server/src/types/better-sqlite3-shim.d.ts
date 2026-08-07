declare module 'better-sqlite3' {
  interface RunResult {
    changes: number;
    lastInsertRowid: number;
  }
}
