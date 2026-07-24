import { Response, NextFunction } from 'express';
import fs from 'fs';
import { v4 as uuidv4 } from 'uuid';
import { query, queryOne, execute, sqlLike, sqlNow } from '../config/database.js';
import { AuthRequest, CourseDocument, CourseDocumentResponse, User, ErrorCodes } from '../types/index.js';
import { AppError } from '../middleware/errorHandler.js';
import { deleteFile, getDocumentFileUrl, resolveUploadPath, storeUploadedFile } from '../utils/fileUpload.js';
import { isR2Enabled, deleteFromR2, streamFromR2 } from '../config/storage.js';
import { programFilter, assertProgramAccess, resolveWritableProgramId } from '../utils/programScope.js';

function parseCourseIds(courseIdsJson: string | null | undefined): string[] {
  if (courseIdsJson == null || courseIdsJson === '') return [];
  try {
    const a = JSON.parse(courseIdsJson);
    return Array.isArray(a) ? a.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

// Default categories
const DEFAULT_CATEGORIES = [
  'Lecture Notes',
  'Assignments',
  'Study Guides',
  'Reference Materials',
  'Exam Preparation',
  'Project Resources',
  'Tutorials',
  'Other',
];

function toDocumentResponse(doc: CourseDocument & { uploader_name?: string }): CourseDocumentResponse {
  const courseIds = parseCourseIds(doc.course_ids);
  return {
    id: doc.id,
    title: doc.title,
    description: doc.description,
    category: doc.category,
    fileName: doc.file_name,
    fileSize: doc.file_size,
    fileUrl: getDocumentFileUrl(doc.id),
    fileMimeType: doc.file_mime_type,
    courseIds: courseIds.length > 0 ? courseIds : undefined,
    programId: doc.program_id ?? null,
    uploadedBy: doc.uploader_name || '',
    uploadedById: doc.uploaded_by_id,
    uploadedAt: doc.uploaded_at as unknown as string,
    updatedAt: doc.updated_at as unknown as string,
  };
}

export async function getDocuments(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 20));
    const category = req.query.category as string;
    const search = req.query.search as string;

    const conditions: string[] = [];
    const params: unknown[] = [];

    // Program scoping: admins only see materials for their program.
    const scope = programFilter(req, 'd.program_id');
    if (scope.clause) {
      conditions.push(scope.clause);
      params.push(...scope.params);
    }
    if (category) {
      params.push(category);
      conditions.push(`d.category = ?`);
    }
    if (search) {
      params.push(`%${search}%`, `%${search}%`);
      const lk = sqlLike();
      conditions.push(`(d.title ${lk} ? OR d.description ${lk} ?)`);
    }
    const whereClause = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : '';

    const countRow = await queryOne<{ count: number }>(
      `SELECT COUNT(*) as count FROM course_documents d ${whereClause}`,
      params
    );
    const total = Number(countRow?.count) || 0;
    const offset = (page - 1) * limit;

    const documents = await query<CourseDocument & { uploader_name: string }>(
      `SELECT d.*, u.name as uploader_name
       FROM course_documents d
       LEFT JOIN users u ON d.uploaded_by_id = u.id
       ${whereClause}
       ORDER BY d.uploaded_at DESC
       LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );

    res.json({
      success: true,
      data: {
        documents: documents.map(toDocumentResponse),
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
      },
    });
  } catch (error) {
    next(error);
  }
}

export async function getDocument(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { id } = req.params;

    const document = await queryOne<CourseDocument & { uploader_name: string }>(
      `SELECT d.*, u.name as uploader_name
       FROM course_documents d
       LEFT JOIN users u ON d.uploaded_by_id = u.id
       WHERE d.id = ?`,
      [id]
    );

    if (!document) {
      throw new AppError('Document not found', 404, ErrorCodes.NOT_FOUND);
    }
    assertProgramAccess(req, document.program_id ?? null);

    res.json({ success: true, data: toDocumentResponse(document) });
  } catch (error) {
    next(error);
  }
}

export async function createDocument(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { title, description, category, programId } = req.body;
    const file = req.file;
    const adminUserId = req.user?.userId;

    const errors: Array<{ field: string; message: string }> = [];

    if (!title || title.trim().length === 0) {
      errors.push({ field: 'title', message: 'Title is required' });
    } else if (title.length > 200) {
      errors.push({ field: 'title', message: 'Title must be 200 characters or less' });
    }
    if (!description || description.trim().length === 0) {
      errors.push({ field: 'description', message: 'Description is required' });
    } else if (description.length > 1000) {
      errors.push({ field: 'description', message: 'Description must be 1000 characters or less' });
    }
    if (!category || category.trim().length === 0) {
      errors.push({ field: 'category', message: 'Category is required' });
    }
    if (!file) {
      errors.push({ field: 'file', message: 'File is required' });
    }

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

    const adminUser = await queryOne<User>('SELECT id, name FROM users WHERE id = ?', [adminUserId]);

    // Reuse existing file-handling/validation from utils/fileUpload (per spec).
    const { storagePath } = await storeUploadedFile(file!, 'documents');

    const id = uuidv4();
    await execute(
      `INSERT INTO course_documents (id, title, description, category, file_name, file_size, file_path, file_mime_type, program_id, uploaded_by_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        title.trim(),
        description.trim(),
        category.trim(),
        file!.originalname,
        file!.size,
        storagePath,
        file!.mimetype,
        targetProgramId,
        adminUserId,
      ]
    );

    const document = await queryOne<CourseDocument>('SELECT * FROM course_documents WHERE id = ?', [id]);
    if (!document) {
      if (file) deleteFile(file.path);
      throw new AppError('Failed to create document', 500, ErrorCodes.INTERNAL_ERROR);
    }

    res.status(201).json({
      success: true,
      data: toDocumentResponse({ ...document, uploader_name: adminUser?.name }),
    });
  } catch (error) {
    next(error);
  }
}

