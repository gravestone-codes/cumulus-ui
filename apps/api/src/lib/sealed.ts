/**
 * Field-level encryption for stored secrets (switch passwords). AES-256-GCM
 * with a key derived from SWITCH_CRED_KEY. One function pair for every
 * secret-at-rest in the system — no ad-hoc crypto elsewhere.
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

function keyOf(secret: string): Buffer {
  return createHash('sha256').update(secret, 'utf8').digest();
}

/** Seal plaintext. Returns iv.body.tag (base64). Pure. */
export function seal(secret: string, plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', keyOf(secret), iv);
  const body = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return `${iv.toString('base64')}.${body.toString('base64')}.${cipher.getAuthTag().toString('base64')}`;
}

/** Open. Throws on tamper, wrong secret, or malformed input. Pure. */
export function open(secret: string, sealed: string): string {
  const [iv, body, tag] = sealed.split('.');
  if (!iv || !body || !tag) throw new Error('malformed sealed value');
  const decipher = createDecipheriv('aes-256-gcm', keyOf(secret), Buffer.from(iv, 'base64'));
  decipher.setAuthTag(Buffer.from(tag, 'base64'));
  return decipher.update(Buffer.from(body, 'base64'), undefined, 'utf8') + decipher.final('utf8');
}
