import { Router } from 'express';
import {
  getDocuments,
  getDocument,
  createDocument,
  updateDocument,
  deleteDocument,
  downloadDocument,
  getCategories,
} from '../controllers/documentsController.js';
import { authenticate, authorize, requireSuperAdmin } from '../middleware/auth.js';
import { uploadDocument } from '../utils/fileUpload.js';

const router = Router();

// All document routes require an authenticated admin.
router.use(authenticate);
router.use(authorize('super_admin', 'admin'));

// GET /documents/categories - Get list of all categories (must be before /:id)
router.get('/categories', getCategories);

// GET /documents - Get all documents with pagination/filtering (program-scoped)
router.get('/', getDocuments);

// GET /documents/:id - Get single document
router.get('/:id', getDocument);

// GET /documents/:id/download - Download document file
router.get('/:id/download', downloadDocument);

// POST /documents - Upload new learning material (create: admin + super admin)
router.post('/', uploadDocument.single('file'), createDocument);

// PUT /documents/:id - Update document metadata (update: admin + super admin)
router.put('/:id', updateDocument);

// DELETE /documents/:id - Delete document (Super Admin only)
router.delete('/:id', requireSuperAdmin, deleteDocument);

export default router;

