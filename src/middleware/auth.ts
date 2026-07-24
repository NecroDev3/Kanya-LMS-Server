import { Response, NextFunction } from 'express';
import { verifyToken } from '../config/jwt.js';
import { AuthRequest, ErrorCodes, UserRole } from '../types/index.js';

export function authenticate(req: AuthRequest, res: Response, next: NextFunction): void {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      res.status(401).json({
        success: false,
        error: {
          code: ErrorCodes.UNAUTHORIZED,
          message: 'Missing or invalid authorization header',
        },
      });
      return;
    }

    const token = authHeader.substring(7);

    try {
      req.user = verifyToken(token);
      next();
    } catch {
      res.status(401).json({
        success: false,
        error: {
          code: ErrorCodes.UNAUTHORIZED,
          message: 'Invalid or expired token',
        },
      });
    }
  } catch (error) {
    next(error);
  }
}

export function authorize(...roles: UserRole[]) {
  return (req: AuthRequest, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({
        success: false,
        error: {
          code: ErrorCodes.UNAUTHORIZED,
          message: 'Authentication required',
        },
      });
      return;
    }

    if (!roles.includes(req.user.role)) {
      res.status(403).json({
        success: false,
        error: {
          code: ErrorCodes.FORBIDDEN,
          message: 'You do not have permission to access this resource',
        },
      });
      return;
    }

    next();
  };
}

/** Convenience guard: only super admins may pass. */
export const requireSuperAdmin = authorize('super_admin');
