import { Response, NextFunction } from 'express';
import { v4 as uuidv4 } from 'uuid';
import bcrypt from 'bcryptjs';
import { query, queryOne, execute } from '../config/database.js';
import { AuthRequest, Course, CourseSection, ErrorCodes, User } from '../types/index.js';
import { AppError } from '../middleware/errorHandler.js';
import { getDocumentFileUrl } from '../utils/fileUpload.js';
import { isSuperAdmin, assertProgramAccess } from '../utils/programScope.js';

/**
 * A "Program" is a row in the `courses` table. The physical table name is kept
 * to reuse existing scoping plumbing; the API is exposed under /programs.
 */

interface CourseRow {
  id: string;
  title: string;
  description: string | null;
  course_code: string;
  sections: string;
  archived?: number | boolean | null;
  archived_at?: string | null;
}

const COURSE_COLUMNS = 'id, title, description, course_code, sections, archived, archived_at';

function parseSections(sectionsJson: string): CourseSection[] {
  try {
    const parsed = JSON.parse(sectionsJson || '[]') as CourseSection[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function ensurePdfFileUrls(sections: CourseSection[]): CourseSection[] {
  return sections.map((sec) => ({
    ...sec,
    items: sec.items.map((item) => {
      if (item.type === 'pdf' && item.documentId && !item.fileUrl) {
        return { ...item, fileUrl: getDocumentFileUrl(item.documentId) };
      }
      return item;
    }),
  }));
}

function rowToCourse(row: CourseRow): Course {
  const sections = ensurePdfFileUrls(parseSections(row.sections));
  return {
    id: row.id,
    title: row.title,
    description: row.description ?? undefined,
    courseCode: row.course_code,
    sections,
    archived: Boolean(row.archived),
    archivedAt: row.archived_at ?? null,
  };
}

export async function getCourses(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    let rows: CourseRow[];
    if (isSuperAdmin(req)) {
      rows = await query<CourseRow>(
        `SELECT ${COURSE_COLUMNS} FROM courses ORDER BY archived, title`
      );
    } else {
      const programId = req.user?.programId;
      if (!programId) {
        rows = [];
      } else {
        rows = await query<CourseRow>(
          `SELECT ${COURSE_COLUMNS} FROM courses WHERE id = ? ORDER BY title`,
          [programId]
        );
      }
    }
    const courses = rows.map(rowToCourse);
    res.json({
      success: true,
      data: { courses, programs: courses },
      // Duplicated at top-level for older clients reading response.data.courses
      courses,
      programs: courses,
    });
  } catch (error) {
    next(error);
  }
}

export async function getCourse(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { id } = req.params;
    const row = await queryOne<CourseRow>(
      `SELECT ${COURSE_COLUMNS} FROM courses WHERE id = ?`,
      [id]
    );
    if (!row) {
      throw new AppError('Program not found', 404, ErrorCodes.NOT_FOUND);
    }
    // Direct-ID access outside an admin's program returns 403.
    assertProgramAccess(req, row.id);
    res.json({ success: true, data: rowToCourse(row) });
  } catch (error) {
    next(error);
  }
}

const COURSE_CODE_REGEX = /^[A-Z0-9]+(-[A-Z0-9]+)*$/i;

function normalizeCourseCode(v: string): string {
  return String(v).trim().toUpperCase();
}

function validateCourseForCreate(body: unknown): { course: Course; errors: Array<{ field: string; message: string }> } {
  const errors: Array<{ field: string; message: string }> = [];
  const o = body as Record<string, unknown>;
  const title = o?.title;
  const sections = o?.sections;
  const courseCodeRaw = o?.courseCode;

  if (title === undefined || title === null || String(title).trim() === '') {
    errors.push({ field: 'title', message: 'Title is required' });
  }
  if (courseCodeRaw === undefined || courseCodeRaw === null || String(courseCodeRaw).trim() === '') {
    errors.push({ field: 'courseCode', message: 'courseCode is required' });
  } else {
    const code = normalizeCourseCode(String(courseCodeRaw));
    if (!COURSE_CODE_REGEX.test(code)) {
      errors.push({ field: 'courseCode', message: 'courseCode must be alphanumeric and hyphens only (e.g. BLOCKCHAIN-101)' });
    }
  }
  if (sections !== undefined && !Array.isArray(sections)) {
    errors.push({ field: 'sections', message: 'sections must be an array' });
  }

  const sectionsArray = Array.isArray(sections) ? (sections as CourseSection[]) : [];
  const courseCode = courseCodeRaw != null ? normalizeCourseCode(String(courseCodeRaw)) : '';
  const course: Course = {
    id: (o?.id ? String(o.id).trim() : '') || uuidv4(),
    title: title != null ? String(title).trim() : '',
    description: o?.description != null ? String(o.description).trim() : undefined,
    courseCode,
    sections: sectionsArray,
  };
  return { course, errors };
}

export async function createCourse(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { course, errors } = validateCourseForCreate(req.body);
    if (errors.length > 0) {
      throw new AppError('Validation failed', 400, ErrorCodes.VALIDATION_ERROR, errors);
    }

    const existing = await queryOne<{ id: string }>('SELECT id FROM courses WHERE id = ?', [course.id]);
    if (existing) {
      throw new AppError('A program with this id already exists', 400, ErrorCodes.DUPLICATE_ENTRY);
    }
    const codeExists = await queryOne<{ id: string }>('SELECT id FROM courses WHERE course_code = ?', [course.courseCode]);
    if (codeExists) {
      throw new AppError('A program with this courseCode already exists', 400, ErrorCodes.DUPLICATE_ENTRY);
    }

    await execute(
      'INSERT INTO courses (id, title, description, course_code, sections) VALUES (?, ?, ?, ?, ?)',
      [course.id, course.title, course.description ?? null, course.courseCode, JSON.stringify(course.sections)]
    );

    const row = await queryOne<CourseRow>(`SELECT ${COURSE_COLUMNS} FROM courses WHERE id = ?`, [course.id]);
    if (!row) {
      throw new AppError('Failed to create program', 500, ErrorCodes.INTERNAL_ERROR);
    }

    res.status(201).json({ success: true, data: rowToCourse(row) });
  } catch (error) {
    next(error);
  }
}

