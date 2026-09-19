import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { buildApp } from './app.js';
import { fixtureNames } from './fixtures/routes.js';

describe('fixtures', () => {
  it('lists names from disk', () => {
    expect(fixtureNames()).toContain('interface');
    expect(fixtureNames()).toContain('summary');
  });

  it('serves JSON, 404s unknown, rejects traversal', async () => {
    const app = await buildApp({ auth: false });
    await app.ready();
    try {
      const api = request(app.server);
      const res = await api.get('/api/v1/fixtures/interface');
      expect(res.status).toBe(200);
      expect(res.body.interface.swp1.state).toBe('up');
      expect(await api.get('/api/v1/fixtures/nope')).toMatchObject({ status: 404 });
      expect(await api.get('/api/v1/fixtures/..%2Fpackage')).toMatchObject({ status: 400 });
    } finally {
      await app.close();
    }
  });
});
