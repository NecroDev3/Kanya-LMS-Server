import path from 'path';
import fs from 'fs';
import dotenv from 'dotenv';
import pg from 'pg';
import Database, { type Database as DatabaseType } from 'better-sqlite3';

dotenv.config();

// Return Postgres DATE (OID 1082) columns as plain 'YYYY-MM-DD' strings instead of
// JS Date objects, which would otherwise be timezone-shifted when serialized to JSON.
// SQLite already stores these as TEXT, so this keeps date handling consistent.
pg.types.setTypeParser(1082, (v: string) => v);

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

  // Add a column only if missing. Tolerates the "duplicate column" race that can
  // happen when multiple processes (e.g. parallel test workers) open the same DB.
  const addColumn = (table: string, column: string, ddl: string) => {
    const cols = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
    if (cols.some((c) => c.name === column)) return;
    try {
      db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
    } catch (e) {
      if (!/duplicate column name/i.test((e as Error).message)) throw e;
    }
  };

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
    addColumn('users', 'program_id', 'program_id TEXT');
    db.exec('CREATE INDEX IF NOT EXISTS idx_users_program ON users(program_id)');
  }

  if (hasTable('students')) {
    addColumn('students', 'program_id', 'program_id TEXT');
    addColumn('students', 'status', "status TEXT NOT NULL DEFAULT 'active'");
    db.exec('CREATE INDEX IF NOT EXISTS idx_students_program ON students(program_id)');
  }

  if (hasTable('course_documents')) {
    addColumn('course_documents', 'program_id', 'program_id TEXT');
    db.exec('CREATE INDEX IF NOT EXISTS idx_documents_program ON course_documents(program_id)');
  }

  if (hasTable('courses')) {
    addColumn('courses', 'archived', 'archived INTEGER NOT NULL DEFAULT 0');
    addColumn('courses', 'archived_at', 'archived_at TEXT');
    db.exec('CREATE INDEX IF NOT EXISTS idx_courses_archived ON courses(archived)');
  }

  // Attendance registers: an uploaded signed in-person register covering a date range.
  if (!hasTable('attendance_registers')) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS attendance_registers (
        id TEXT PRIMARY KEY,
        program_id TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        date_from TEXT NOT NULL,
        date_to TEXT NOT NULL,
        file_name TEXT NOT NULL,
        file_size INTEGER NOT NULL,
        file_path TEXT NOT NULL,
        file_mime_type TEXT,
        uploaded_by_id TEXT NOT NULL REFERENCES users(id),
        uploaded_at TEXT DEFAULT (datetime('now')),
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_attendance_registers_program ON attendance_registers(program_id);
      CREATE INDEX IF NOT EXISTS idx_attendance_registers_dates ON attendance_registers(date_from, date_to);
    `);
  }

  // Progress reports are now program-level (title, month/year, file) — no student link.
  // Recreate the legacy student-linked table if present (safe: the feature carried no data).
  const progressIsLegacy =
    hasTable('progress_reports') &&
    !(db.prepare('PRAGMA table_info(progress_reports)').all() as { name: string }[]).some((c) => c.name === 'period_year');
  if (progressIsLegacy) {
    db.exec('DROP TABLE progress_reports');
  }
  if (!hasTable('progress_reports')) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS progress_reports (
        id TEXT PRIMARY KEY,
        program_id TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        description TEXT,
        period_month INTEGER NOT NULL,
        period_year INTEGER NOT NULL,
        file_name TEXT NOT NULL,
        file_size INTEGER NOT NULL,
        file_path TEXT NOT NULL,
        file_mime_type TEXT,
        uploaded_by_id TEXT NOT NULL REFERENCES users(id),
        uploaded_at TEXT DEFAULT (datetime('now')),
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_progress_reports_program ON progress_reports(program_id);
      CREATE INDEX IF NOT EXISTS idx_progress_reports_period ON progress_reports(period_year, period_month);
    `);
  }

  if (!hasTable('questionnaire_assignments')) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS questionnaire_assignments (
        id TEXT PRIMARY KEY,
        quiz_id TEXT NOT NULL REFERENCES quizzes(id) ON DELETE CASCADE,
        student_id TEXT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
        assigned_by_id TEXT REFERENCES users(id),
        assigned_at TEXT DEFAULT (datetime('now')),
        UNIQUE (quiz_id, student_id)
      );
      CREATE INDEX IF NOT EXISTS idx_questionnaire_assignments_quiz ON questionnaire_assignments(quiz_id);
      CREATE INDEX IF NOT EXISTS idx_questionnaire_assignments_student ON questionnaire_assignments(student_id);
    `);
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
