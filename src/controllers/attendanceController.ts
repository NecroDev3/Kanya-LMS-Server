import { Response, NextFunction } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { query, queryOne, execute, sqlNow } from '../config/database.js';
import {
  AuthRequest,
  ErrorCodes,
  AttendanceSession,
  AttendanceRecord,
  AttendanceSessionResponse,
  AttendanceRecordResponse,
} from '../types/index.js';
import { AppError } from '../middleware/errorHandler.js';

// ── Helpers ──────────────────────────────────────────────────────────────────

interface SessionRow extends AttendanceSession {
  course_name: string;
  creator_name: string | null;
  total_students: string | number;
  marked_count: string | number;
}

function toSessionResponse(row: SessionRow, markedByMe?: boolean): AttendanceSessionResponse {
  return {
    id: row.id,
    courseId: row.course_id,
    courseName: row.course_name,
    title: row.title,
    sessionDate: row.session_date,
    createdBy: row.creator_name,
    createdAt: row.created_at,
    totalStudents: Number(row.total_students),
    markedCount: Number(row.marked_count),
    markedByMe,
  };
}

// today's date as YYYY-MM-DD in local time
function todayDate(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// ── Admin: create session ─────────────────────────────────────────────────────

/** POST /attendance  (admin only) */
export async function createSession(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const adminId = req.user?.userId;
    if (!adminId) throw new AppError('Authentication required', 401, ErrorCodes.UNAUTHORIZED);
    if (req.user?.role !== 'admin') throw new AppError('Admin access required', 403, ErrorCodes.FORBIDDEN);

    const { courseId, title, sessionDate } = req.body;

    if (!courseId?.trim()) throw new AppError('courseId is required', 400, ErrorCodes.VALIDATION_ERROR);
    if (!title?.trim()) throw new AppError('title is required', 400, ErrorCodes.VALIDATION_ERROR);
    if (!sessionDate?.trim()) throw new AppError('sessionDate is required (YYYY-MM-DD)', 400, ErrorCodes.VALIDATION_ERROR);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(sessionDate.trim())) {
      throw new AppError('sessionDate must be in YYYY-MM-DD format', 400, ErrorCodes.VALIDATION_ERROR);
    }

    const course = await queryOne<{ id: string; title: string }>('SELECT id, title FROM courses WHERE id = ?', [courseId]);
    if (!course) throw new AppError('Course not found', 404, ErrorCodes.NOT_FOUND);

    const id = uuidv4();
    await execute(
      `INSERT INTO attendance_sessions (id, course_id, title, session_date, created_by)
       VALUES (?, ?, ?, ?, ?)`,
      [id, courseId.trim(), title.trim(), sessionDate.trim(), adminId]
    );

    const row = await queryOne<SessionRow>(SESSION_SELECT + ' WHERE s.id = ?', [id]);
    res.status(201).json({ success: true, data: toSessionResponse(row!) });
  } catch (err) { next(err); }
}

// ── List sessions ─────────────────────────────────────────────────────────────

/**
 * GET /attendance
 * Admin → all sessions (optional ?courseId= filter)
 * Student → sessions for their enrolled courses
 */
export async function listSessions(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const userId = req.user?.userId;
    if (!userId) throw new AppError('Authentication required', 401, ErrorCodes.UNAUTHORIZED);
    const isAdmin = req.user?.role === 'admin';

    let rows: SessionRow[];

    if (isAdmin) {
      const courseFilter = req.query.courseId as string | undefined;
      if (courseFilter) {
        rows = await query<SessionRow>(SESSION_SELECT + ' WHERE s.course_id = ? ORDER BY s.session_date DESC, s.created_at DESC', [courseFilter]);
      } else {
        rows = await query<SessionRow>(SESSION_SELECT + ' ORDER BY s.session_date DESC, s.created_at DESC');
      }
      res.json({ success: true, data: rows.map(r => toSessionResponse(r)) });
      return;
    }

    // Student: only sessions for courses they're enrolled in
    const studentRow = await queryOne<{ id: string }>('SELECT id FROM students WHERE user_id = ?', [userId]);
    if (!studentRow) { res.json({ success: true, data: [] }); return; }

    rows = await query<SessionRow>(
      SESSION_SELECT +
      ` JOIN user_course_codes ucc ON ucc.course_code = (SELECT course_code FROM courses WHERE id = s.course_id)
        WHERE ucc.user_id = ?
        ORDER BY s.session_date DESC, s.created_at DESC`,
      [userId]
    );

    // Attach markedByMe
    const marked = await query<{ session_id: string }>(
      'SELECT session_id FROM attendance_records WHERE student_id = ?',
      [studentRow.id]
    );
    const markedSet = new Set(marked.map(m => m.session_id));

    res.json({ success: true, data: rows.map(r => toSessionResponse(r, markedSet.has(r.id))) });
  } catch (err) { next(err); }
}

