import { Request } from 'express';

// User Types
// Admin-only access model: the only account holders are super admins and
// program-scoped admins. There is no student login.
export type UserRole = 'super_admin' | 'admin';

export interface User {
  id: string;
  name: string;
  email: string;
  password_hash: string;
  role: UserRole;
  /** Assigned program (single). Null/ignored for super_admin, required for admin. */
  program_id?: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface UserResponse {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  programId?: string | null;
}

export type StudentStatus = 'active' | 'archived';

// Student Types — students are managed records only (no login).
export interface Student {
  id: string;
  user_id?: string;
  program_id?: string | null;
  name: string;
  email: string;
  enrollment_number: string;
  department: string;
  semester: number;
  status?: StudentStatus;
  created_at: Date;
  updated_at: Date;
}

export interface StudentResponse {
  id: string;
  userId?: string;
  programId?: string | null;
  name: string;
  email: string;
  enrollmentNumber: string;
  department: string;
  semester: number;
  status?: StudentStatus;
  createdAt: string;
  updatedAt?: string;
}

// Submission Types
export type SubmissionStatus = 'pending' | 'approved' | 'rejected';

export interface Submission {
  id: string;
  student_id: string;
  title: string;
  description: string;
  file_name: string;
  file_size: number;
  file_path: string;
  file_mime_type?: string;
  status: SubmissionStatus;
  submitted_at: Date;
  reviewed_at?: Date;
  reviewed_by_id?: string;
  feedback?: string;
  created_at: Date;
  updated_at: Date;
  // Joined fields
  student_name?: string;
  reviewer_name?: string;
}

export interface SubmissionResponse {
  id: string;
  studentId: string;
  studentName: string;
  title: string;
  description: string;
  fileName: string;
  fileSize: number;
  fileUrl: string;
  fileMimeType?: string;
  status: SubmissionStatus;
  submittedAt: string;
  reviewedAt?: string;
  reviewedBy?: string;
  reviewedById?: string;
  feedback?: string;
  createdAt?: string;
  updatedAt?: string;
}

// JWT Types
export interface JWTPayload {
  userId: string;
  email: string;
  role: UserRole;
  /** Assigned program for admins. Undefined/null for super_admin. */
  programId?: string | null;
}

// Extended Request Type
export interface AuthRequest extends Request {
  user?: JWTPayload;
}

// API Response Types
export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  message?: string;
  error?: {
    code: string;
    message: string;
    details?: Array<{ field: string; message: string }>;
  };
}

