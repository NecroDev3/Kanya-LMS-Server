import { verifyToken, createClerkClient } from '@clerk/backend';
import { v4 as uuidv4 } from 'uuid';
import { queryOne, execute } from '../config/database.js';
import type { User, Student, JWTPayload } from '../types/index.js';

function buildJwtPayload(user: User): JWTPayload {
  let studentId: string | undefined;
  if (user.role === 'student') {
    const student = queryOne<Student>('SELECT id FROM students WHERE user_id = ?', [user.id]);
    studentId = student?.id;
  }
  return {
    userId: user.id,
    email: user.email,
    role: user.role,
    studentId,
  };
}

function authorizedPartiesFromEnv(): string[] | undefined {
  const raw = process.env.CLERK_AUTHORIZED_PARTIES?.trim() || process.env.FRONTEND_URL?.trim();
  if (!raw) return undefined;
  const list = raw.split(',').map((s) => s.trim()).filter(Boolean);
  return list.length ? list : undefined;
}

/**
 * Verifies a Clerk session JWT and returns the matching LMS JWTPayload.
 * - If user row has clerk_user_id = Clerk sub → use it.
 * - Else if email matches an existing user → link clerk_user_id and use that row.
 * - Else create a student user + student row (same idea as Google sign-in).
 */
export async function resolveUserFromClerkSessionToken(sessionToken: string): Promise<JWTPayload | null> {
  const secretKey = process.env.CLERK_SECRET_KEY?.trim();
  if (!secretKey) return null;

  let sub: string;
  try {
    const opts: Parameters<typeof verifyToken>[1] = { secretKey };
    const parties = authorizedPartiesFromEnv();
    if (parties) {
      opts.authorizedParties = parties;
    }
    const verified = await verifyToken(sessionToken, opts);
    sub = verified.sub;
    if (!sub) return null;
  } catch {
    return null;
  }

  const linked = queryOne<User>('SELECT * FROM users WHERE clerk_user_id = ?', [sub]);
  if (linked) {
    return buildJwtPayload(linked);
  }

  const clerk = createClerkClient({ secretKey });
  let cu;
  try {
    cu = await clerk.users.getUser(sub);
  } catch {
    return null;
  }

  const primaryId = cu.primaryEmailAddressId;
  const primary =
    primaryId != null ? cu.emailAddresses.find((e) => e.id === primaryId) : cu.emailAddresses[0];
  const email = primary?.emailAddress?.toLowerCase();
  if (!email) return null;

  const name =
    [cu.firstName, cu.lastName].filter(Boolean).join(' ').trim() ||
    (cu.username ?? '').trim() ||
    email.split('@')[0] ||
    'User';

  const byEmail = queryOne<User>('SELECT * FROM users WHERE email = ?', [email]);
  if (byEmail) {
    execute("UPDATE users SET clerk_user_id = ?, updated_at = datetime('now') WHERE id = ?", [sub, byEmail.id]);
    return buildJwtPayload(byEmail);
  }

  const id = uuidv4();
  execute(
    'INSERT INTO users (id, name, email, password_hash, role, clerk_user_id) VALUES (?, ?, ?, ?, ?, ?)',
    [id, name, email, '', 'student', sub]
  );
  const user = queryOne<User>('SELECT * FROM users WHERE id = ?', [id]);
  if (!user) return null;

  const slug = sub.replace(/[^a-zA-Z0-9]/g, '').slice(0, 24);
  const enrollmentNumber = `CLERK-${slug || id.replace(/-/g, '').slice(0, 16)}`;
  const studentId = uuidv4();
  execute(
    `INSERT INTO students (id, user_id, name, email, enrollment_number, department, semester)
     VALUES (?, ?, ?, ?, ?, 'General', 1)`,
    [studentId, id, name, email, enrollmentNumber]
  );

  return {
    userId: user.id,
    email: user.email,
    role: user.role,
    studentId,
  };
}
