import { describe, expect, it } from 'vitest';
import { actionParams, actionPaths } from './SectionActions.js';
import { childObjectKeys, hasChildren, mapKeys, probeMethods } from './SubCollections.js';

const routes: Record<string, string[]> = {
  '/system/packages': ['delete', 'get', 'patch', 'post'],
  '/system/packages/key': ['get', 'post'],
  '/system/packages/key/{key-id}': ['get', 'post'],
  '/system/packages/to': ['post'],
  '/system/aaa/user': ['post'],
  '/system/aaa/user/{user-id}': ['delete', 'get', 'patch', 'post'],
  '/service/ptp/{instance-id}/monitor/timestamp-log': ['post'],
};

describe('actionPaths', () => {
  it('lists concrete POSTs at or under the section, sorted', () => {
    expect(actionPaths(routes, '/system/packages')).toEqual([
      '/system/packages',
      '/system/packages/key',
      '/system/packages/to',
    ]);
  });

  it('keeps member-templated actions off section cards', () => {
    expect(actionPaths(routes, '/system/aaa')).toEqual(['/system/aaa/user']);
    expect(actionPaths(routes, '/service/ptp')).toEqual([]);
  });

  it('matches nothing outside the subtree', () => {
    expect(actionPaths(routes, '/service/ntp')).toEqual([]);
  });
});

describe('actionParams', () => {
  const schema = {
    properties: {
      '@fetch': {
        type: 'object',
        properties: {
          state: { type: 'string', enum: ['inactive', 'start'] },
          timeout: { type: 'integer' },
          status: { type: 'string' },
          percentage: { type: 'string' },
          detail: { type: 'string' },
          'http-status': { type: 'number' },
          type: { type: 'string' },
          issue: { type: 'array' },
        },
      },
      '@export': {
        type: 'object',
        properties: {
          parameters: { type: 'object', properties: { force: { type: 'boolean' } } },
          status: { type: 'string' },
        },
      },
    },
  };
  it('keeps @action inputs, drops envelope outputs', () => {
    expect(actionParams(schema).sort()).toEqual(
      ['@export/parameters/force', '@fetch/state', '@fetch/timeout'].sort(),
    );
  });
});

describe('probeMethods', () => {
  it('resolves concrete probes to template methods', () => {
    expect(probeMethods(routes, '/system/packages/key/-')).toEqual(['get', 'post']);
    expect(probeMethods(routes, '/service/ptp/-/monitor/timestamp-log')).toEqual(['post']);
  });

  it('returns empty for unknown paths', () => {
    expect(probeMethods(routes, '/system/nope/-')).toEqual([]);
  });
});

describe('mapKeys', () => {
  it('finds nested row collections, skipping actions and scalars', () => {
    expect(
      mapKeys({
        properties: {
          server: { type: 'object', additionalProperties: { type: 'object' } },
          pool: { type: 'object', additionalProperties: { type: 'object' } },
          mode: { type: 'string' },
          '@clear': { type: 'object', additionalProperties: { type: 'object' } },
        },
      }),
    ).toEqual(['server', 'pool']);
  });

  it('tolerates bare schemas', () => {
    expect(mapKeys(null)).toEqual([]);
    expect(mapKeys({})).toEqual([]);
  });
});

describe('childObjectKeys', () => {
  it('finds drillable singletons, skipping maps and actions', () => {
    expect(
      childObjectKeys({
        properties: {
          router: { type: 'object', properties: { bgp: { type: 'object' } } },
          server: { type: 'object', additionalProperties: { type: 'object' } },
          mode: { type: 'string' },
          '@clear': { type: 'object', properties: {} },
        },
      }),
    ).toEqual(['router']);
  });
});

describe('hasChildren', () => {
  it('is true for maps and drillable objects only', () => {
    expect(hasChildren({ properties: { server: { additionalProperties: {} } } })).toBe(true);
    expect(hasChildren({ properties: { router: { properties: {} } } })).toBe(true);
    expect(hasChildren({ properties: { mode: { type: 'string' } } })).toBe(false);
    expect(hasChildren(null)).toBe(false);
  });
});
