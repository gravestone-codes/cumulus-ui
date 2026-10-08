import { describe, expect, it } from 'vitest';
import {
  boundsOf,
  choicesOf,
  decodeValue,
  encodeValue,
  invalidReason,
  kindOf,
  leafSchema,
  mergeBodies,
  nest,
  setDelta,
} from './fieldSchema.js';

// Shapes copied from the NVUE 5.14 PATCH schemas the backend serves.
const LINK = {
  properties: {
    mtu: { type: 'integer', minimum: 552, maximum: 9216 },
    speed: { type: 'string', anyOf: [{ enum: ['auto', '1G', '100G', null] }] },
    lanes: { type: 'integer', enum: [1, 2, 4, 8, null] },
    'auto-negotiate': { type: 'object', enum: ['on', 'off', null] },
    state: {
      type: 'object',
      properties: { up: { type: 'object', properties: {} }, down: { type: 'object' } },
    },
    breakout: {
      type: 'object',
      'x-propertyNames': { anyOf: [{ enum: ['1x', '4x', 'disabled', null] }] },
      additionalProperties: { type: 'object' },
    },
  },
};
const DOMAIN = {
  properties: {
    untagged: {
      anyOf: [
        { type: 'integer', minimum: 1, maximum: 4094 },
        { type: 'string', enum: ['none', null] },
      ],
    },
    'mac-address': {
      type: 'string',
      anyOf: [
        {
          type: 'string',
          anyOf: [
            { type: 'string', format: 'mac' },
            { type: 'string', enum: [null] },
          ],
        },
        { type: 'string', enum: ['auto', null] },
      ],
    },
  },
};
const IP = {
  properties: { address: { type: 'object', 'x-propertyNames': { anyOf: [] }, additionalProperties: {} } },
};

describe('kind + choices from the spec', () => {
  it('reads enums, numeric bounds, tag objects and map keys', () => {
    expect(kindOf(leafSchema(LINK, 'mtu'))).toBe('number');
    expect(boundsOf(leafSchema(LINK, 'mtu'))).toEqual({ min: 552, max: 9216 });
    expect(kindOf(leafSchema(LINK, 'speed'))).toBe('choice');
    expect(choicesOf(leafSchema(LINK, 'speed'))).toEqual(['auto', '1G', '100G']);
    expect(kindOf(leafSchema(LINK, 'auto-negotiate'))).toBe('choice');
    expect(kindOf(leafSchema(LINK, 'state'))).toBe('keyed');
    expect(choicesOf(leafSchema(LINK, 'state'))).toEqual(['up', 'down']);
    expect(kindOf(leafSchema(LINK, 'breakout'))).toBe('keyed');
    expect(choicesOf(leafSchema(LINK, 'breakout'))).toEqual(['1x', '4x', 'disabled']);
    expect(kindOf(leafSchema(IP, 'address'))).toBe('set');
    expect(kindOf(undefined, 'text')).toBe('text');
  });
  it('reads value-or-keyword leaves as free entry with the keywords kept', () => {
    const untagged = leafSchema(DOMAIN, 'untagged');
    expect(kindOf(untagged)).toBe('number');
    expect(choicesOf(untagged)).toEqual(['none']);
    expect(boundsOf(untagged)).toEqual({ min: 1, max: 4094 });
    expect(kindOf(leafSchema(DOMAIN, 'mac-address'))).toBe('text');
    expect(choicesOf(leafSchema(DOMAIN, 'mac-address'))).toEqual(['auto']);
  });
});

describe('decode/encode', () => {
  it('round-trips each kind into NVUE shapes', () => {
    expect(decodeValue('keyed', { down: {} })).toBe('down');
    expect(encodeValue('keyed', 'down')).toEqual({ down: {} });
    expect(decodeValue('set', { '10.0.0.3/31': {}, '10.0.0.1/31': {} })).toBe('10.0.0.1/31\n10.0.0.3/31');
    expect(encodeValue('number', '9216')).toBe(9216);
    expect(encodeValue('choice', '4', ['1', '2', '4', '8'])).toBe(4);
    expect(encodeValue('choice', '100G', ['auto', '100G'])).toBe('100G');
    expect(decodeValue('choice', undefined)).toBe('');
  });
  it('diffs sets and builds nested bodies', () => {
    expect(setDelta('a\nb', 'b, c')).toEqual({ add: ['c'], remove: ['a'] });
    expect(mergeBodies(nest('link/mtu', 9000), nest('link/state', { up: {} }))).toEqual({
      link: { mtu: 9000, state: { up: {} } },
    });
  });
  it('validates numbers against spec bounds', () => {
    const mtu = leafSchema(LINK, 'mtu');
    expect(invalidReason('number', '100', mtu)).toBe('Must be at least 552.');
    expect(invalidReason('number', '9.5', mtu)).toBe('Must be a whole number.');
    expect(invalidReason('number', '9000', mtu)).toBeNull();
    const untagged = leafSchema(DOMAIN, 'untagged');
    expect(invalidReason('number', 'none', untagged)).toBeNull();
    expect(invalidReason('number', '5000', untagged)).toBe('Must be at most 4094.');
    expect(encodeValue('number', 'none', ['none'])).toBe('none');
    expect(encodeValue('number', '10', ['none'])).toBe(10);
  });
});
