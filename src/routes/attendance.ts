import { Router } from 'express';
import {
  listRegisters,
  createRegister,
  downloadRegister,
  deleteRegister,
} from '../controllers/attendanceController.js';
import { authenticate, authorize, requireSuperAdmin } from '../middleware/auth.js';
import { uploadDocument } from '../utils/fileUpload.js';

const router = Router();

router.use(authenticate);
router.use(authorize('super_admin', 'admin'));

router.get('/', listRegisters);
router.post('/', uploadDocument.single('file'), createRegister);
router.get('/:id/download', downloadRegister);
router.delete('/:id', requireSuperAdmin, deleteRegister);

export default router;
