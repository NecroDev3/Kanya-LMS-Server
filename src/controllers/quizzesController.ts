import { Response, NextFunction } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { query, queryOne, execute, sqlNow } from '../config/database.js';
import { AuthRequest, ErrorCodes } from '../types/index.js';
import { AppError } from '../middleware/errorHandler.js';
import { programFilter, assertProgramAccess, resolveWritableProgramId } from '../utils/programScope.js';

/**
 * "Questionnaires" are stored in the `quizzes` table. A questionnaire belongs to
 * a program (quizzes.course_id) and can be assigned to individual students in
 * that program via questionnaire_assignments.
 */

interface QuizQuestion {
  id: string;
  type: string;
  question: string;
  options?: string[];
  correctIndex?: number;
  correctAnswer?: string;
  order: number;
  information?: string;
}

interface QuizRow {
  id: string;
  title: string;
  description: string | null;
  information?: string | null;
  course_id: string | null;
  passing_score: number;
  questions: string;
  created_at: string;
  updated_at: string;
}

function toISO(ts: string | null | undefined): string {
  if (ts == null) return new Date().toISOString();
  const d = new Date(ts);
  return isNaN(d.getTime()) ? ts : d.toISOString();
}

function parseQuestions(json: string): QuizQuestion[] {
  try {
    const p = JSON.parse(json || '[]') as unknown;
    return Array.isArray(p) ? (p as QuizQuestion[]) : [];
  } catch {
    return [];
  }
}

function parseQuizIdParam(raw: string | undefined): string {
  const id = raw != null ? String(raw).trim() : '';
  if (!id) {
    throw new AppError('Questionnaire id is required', 400, ErrorCodes.VALIDATION_ERROR);
  }
  return id;
}

function rowToQuiz(row: QuizRow) {
  return {
    id: row.id,
    title: row.title,
    description: row.description ?? undefined,
    information:
      row.information != null && String(row.information).trim() !== ''
        ? String(row.information).trim()
        : undefined,
    courseId: row.course_id ?? undefined,
    programId: row.course_id ?? undefined,
    passingScore: row.passing_score,
    questions: parseQuestions(row.questions),
    createdAt: toISO(row.created_at),
    updatedAt: toISO(row.updated_at),
  };
}

function validateQuestions(questions: unknown): QuizQuestion[] {
  if (!Array.isArray(questions)) {
    throw new AppError('questions must be an array', 400, ErrorCodes.VALIDATION_ERROR);
  }
  const out: QuizQuestion[] = [];
  for (const q of questions) {
    if (!q || typeof q !== 'object') continue;
    const o = q as Record<string, unknown>;
    if (typeof o.id !== 'string' || typeof o.question !== 'string' || typeof o.order !== 'number') {
      throw new AppError('Each question needs id, question, and order', 400, ErrorCodes.VALIDATION_ERROR);
    }
    const infoRaw = o.information;
    const information =
      typeof infoRaw === 'string' && infoRaw.trim() !== '' ? infoRaw.trim() : undefined;
    out.push({
      id: o.id,
      type: typeof o.type === 'string' ? o.type : 'short_answer',
      question: o.question,
      options: Array.isArray(o.options) ? o.options.filter((x): x is string => typeof x === 'string') : undefined,
      correctIndex: typeof o.correctIndex === 'number' ? o.correctIndex : undefined,
      correctAnswer: typeof o.correctAnswer === 'string' ? o.correctAnswer : undefined,
      order: o.order,
      ...(information ? { information } : {}),
    });
  }
  return out;
}

export async function listQuizzes(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const scope = programFilter(req, 'course_id');
    const where = scope.clause ? `WHERE ${scope.clause}` : '';
    const rows = await query<QuizRow>(`SELECT * FROM quizzes ${where} ORDER BY updated_at DESC`, scope.params);
    res.json({
      success: true,
      data: { quizzes: rows.map(rowToQuiz), questionnaires: rows.map(rowToQuiz) },
    });
  } catch (error) {
    next(error);
  }
}

export async function getQuiz(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const id = parseQuizIdParam(req.params.id);
    const row = await queryOne<QuizRow>('SELECT * FROM quizzes WHERE id = ?', [id]);
    if (!row) {
      throw new AppError('Questionnaire not found', 404, ErrorCodes.NOT_FOUND);
    }
    assertProgramAccess(req, row.course_id ?? null);
    res.json({ success: true, data: rowToQuiz(row) });
  } catch (error) {
    next(error);
  }
}

