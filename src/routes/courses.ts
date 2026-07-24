import { Router } from 'express';
import {
  getCourses,
  getCourse,
  createCourse,
  updateCourse,
  deleteCourse,
  archiveCourse,
  unarchiveCourse,
} from '../controllers/coursesController.js';
import { authenticate, authorize, requireSuperAdmin } from '../middleware/auth.js';

const router = Router();

router.use(authenticate);
router.use(authorize('super_admin', 'admin'));

// Read: admins see only their program; super admins see all.
router.get('/', getCourses);
router.get('/:id', getCourse);

// Program lifecycle is Super Admin only.
router.post('/', requireSuperAdmin, createCourse);
router.put('/:id', requireSuperAdmin, updateCourse);
router.post('/:id/archive', requireSuperAdmin, archiveCourse);
router.post('/:id/unarchive', requireSuperAdmin, unarchiveCourse);
router.delete('/:id', requireSuperAdmin, deleteCourse);

export default router;
