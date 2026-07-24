import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import app from '../app.js';
import { seedTestData, type TestIds } from './helpers/seed.js';
import { makeToken } from './helpers/auth.js';

let ids: TestIds;
let superToken: string;
let adminToken: string; // program 1
let admin2Token: string; // program 2

beforeEach(() => {
  ids = seedTestData();
  superToken = makeToken({ userId: ids.superAdminId, email: 'super@test.com', role: 'super_admin', programId: null });
  adminToken = makeToken({ userId: ids.adminId, email: 'admin@test.com', role: 'admin', programId: ids.programId });
  admin2Token = makeToken({ userId: ids.admin2Id, email: 'admin2@test.com', role: 'admin', programId: ids.program2Id });
});

const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

describe('Students program scoping', () => {
  it('admin only sees students in their program', async () => {
    const res = await request(app).get('/api/v1/students').set(auth(adminToken));
    expect(res.status).toBe(200);
    const list = res.body.data.students as Array<{ id: string }>;
    expect(list.map((s) => s.id)).toEqual([ids.studentId]);
  });

  it('super admin sees students across all programs', async () => {
    const res = await request(app).get('/api/v1/students').set(auth(superToken));
    expect(res.status).toBe(200);
    const list = res.body.data.students as Array<{ id: string }>;
    expect(list.map((s) => s.id).sort()).toEqual([ids.studentId, ids.student2Id].sort());
  });

  it('admin gets 403 fetching a student in another program', async () => {
    const res = await request(app).get(`/api/v1/students/${ids.student2Id}`).set(auth(adminToken));
    expect(res.status).toBe(403);
  });

  it('new students are scoped to the creating admin program', async () => {
    const res = await request(app)
      .post('/api/v1/students')
      .set(auth(adminToken))
      .send({ name: 'New', email: 'new@test.com', enrollmentNumber: 'STU-NEW', department: 'CS', semester: 1 });
    expect(res.status).toBe(201);
    expect(res.body.data.programId).toBe(ids.programId);
  });
});

describe('Delete gating (Super Admin only)', () => {
  it('admin cannot delete a student', async () => {
    const res = await request(app).delete(`/api/v1/students/${ids.studentId}`).set(auth(adminToken));
    expect(res.status).toBe(403);
  });

  it('super admin can delete a student', async () => {
    const res = await request(app).delete(`/api/v1/students/${ids.studentId}`).set(auth(superToken));
    expect(res.status).toBe(200);
  });

  it('admin cannot delete a document; super admin can', async () => {
    const denied = await request(app).delete(`/api/v1/documents/${ids.documentId}`).set(auth(adminToken));
    expect(denied.status).toBe(403);
    const ok = await request(app).delete(`/api/v1/documents/${ids.documentId}`).set(auth(superToken));
    expect(ok.status).toBe(200);
  });
});

describe('Documents program scoping', () => {
  it('admin only lists their program documents', async () => {
    const res = await request(app).get('/api/v1/documents').set(auth(adminToken));
    expect(res.status).toBe(200);
    const list = res.body.data.documents as Array<{ id: string }>;
    expect(list.map((d) => d.id)).toEqual([ids.documentId]);
  });

  it('admin gets 403 fetching a cross-program document', async () => {
    const res = await request(app).get(`/api/v1/documents/${ids.document2Id}`).set(auth(adminToken));
    expect(res.status).toBe(403);
  });
});

describe('Programs scoping', () => {
  it('admin sees only their assigned program', async () => {
    const res = await request(app).get('/api/v1/programs').set(auth(adminToken));
    expect(res.status).toBe(200);
    const list = res.body.data.programs as Array<{ id: string }>;
    expect(list.map((p) => p.id)).toEqual([ids.programId]);
  });

  it('admin cannot create a program (super admin only)', async () => {
    const res = await request(app)
      .post('/api/v1/programs')
      .set(auth(adminToken))
      .send({ title: 'X', courseCode: 'X-1' });
    expect(res.status).toBe(403);
  });

  it('super admin can create a program', async () => {
    const res = await request(app)
      .post('/api/v1/programs')
      .set(auth(superToken))
      .send({ title: 'New Program', courseCode: 'NEW-1' });
    expect(res.status).toBe(201);
  });
});

describe('Admin management (Super Admin only)', () => {
  it('admins cannot list admins', async () => {
    const res = await request(app).get('/api/v1/admins').set(auth(adminToken));
    expect(res.status).toBe(403);
  });

  it('super admin lists all admins', async () => {
    const res = await request(app).get('/api/v1/admins').set(auth(superToken));
    expect(res.status).toBe(200);
    expect(res.body.data.admins.length).toBe(3);
  });

  it('super admin creates a program-scoped admin', async () => {
    const res = await request(app)
      .post('/api/v1/admins')
      .set(auth(superToken))
      .send({ name: 'Fresh Admin', email: 'fresh@test.com', password: 'password123', role: 'admin', programId: ids.programId });
    expect(res.status).toBe(201);
    expect(res.body.data.programId).toBe(ids.programId);
  });

  it('rejects creating an admin without a program', async () => {
    const res = await request(app)
      .post('/api/v1/admins')
      .set(auth(superToken))
      .send({ name: 'No Program', email: 'np@test.com', password: 'password123', role: 'admin' });
    expect(res.status).toBe(400);
  });
});

describe('Questionnaires scoping + assignment dependency', () => {
  it('admin2 gets 403 on program 1 questionnaire', async () => {
    const res = await request(app).get(`/api/v1/questionnaires/${ids.quizId}`).set(auth(admin2Token));
    expect(res.status).toBe(403);
  });

  it('cannot assign a student from another program', async () => {
    const res = await request(app)
      .post(`/api/v1/questionnaires/${ids.quizId}/assignments`)
      .set(auth(adminToken))
      .send({ studentIds: [ids.student2Id] });
    // Assignment succeeds structurally but skips the out-of-program student.
    expect(res.status).toBe(201);
    expect(res.body.data.assigned).toBe(0);
    expect(res.body.data.skipped.length).toBe(1);
  });

  it('assigns a student within the same program', async () => {
    const res = await request(app)
      .post(`/api/v1/questionnaires/${ids.quizId}/assignments`)
      .set(auth(adminToken))
      .send({ studentIds: [ids.studentId] });
    expect(res.status).toBe(201);
    expect(res.body.data.assigned).toBe(1);
  });
});
