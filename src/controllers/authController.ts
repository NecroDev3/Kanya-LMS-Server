import { Response, NextFunction } from 'express';
import bcrypt from 'bcryptjs';
import { OAuth2Client } from 'google-auth-library';
import { v4 as uuidv4 } from 'uuid';
import { query, queryOne, execute } from '../config/database.js';
import { generateToken } from '../config/jwt.js';
import { AuthRequest, User, ErrorCodes, Student } from '../types/index.js';
import { AppError } from '../middleware/errorHandler.js';

const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

function getUserCourseCodes(userId: string): string[] {
  try {
    const rows = query<{ course_code: string }>(
      'SELECT course_code FROM user_course_codes WHERE user_id = ? ORDER BY course_code',
      [userId]
    );
    return rows.map((r) => r.course_code);
  } catch (e: unknown) {
    const err = e as { code?: string; message?: string };
    if (err?.code === 'SQLITE_ERROR' && err?.message?.includes('user_course_codes')) return [];
    throw e;
  }
}

export async function login(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { email, password } = req.body;

    // Validate input
    if (!email || !password) {
      throw new AppError('Email and password are required', 400, ErrorCodes.VALIDATION_ERROR);
    }

    // Find user by email
    const user = queryOne<User>(
      'SELECT * FROM users WHERE email = ?',
      [email.toLowerCase()]
    );

    if (!user) {
      throw new AppError('Invalid email or password', 401, ErrorCodes.INVALID_CREDENTIALS);
    }

    // Verify password
    const isValidPassword = await bcrypt.compare(password, user.password_hash);
    if (!isValidPassword) {
      throw new AppError('Invalid email or password', 401, ErrorCodes.INVALID_CREDENTIALS);
    }

    // Get studentId if user is a student
    let studentId: string | undefined;
    if (user.role === 'student') {
      const student = queryOne<Student>(
        'SELECT id FROM students WHERE user_id = ?',
        [user.id]
      );
      studentId = student?.id;
    }

    // Generate JWT token
    const token = generateToken({
      userId: user.id,
      email: user.email,
      role: user.role,
      studentId,
    });

    res.json({
      success: true,
      data: {
        token,
        user: {
          id: user.id,
          name: user.name,
          email: user.email,
          role: user.role,
          courseCodes: getUserCourseCodes(user.id),
        },
      },
    });
  } catch (error) {
    next(error);
  }
}

export async function googleLogin(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { id_token } = req.body;
    if (!id_token) {
      throw new AppError('id_token is required', 400, ErrorCodes.VALIDATION_ERROR);
    }

    const clientId = process.env.GOOGLE_CLIENT_ID;
    if (!clientId) {
      throw new AppError('Google sign-in is not configured', 500, ErrorCodes.INTERNAL_ERROR);
    }

    const ticket = await googleClient.verifyIdToken({
      idToken: id_token,
      audience: clientId,
    });
    const payload = ticket.getPayload();
    if (!payload?.email) {
      throw new AppError('Invalid Google token', 401, ErrorCodes.INVALID_CREDENTIALS);
    }

    const email = payload.email.toLowerCase();
    const name = (payload.name || payload.email.split('@')[0] || 'User').trim();

    let user = queryOne<User>('SELECT * FROM users WHERE email = ?', [email]);
    if (!user) {
      const id = uuidv4();
      execute(
        'INSERT INTO users (id, name, email, password_hash, role) VALUES (?, ?, ?, ?, ?)',
        [id, name, email, '', 'student']
      );
      user = queryOne<User>('SELECT * FROM users WHERE id = ?', [id]);
    }

    if (!user) {
      throw new AppError('Could not find or create user', 500, ErrorCodes.INTERNAL_ERROR);
    }

    let studentId: string | undefined;
    if (user.role === 'student') {
      const student = queryOne<Student>('SELECT id FROM students WHERE user_id = ?', [user.id]);
      studentId = student?.id;
    }

    const token = generateToken({
      userId: user.id,
      email: user.email,
      role: user.role,
      studentId,
    });

    res.json({
      success: true,
      data: {
        token,
        user: {
          id: user.id,
          name: user.name,
          email: user.email,
          role: user.role,
          courseCodes: getUserCourseCodes(user.id),
        },
      },
    });
  } catch (error) {
    next(error);
  }
}

export async function logout(_req: AuthRequest, res: Response): Promise<void> {
  // For stateless JWT, logout is handled client-side
  res.json({
    success: true,
    message: 'Logged out successfully',
  });
}

export async function getMe(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.user) {
      throw new AppError('Authentication required', 401, ErrorCodes.UNAUTHORIZED);
    }

    const user = queryOne<User>(
      'SELECT id, name, email, role FROM users WHERE id = ?',
      [req.user.userId]
    );

    if (!user) {
      throw new AppError('User not found', 404, ErrorCodes.NOT_FOUND);
    }

    res.json({
      success: true,
      data: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        courseCodes: getUserCourseCodes(user.id),
      },
    });
  } catch (error) {
    next(error);
  }
}

// Helper function to create a user (for seeding/registration)
export async function createUser(
  name: string, 
  email: string, 
  password: string, 
  role: 'student' | 'admin'
): Promise<User> {
  const id = uuidv4();
  const passwordHash = await bcrypt.hash(password, 10);
  
  const stmt = `INSERT INTO users (id, name, email, password_hash, role) VALUES (?, ?, ?, ?, ?)`;
  query(stmt, [id, name, email.toLowerCase(), passwordHash, role]);

  const user = queryOne<User>('SELECT * FROM users WHERE id = ?', [id]);
  if (!user) {
    throw new Error('Failed to create user');
  }

  return user;
}
