/**
 * Migrate an existing database to the admin-only, program-scoped RBAC model.
 *
 * - users:  add program_id; relax the role CHECK to ('super_admin','admin')
 * - students: add program_id + status
 * - course_documents: add program_id
 * - create progress_reports and questionnaire_assignments
 *
 * Safe to run multiple times. Works against Postgres/Neon (uses DATABASE_URL).
 * For local SQLite, the same changes are applied automatically on boot by
 * runSqliteEnsures() in config/database.ts.
 *
 * Usage (Postgres/Neon):
 *   export DATABASE_URL='postgresql://...'
 *   npm run db:migrate-rbac
 */

import dotenv from 'dotenv';
dotenv.config();

import { execute, isPostgres, close } from '../config/database.js';

async function run(sql: string, label: string): Promise<void> {
  try {
    await execute(sql);
    console.log('OK  ', label);
  } catch (e) {
    console.error('FAIL', label, '-', (e as Error).message);
    throw e;
  }
}

async function main(): Promise<void> {
  if (!isPostgres) {
    console.log(
      'DATABASE_URL not set — this migration targets Postgres. SQLite applies these changes automatically on boot.'
    );
    await close();
    return;
  }

  await run('ALTER TABLE users ADD COLUMN IF NOT EXISTS program_id TEXT', 'users.program_id');
  await run('ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check', 'drop old users_role_check');
  await run(
    "ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN ('super_admin','admin'))",
    'users role CHECK super_admin/admin'
  ).catch(() => {
    console.warn(
      'Could not add strict role CHECK (likely legacy student rows). Convert/remove them, then re-run. Roles are still enforced in app code.'
    );
  });
  await run('CREATE INDEX IF NOT EXISTS idx_users_program ON users(program_id)', 'idx_users_program');

  await run('ALTER TABLE students ADD COLUMN IF NOT EXISTS program_id TEXT', 'students.program_id');
  await run(
    "ALTER TABLE students ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active'",
    'students.status'
  );
  await run('CREATE INDEX IF NOT EXISTS idx_students_program ON students(program_id)', 'idx_students_program');

  await run(
    'ALTER TABLE course_documents ADD COLUMN IF NOT EXISTS program_id TEXT',
    'course_documents.program_id'
  );
  await run(
    'CREATE INDEX IF NOT EXISTS idx_documents_program ON course_documents(program_id)',
    'idx_documents_program'
  );

  await run(
    `CREATE TABLE IF NOT EXISTS attendance_registers (
      id TEXT PRIMARY KEY,
      program_id TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      date_from DATE NOT NULL,
      date_to DATE NOT NULL,
      file_name TEXT NOT NULL,
      file_size INTEGER NOT NULL,
      file_path TEXT NOT NULL,
      file_mime_type TEXT,
      uploaded_by_id TEXT NOT NULL REFERENCES users(id),
      uploaded_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
      created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    )`,
    'create attendance_registers'
  );
  await run(
    'CREATE INDEX IF NOT EXISTS idx_attendance_registers_program ON attendance_registers(program_id)',
    'idx_attendance_registers_program'
  );

  await run(
    `CREATE TABLE IF NOT EXISTS progress_reports (
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
      uploaded_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
      created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    )`,
    'create progress_reports'
  );
  await run(
    'CREATE INDEX IF NOT EXISTS idx_progress_reports_program ON progress_reports(program_id)',
    'idx_progress_reports_program'
  );
  await run(
    'CREATE INDEX IF NOT EXISTS idx_progress_reports_period ON progress_reports(period_year, period_month)',
    'idx_progress_reports_period'
  );

  await run(
    `CREATE TABLE IF NOT EXISTS questionnaire_assignments (
      id TEXT PRIMARY KEY,
      quiz_id TEXT NOT NULL REFERENCES quizzes(id) ON DELETE CASCADE,
      student_id TEXT NOT NULL REFERENCES students(id) ON DELETE CASCADE,
      assigned_by_id TEXT REFERENCES users(id),
      assigned_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (quiz_id, student_id)
    )`,
    'create questionnaire_assignments'
  );
  await run(
    'CREATE INDEX IF NOT EXISTS idx_questionnaire_assignments_quiz ON questionnaire_assignments(quiz_id)',
    'idx_qa_quiz'
  );
  await run(
    'CREATE INDEX IF NOT EXISTS idx_questionnaire_assignments_student ON questionnaire_assignments(student_id)',
    'idx_qa_student'
  );

  console.log('RBAC migration complete.');
  await close();
}

void main().catch(async (e) => {
  console.error(e);
  await close();
  process.exit(1);
});