export async function updateDocument(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { id } = req.params;
    const { title, description, category } = req.body;

    const existing = await queryOne<CourseDocument & { uploader_name: string }>(
      `SELECT d.*, u.name as uploader_name
       FROM course_documents d
       LEFT JOIN users u ON d.uploaded_by_id = u.id
       WHERE d.id = ?`,
      [id]
    );

    if (!existing) {
      throw new AppError('Document not found', 404, ErrorCodes.NOT_FOUND);
    }
    assertProgramAccess(req, existing.program_id ?? null);

    const errors: Array<{ field: string; message: string }> = [];
    if (title !== undefined && title.length > 200) {
      errors.push({ field: 'title', message: 'Title must be 200 characters or less' });
    }
    if (description !== undefined && description.length > 1000) {
      errors.push({ field: 'description', message: 'Description must be 1000 characters or less' });
    }
    if (errors.length > 0) {
      throw new AppError('Validation failed', 400, ErrorCodes.VALIDATION_ERROR, errors);
    }

    const updates: string[] = [];
    const params: unknown[] = [];
    if (title !== undefined) {
      updates.push(`title = ?`);
      params.push(title.trim());
    }
    if (description !== undefined) {
      updates.push(`description = ?`);
      params.push(description.trim());
    }
    if (category !== undefined) {
      updates.push(`category = ?`);
      params.push(category.trim());
    }

    if (updates.length === 0) {
      res.json({ success: true, data: toDocumentResponse(existing) });
      return;
    }

    updates.push(`updated_at = ${sqlNow()}`);
    params.push(id);

    await execute(`UPDATE course_documents SET ${updates.join(', ')} WHERE id = ?`, params);

    const document = await queryOne<CourseDocument & { uploader_name: string }>(
      `SELECT d.*, u.name as uploader_name
       FROM course_documents d
       LEFT JOIN users u ON d.uploaded_by_id = u.id
       WHERE d.id = ?`,
      [id]
    );

    res.json({ success: true, data: toDocumentResponse(document!) });
  } catch (error) {
    next(error);
  }
}

export async function deleteDocument(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { id } = req.params;

    const existing = await queryOne<CourseDocument>('SELECT * FROM course_documents WHERE id = ?', [id]);
    if (!existing) {
      throw new AppError('Document not found', 404, ErrorCodes.NOT_FOUND);
    }

    if (isR2Enabled) {
      await deleteFromR2(existing.file_path);
    } else {
      deleteFile(existing.file_path);
    }

    await execute('DELETE FROM course_documents WHERE id = ?', [id]);

    res.json({ success: true, message: 'Document deleted successfully' });
  } catch (error) {
    next(error);
  }
}

export async function downloadDocument(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { id } = req.params;

    const document = await queryOne<CourseDocument>('SELECT * FROM course_documents WHERE id = ?', [id]);
    if (!document) {
      throw new AppError('Document not found', 404, ErrorCodes.NOT_FOUND);
    }
    assertProgramAccess(req, document.program_id ?? null);

    if (isR2Enabled) {
      await streamFromR2(document.file_path, res, document.file_name, document.file_mime_type || 'application/octet-stream');
      return;
    }

    const safePath = resolveUploadPath(document.file_path);
    if (!fs.existsSync(safePath)) {
      throw new AppError('File not found', 404, ErrorCodes.NOT_FOUND);
    }
    res.setHeader('Content-Type', document.file_mime_type || 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${document.file_name}"`);
    res.setHeader('Content-Length', document.file_size);
    res.sendFile(safePath);
  } catch (error) {
    next(error);
  }
}

export async function getCategories(_req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const dbCategories = await query<{ category: string }>(
      'SELECT DISTINCT category FROM course_documents ORDER BY category'
    );

    const categorySet = new Set(DEFAULT_CATEGORIES);
    for (const row of dbCategories) {
      categorySet.add(row.category);
    }
    const categories = Array.from(categorySet).sort();

    res.json({ success: true, data: { categories } });
  } catch (error) {
    next(error);
  }
}
