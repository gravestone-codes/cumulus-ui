import { describe, expect, it } from 'vitest';
import { actionPaths } from './SectionActions.js';
import { mapKeys, probeMethods } from './SubCollections.js';

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
