import { Response, NextFunction } from 'express';
import fs from 'fs';
import { v4 as uuidv4 } from 'uuid';
import { query, queryOne, execute } from '../config/database.js';
import { AuthRequest, ErrorCodes, AttendanceRegister, AttendanceRegisterResponse } from '../types/index.js';
import { AppError } from '../middleware/errorHandler.js';
import { deleteFile, resolveUploadPath, storeUploadedFile } from '../utils/fileUpload.js';
import { isR2Enabled, deleteFromR2, streamFromR2 } from '../config/storage.js';
import { programFilter, assertProgramAccess, resolveWritableProgramId } from '../utils/programScope.js';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function fileUrl(id: string): string {
  return `/api/v1/attendance/${id}/download`;
}

function toResponse(r: AttendanceRegister): AttendanceRegisterResponse {
  return {
    id: r.id,
    programId: r.program_id,
    programName: r.program_name,
    title: r.title,
    dateFrom: r.date_from,
    dateTo: r.date_to,
    fileName: r.file_name,
    fileSize: r.file_size,
    fileUrl: fileUrl(r.id),
    fileMimeType: r.file_mime_type,
    uploadedBy: r.uploader_name,
    uploadedById: r.uploaded_by_id,
    uploadedAt: r.uploaded_at as unknown as string,
  };
}

const REGISTER_SELECT = `
  SELECT ar.*, c.title AS program_name, u.name AS uploader_name
  FROM attendance_registers ar
  JOIN courses c ON c.id = ar.program_id
  LEFT JOIN users u ON u.id = ar.uploaded_by_id
`;

// ── List registers (program-scoped) ───────────────────────────────────────────
export async function listRegisters(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const conditions: string[] = [];
    const params: unknown[] = [];

    const scope = programFilter(req, 'ar.program_id');
    if (scope.clause) {
      conditions.push(scope.clause);
      params.push(...scope.params);
    }

    const courseFilter = (req.query.courseId as string | undefined) || (req.query.programId as string | undefined);
    if (courseFilter) {
      assertProgramAccess(req, courseFilter);
      conditions.push('ar.program_id = ?');
      params.push(courseFilter);
    }

    const where = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : '';
    const rows = await query<AttendanceRegister>(
      REGISTER_SELECT + ` ${where} ORDER BY ar.date_from DESC, ar.uploaded_at DESC`,
      params
    );
    res.json({ success: true, data: rows.map(toResponse) });
  } catch (err) {
    next(err);
  }
}

// ── Upload a register (title, date range, file) ───────────────────────────────
export async function createRegister(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const adminId = req.user?.userId;
    const { title, dateFrom, dateTo, courseId, programId } = req.body;
    const file = req.file;

    const errors: Array<{ field: string; message: string }> = [];
    if (!title || String(title).trim().length === 0) errors.push({ field: 'title', message: 'Title is required' });
    if (!dateFrom || !DATE_RE.test(String(dateFrom).trim())) errors.push({ field: 'dateFrom', message: 'dateFrom is required (YYYY-MM-DD)' });
    if (!dateTo || !DATE_RE.test(String(dateTo).trim())) errors.push({ field: 'dateTo', message: 'dateTo is required (YYYY-MM-DD)' });
    if (dateFrom && dateTo && DATE_RE.test(String(dateFrom)) && DATE_RE.test(String(dateTo)) && String(dateTo) < String(dateFrom)) {
      errors.push({ field: 'dateTo', message: 'dateTo must be on or after dateFrom' });
    }
    if (!file) errors.push({ field: 'file', message: 'File is required' });
    if (errors.length > 0) {
      if (file) deleteFile(file.path);
      throw new AppError('Validation failed', 400, ErrorCodes.VALIDATION_ERROR, errors);
    }

    let targetProgramId: string;
    try {
      targetProgramId = resolveWritableProgramId(req, programId ?? courseId);
    } catch (e) {
      if (file) deleteFile(file.path);
      throw e;
    }

    const program = await queryOne<{ id: string }>('SELECT id FROM courses WHERE id = ?', [targetProgramId]);
    if (!program) {
      if (file) deleteFile(file.path);
      throw new AppError('Program not found', 404, ErrorCodes.NOT_FOUND);
    }

    const { storagePath } = await storeUploadedFile(file!, 'documents');

    const id = uuidv4();
    await execute(
      `INSERT INTO attendance_registers (id, program_id, title, date_from, date_to, file_name, file_size, file_path, file_mime_type, uploaded_by_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        targetProgramId,
        String(title).trim(),
        String(dateFrom).trim(),
        String(dateTo).trim(),
        file!.originalname,
        file!.size,
        storagePath,
        file!.mimetype,
        adminId,
      ]
    );

    const row = await queryOne<AttendanceRegister>(REGISTER_SELECT + ' WHERE ar.id = ?', [id]);
    res.status(201).json({ success: true, data: toResponse(row!) });
  } catch (err) {
    next(err);
  }
}

// ── Download the register file (program-scoped) ───────────────────────────────
export async function downloadRegister(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { id } = req.params;
    const row = await queryOne<AttendanceRegister>('SELECT * FROM attendance_registers WHERE id = ?', [id]);
    if (!row) throw new AppError('Attendance register not found', 404, ErrorCodes.NOT_FOUND);
    assertProgramAccess(req, row.program_id);

    if (isR2Enabled) {
      await streamFromR2(row.file_path, res, row.file_name, row.file_mime_type || 'application/octet-stream');
      return;
    }
    const safePath = resolveUploadPath(row.file_path);
    if (!fs.existsSync(safePath)) throw new AppError('File not found', 404, ErrorCodes.NOT_FOUND);
    res.setHeader('Content-Type', row.file_mime_type || 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${row.file_name}"`);
    res.setHeader('Content-Length', row.file_size);
    res.sendFile(safePath);
  } catch (err) {
    next(err);
  }
}

// ── Delete register (Super Admin only via route) ──────────────────────────────
export async function deleteRegister(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { id } = req.params;
    const row = await queryOne<AttendanceRegister>('SELECT * FROM attendance_registers WHERE id = ?', [id]);
    if (!row) throw new AppError('Attendance register not found', 404, ErrorCodes.NOT_FOUND);

    if (isR2Enabled) {
      await deleteFromR2(row.file_path);
    } else {
      deleteFile(row.file_path);
    }
    await execute('DELETE FROM attendance_registers WHERE id = ?', [id]);
    res.json({ success: true, message: 'Attendance register deleted' });
  } catch (err) {
    next(err);
  }
}
