import { generateToken } from '../../config/jwt.js';
import type { JWTPayload, UserRole } from '../../types/index.js';

export function makeToken(overrides: {
  userId: string;
  email: string;
  role: UserRole;
  programId?: string | null;
}): string {
  const payload: JWTPayload = {
    userId: overrides.userId,
    email: overrides.email,
    role: overrides.role,
    programId: overrides.programId ?? null,
  };
  return generateToken(payload);
}
