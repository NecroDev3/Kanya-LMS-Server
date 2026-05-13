/**
 * Apply DB schema.
 * - SQLite (local default): database/schema.sql
 * - Neon / Postgres: set DATABASE_URL; uses database/schema.postgres.sql
 *
 * Usage:
 *   npm run db:schema
 *   SCHEMA_SQL_PATH=/path/to/file.sql npm run db:schema
 */

import dotenv from 'dotenv';
dotenv.config();

import fs from 'fs';
import path from 'path';
import pg from 'pg';

function splitSqlStatements(raw: string): string[] {
  return raw
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean);
}

function pgPool(): pg.Pool {
  const connectionString = process.env.DATABASE_URL!.trim();
  return new pg.Pool({
    connectionString,
    max: 2,
    ssl:
      connectionString.includes('neon.tech') || /sslmode=require/i.test(connectionString)
        ? { rejectUnauthorized: false }
        : undefined,
  });
}

async function runPostgresSchema(): Promise<void> {
  const defaultPath = path.join(process.cwd(), 'database/schema.postgres.sql');
  const schemaPath = process.env.SCHEMA_SQL_PATH || defaultPath;
  if (!fs.existsSync(schemaPath)) {
    console.error(`Schema file not found: ${schemaPath}`);
    process.exit(1);
  }
  const body = fs.readFileSync(schemaPath, 'utf8');
  const pool = pgPool();
  try {
    console.log('Running Postgres schema from', schemaPath);
    for (const stmt of splitSqlStatements(body)) {
      await pool.query(stmt);
    }
    console.log('Postgres schema applied successfully.');
  } finally {
    await pool.end();
  }
}

async function runSqliteSchema(): Promise<void> {
  const { db, close } = await import('../config/database.js');
  if (!db) {
    console.error('SQLite mode expected but db is null.');
    process.exit(1);
  }
  const defaultPath = path.join(process.cwd(), 'database/schema.sql');
  const schemaPath = process.env.SCHEMA_SQL_PATH || defaultPath;
  if (!fs.existsSync(schemaPath)) {
    console.error(`Schema file not found: ${schemaPath}`);
    process.exit(1);
  }
  const schema = fs.readFileSync(schemaPath, 'utf8');
  console.log('Running SQLite schema from', schemaPath);
  db.exec(schema);
  console.log('SQLite schema applied successfully.');
  await close();
}

async function main(): Promise<void> {
  try {
    if (process.env.DATABASE_URL?.trim()) {
      await runPostgresSchema();
    } else {
      await runSqliteSchema();
    }
  } catch (err) {
    console.error('Error running schema:', err);
    process.exit(1);
  }
}

void main();