export interface PaginationInfo {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export interface PaginatedResponse<T> {
  items: T[];
  pagination: PaginationInfo;
}

// Course Document Types
export interface CourseDocument {
  id: string;
  title: string;
  description: string;
  category: string;
  file_name: string;
  file_size: number;
  file_path: string;
  file_mime_type?: string;
  course_ids?: string | null; // legacy JSON array of course IDs; empty/null = open to all
  program_id?: string | null; // program (courses.id) this material belongs to
  uploaded_by_id: string;
  uploaded_at: Date;
  created_at: Date;
  updated_at: Date;
  // Joined fields
  uploader_name?: string;
}

export interface CourseDocumentResponse {
  id: string;
  title: string;
  description: string;
  category: string;
  fileName: string;
  fileSize: number;
  fileUrl: string;
  fileMimeType?: string;
  courseIds?: string[];
  programId?: string | null;
  uploadedBy: string;
  uploadedById: string;
  uploadedAt: string;
  updatedAt?: string;
}

// Forum Types (BACKEND_UPDATE_REQUIREMENTS)
export interface ForumAuthor {
  id: string;
  name: string;
  email: string;
  role: UserRole;
}

export interface ForumTopicResponse {
  id: string;
  title: string;
  body: string;
  /** null / undefined = General channel */
  courseId?: string | null;
  author: ForumAuthor;
  createdAt: string;
  updatedAt?: string;
  postCount: number;
  lastPostAt?: string | null;
}

export interface ForumPostResponse {
  id: string;
  topicId: string;
  body: string;
  author: ForumAuthor;
  createdAt: string;
  updatedAt?: string;
}

// Course API Types (BACKEND_UPDATE_REQUIREMENTS)
export type CourseItem =
  | { id: string; type: 'video'; title: string; order?: number; url: string; description?: string; information?: string }
  | { id: string; type: 'link'; title: string; order?: number; url: string; description?: string; information?: string }
  | {
      id: string;
      type: 'pdf';
      title: string;
      order?: number;
      documentId?: string;
      fileUrl?: string;
      description?: string;
      information?: string;
    };

export interface CourseSection {
  id: string;
  title: string;
  objective?: string;
  outcome?: string;
  items: CourseItem[];
}

export interface Course {
  id: string;
  title: string;
  description?: string;
  courseCode: string;
  sections: CourseSection[];
  archived?: boolean;
  archivedAt?: string | null;
}

// Messages API Types (BACKEND_UPDATE_REQUIREMENTS)
export interface ConversationResponse {
  id: string;
  participantIds: [string, string];
  participantNames: [string, string];
  updatedAt: string;
}

export interface MessageResponse {
  id: string;
  conversationId: string;
  senderId: string;
  body: string;
  createdAt: string;
}

// Course members & user directory (BACKEND_UPDATE_REQUIREMENTS)
export interface UserDirectoryItem {
  id: string;
  name: string;
  email?: string;
  role: UserRole;
  courseCodes?: string[];
}

// Analytics Types (admin-only, program-scoped)
export interface DashboardAnalytics {
  totalPrograms: number;
  totalStudents: number;
  totalQuestionnaires: number;
  totalProgressReports: number;
  studentsByStatus: {
    active: number;
    archived: number;
  };
  studentsByDepartment: Array<{ department: string; count: number }>;
  recentStudents: Array<{
    id: string;
    name: string;
    enrollmentNumber: string;
    department: string;
    createdAt: string;
  }>;
}

// ── Attendance Registers ────────────────────────────────────────────────────────
// An attendance register is an uploaded, signed in-person form covering a date range.
export interface AttendanceRegister {
  id: string;
  program_id: string;
  title: string;
  date_from: string;
  date_to: string;
  file_name: string;
  file_size: number;
  file_path: string;
  file_mime_type?: string;
  uploaded_by_id: string;
  uploaded_at: Date;
  created_at: Date;
  updated_at: Date;
  // Joined
  program_name?: string;
  uploader_name?: string;
}

export interface AttendanceRegisterResponse {
  id: string;
  programId: string;
  programName?: string;
  title: string;
  dateFrom: string;
  dateTo: string;
  fileName: string;
  fileSize: number;
  fileUrl: string;
  fileMimeType?: string;
  uploadedBy?: string;
  uploadedById: string;
  uploadedAt: string;
}

// ── Progress Reports ───────────────────────────────────────────────────────────
// Program-level review write-ups uploaded by an admin for a given month/year.
export interface ProgressReport {
  id: string;
  program_id: string;
  title: string;
  description: string | null;
  period_month: number;
  period_year: number;
  file_name: string;
  file_size: number;
  file_path: string;
  file_mime_type?: string;
  uploaded_by_id: string;
  uploaded_at: Date;
  created_at: Date;
  updated_at: Date;
  // Joined
  program_name?: string;
  uploader_name?: string;
}

export interface ProgressReportResponse {
  id: string;
  programId: string;
  title: string;
  description: string | null;
  periodMonth: number;
  periodYear: number;
  fileName: string;
  fileSize: number;
  fileUrl: string;
  fileMimeType?: string;
  uploadedBy?: string;
  uploadedById: string;
  uploadedAt: string;
}

// ── Questionnaire assignments (link a questionnaire/quiz to a student) ──────────
export interface QuestionnaireAssignment {
  id: string;
  quiz_id: string;
  student_id: string;
  assigned_by_id: string | null;
  assigned_at: Date;
  // Joined
  student_name?: string;
}

// Error Codes
export const ErrorCodes = {
  UNAUTHORIZED: 'UNAUTHORIZED',
  FORBIDDEN: 'FORBIDDEN',
  NOT_FOUND: 'NOT_FOUND',
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  INVALID_CREDENTIALS: 'INVALID_CREDENTIALS',
  FILE_TOO_LARGE: 'FILE_TOO_LARGE',
  INVALID_FILE_TYPE: 'INVALID_FILE_TYPE',
  SUBMISSION_LOCKED: 'SUBMISSION_LOCKED',
  DUPLICATE_ENTRY: 'DUPLICATE_ENTRY',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
} as const;

