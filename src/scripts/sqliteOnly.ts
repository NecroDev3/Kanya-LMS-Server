import { db, isPostgres } from '../config/database.js';
import type { Database as DatabaseType } from 'better-sqlite3';

/** Ensures we are on SQLite and returns the DB handle (narrowed for TypeScript). */
export function assertSqliteForScript(scriptName: string): DatabaseType {
  if (isPostgres) {
    console.error(
      `${scriptName} only runs against SQLite (unset DATABASE_URL). For Neon/Postgres, run SQL in the Neon SQL Editor or use psql with DATABASE_URL.`
    );
    process.exit(1);
  }
  if (!db) {
    throw new Error('SQLite database not initialized');
  }
  return db;
}
