import bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';
import { db } from '../../config/database.js';

const PASSWORD = 'password123';
const HASH = bcrypt.hashSync(PASSWORD, 4); // low rounds for speed in tests

export const TEST_PASSWORD = PASSWORD;

export interface TestIds {
  superAdminId: string;
  /** Admin scoped to program 1 */
  adminId: string;
  /** Admin scoped to program 2 */
  admin2Id: string;
  programId: string; // program 1 (courses.id)
  programCode: string;
  program2Id: string; // program 2
  program2Code: string;
  studentId: string; // in program 1
  student2Id: string; // in program 2
  documentId: string; // in program 1
  document2Id: string; // in program 2
  quizId: string; // in program 1
}

/**
 * Seeds a two-program world:
 *  - 1 super admin (no program)
 *  - admin (program 1), admin2 (program 2)
 *  - a student, a document and a quiz in each program
 * Used to verify program scoping and delete gating.
 */
export function seedTestData(): TestIds {
  const superAdminId = uuidv4();
  const adminId = uuidv4();
  const admin2Id = uuidv4();
  const programId = uuidv4();
  const programCode = 'BLOCK-101';
  const program2Id = uuidv4();
  const program2Code = 'WEB-201';
  const studentId = uuidv4();
  const student2Id = uuidv4();
  const documentId = uuidv4();
  const document2Id = uuidv4();
  const quizId = uuidv4();

  db.exec(`
    INSERT INTO courses (id, title, description, course_code, sections)
    VALUES
      ('${programId}', 'Blockchain 101', 'Intro to blockchain', '${programCode}', '[]'),
      ('${program2Id}', 'Web Dev 201', 'Advanced web development', '${program2Code}', '[]');

    INSERT INTO users (id, name, email, password_hash, role, program_id)
    VALUES
      ('${superAdminId}', 'Super Admin', 'super@test.com', '${HASH}', 'super_admin', NULL),
      ('${adminId}', 'Admin One', 'admin@test.com', '${HASH}', 'admin', '${programId}'),
      ('${admin2Id}', 'Admin Two', 'admin2@test.com', '${HASH}', 'admin', '${program2Id}');

    INSERT INTO students (id, program_id, name, email, enrollment_number, department, semester, status)
    VALUES
      ('${studentId}', '${programId}', 'Student One', 's1@test.com', 'STU-001', 'Computer Science', 3, 'active'),
      ('${student2Id}', '${program2Id}', 'Student Two', 's2@test.com', 'STU-002', 'Computer Science', 3, 'active');

    INSERT INTO course_documents (id, title, description, category, file_name, file_size, file_path, file_mime_type, program_id, uploaded_by_id)
    VALUES
      ('${documentId}', 'P1 Notes', 'Program 1 notes', 'Lecture Notes', 'p1.pdf', 1024, '/tmp/test/p1.pdf', 'application/pdf', '${programId}', '${adminId}'),
      ('${document2Id}', 'P2 Notes', 'Program 2 notes', 'Lecture Notes', 'p2.pdf', 1024, '/tmp/test/p2.pdf', 'application/pdf', '${program2Id}', '${admin2Id}');

    INSERT INTO quizzes (id, title, description, course_id, passing_score, questions)
    VALUES ('${quizId}', 'P1 Quiz', 'Program 1 quiz', '${programId}', 70, '[]');
  `);

  return {
    superAdminId,
    adminId,
    admin2Id,
    programId,
    programCode,
    program2Id,
    program2Code,
    studentId,
    student2Id,
    documentId,
    document2Id,
    quizId,
  };
}
