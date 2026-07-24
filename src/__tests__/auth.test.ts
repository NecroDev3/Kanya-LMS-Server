import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import app from '../app.js';
import { seedTestData, TEST_PASSWORD, type TestIds } from './helpers/seed.js';
import { makeToken } from './helpers/auth.js';

let ids: TestIds;

beforeEach(() => {
  ids = seedTestData();
});

describe('POST /api/v1/auth/login', () => {
  it('returns token + user (with programId) on valid admin credentials', async () => {
    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'admin@test.com', password: TEST_PASSWORD });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.token).toBeTypeOf('string');
    expect(res.body.data.user).toMatchObject({
      id: ids.adminId,
      email: 'admin@test.com',
      role: 'admin',
      programId: ids.programId,
    });
  });

  it('super admin logs in with null programId', async () => {
    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'super@test.com', password: TEST_PASSWORD });

    expect(res.status).toBe(200);
    expect(res.body.data.user.role).toBe('super_admin');
    expect(res.body.data.user.programId).toBeNull();
  });

  it('rejects wrong password with 401', async () => {
    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'admin@test.com', password: 'wrong' });

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('INVALID_CREDENTIALS');
  });

  it('returns 400 when password missing', async () => {
    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'admin@test.com' });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });
});

describe('GET /api/v1/auth/me', () => {
  it('returns current user when authenticated', async () => {
    const token = makeToken({ userId: ids.adminId, email: 'admin@test.com', role: 'admin', programId: ids.programId });

    const res = await request(app).get('/api/v1/auth/me').set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      id: ids.adminId,
      email: 'admin@test.com',
      role: 'admin',
      programId: ids.programId,
    });
  });

  it('returns 401 without auth header', async () => {
    const res = await request(app).get('/api/v1/auth/me');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHORIZED');
  });

  it('returns 401 with invalid token', async () => {
    const res = await request(app).get('/api/v1/auth/me').set('Authorization', 'Bearer invalid-token');
    expect(res.status).toBe(401);
  });
});

describe('POST /api/v1/auth/logout', () => {
  it('returns success (stateless JWT logout)', async () => {
    const token = makeToken({ userId: ids.adminId, email: 'admin@test.com', role: 'admin', programId: ids.programId });
    const res = await request(app).post('/api/v1/auth/logout').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });
});
