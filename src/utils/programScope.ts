import { AuthRequest, ErrorCodes } from '../types/index.js';
import { AppError } from '../middleware/errorHandler.js';

/**
 * Program-level access control helpers.
 *
 * The admin-only model has two roles:
 *  - super_admin: unrestricted, sees every program.
 *  - admin: scoped to exactly one program (users.program_id / JWT programId).
 *
 * All data-fetching and mutating queries MUST be scoped with these helpers so
 * an admin can never read or write another program's data (enforced server-side,
 * not just hidden in the UI).
 */

export function isSuperAdmin(req: AuthRequest): boolean {
  return req.user?.role === 'super_admin';
}

/** The admin's assigned program id, or null for super_admin. */
export function callerProgramId(req: AuthRequest): string | null {
  if (isSuperAdmin(req)) return null;
  return req.user?.programId ?? null;
}

/**
 * Returns a SQL fragment + params that scopes a query to the caller's program.
 * For super_admin this is a no-op (empty clause). For an admin it restricts to
 * `column = <their program>`. If an admin has no program assigned, it forces an
 * impossible match so they see nothing.
 *
 * @param column fully-qualified or bare column that holds the program id
 */
export function programFilter(
  req: AuthRequest,
  column: string
): { clause: string; params: unknown[] } {
  if (isSuperAdmin(req)) {
    return { clause: '', params: [] };
  }
  const programId = req.user?.programId;
  if (!programId) {
    // Admin with no assigned program: match nothing.
    return { clause: `${column} IS NULL AND 1 = 0`, params: [] };
  }
  return { clause: `${column} = ?`, params: [programId] };
}

/**
 * Throws 403 if an admin attempts to touch a program that is not theirs.
 * Super admins always pass. Use before returning/mutating a specific record so
 * direct URL/ID manipulation returns 403 instead of leaking data.
 */
export function assertProgramAccess(req: AuthRequest, programId: string | null | undefined): void {
  if (isSuperAdmin(req)) return;
  const mine = req.user?.programId ?? null;
  if (!mine || !programId || programId !== mine) {
    throw new AppError('You do not have access to this program', 403, ErrorCodes.FORBIDDEN);
  }
}

/**
 * Resolves the program id to use when an admin creates a record.
 * Admins can only create within their own program; super admins must specify one.
 */
export function resolveWritableProgramId(
  req: AuthRequest,
  requestedProgramId?: string | null
): string {
  if (isSuperAdmin(req)) {
    if (!requestedProgramId) {
      throw new AppError('programId is required', 400, ErrorCodes.VALIDATION_ERROR);
    }
    return requestedProgramId;
  }
  const mine = req.user?.programId ?? null;
  if (!mine) {
    throw new AppError('You are not assigned to a program', 403, ErrorCodes.FORBIDDEN);
  }
  // If the admin passed a program id, it must be their own.
  if (requestedProgramId && requestedProgramId !== mine) {
    throw new AppError('You do not have access to this program', 403, ErrorCodes.FORBIDDEN);
  }
  return mine;
}
