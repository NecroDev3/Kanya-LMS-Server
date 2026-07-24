import { Response, NextFunction } from 'express';
import fs from 'fs';
import { v4 as uuidv4 } from 'uuid';
import { query, queryOne, execute } from '../config/database.js';
import { AuthRequest, ProgressReport, ProgressReportResponse, ErrorCodes } from '../types/index.js';
import { AppError } from '../middleware/errorHandler.js';
import { deleteFile, resolveUploadPath, storeUploadedFile } from '../utils/fileUpload.js';
import { isR2Enabled, deleteFromR2, streamFromR2 } from '../config/storage.js';
import { programFilter, assertProgramAccess, resolveWritableProgramId } from '../utils/programScope.js';

function fileUrl(id: string): string {
  return `/api/v1/progress-reports/${id}/download`;
}

function toResponse(r: ProgressReport): ProgressReportResponse {
  return {
    id: r.id,
    programId: r.program_id,
    title: r.title,
    description: r.description ?? null,
    periodMonth: r.period_month,
    periodYear: r.period_year,
    fileName: r.file_name,
    fileSize: r.file_size,
    fileUrl: fileUrl(r.id),
    fileMimeType: r.file_mime_type,
    uploadedBy: r.uploader_name,
    uploadedById: r.uploaded_by_id,
    uploadedAt: r.uploaded_at as unknown as string,
  };
}

const REPORT_SELECT = `
  SELECT pr.*, c.title AS program_name, u.name AS uploader_name
  FROM progress_reports pr
  JOIN courses c ON c.id = pr.program_id
  LEFT JOIN users u ON u.id = pr.uploaded_by_id
`;

export async function listProgressReports(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const conditions: string[] = [];
    const params: unknown[] = [];

    const scope = programFilter(req, 'pr.program_id');
    if (scope.clause) {
      conditions.push(scope.clause);
      params.push(...scope.params);
    }
    const courseFilter = (req.query.programId as string | undefined) || (req.query.courseId as string | undefined);
    if (courseFilter) {
      assertProgramAccess(req, courseFilter);
      conditions.push('pr.program_id = ?');
      params.push(courseFilter);
    }
    const where = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : '';

    const rows = await query<ProgressReport>(
      REPORT_SELECT + ` ${where} ORDER BY pr.period_year DESC, pr.period_month DESC, pr.uploaded_at DESC`,
      params
    );

    res.json({ success: true, data: { reports: rows.map(toResponse) } });
  } catch (error) {
    next(error);
  }
}

export async function createProgressReport(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { title, description, month, year, programId } = req.body;
    const file = req.file;
    const adminId = req.user?.userId;

    const monthNum = Number.parseInt(String(month), 10);
    const yearNum = Number.parseInt(String(year), 10);

    const errors: Array<{ field: string; message: string }> = [];
    if (!title || String(title).trim().length === 0) errors.push({ field: 'title', message: 'Title is required' });
    if (!Number.isInteger(monthNum) || monthNum < 1 || monthNum > 12) errors.push({ field: 'month', message: 'Month must be between 1 and 12' });
    if (!Number.isInteger(yearNum) || yearNum < 2000 || yearNum > 2100) errors.push({ field: 'year', message: 'Year is invalid' });
    if (!file) errors.push({ field: 'file', message: 'File is required' });
    if (errors.length > 0) {
      if (file) deleteFile(file.path);
      throw new AppError('Validation failed', 400, ErrorCodes.VALIDATION_ERROR, errors);
    }

    let targetProgramId: string;
    try {
      targetProgramId = resolveWritableProgramId(req, programId);
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
      `INSERT INTO progress_reports (id, program_id, title, description, period_month, period_year, file_name, file_size, file_path, file_mime_type, uploaded_by_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        targetProgramId,
        String(title).trim(),
        description != null ? String(description).trim() : null,
        monthNum,
        yearNum,
        file!.originalname,
        file!.size,
        storagePath,
        file!.mimetype,
        adminId,
      ]
    );

    const row = await queryOne<ProgressReport>(REPORT_SELECT + ' WHERE pr.id = ?', [id]);
    res.status(201).json({ success: true, data: toResponse(row!) });
  } catch (error) {
    next(error);
  }
}

export async function downloadProgressReport(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { id } = req.params;
    const report = await queryOne<ProgressReport>('SELECT * FROM progress_reports WHERE id = ?', [id]);
    if (!report) throw new AppError('Progress report not found', 404, ErrorCodes.NOT_FOUND);
    assertProgramAccess(req, report.program_id);

    if (isR2Enabled) {
      await streamFromR2(report.file_path, res, report.file_name, report.file_mime_type || 'application/octet-stream');
      return;
    }
    const safePath = resolveUploadPath(report.file_path);
    if (!fs.existsSync(safePath)) throw new AppError('File not found', 404, ErrorCodes.NOT_FOUND);
    res.setHeader('Content-Type', report.file_mime_type || 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${report.file_name}"`);
    res.setHeader('Content-Length', report.file_size);
    res.sendFile(safePath);
  } catch (error) {
    next(error);
  }
}

export async function deleteProgressReport(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { id } = req.params;
    const report = await queryOne<ProgressReport>('SELECT * FROM progress_reports WHERE id = ?', [id]);
    if (!report) throw new AppError('Progress report not found', 404, ErrorCodes.NOT_FOUND);

    if (isR2Enabled) {
      await deleteFromR2(report.file_path);
    } else {
      deleteFile(report.file_path);
    }
    await execute('DELETE FROM progress_reports WHERE id = ?', [id]);
    res.json({ success: true, message: 'Progress report deleted' });
  } catch (error) {
    next(error);
  }
}