export async function updateCourse(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { id } = req.params;
    const existing = await queryOne<CourseRow>(`SELECT ${COURSE_COLUMNS} FROM courses WHERE id = ?`, [id]);
    if (!existing) {
      throw new AppError('Program not found', 404, ErrorCodes.NOT_FOUND);
    }

    const o = (req.body || {}) as Record<string, unknown>;
    const errors: Array<{ field: string; message: string }> = [];
    if (o.title !== undefined && (o.title === null || String(o.title).trim() === '')) {
      errors.push({ field: 'title', message: 'Title cannot be empty' });
    }
    if (o.courseCode !== undefined && (o.courseCode === null || String(o.courseCode).trim() === '')) {
      errors.push({ field: 'courseCode', message: 'courseCode cannot be empty' });
    } else if (o.courseCode !== undefined) {
      const code = normalizeCourseCode(String(o.courseCode));
      if (!COURSE_CODE_REGEX.test(code)) {
        errors.push({ field: 'courseCode', message: 'courseCode must be alphanumeric and hyphens only' });
      }
    }
    if (o.sections !== undefined && !Array.isArray(o.sections)) {
      errors.push({ field: 'sections', message: 'sections must be an array' });
    }
    if (errors.length > 0) {
      throw new AppError('Validation failed', 400, ErrorCodes.VALIDATION_ERROR, errors);
    }

    const title = o.title !== undefined ? String(o.title).trim() : existing.title;
    const description = o.description !== undefined ? (o.description != null ? String(o.description).trim() : null) : existing.description;
    let courseCode = existing.course_code;
    if (o.courseCode !== undefined) {
      courseCode = normalizeCourseCode(String(o.courseCode));
      const codeExists = await queryOne<{ id: string }>('SELECT id FROM courses WHERE course_code = ? AND id != ?', [courseCode, id]);
      if (codeExists) {
        throw new AppError('A program with this courseCode already exists', 400, ErrorCodes.DUPLICATE_ENTRY);
      }
    }
    const sections = o.sections !== undefined ? (o.sections as CourseSection[]) : parseSections(existing.sections);

    await execute('UPDATE courses SET title = ?, description = ?, course_code = ?, sections = ? WHERE id = ?', [
      title,
      description ?? null,
      courseCode,
      JSON.stringify(sections),
      id,
    ]);

    const row = await queryOne<CourseRow>(`SELECT ${COURSE_COLUMNS} FROM courses WHERE id = ?`, [id]);
    res.json({ success: true, data: rowToCourse(row!) });
  } catch (error) {
    next(error);
  }
}

async function setArchived(req: AuthRequest, res: Response, archived: boolean): Promise<void> {
  const { id } = req.params;
  const existing = await queryOne<CourseRow>(`SELECT ${COURSE_COLUMNS} FROM courses WHERE id = ?`, [id]);
  if (!existing) {
    throw new AppError('Program not found', 404, ErrorCodes.NOT_FOUND);
  }
  await execute(
    'UPDATE courses SET archived = ?, archived_at = ? WHERE id = ?',
    [archived ? 1 : 0, archived ? new Date().toISOString() : null, id]
  );
  const row = await queryOne<CourseRow>(`SELECT ${COURSE_COLUMNS} FROM courses WHERE id = ?`, [id]);
  res.json({ success: true, data: rowToCourse(row!) });
}

export async function archiveCourse(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    await setArchived(req, res, true);
  } catch (error) {
    next(error);
  }
}

export async function unarchiveCourse(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    await setArchived(req, res, false);
  } catch (error) {
    next(error);
  }
}

export async function deleteCourse(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { id } = req.params;
    const password = (req.body as Record<string, unknown> | undefined)?.password;

    // Deleting a program is destructive and cascades to its attendance registers,
    // progress reports, etc. Require the acting super admin to re-enter their password.
    if (!password || typeof password !== 'string') {
      throw new AppError('Password confirmation is required to delete a program', 400, ErrorCodes.VALIDATION_ERROR);
    }

    const actingUser = await queryOne<User>('SELECT * FROM users WHERE id = ?', [req.user!.userId]);
    if (!actingUser) {
      throw new AppError('Authenticated user not found', 401, ErrorCodes.UNAUTHORIZED);
    }
    const passwordValid = await bcrypt.compare(password, actingUser.password_hash);
    if (!passwordValid) {
      throw new AppError('Incorrect password. Program was not deleted.', 403, ErrorCodes.INVALID_CREDENTIALS);
    }

    const existing = await queryOne<{ id: string }>('SELECT id FROM courses WHERE id = ?', [id]);
    if (!existing) {
      throw new AppError('Program not found', 404, ErrorCodes.NOT_FOUND);
    }

    // Detach any admins scoped to this program so we don't leave dangling program_id refs.
    await execute('UPDATE users SET program_id = NULL WHERE program_id = ?', [id]);
    await execute('DELETE FROM courses WHERE id = ?', [id]);
    res.json({ success: true });
  } catch (error) {
    next(error);
  }
}
