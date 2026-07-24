import { Router } from 'express';
import { listAdmins, createAdmin, updateAdmin, deleteAdmin } from '../controllers/adminsController.js';
import { authenticate, requireSuperAdmin } from '../middleware/auth.js';

const router = Router();

// Admin account visibility and management is Super Admin only.
router.use(authenticate);
router.use(requireSuperAdmin);

router.get('/', listAdmins);
router.post('/', createAdmin);
router.put('/:id', updateAdmin);
router.delete('/:id', deleteAdmin);

export default router;
