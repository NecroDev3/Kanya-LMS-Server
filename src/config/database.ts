import path from 'path';
import fs from 'fs';
import dotenv from 'dotenv';
import pg from 'pg';
import Database, { type Database as DatabaseType } from 'better-sqlite3';

dotenv.config();

const databaseUrl = process.env.DATABASE_URL?.trim();

export const isPostgres = Boolean(databaseUrl);

/** Use in dynamic SQL fragments, e.g. \`updated_at = ${sqlNow()}\` */
export function sqlNow(): string {
  return isPostgres ? 'CURRENT_TIMESTAMP' : "datetime('now')";
}

/** Case-insensitive search on Postgres */
export function sqlLike(): string {
  return isPostgres ? 'ILIKE' : 'LIKE';
}

/** Convert SQLite-style ? placeholders to $1 $2 ... for pg */
export function toPgSql(sql: string): string {
  let n = 0;
  return sql.replace(/\?/g, () => `$${++n}`);
}

let pool: pg.Pool | null = null;
let sqliteDb: DatabaseType | null = null;

if (isPostgres) {
  pool = new pg.Pool({
    connectionString: databaseUrl,
    max: 10,
    ssl: databaseUrl!.includes('neon.tech') || /sslmode=require/i.test(databaseUrl!)
      ? { rejectUnauthorized: false }
      : undefined,
  });
} else {
  const DB_PATH = process.env.DATABASE_PATH || './data/student_ms.db';
  const dbDir = path.dirname(DB_PATH);
  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
  }
  sqliteDb = new Database(DB_PATH);
  sqliteDb.pragma('journal_mode = WAL');
  sqliteDb.pragma('foreign_keys = ON');
  runSqliteEnsures(sqliteDb);
}

function runSqliteEnsures(db: DatabaseType): void {
  const hasTable = (name: string) =>
    Boolean(
      db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(name)
    );

  if (!hasTable('user_course_codes')) {
    db.exec(`
      CREATE TABLE user_course_codes (
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        course_code TEXT NOT NULL,
        PRIMARY KEY (user_id, course_code)
      );
      CREATE INDEX IF NOT EXISTS idx_user_course_codes_user ON user_course_codes(user_id);
      CREATE INDEX IF NOT EXISTS idx_user_course_codes_code ON user_course_codes(course_code);
    `);
  }

  if (hasTable('users')) {
    const cols = db.prepare('PRAGMA table_info(users)').all() as { name: string }[];
    if (!cols.some((c) => c.name === 'clerk_user_id')) {
      db.exec('ALTER TABLE users ADD COLUMN clerk_user_id TEXT');
    }
    db.exec(
      'CREATE UNIQUE INDEX IF NOT EXISTS idx_users_clerk_user_id ON users(clerk_user_id) WHERE clerk_user_id IS NOT NULL'
    );
  }

  if (!hasTable('announcements')) {
    db.exec(`
      CREATE TABLE announcements (
        id         TEXT PRIMARY KEY,
        title      TEXT NOT NULL,
        body       TEXT NOT NULL,
        scope      TEXT NOT NULL DEFAULT 'general' CHECK (scope IN ('general', 'course')),
        course_id  TEXT REFERENCES courses(id) ON DELETE CASCADE,
        author_id  TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        pinned     INTEGER NOT NULL DEFAULT 0,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_announcements_scope    ON announcements(scope);
      CREATE INDEX IF NOT EXISTS idx_announcements_course   ON announcements(course_id);
      CREATE INDEX IF NOT EXISTS idx_announcements_created  ON announcements(created_at DESC);
    `);
  }

  if (!hasTable('user_profiles')) {
    db.exec(`
      CREATE TABLE user_profiles (
        user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        avatar_path  TEXT,
        whatsapp     TEXT,
        telegram     TEXT,
        linkedin_url TEXT,
        github_url   TEXT,
        twitter_url  TEXT,
        website_url  TEXT,
        custom_links TEXT DEFAULT '[]',
        updated_at   TEXT DEFAULT (datetime('now'))
      )
    `);
  } else {
    const cols = db.prepare('PRAGMA table_info(user_profiles)').all() as { name: string }[];
    const addCol = (col: string, def: string) => {
      if (!cols.some((c) => c.name === col)) {
        db.exec(`ALTER TABLE user_profiles ADD COLUMN ${col} ${def}`);
      }
    };
    addCol('avatar_path', 'TEXT');
    addCol('whatsapp', 'TEXT');
    addCol('telegram', 'TEXT');
    addCol('linkedin_url', 'TEXT');
    addCol('github_url', 'TEXT');
    addCol('twitter_url', 'TEXT');
    addCol('website_url', 'TEXT');
    addCol('custom_links', "TEXT DEFAULT '[]'");
  }

  if (!hasTable('course_invites')) {
    db.exec(`
      CREATE TABLE course_invites (
        id TEXT PRIMARY KEY,
        course_id TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
        email TEXT NOT NULL,
        token TEXT NOT NULL UNIQUE,
        status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'revoked')),
        created_at TEXT DEFAULT (datetime('now')),
        expires_at TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_course_invites_course ON course_invites(course_id);
      CREATE INDEX IF NOT EXISTS idx_course_invites_email ON course_invites(email);
      CREATE INDEX IF NOT EXISTS idx_course_invites_token ON course_invites(token);
    `);
  }

  if (!hasTable('conversation_reads')) {
    db.exec(`
      CREATE TABLE conversation_reads (
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
        last_read_at TEXT NOT NULL DEFAULT (datetime('now')),
        PRIMARY KEY (user_id, conversation_id)
      );
      CREATE INDEX IF NOT EXISTS idx_conv_reads_user ON conversation_reads(user_id);
    `);
  }

  if (hasTable('forum_topics')) {
    const cols = db.prepare('PRAGMA table_info(forum_topics)').all() as { name: string }[];
    if (!cols.some((c) => c.name === 'course_id')) {
      db.exec('ALTER TABLE forum_topics ADD COLUMN course_id TEXT NULL REFERENCES courses(id) ON DELETE SET NULL');
      db.exec('CREATE INDEX IF NOT EXISTS idx_forum_topics_course_id ON forum_topics(course_id)');
    }
  }

  if (hasTable('quizzes')) {
    const cols = db.prepare('PRAGMA table_info(quizzes)').all() as { name: string }[];
    if (!cols.some((c) => c.name === 'information')) {
      db.exec('ALTER TABLE quizzes ADD COLUMN information TEXT');
    }
  }
}

