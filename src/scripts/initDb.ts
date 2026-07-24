/**
 * Initialize a local SQLite database from the canonical schema and seed a
 * super admin + demo program + program-scoped admin (admin-only model).
 *
 * Usage: npm run db:init
 */

import dotenv from 'dotenv';
dotenv.config();

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';
import { assertSqliteForScript } from './sqliteOnly.js';
import { close } from '../config/database.js';

const db = assertSqliteForScript('db:init');

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function initDatabase() {
  try {
    console.log('🔄 Creating database tables from schema.sql...');
    const schemaPath = path.resolve(__dirname, '../../database/schema.sql');
    const schemaSQL = fs.readFileSync(schemaPath, 'utf-8');
    db.exec(schemaSQL);
    console.log('✅ Tables created');

    const now = new Date().toISOString();

    const programId = uuidv4();
    db.prepare(
      `INSERT INTO courses (id, title, description, course_code, sections) VALUES (?, ?, ?, ?, '[]')`
    ).run(programId, 'Demo Program', 'A demo program for local development', 'DEMO-101');

    const superHash = await bcrypt.hash('super123', 10);
    db.prepare(
      `INSERT INTO users (id, name, email, password_hash, role, program_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'super_admin', NULL, ?, ?)`
    ).run(uuidv4(), 'Super Admin', 'super@kanya.edu', superHash, now, now);

    const adminHash = await bcrypt.hash('admin123', 10);
    db.prepare(
      `INSERT INTO users (id, name, email, password_hash, role, program_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'admin', ?, ?, ?)`
    ).run(uuidv4(), 'Program Admin', 'admin@kanya.edu', adminHash, programId, now, now);

    // A couple of demo students in the program (no login accounts).
    const insertStudent = db.prepare(
      `INSERT INTO students (id, program_id, name, email, enrollment_number, department, semester, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)`
    );
    insertStudent.run(uuidv4(), programId, 'Jane Doe', 'jane@example.com', 'KCS2024001', 'Computer Science', 4, now, now);
    insertStudent.run(uuidv4(), programId, 'John Smith', 'john@example.com', 'KCS2024002', 'Computer Science', 2, now, now);

    console.log('\n📋 Database initialization complete!');
    console.log('🔑 Super Admin: super@kanya.edu / super123');
    console.log('🔑 Admin:       admin@kanya.edu / admin123');
  } catch (error) {
    console.error('❌ Error initializing database:', error);
    throw error;
  } finally {
    await close();
  }
}

initDatabase().catch((error) => {
  console.error(error);
  process.exit(1);
});
