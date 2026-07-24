import { Router } from 'express';
import { getDashboard } from '../controllers/analyticsController.js';
import { authenticate, authorize } from '../middleware/auth.js';

const router = Router();

// All analytics routes require an authenticated admin.
router.use(authenticate);
router.use(authorize('super_admin', 'admin'));

// GET /analytics/dashboard - Get dashboard statistics
router.get('/dashboard', getDashboard);

export default router;