// ── Get single session + records (admin) / session info (student) ─────────────

/** GET /attendance/:id */
export async function getSession(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const userId = req.user?.userId;
    if (!userId) throw new AppError('Authentication required', 401, ErrorCodes.UNAUTHORIZED);
    const isAdmin = req.user?.role === 'admin';
    const { id } = req.params;

    const row = await queryOne<SessionRow>(SESSION_SELECT + ' WHERE s.id = ?', [id]);
    if (!row) throw new AppError('Attendance session not found', 404, ErrorCodes.NOT_FOUND);

    if (isAdmin) {
      const records = await query<AttendanceRecord & { student_name: string; enrollment_number: string }>(
        `SELECT ar.*, st.name AS student_name, st.enrollment_number
         FROM attendance_records ar
         JOIN students st ON st.id = ar.student_id
         WHERE ar.session_id = ?
         ORDER BY ar.marked_at ASC`,
        [id]
      );

      const recordResponses: AttendanceRecordResponse[] = records.map(r => ({
        id: r.id,
        studentId: r.student_id,
        studentName: r.student_name,
        enrollmentNumber: r.enrollment_number,
        markedAt: r.marked_at,
      }));

      res.json({ success: true, data: { session: toSessionResponse(row), records: recordResponses } });
      return;
    }

    // Student view
    const studentRow = await queryOne<{ id: string }>('SELECT id FROM students WHERE user_id = ?', [userId]);
    let markedByMe = false;
    if (studentRow) {
      const rec = await queryOne<{ id: string }>(
        'SELECT id FROM attendance_records WHERE session_id = ? AND student_id = ?',
        [id, studentRow.id]
      );
      markedByMe = Boolean(rec);
    }
    res.json({ success: true, data: toSessionResponse(row, markedByMe) });
  } catch (err) { next(err); }
}

// ── Student: mark attendance ──────────────────────────────────────────────────

/** POST /attendance/:id/mark */
export async function markAttendance(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const userId = req.user?.userId;
    if (!userId) throw new AppError('Authentication required', 401, ErrorCodes.UNAUTHORIZED);
    const { id } = req.params;

    const session = await queryOne<AttendanceSession>('SELECT * FROM attendance_sessions WHERE id = ?', [id]);
    if (!session) throw new AppError('Attendance session not found', 404, ErrorCodes.NOT_FOUND);

    // Must be today
    const today = todayDate();
    const sessionDay = session.session_date.slice(0, 10);
    if (sessionDay !== today) {
      throw new AppError(
        `Attendance can only be marked on ${sessionDay}`,
        403,
        ErrorCodes.FORBIDDEN
      );
    }

    const studentRow = await queryOne<{ id: string }>('SELECT id FROM students WHERE user_id = ?', [userId]);
    if (!studentRow) throw new AppError('Student profile not found', 403, ErrorCodes.FORBIDDEN);

    // Check student is enrolled in this course
    const enrolled = await queryOne<{ course_code: string }>(
      `SELECT ucc.course_code FROM user_course_codes ucc
       JOIN courses c ON c.course_code = ucc.course_code
       WHERE ucc.user_id = ? AND c.id = ?`,
      [userId, session.course_id]
    );
    if (!enrolled) throw new AppError('You are not enrolled in this course', 403, ErrorCodes.FORBIDDEN);

    // Check not already marked
    const existing = await queryOne<{ id: string }>(
      'SELECT id FROM attendance_records WHERE session_id = ? AND student_id = ?',
      [id, studentRow.id]
    );
    if (existing) throw new AppError('Attendance already marked', 400, ErrorCodes.DUPLICATE_ENTRY);

    const recordId = uuidv4();
    await execute(
      `INSERT INTO attendance_records (id, session_id, student_id, marked_at)
       VALUES (?, ?, ?, ${sqlNow()})`,
      [recordId, id, studentRow.id]
    );

    res.json({ success: true, message: 'Attendance marked successfully' });
  } catch (err) { next(err); }
}

// ── Admin: delete session ─────────────────────────────────────────────────────

/** DELETE /attendance/:id */
export async function deleteSession(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    if (req.user?.role !== 'admin') throw new AppError('Admin access required', 403, ErrorCodes.FORBIDDEN);
    const { id } = req.params;
    const session = await queryOne<{ id: string }>('SELECT id FROM attendance_sessions WHERE id = ?', [id]);
    if (!session) throw new AppError('Attendance session not found', 404, ErrorCodes.NOT_FOUND);
    await execute('DELETE FROM attendance_sessions WHERE id = ?', [id]);
    res.json({ success: true, message: 'Session deleted' });
  } catch (err) { next(err); }
}

