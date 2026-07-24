/**
 * Seed a single Super Admin account. Idempotent (skips if the email exists).
 * Works against both SQLite (local) and Postgres/Neon (DATABASE_URL set).
 *
 * Configure via env (falls back to sensible dev defaults):
 *   SUPERADMIN_NAME, SUPERADMIN_EMAIL, SUPERADMIN_PASSWORD
 *
 * Usage:
 *   npm run db:seed-superadmin
 *   SUPERADMIN_EMAIL=you@org.com SUPERADMIN_PASSWORD='strongpass' npm run db:seed-superadmin
 */

import dotenv from 'dotenv';
dotenv.config();

import bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';
import { queryOne, execute, close } from '../config/database.js';

async function main(): Promise<void> {
  const name = (process.env.SUPERADMIN_NAME || 'Super Admin').trim();
  const email = (process.env.SUPERADMIN_EMAIL || 'superadmin@kanya.edu').trim().toLowerCase();
  const password = process.env.SUPERADMIN_PASSWORD || 'superadmin123';

  const existing = await queryOne<{ id: string }>('SELECT id FROM users WHERE email = ?', [email]);
  if (existing) {
    console.log(`Super admin already exists: ${email}`);
    await close();
    return;
  }

  const id = uuidv4();
  const hash = await bcrypt.hash(password, 10);
  await execute(
    `INSERT INTO users (id, name, email, password_hash, role, program_id) VALUES (?, ?, ?, ?, 'super_admin', NULL)`,
    [id, name, email, hash]
  );

  console.log(`Created super admin: ${email}`);
  if (!process.env.SUPERADMIN_PASSWORD) {
    console.log('Default password: superadmin123  (set SUPERADMIN_PASSWORD to override)');
  }
  await close();
}

void main().catch(async (e) => {
  console.error('Error seeding super admin:', e);
  await close();
  process.exit(1);
});
