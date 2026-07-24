/**
 * Seed a super admin, a demo program, and a program-scoped admin.
 * Admin-only model: there are no student logins.
 *
 * Created:
 *   super@kanya.edu / super123   (super_admin)
 *   admin@kanya.edu / admin123   (admin, scoped to the "Demo Program")
 *
 * Usage: npm run db:seed
 */

import dotenv from 'dotenv';
dotenv.config();

import bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';
import { assertSqliteForScript } from './sqliteOnly.js';
import { close } from '../config/database.js';

const db = assertSqliteForScript('db:seed');

async function seed() {
  try {
    const now = new Date().toISOString();

    // Demo program (a courses row).
    let program = db.prepare('SELECT id FROM courses WHERE course_code = ?').get('DEMO-101') as { id: string } | undefined;
    if (!program) {
      const programId = uuidv4();
      db.prepare(
        `INSERT INTO courses (id, title, description, course_code, sections) VALUES (?, ?, ?, ?, '[]')`
      ).run(programId, 'Demo Program', 'A demo program for local development', 'DEMO-101');
      program = { id: programId };
      console.log('Created program: Demo Program (DEMO-101)');
    }

    const insertUser = db.prepare(
      `INSERT OR IGNORE INTO users (id, name, email, password_hash, role, program_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    );

    const superHash = await bcrypt.hash('super123', 10);
    const superRes = insertUser.run(uuidv4(), 'Super Admin', 'super@kanya.edu', superHash, 'super_admin', null, now, now);
    console.log(superRes.changes > 0 ? 'Created: super@kanya.edu' : 'Skipped (exists): super@kanya.edu');

    const adminHash = await bcrypt.hash('admin123', 10);
    const adminRes = insertUser.run(uuidv4(), 'Program Admin', 'admin@kanya.edu', adminHash, 'admin', program.id, now, now);
    console.log(adminRes.changes > 0 ? 'Created: admin@kanya.edu' : 'Skipped (exists): admin@kanya.edu');

    console.log('\nCredentials:');
    console.log('  Super Admin: super@kanya.edu / super123');
    console.log('  Admin:       admin@kanya.edu / admin123');
  } catch (err) {
    console.error('Error seeding users:', err);
    process.exit(1);
  } finally {
    await close();
  }
}

void seed();
