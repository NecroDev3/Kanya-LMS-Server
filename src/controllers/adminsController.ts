import { Response, NextFunction } from 'express';
import bcrypt from 'bcryptjs';
import { query, queryOne, execute, sqlNow } from '../config/database.js';
import { AuthRequest, User, UserRole, ErrorCodes } from '../types/index.js';
import { AppError } from '../middleware/errorHandler.js';
import { createUser } from './authController.js';

interface AdminRow {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  program_id: string | null;
  program_name: string | null;
  created_at: string;
}

function toAdminResponse(r: AdminRow) {
  return {
    id: r.id,
    name: r.name,
    email: r.email,
    role: r.role,
    programId: r.program_id,
    programName: r.program_name,
    createdAt: r.created_at,
  };
}

/** GET /admins — list all admin/super_admin accounts (Super Admin only). */
export async function listAdmins(_req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const rows = await query<AdminRow>(
      `SELECT u.id, u.name, u.email, u.role, u.program_id, c.title AS program_name, u.created_at
       FROM users u
       LEFT JOIN courses c ON c.id = u.program_id
       ORDER BY u.role DESC, u.name ASC`
    );
    res.json({ success: true, data: { admins: rows.map(toAdminResponse) } });
  } catch (error) {
    next(error);
  }
}

/** POST /admins — create a new admin (or super admin) account. */
export async function createAdmin(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const body = (req.body || {}) as Record<string, unknown>;
    const name = body.name != null ? String(body.name).trim() : '';
    const email = body.email != null ? String(body.email).trim().toLowerCase() : '';
    const password = body.password != null ? String(body.password) : '';
    const role: UserRole = body.role === 'super_admin' ? 'super_admin' : 'admin';
    const programId = body.programId != null && String(body.programId).trim() !== '' ? String(body.programId).trim() : null;

    const errors: Array<{ field: string; message: string }> = [];
    if (!name) errors.push({ field: 'name', message: 'Name is required' });
    if (!email || !email.includes('@')) errors.push({ field: 'email', message: 'Valid email is required' });
    if (!password || password.length < 8) errors.push({ field: 'password', message: 'Password must be at least 8 characters' });
    if (role === 'admin' && !programId) errors.push({ field: 'programId', message: 'An admin must be assigned to a program' });
    if (errors.length > 0) {
      throw new AppError('Validation failed', 400, ErrorCodes.VALIDATION_ERROR, errors);
    }

    const existing = await queryOne<{ id: string }>('SELECT id FROM users WHERE email = ?', [email]);
    if (existing) {
      throw new AppError('A user with this email already exists', 400, ErrorCodes.DUPLICATE_ENTRY);
    }
    if (role === 'admin' && programId) {
      const program = await queryOne<{ id: string }>('SELECT id FROM courses WHERE id = ?', [programId]);
      if (!program) throw new AppError('Program not found', 404, ErrorCodes.NOT_FOUND);
    }

    const user = await createUser(name, email, password, role, programId);
    const row = await queryOne<AdminRow>(
      `SELECT u.id, u.name, u.email, u.role, u.program_id, c.title AS program_name, u.created_at
       FROM users u LEFT JOIN courses c ON c.id = u.program_id WHERE u.id = ?`,
      [user.id]
    );
    res.status(201).json({ success: true, data: toAdminResponse(row!) });
  } catch (error) {
    next(error);
  }
}

/** PUT /admins/:id — update name, role, assigned program, or reset password. */
export async function updateAdmin(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { id } = req.params;
    const existing = await queryOne<User>('SELECT * FROM users WHERE id = ?', [id]);
    if (!existing) throw new AppError('Admin not found', 404, ErrorCodes.NOT_FOUND);

    const body = (req.body || {}) as Record<string, unknown>;
    const updates: string[] = [];
    const params: unknown[] = [];

    let nextRole: UserRole = existing.role;
    if (body.role !== undefined) {
      nextRole = body.role === 'super_admin' ? 'super_admin' : 'admin';
      updates.push('role = ?');
      params.push(nextRole);
    }
    if (body.name !== undefined) {
      const n = String(body.name).trim();
      if (!n) throw new AppError('Name cannot be empty', 400, ErrorCodes.VALIDATION_ERROR);
      updates.push('name = ?');
      params.push(n);
    }
    // programId: assign or revoke (null). Super admins carry no program.
    if (body.programId !== undefined || body.role !== undefined) {
      let programId: string | null =
        body.programId != null && String(body.programId).trim() !== '' ? String(body.programId).trim() : null;
      if (nextRole === 'super_admin') {
        programId = null;
      } else if (!programId) {
        // Falling back to existing when only the role changed.
        programId = existing.program_id ?? null;
        if (!programId) throw new AppError('An admin must be assigned to a program', 400, ErrorCodes.VALIDATION_ERROR);
      }
      if (programId) {
        const program = await queryOne<{ id: string }>('SELECT id FROM courses WHERE id = ?', [programId]);
        if (!program) throw new AppError('Program not found', 404, ErrorCodes.NOT_FOUND);
      }
      updates.push('program_id = ?');
      params.push(programId);
    }
    if (body.password !== undefined) {
      const pw = String(body.password);
      if (pw.length < 8) throw new AppError('Password must be at least 8 characters', 400, ErrorCodes.VALIDATION_ERROR);
      updates.push('password_hash = ?');
      params.push(await bcrypt.hash(pw, 10));
    }

    if (updates.length === 0) {
      throw new AppError('No fields to update', 400, ErrorCodes.VALIDATION_ERROR);
    }
    updates.push(`updated_at = ${sqlNow()}`);
    params.push(id);
    await execute(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`, params);

    const row = await queryOne<AdminRow>(
      `SELECT u.id, u.name, u.email, u.role, u.program_id, c.title AS program_name, u.created_at
       FROM users u LEFT JOIN courses c ON c.id = u.program_id WHERE u.id = ?`,
      [id]
    );
    res.json({ success: true, data: toAdminResponse(row!) });
  } catch (error) {
    next(error);
  }
}

/** DELETE /admins/:id — remove an admin account (cannot delete yourself). */
export async function deleteAdmin(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { id } = req.params;
    if (req.user?.userId === id) {
      throw new AppError('You cannot delete your own account', 400, ErrorCodes.VALIDATION_ERROR);
    }
    const existing = await queryOne<{ id: string }>('SELECT id FROM users WHERE id = ?', [id]);
    if (!existing) throw new AppError('Admin not found', 404, ErrorCodes.NOT_FOUND);
    await execute('DELETE FROM users WHERE id = ?', [id]);
    res.json({ success: true, message: 'Admin removed' });
  } catch (error) {
    next(error);
  }
}
