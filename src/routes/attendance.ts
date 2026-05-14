import { Router } from 'express';
import {
  createSession,
  listSessions,
  getSession,
  markAttendance,
  deleteSession,
  myAttendance,
} from '../controllers/attendanceController.js';
import { authenticate } from '../middleware/auth.js';

const router = Router();

router.use(authenticate);

router.get('/my',      myAttendance);          // student: own history
router.get('/',        listSessions);           // admin: all | student: their courses
router.post('/',       createSession);          // admin only (enforced in controller)
router.get('/:id',     getSession);             // admin: session + records | student: session info
router.post('/:id/mark', markAttendance);       // student marks present
router.delete('/:id',  deleteSession);          // admin only

export default router;