// ── Student: own attendance history ──────────────────────────────────────────

/** GET /attendance/my  — student's full history */
export async function myAttendance(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const userId = req.user?.userId;
    if (!userId) throw new AppError('Authentication required', 401, ErrorCodes.UNAUTHORIZED);

    const studentRow = await queryOne<{ id: string }>('SELECT id FROM students WHERE user_id = ?', [userId]);
    if (!studentRow) { res.json({ success: true, data: [] }); return; }

    const rows = await query<SessionRow & { marked_at: string }>(
      SESSION_SELECT +
      ` JOIN attendance_records ar ON ar.session_id = s.id AND ar.student_id = ?
        ORDER BY s.session_date DESC`,
      [studentRow.id]
    );

    res.json({ success: true, data: rows.map(r => toSessionResponse(r, true)) });
  } catch (err) { next(err); }
}

// ── Admin: export session as CSV ──────────────────────────────────────────────

/** GET /attendance/:id/export  (admin only) */
export async function exportSession(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    if (req.user?.role !== 'admin') throw new AppError('Admin access required', 403, ErrorCodes.FORBIDDEN);
    const { id } = req.params;

    const session = await queryOne<AttendanceSession & { course_name: string; course_code: string }>(
      `SELECT s.*, c.title AS course_name, c.course_code
       FROM attendance_sessions s
       JOIN courses c ON c.id = s.course_id
       WHERE s.id = ?`,
      [id]
    );
    if (!session) throw new AppError('Attendance session not found', 404, ErrorCodes.NOT_FOUND);

    // All students enrolled in this course
    type EnrolledStudent = {
      student_id: string;
      name: string;
      email: string;
      enrollment_number: string;
      department: string | null;
    };
    const enrolled = await query<EnrolledStudent>(
      `SELECT st.id AS student_id, st.name, st.email, st.enrollment_number, st.department
       FROM students st
       JOIN users u ON u.id = st.user_id
       JOIN user_course_codes ucc ON ucc.user_id = u.id
       JOIN courses c ON c.course_code = ucc.course_code
       WHERE c.id = ?
       ORDER BY st.name ASC`,
      [session.course_id]
    );

    // Attendance records for this session
    const records = await query<{ student_id: string; marked_at: string }>(
      'SELECT student_id, marked_at FROM attendance_records WHERE session_id = ?',
      [id]
    );
    const markedMap = new Map(records.map(r => [r.student_id, r.marked_at]));

    // Build CSV
    const dateStr = session.session_date.slice(0, 10);
    const csvLines: string[] = [
      // Header metadata (like the register form)
      `"ATTENDANCE REGISTER"`,
      `"Date:","${dateStr}"`,
      `"Course:","${session.course_name}"`,
      `"Session:","${session.title}"`,
      ``,
      // Column headers
      `"No.","First Name","Last Name","Enrollment Number","Email","Department","Status","Time Marked"`,
    ];

    enrolled.forEach((s, idx) => {
      const nameParts = s.name.trim().split(/\s+/);
      const lastName = nameParts.length > 1 ? nameParts.pop()! : '';
      const firstName = nameParts.join(' ');
      const markedAt = markedMap.get(s.student_id);
      const status = markedAt ? 'Present' : 'Absent';
      const timeMarked = markedAt
        ? new Date(markedAt).toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit' })
        : '';
      csvLines.push(
        `"${idx + 1}","${firstName}","${lastName}","${s.enrollment_number}","${s.email}","${s.department ?? ''}","${status}","${timeMarked}"`
      );
    });

    const csv = csvLines.join('\n');
    const filename = `attendance_${dateStr}_${session.course_name.replace(/\s+/g, '_')}.csv`;

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send('\uFEFF' + csv); // BOM for Excel compatibility
  } catch (err) { next(err); }
}

// ── Shared SELECT ─────────────────────────────────────────────────────────────

const SESSION_SELECT = `
  SELECT
    s.*,
    c.title AS course_name,
    u.name  AS creator_name,
    (SELECT COUNT(*) FROM user_course_codes ucc2 WHERE ucc2.course_code = (SELECT course_code FROM courses WHERE id = s.course_id)) AS total_students,
    (SELECT COUNT(*) FROM attendance_records ar2 WHERE ar2.session_id = s.id) AS marked_count
  FROM attendance_sessions s
  JOIN courses c ON c.id = s.course_id
  LEFT JOIN users u ON u.id = s.created_by
`;
