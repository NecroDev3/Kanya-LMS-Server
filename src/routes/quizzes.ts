import { Router } from 'express';
import {
  listQuizzes,
  getQuiz,
  createQuiz,
  updateQuiz,
  deleteQuiz,
  getAssignments,
  assignStudents,
  removeAssignment,
} from '../controllers/quizzesController.js';
import { authenticate, authorize, requireSuperAdmin } from '../middleware/auth.js';

const router = Router();

router.use(authenticate);
router.use(authorize('super_admin', 'admin'));

router.get('/', listQuizzes);
router.post('/', createQuiz);
router.get('/:id', getQuiz);
router.put('/:id', updateQuiz);
router.delete('/:id', requireSuperAdmin, deleteQuiz);

// Assignments: link a questionnaire to specific students in its program.
router.get('/:id/assignments', getAssignments);
router.post('/:id/assignments', assignStudents);
router.delete('/:id/assignments/:studentId', removeAssignment);

export default router;
