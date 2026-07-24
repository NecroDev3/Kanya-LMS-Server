import { Router } from 'express';
import { 
  getStudents, 
  getStudent, 
  createStudent, 
  updateStudent, 
  deleteStudent,
  importStudents,
} from '../controllers/studentsController.js';
import { authenticate, authorize, requireSuperAdmin } from '../middleware/auth.js';

const router = Router();

// All student routes require an authenticated admin (super_admin or admin).
router.use(authenticate);
router.use(authorize('super_admin', 'admin'));

// GET /students - Get all students with pagination/filtering
router.get('/', getStudents);

// GET /students/:id - Get single student
router.get('/:id', getStudent);

// POST /students - Create new student
router.post('/', createStudent);

// POST /students/import - Bulk CSV import
router.post('/import', importStudents);

// PUT /students/:id - Update student
router.put('/:id', updateStudent);

// DELETE /students/:id - Hard delete (Super Admin only). Admins archive instead.
router.delete('/:id', requireSuperAdmin, deleteStudent);

export default router;

