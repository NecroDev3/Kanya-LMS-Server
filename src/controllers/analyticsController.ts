import { Response, NextFunction } from 'express';
import { query, queryOne } from '../config/database.js';
import { AuthRequest, DashboardAnalytics } from '../types/index.js';
import { programFilter, isSuperAdmin } from '../utils/programScope.js';

export async function getDashboard(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const studentScope = programFilter(req, 'program_id');
    const studentWhere = studentScope.clause ? `WHERE ${studentScope.clause}` : '';

    const totalPrograms = isSuperAdmin(req)
      ? Number((await queryOne<{ count: number }>('SELECT COUNT(*) as count FROM courses'))?.count) || 0
      : req.user?.programId
        ? 1
        : 0;

    const totalStudents =
      Number((await queryOne<{ count: number }>(`SELECT COUNT(*) as count FROM students ${studentWhere}`, studentScope.params))?.count) || 0;

    const questWhere = (() => {
      const s = programFilter(req, 'course_id');
      return { where: s.clause ? `WHERE ${s.clause}` : '', params: s.params };
    })();
    const totalQuestionnaires =
      Number((await queryOne<{ count: number }>(`SELECT COUNT(*) as count FROM quizzes ${questWhere.where}`, questWhere.params))?.count) || 0;

    const prWhere = (() => {
      const s = programFilter(req, 'program_id');
      return { where: s.clause ? `WHERE ${s.clause}` : '', params: s.params };
    })();
    const totalProgressReports =
      Number((await queryOne<{ count: number }>(`SELECT COUNT(*) as count FROM progress_reports ${prWhere.where}`, prWhere.params))?.count) || 0;

    const statusRows = await query<{ status: string; count: number }>(
      `SELECT status, COUNT(*) as count FROM students ${studentWhere} GROUP BY status`,
      studentScope.params
    );
    const studentsByStatus = { active: 0, archived: 0 };
    for (const row of statusRows) {
      if (row.status === 'archived') studentsByStatus.archived = Number(row.count);
      else studentsByStatus.active = Number(row.count);
    }

    const departmentCounts = await query<{ department: string; count: number }>(
      `SELECT department, COUNT(*) as count FROM students ${studentWhere} GROUP BY department ORDER BY count DESC`,
      studentScope.params
    );
    const studentsByDepartment = departmentCounts.map((row) => ({
      department: row.department,
      count: Number(row.count),
    }));

    const recent = await query<{ id: string; name: string; enrollment_number: string; department: string; created_at: string }>(
      `SELECT id, name, enrollment_number, department, created_at FROM students ${studentWhere} ORDER BY created_at DESC LIMIT 10`,
      studentScope.params
    );

    const analytics: DashboardAnalytics = {
      totalPrograms,
      totalStudents,
      totalQuestionnaires,
      totalProgressReports,
      studentsByStatus,
      studentsByDepartment,
      recentStudents: recent.map((s) => ({
        id: s.id,
        name: s.name,
        enrollmentNumber: s.enrollment_number,
        department: s.department,
        createdAt: s.created_at,
      })),
    };

    res.json({ success: true, data: analytics });
  } catch (error) {
    next(error);
  }
}
