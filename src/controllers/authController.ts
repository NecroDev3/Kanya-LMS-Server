import { Response, NextFunction } from 'express';
import bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';
import { queryOne, execute } from '../config/database.js';
import { generateToken } from '../config/jwt.js';
import { AuthRequest, User, UserRole, ErrorCodes } from '../types/index.js';
import { AppError } from '../middleware/errorHandler.js';

function toUserResponse(user: Pick<User, 'id' | 'name' | 'email' | 'role' | 'program_id'>) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    programId: user.program_id ?? null,
  };
}

export async function login(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      throw new AppError('Email and password are required', 400, ErrorCodes.VALIDATION_ERROR);
    }

    const user = await queryOne<User>('SELECT * FROM users WHERE email = ?', [email.toLowerCase()]);
    if (!user) {
      throw new AppError('Invalid email or password', 401, ErrorCodes.INVALID_CREDENTIALS);
    }

    const isValidPassword = await bcrypt.compare(password, user.password_hash);
    if (!isValidPassword) {
      throw new AppError('Invalid email or password', 401, ErrorCodes.INVALID_CREDENTIALS);
    }

    const token = generateToken({
      userId: user.id,
      email: user.email,
      role: user.role,
      programId: user.program_id ?? null,
    });

    res.json({
      success: true,
      data: {
        token,
        user: toUserResponse(user),
      },
    });
  } catch (error) {
    next(error);
  }
}

export async function logout(_req: AuthRequest, res: Response): Promise<void> {
  // Stateless JWT: logout is handled client-side by discarding the token.
  res.json({ success: true, message: 'Logged out successfully' });
}

export async function getMe(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.user) {
      throw new AppError('Authentication required', 401, ErrorCodes.UNAUTHORIZED);
    }

    const user = await queryOne<User>(
      'SELECT id, name, email, role, program_id FROM users WHERE id = ?',
      [req.user.userId]
    );

    if (!user) {
      throw new AppError('User not found', 404, ErrorCodes.NOT_FOUND);
    }

    res.json({ success: true, data: toUserResponse(user) });
  } catch (error) {
    next(error);
  }
}

// Helper to create a user (seeding / super-admin-driven account creation).
export async function createUser(
  name: string,
  email: string,
  password: string,
  role: UserRole,
  programId: string | null = null
): Promise<User> {
  const id = uuidv4();
  const passwordHash = await bcrypt.hash(password, 10);

  await execute(
    `INSERT INTO users (id, name, email, password_hash, role, program_id) VALUES (?, ?, ?, ?, ?, ?)`,
    [id, name, email.toLowerCase(), passwordHash, role, role === 'admin' ? programId : null]
  );

  const user = await queryOne<User>('SELECT * FROM users WHERE id = ?', [id]);
  if (!user) {
    throw new Error('Failed to create user');
  }

  return user;
}
