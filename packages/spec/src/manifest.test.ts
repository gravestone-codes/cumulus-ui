import { describe, expect, it } from 'vitest';
import { buildManifest } from './manifest.js';

describe('buildManifest', () => {
  it('counts paths, verbs and top segments', () => {
    const m = buildManifest({
      info: { title: 'NVUE', version: '1.0' },
      paths: {
        '/': { get: {} },
        '/interface': { get: {}, patch: {} },
        '/interface/{id}': { get: {}, delete: {} },
      },
    });
    expect(m.pathCount).toBe(3);
    expect(m.verbs).toMatchObject({ get: 3, patch: 1, delete: 1 });
    expect(m.topSegments).toMatchObject({ root: 1, interface: 2 });
  });

  it('extracts ?view= enums per path', () => {
    const m = buildManifest({
      paths: {
        '/interface': { get: { parameters: [{ name: 'view', schema: { enum: ['status', 'counters'] } }] } },
      },
    });
    expect(m.views).toEqual({ '/interface': ['counters', 'status'] });
  });

  it('extracts views from view:* response links (this spec’s shape)', () => {
    const m = buildManifest({
      'x-defs': {
        show: {
          content: {},
          links: { 'view:status': { operationId: 'getInterfaces' }, 'view:rates': {}, other: {} },
        },
      },
      paths: {
        '/interface': { get: { responses: { 200: { $ref: '#/x-defs/show' } } } },
        '/plain': { get: { responses: { 200: { content: {} } } } },
      },
    });
    expect(m.views).toEqual({ '/interface': ['rates', 'status'] });
  });

  it('maps routes to allowed methods', () => {
    const m = buildManifest({
      paths: {
        '/interface': { get: {}, patch: {} },
        '/revision': { get: {}, post: {} },
      },
    });
    expect(m.routes).toEqual({ '/interface': ['get', 'patch'], '/revision': ['get', 'post'] });
  });

  it('never throws on unknown shapes', () => {
    expect(buildManifest({})).toMatchObject({ pathCount: 0, title: 'unknown' });
    expect(buildManifest({ paths: { '/x': { bogus: {} } } }).verbs).toEqual({});
  });
});