export async function createQuiz(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const body = (req.body || {}) as Record<string, unknown>;
    const title = body.title != null ? String(body.title).trim() : '';
    if (!title) {
      throw new AppError('title is required', 400, ErrorCodes.VALIDATION_ERROR);
    }
    const questions = validateQuestions(body.questions);
    const description =
      body.description !== undefined && body.description !== null ? String(body.description).trim() : null;
    const information =
      body.information !== undefined && body.information !== null && String(body.information).trim() !== ''
        ? String(body.information).trim()
        : null;

    // A questionnaire must belong to a program (scoped for admins).
    const requestedProgram =
      (body.programId ?? body.courseId) != null && String(body.programId ?? body.courseId).trim() !== ''
        ? String(body.programId ?? body.courseId).trim()
        : undefined;
    const courseId = resolveWritableProgramId(req, requestedProgram);

    const passingScore =
      typeof body.passingScore === 'number' && body.passingScore >= 0 && body.passingScore <= 100
        ? Math.floor(body.passingScore)
        : 70;
    const id =
      body.id !== undefined && body.id !== null && String(body.id).trim() !== ''
        ? String(body.id).trim()
        : uuidv4();

    const existing = await queryOne<{ id: string }>('SELECT id FROM quizzes WHERE id = ?', [id]);
    if (existing) {
      throw new AppError('A questionnaire with this id already exists', 400, ErrorCodes.DUPLICATE_ENTRY);
    }

    await execute(
      `INSERT INTO quizzes (id, title, description, information, course_id, passing_score, questions)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [id, title, description, information, courseId, passingScore, JSON.stringify(questions)]
    );

    const row = await queryOne<QuizRow>('SELECT * FROM quizzes WHERE id = ?', [id]);
    if (!row) {
      throw new AppError('Failed to create questionnaire', 500, ErrorCodes.INTERNAL_ERROR);
    }

    res.status(201).json({ success: true, data: rowToQuiz(row) });
  } catch (error) {
    next(error);
  }
}

export async function updateQuiz(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const id = parseQuizIdParam(req.params.id);
    const existing = await queryOne<QuizRow>('SELECT * FROM quizzes WHERE id = ?', [id]);
    if (!existing) {
      throw new AppError('Questionnaire not found', 404, ErrorCodes.NOT_FOUND);
    }
    assertProgramAccess(req, existing.course_id ?? null);

    const body = (req.body || {}) as Record<string, unknown>;
    const updates: string[] = [];
    const params: unknown[] = [];

    if (body.title !== undefined) {
      const t = String(body.title).trim();
      if (!t) {
        throw new AppError('title cannot be empty', 400, ErrorCodes.VALIDATION_ERROR);
      }
      updates.push('title = ?');
      params.push(t);
    }
    if (body.description !== undefined) {
      updates.push('description = ?');
      params.push(body.description != null ? String(body.description).trim() : null);
    }
    if (body.information !== undefined) {
      updates.push('information = ?');
      params.push(
        body.information != null && String(body.information).trim() !== ''
          ? String(body.information).trim()
          : null
      );
    }
    if (body.passingScore !== undefined) {
      const ps = body.passingScore;
      if (typeof ps !== 'number' || ps < 0 || ps > 100) {
        throw new AppError('passingScore must be between 0 and 100', 400, ErrorCodes.VALIDATION_ERROR);
      }
      updates.push('passing_score = ?');
      params.push(Math.floor(ps));
    }
    if (body.questions !== undefined) {
      const questions = validateQuestions(body.questions);
      updates.push('questions = ?');
      params.push(JSON.stringify(questions));
    }

    if (updates.length === 0) {
      res.json({ success: true, data: rowToQuiz(existing) });
      return;
    }

    updates.push(`updated_at = ${sqlNow()}`);
    params.push(id);
    await execute(`UPDATE quizzes SET ${updates.join(', ')} WHERE id = ?`, params);

    const row = await queryOne<QuizRow>('SELECT * FROM quizzes WHERE id = ?', [id]);
    res.json({ success: true, data: rowToQuiz(row!) });
  } catch (error) {
    next(error);
  }
}

export async function deleteQuiz(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const id = parseQuizIdParam(req.params.id);
    const existing = await queryOne<{ id: string }>('SELECT id FROM quizzes WHERE id = ?', [id]);
    if (!existing) {
      throw new AppError('Questionnaire not found', 404, ErrorCodes.NOT_FOUND);
    }
    await execute('DELETE FROM quizzes WHERE id = ?', [id]);
    res.json({ success: true });
  } catch (error) {
    next(error);
  }
}

// ── Assignments (link a questionnaire to specific students in its program) ─────

export async function getAssignments(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const quizId = parseQuizIdParam(req.params.id);
    const quiz = await queryOne<QuizRow>('SELECT * FROM quizzes WHERE id = ?', [quizId]);
    if (!quiz) throw new AppError('Questionnaire not found', 404, ErrorCodes.NOT_FOUND);
    assertProgramAccess(req, quiz.course_id ?? null);

    const rows = await query<{ id: string; student_id: string; assigned_at: string; student_name: string; enrollment_number: string }>(
      `SELECT qa.id, qa.student_id, qa.assigned_at, st.name AS student_name, st.enrollment_number
       FROM questionnaire_assignments qa
       JOIN students st ON st.id = qa.student_id
       WHERE qa.quiz_id = ?
       ORDER BY st.name ASC`,
      [quizId]
    );

    res.json({
      success: true,
      data: {
        assignments: rows.map((r) => ({
          id: r.id,
          studentId: r.student_id,
          studentName: r.student_name,
          enrollmentNumber: r.enrollment_number,
          assignedAt: toISO(r.assigned_at),
        })),
      },
    });
  } catch (error) {
    next(error);
  }
}

export async function assignStudents(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const quizId = parseQuizIdParam(req.params.id);
    const assignerId = req.user?.userId ?? null;
    const quiz = await queryOne<QuizRow>('SELECT * FROM quizzes WHERE id = ?', [quizId]);
    if (!quiz) throw new AppError('Questionnaire not found', 404, ErrorCodes.NOT_FOUND);
    assertProgramAccess(req, quiz.course_id ?? null);

    const body = (req.body || {}) as Record<string, unknown>;
    const rawIds = Array.isArray(body.studentIds)
      ? body.studentIds
      : body.studentId != null
        ? [body.studentId]
        : [];
    const studentIds = rawIds.filter((x): x is string => typeof x === 'string' && x.trim() !== '').map((s) => s.trim());
    if (studentIds.length === 0) {
      throw new AppError('studentIds is required', 400, ErrorCodes.VALIDATION_ERROR);
    }

    let assigned = 0;
    const skipped: Array<{ studentId: string; reason: string }> = [];
    for (const studentId of studentIds) {
      // Enforce the Questionnaires -> Students dependency: only students in the
      // same program as the questionnaire can be assigned.
      const student = await queryOne<{ id: string; program_id: string | null }>(
        'SELECT id, program_id FROM students WHERE id = ?',
        [studentId]
      );
      if (!student) {
        skipped.push({ studentId, reason: 'Student not found' });
        continue;
      }
      if ((student.program_id ?? null) !== (quiz.course_id ?? null)) {
        skipped.push({ studentId, reason: 'Student is not in this questionnaire\'s program' });
        continue;
      }
      const exists = await queryOne<{ id: string }>(
        'SELECT id FROM questionnaire_assignments WHERE quiz_id = ? AND student_id = ?',
        [quizId, studentId]
      );
      if (exists) {
        skipped.push({ studentId, reason: 'Already assigned' });
        continue;
      }
      await execute(
        `INSERT INTO questionnaire_assignments (id, quiz_id, student_id, assigned_by_id, assigned_at)
         VALUES (?, ?, ?, ?, ${sqlNow()})`,
        [uuidv4(), quizId, studentId, assignerId]
      );
      assigned++;
    }

    res.status(201).json({ success: true, data: { assigned, skipped } });
  } catch (error) {
    next(error);
  }
}

export async function removeAssignment(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const quizId = parseQuizIdParam(req.params.id);
    const studentId = req.params.studentId?.trim();
    if (!studentId) throw new AppError('studentId is required', 400, ErrorCodes.VALIDATION_ERROR);

    const quiz = await queryOne<QuizRow>('SELECT * FROM quizzes WHERE id = ?', [quizId]);
    if (!quiz) throw new AppError('Questionnaire not found', 404, ErrorCodes.NOT_FOUND);
    assertProgramAccess(req, quiz.course_id ?? null);

    await execute('DELETE FROM questionnaire_assignments WHERE quiz_id = ? AND student_id = ?', [quizId, studentId]);
    res.json({ success: true });
  } catch (error) {
    next(error);
  }
}
