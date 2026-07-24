import jwt from 'jsonwebtoken';
import dotenv from 'dotenv';
import { JWTPayload } from '../types/index.js';

dotenv.config();

// JWT_SECRET is required in every real environment. The only exception is the
// automated test runner (NODE_ENV=test), which uses an ephemeral in-memory secret.
const isTest = process.env.NODE_ENV === 'test';
const configuredSecret = process.env.JWT_SECRET?.trim();

if (!configuredSecret && !isTest) {
  throw new Error(
    'JWT_SECRET environment variable is required. Set a strong, random secret before starting the server.'
  );
}

const JWT_SECRET = configuredSecret || 'test-only-ephemeral-secret';
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '24h';

export function generateToken(payload: JWTPayload): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN } as jwt.SignOptions);
}

export function verifyToken(token: string): JWTPayload {
  return jwt.verify(token, JWT_SECRET) as JWTPayload;
}

export function decodeToken(token: string): JWTPayload | null {
  try {
    return jwt.decode(token) as JWTPayload;
  } catch {
    return null;
  }
}

