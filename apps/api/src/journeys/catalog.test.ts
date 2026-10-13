/**
 * Journey catalog contract: a journey that drifts from the vendored NVUE spec
 * fails here, not on a switch. Every planned write resolves to a manifest
 * path that allows its method, every body key exists in that operation's
 * schema, every check reads a GET path, and every ref names a value an
 * earlier step produces.
 */
import { describe, expect, it } from 'vitest';
import manifestJson from '@cumulus/spec/manifest.json' with { type: 'json' };
import { matchTemplate } from '../nvue/guard.js';
import { requestBodySchema } from '../spec/fields.js';
import { JOURNEYS, type JourneyStep } from './catalog.js';
import { planCalls, verifyReads, type Values } from './engine.js';

const manifest = manifestJson as { routes: Record<string, string[]>; views: Record<string, string[]> };

/** Representative values per journey: every optional field set, so every branch plans. */
const SAMPLES: Record<string, Values[]> = {
  'vrf-bringup': [
    {
      'vrf.name': 'RED',
      'vrf.vid': 10,
      'vrf.gateway': '10.1.10.1/24',
      'vrf.bridge': 'br_default',
      'vrf.vni': 4001,
      'vrf.net': '10.1.10.0/24',
    },
  ],
  'server-attach': [
    {
      'attach.bond': 'bond1',
      'attach.members': ['swp1', 'swp2'],
      'attach.vlan': 10,
      'attach.bridge': 'br_default',
      'attach.mtu': 9216,
      'attach.mlag': 5,
      'attach.description': 'db01',
    },
  ],
  'route-leak': [
    {
      'leak.vrf': 'RED',
      'leak.prefix': '10.20.0.0/16',
      'leak.net': '10.20.0.0/16',
      'present.protocol': 'bgp',
      'exporter.source': 'BLUE',
      'import.routemap': 'IMPORT',
      'fix.remedy': 'route-map',
      'fix.routemap': 'NO-LEAK',
    },
  ],
};

type Schema = Record<string, unknown>;
const isObj = (v: unknown): v is Schema => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Body keys the schema does not know (anyOf branches tried; shapeless nodes accept anything). */
function strays(body: unknown, schema: unknown, at: string): string[] {
  if (!isObj(schema)) return [];
  if (Array.isArray(schema.anyOf)) {
    const tries = (schema.anyOf as unknown[]).map((b) => strays(body, b, at));
    return tries.some((t) => t.length === 0) ? [] : (tries[0] ?? []);
  }
  if (!isObj(body)) return [];
  const props = isObj(schema.properties) ? schema.properties : {};
  const extra = isObj(schema.additionalProperties) ? schema.additionalProperties : undefined;
  if (Object.keys(props).length === 0 && !extra) return [];
  return Object.entries(body).flatMap(([k, v]) => {
    const child = props[k] ?? extra;
    return child === undefined ? [`${at}/${k}`] : strays(v, child, `${at}/${k}`);
  });
}

/** Names each step makes available as `step.name`. */
function produced(step: JourneyStep): string[] {
  if (step.kind === 'input') {
    return [...step.fields.map((f) => f.name), ...Object.keys(step.derive ?? {})].map(
      (n) => `${step.id}.${n}`,
    );
  }
  return Object.keys(step.verify.capture ?? {}).map((n) => `${step.id}.${n}`);
}

const refsIn = (v: unknown): string[] =>
  [...JSON.stringify(v).matchAll(/\{\{([\w.-]+)\}\}/g)].map((m) => m[1] as string);

describe('journey catalog', () => {
  it('has unique keys and step ids, and samples for every journey', () => {
    expect(new Set(JOURNEYS.map((j) => j.key)).size).toBe(JOURNEYS.length);
    for (const j of JOURNEYS) {
      expect(new Set(j.steps.map((s) => s.id)).size, j.key).toBe(j.steps.length);
      expect(SAMPLES[j.key], j.key).toBeDefined();
      expect(j.steps[0]?.kind, j.key).toBe('input');
    }
  });

  it('refs only name values earlier steps produce; gotos land on real steps', () => {
    for (const j of JOURNEYS) {
      const known = new Set<string>(['item']);
      for (const step of j.steps) {
        const { id, title, help, ...rest } = step;
        void id;
        void title;
        void help;
        for (const ref of refsIn(rest)) expect(known.has(ref), `${j.key}/${step.id}: {{${ref}}}`).toBe(true);
        if (step.kind === 'verify') {
          for (const o of [step.onPass, step.onFail]) {
            if (o && o.goto !== 'end')
              expect(
                j.steps.some((s) => s.id === o.goto),
                `${j.key}: ${o.goto}`,
              ).toBe(true);
          }
        }
        for (const name of produced(step)) known.add(name);
      }
    }
  });

  it('input patterns compile', () => {
    for (const j of JOURNEYS)
      for (const s of j.steps)
        if (s.kind === 'input')
          for (const f of s.fields)
            if (f.pattern) expect(() => new RegExp(f.pattern as string)).not.toThrow();
  });

  it('every planned write hits a manifest path allowing its method, with a body the spec knows', () => {
    for (const j of JOURNEYS) {
      for (const values of SAMPLES[j.key] ?? []) {
        for (const step of j.steps) {
          if (step.kind !== 'change') continue;
          for (const call of planCalls(step.calls, values)) {
            const hit = matchTemplate(manifest, call.path);
            expect(hit, `${j.key}/${step.id}: ${call.path}`).not.toBeNull();
            expect(hit?.methods, `${j.key}/${step.id}: ${call.method} ${call.path}`).toContain(
              call.method.toLowerCase(),
            );
            if (call.body && hit) {
              const schema = requestBodySchema(hit.template, call.method)?.schema;
              expect(schema, `${j.key}/${step.id}: no schema for ${hit.template}`).toBeDefined();
              expect(strays(call.body, schema, hit.template), `${j.key}/${step.id}`).toEqual([]);
            }
          }
        }
      }
    }
  });

  it('the body check is not vacuous: misspelt and misplaced keys are caught', () => {
    const vrf = requestBodySchema('/vrf/{vrf-id}', 'patch')?.schema;
    expect(strays({ tabel: 'auto' }, vrf, '/vrf')).toEqual(['/vrf/tabel']);
    const iface = requestBodySchema('/interface/{interface-id}', 'patch')?.schema;
    expect(strays({ ip: { vrff: 'RED' } }, iface, '/interface')).toEqual(['/interface/ip/vrff']);
    expect(strays({ bond: { member: { swp1: {} } } }, iface, '/interface')).toEqual([]);
  });

  it('every check reads a manifest GET path', () => {
    for (const j of JOURNEYS) {
      for (const values of SAMPLES[j.key] ?? []) {
        for (const step of j.steps) {
          if (step.kind === 'input') continue;
          for (const read of verifyReads(step.verify, values)) {
            expect(
              matchTemplate(manifest, read.path)?.methods,
              `${j.key}/${step.id}: ${read.path}`,
            ).toContain('get');
          }
        }
      }
    }
  });
});
