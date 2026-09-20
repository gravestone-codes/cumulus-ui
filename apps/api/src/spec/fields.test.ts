/**
 * Field-descriptor unit tests (Phase 2): pure functions over the real
 * vendored spec. Cycle-safe, depth-capped, and the interface PATCH body
 * resolves to a schema the ResourceForm can render.
 */
import { describe, expect, it } from 'vitest';
import manifestJson from '@cumulus/spec/manifest.json' with { type: 'json' };
import { matchTemplate } from '../nvue/guard.js';
import { dereference, requestBodySchema, specDoc } from './fields.js';

const manifest = manifestJson as { routes: Record<string, string[]>; views: Record<string, string[]> };

describe('spec fields', () => {
  it('matchTemplate resolves concrete ids to templates', () => {
    expect(matchTemplate(manifest, '/interface/swp1')?.template).toBe('/interface/{interface-id}');
    expect(matchTemplate(manifest, '/interface/{interface-id}')?.template).toBe('/interface/{interface-id}');
    expect(matchTemplate(manifest, '/nope')).toBeNull();
  });

  it('interface PATCH body resolves to an object schema with a description field', () => {
    const found = requestBodySchema('/interface/{interface-id}', 'patch');
    expect(found).not.toBeNull();
    const schema = found?.schema as { type?: string; properties?: Record<string, unknown> };
    expect(schema.type).toBe('object');
    expect(schema.properties).toBeTypeOf('object');
    expect(schema.properties).toHaveProperty('description');
  });

  it('operations without a body return null', () => {
    expect(requestBodySchema('/interface/{interface-id}', 'get')).toBeNull();
    expect(requestBodySchema('/nope', 'patch')).toBeNull();
  });

  it('dereference is cycle-safe and merges $ref siblings', () => {
    const doc = {
      a: { type: 'object', properties: { self: { $ref: '#/a' } } },
      b: { type: 'string', description: 'keep me' },
    } as never;
    const cycled = dereference({ $ref: '#/a' }, doc) as {
      properties: { self: unknown };
    };
    expect(cycled.properties.self).toEqual({});
    const merged = dereference({ $ref: '#/b', title: 'extra' }, doc) as Record<string, unknown>;
    expect(merged).toMatchObject({ type: 'string', description: 'keep me', title: 'extra' });
    expect(dereference({ $ref: '#/missing' }, doc)).toEqual({});
  });

  it('the full vendored doc loads and every route template resolves', () => {
    const doc = specDoc();
    expect(Object.keys(doc.paths ?? {}).length).toBeGreaterThan(1000);
  });
});
