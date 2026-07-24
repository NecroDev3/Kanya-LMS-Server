import { Router } from 'express';
import {
  listProgressReports,
  createProgressReport,
  downloadProgressReport,
  deleteProgressReport,
} from '../controllers/progressReportsController.js';
import { authenticate, authorize, requireSuperAdmin } from '../middleware/auth.js';
import { uploadDocument } from '../utils/fileUpload.js';

const router = Router();

router.use(authenticate);
router.use(authorize('super_admin', 'admin'));

router.get('/', listProgressReports);
router.post('/', uploadDocument.single('file'), createProgressReport);
router.get('/:id/download', downloadProgressReport);
router.delete('/:id', requireSuperAdmin, deleteProgressReport);

export default router;
