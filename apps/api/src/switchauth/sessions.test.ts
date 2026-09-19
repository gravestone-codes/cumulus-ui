import { describe, expect, it } from 'vitest';
import { SignJWT } from 'jose';
import {
  dropSwitchToken,
  dropUserTokens,
  expiryOf,
  getSwitchToken,
  setSwitchToken,
  switchTokenCount,
} from './sessions.js';

const SECRET = new TextEncoder().encode('test-secret');

async function jwt(expiresIn: string | null): Promise<string> {
  let builder = new SignJWT({ sub: 'u' }).setProtectedHeader({ alg: 'HS256' });
  if (expiresIn) builder = builder.setExpirationTime(expiresIn);
  return builder.sign(SECRET);
}

describe('switch sessions (pure, memory-only)', () => {
  it('stores, returns, drops, and counts', async () => {
    setSwitchToken('u1', 'sw1', await jwt('1h'));
    expect(getSwitchToken('u1', 'sw1')).toContain('.');
    expect(switchTokenCount()).toBeGreaterThanOrEqual(1);
    dropSwitchToken('u1', 'sw1');
    expect(getSwitchToken('u1', 'sw1')).toBeNull();
  });

  it('expired tokens evaporate on read', async () => {
    setSwitchToken('u1', 'sw2', await jwt('-1h'));
    expect(getSwitchToken('u1', 'sw2')).toBeNull();
    expect(getSwitchToken('u1', 'sw2')).toBeNull();
  });

  it('tokens without exp are kept; malformed strings expire immediately', async () => {
    setSwitchToken('u1', 'sw3', await jwt(null));
    expect(getSwitchToken('u1', 'sw3')).not.toBeNull();
    expect(expiryOf('not-a-jwt')).toBe(0);
    dropSwitchToken('u1', 'sw3');
  });

  it('dropUserTokens only drops that user', async () => {
    setSwitchToken('u1', 'sw1', await jwt('1h'));
    setSwitchToken('u11', 'sw1', await jwt('1h'));
    dropUserTokens('u1');
    expect(getSwitchToken('u1', 'sw1')).toBeNull();
    expect(getSwitchToken('u11', 'sw1')).not.toBeNull();
    dropUserTokens('u11');
  });
});
