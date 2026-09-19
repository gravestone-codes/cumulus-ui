import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { buildApp } from './app.js';

describe('api skeleton', () => {
  it('GET /api/v1/health → 200 {status:ok}', async () => {
    const app = await buildApp({ auth: false });
    await app.ready();
    try {
      const res = await request(app.server).get('/api/v1/health');
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ status: 'ok' });
    } finally {
      await app.close();
    }
  });

  it('unknown route → 404 RFC 9457 problem', async () => {
    const app = await buildApp({ auth: false });
    await app.ready();
    try {
      const res = await request(app.server).get('/api/v1/nope');
      expect(res.status).toBe(404);
      expect(res.body).toMatchObject({ title: 'Not Found', status: 404 });
    } finally {
      await app.close();
    }
  });
});