/** Only set when using SQLite (e.g. tests, local without DATABASE_URL). Reassigned by _resetForTests. */
export let db: DatabaseType | null = sqliteDb;

export async function query<T>(sql: string, params: unknown[] = []): Promise<T[]> {
  if (isPostgres) {
    const { rows } = await pool!.query(toPgSql(sql), params);
    return rows as T[];
  }
  const stmt = sqliteDb!.prepare(sql);
  return stmt.all(...params) as T[];
}

export async function queryOne<T>(sql: string, params: unknown[] = []): Promise<T | null> {
  if (isPostgres) {
    const { rows } = await pool!.query(toPgSql(sql), params);
    return (rows[0] as T) ?? null;
  }
  const stmt = sqliteDb!.prepare(sql);
  const row = stmt.get(...params) as T | undefined;
  return row ?? null;
}

export async function execute(sql: string, params: unknown[] = []): Promise<number> {
  if (isPostgres) {
    const result = await pool!.query(toPgSql(sql), params);
    return result.rowCount ?? 0;
  }
  const stmt = sqliteDb!.prepare(sql);
  const r = stmt.run(...params);
  return r.changes;
}

export async function insert(sql: string, params: unknown[] = []): Promise<string | number> {
  if (isPostgres) {
    const r = await pool!.query(toPgSql(sql), params);
    return r.rowCount ?? 0;
  }
  const stmt = sqliteDb!.prepare(sql);
  const result = stmt.run(...params);
  return Number(result.lastInsertRowid);
}

/** Idempotent user_course_codes row (Postgres: ON CONFLICT DO NOTHING). */
export async function insertUserCourseCodeIgnore(userId: string, courseCode: string): Promise<void> {
  if (isPostgres) {
    await execute(
      `INSERT INTO user_course_codes (user_id, course_code) VALUES (?, ?) ON CONFLICT (user_id, course_code) DO NOTHING`,
      [userId, courseCode]
    );
  } else {
    await execute(`INSERT OR IGNORE INTO user_course_codes (user_id, course_code) VALUES (?, ?)`, [
      userId,
      courseCode,
    ]);
  }
}

export async function testConnection(): Promise<void> {
  if (isPostgres) {
    await pool!.query('SELECT 1');
  } else {
    sqliteDb!.prepare('SELECT 1').get();
  }
}

export async function close(): Promise<void> {
  if (isPostgres) {
    await pool!.end();
  } else {
    try {
      sqliteDb?.close();
    } catch {
      /* ignore */
    }
  }
}

export function _resetForTests(schemaSQL: string): void {
  if (isPostgres) {
    throw new Error('_resetForTests requires SQLite (unset DATABASE_URL in tests)');
  }
  try {
    sqliteDb?.close();
  } catch {
    /* ignore */
  }
  sqliteDb = new Database(':memory:');
  sqliteDb.pragma('foreign_keys = ON');
  sqliteDb.exec(schemaSQL);
  runSqliteEnsures(sqliteDb);
  db = sqliteDb;
}
