import { Router } from 'express';
import { login, logout, getMe } from '../controllers/authController.js';
import { authenticate } from '../middleware/auth.js';

const router = Router();

// POST /auth/login - Authenticate with email + password
router.post('/login', login);

// POST /auth/logout - Logout (client discards token)
router.post('/logout', authenticate, logout);

// GET /auth/me - Current user info
router.get('/me', authenticate, getMe);

export default router;
