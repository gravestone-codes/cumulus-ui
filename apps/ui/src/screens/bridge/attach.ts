/**
 * VlanAttachment planning (R13, roadmap 3B.2), kept pure for tests.
 * Member ports are interface (S1) config — every call PATCHes or DELETEs
 * `/interface/{port}/bridge/domain/{domain}` — so attach and detach ride
 * the same ChangeFlow as every other write. Ports (incl. bonds) arrive as
 * names from the S1 picker; no bond state lives here (3B identity check).
 */
import type { StageCall } from '../../lib/api.js';
import { mergeBodies, nest, setDelta, setEntries } from '../../lib/fieldSchema.js';
import { getPath } from '../../lib/format.js';
import { displayValue } from '../iface/ConfigTab.js';

export type AttachMode = 'access' | 'trunk';

/** One port's attachment as decoded text ('' = unset, sets comma/newline separated). */
export interface PortAttachment {
  access: string;
  vlans: string;
  untagged: string;
}

/** Form input for one attach; absent text = empty. */
export interface AttachInput {
  mode: AttachMode;
  access: string;
  vlans: string;
  untagged: string;
}

/** NVUE spec range for a VLAN id; the UI passes live bounds from /spec/fields when loaded. */
export const VID_BOUNDS = { min: 1, max: 4094 } as const;

const vidReason = (text: string, bounds: { min: number; max: number }): string | null => {
  const n = Number(text.trim());
  if (!Number.isInteger(n)) return 'Must be a whole number.';
  if (n < bounds.min) return `Must be at least ${bounds.min}.`;
  if (n > bounds.max) return `Must be at most ${bounds.max}.`;
  return null;
};

/**
 * Validate one attach form. Access needs its VID; trunk needs its VLAN
 * list with every id in range, and an untagged VID only inside that list.
 * @throws never — returns the message, null when fine.
 */
export function invalidAttach(
  input: AttachInput,
  bounds: { min: number; max: number } = VID_BOUNDS,
): string | null {
  if (input.mode === 'access') {
    const t = input.access.trim();
    if (!t) return 'Access VLAN is required.';
    return vidReason(t, bounds) ? `Access VLAN: ${vidReason(t, bounds)}` : null;
  }
  const vids = setEntries(input.vlans);
  if (vids.length === 0) return 'VLANs are required (comma-separated).';
  for (const v of vids) {
    const r = vidReason(v, bounds);
    if (r) return `VLAN ${v}: ${r}`;
  }
  const u = input.untagged.trim();
  if (u) {
    const r = vidReason(u, bounds);
    if (r) return `Untagged: ${r}`;
    if (!vids.includes(String(Number(u)))) return 'Untagged must be one of the VLANs.';
  }
  return null;
}

/** One port's attachment out of its applied interface object; undefined when detached. */
export function portAttachment(
  iface: Record<string, unknown> | undefined,
  domain: string,
): PortAttachment | undefined {
  const m = getPath(iface, `bridge/domain/${domain}`);
  if (typeof m !== 'object' || m === null || Array.isArray(m)) return undefined;
  const o = m as Record<string, unknown>;
  return {
    access: displayValue(o['access']),
    vlans: displayValue(o['vlan']),
    untagged: displayValue(o['untagged']),
  };
}

const sameSet = (a: string, b: string) => setEntries(a).join('\n') === setEntries(b).join('\n');

/**
 * PATCH body for one port: only leaves that differ from `now`. Access and
 * trunk are exclusive — switching modes nulls the other side. A changed
 * VLAN set sends its whole target membership (kept keys pinned, removed as
 * null), the 3B.1 set semantics; clears are PATCH null (leaves own no DELETE).
 */
export function attachBody(now: PortAttachment, input: AttachInput): Record<string, unknown> {
  const wantAccess = input.mode === 'access' ? input.access.trim() : '';
  const wantVlans = input.mode === 'trunk' ? setEntries(input.vlans).join(', ') : '';
  const wantUntagged = input.mode === 'trunk' ? input.untagged.trim() : '';
  let body: Record<string, unknown> = {};
  if ((now.access || '') !== wantAccess) {
    body = mergeBodies(body, nest('access', wantAccess === '' ? null : Number(wantAccess)));
  }
  if (!sameSet(now.vlans || '', wantVlans)) {
    if (wantVlans === '') {
      body = mergeBodies(body, nest('vlan', null));
    } else {
      const { remove } = setDelta(now.vlans || '', wantVlans);
      body = mergeBodies(
        body,
        nest(
          'vlan',
          Object.fromEntries([...setEntries(wantVlans).map((k) => [k, {}]), ...remove.map((k) => [k, null])]),
        ),
      );
    }
  }
  if ((now.untagged || '') !== wantUntagged) {
    body = mergeBodies(body, nest('untagged', wantUntagged === '' ? null : Number(wantUntagged)));
  }
  return body;
}

export type AttachPlan =
  { ok: true; calls: Record<string, StageCall[]>; unchanged: string[] } | { ok: false; error: string };

/**
 * Build every member's attach calls for `ports`. `current[sw][port]` is the
 * decoded applied attachment (absent = detached). A switch whose ports
 * already match gets no call, so applies only touch real diffs. `exists`
 * narrows to switches holding the interface itself (a port missing there is
 * skipped, never created by an attachment PATCH).
 */
export function planAttachCalls(
  domain: string,
  members: string[],
  ports: string[],
  input: AttachInput,
  current: Record<string, Record<string, PortAttachment | undefined>>,
  bounds: { min: number; max: number } = VID_BOUNDS,
  exists?: Record<string, Record<string, boolean>>,
): AttachPlan {
  if (ports.length === 0) return { ok: false, error: 'Pick at least one port.' };
  const reason = invalidAttach(input, bounds);
  if (reason) return { ok: false, error: reason };
  const calls: Record<string, StageCall[]> = {};
  const unchanged: string[] = [];
  for (const sw of members) {
    const list: StageCall[] = [];
    for (const port of ports) {
      if (exists && !exists[sw]?.[port]) continue;
      const now = current[sw]?.[port] ?? { access: '', vlans: '', untagged: '' };
      const body = attachBody(now, input);
      if (Object.keys(body).length > 0) {
        list.push({ path: `/interface/${port}/bridge/domain/${domain}`, method: 'PATCH', body });
      }
    }
    if (list.length > 0) calls[sw] = list;
    else unchanged.push(sw);
  }
  if (Object.keys(calls).length === 0) return { ok: false, error: 'No changes to stage.' };
  return { ok: true, calls, unchanged };
}

/**
 * Build every member's detach calls for `ports`. Only holders (ports
 * attached there) get a DELETE; members holding none land in `unchanged`.
 */
export function planDetachCalls(
  domain: string,
  members: string[],
  ports: string[],
  attached: Record<string, Record<string, boolean>>,
): AttachPlan {
  if (ports.length === 0) return { ok: false, error: 'Pick at least one port.' };
  const calls: Record<string, StageCall[]> = {};
  const unchanged: string[] = [];
  for (const sw of members) {
    const list: StageCall[] = [];
    for (const port of ports) {
      if (attached[sw]?.[port]) {
        list.push({ path: `/interface/${port}/bridge/domain/${domain}`, method: 'DELETE' });
      }
    }
    if (list.length > 0) calls[sw] = list;
    else unchanged.push(sw);
  }
  if (Object.keys(calls).length === 0) return { ok: false, error: 'Nothing attached to detach.' };
  return { ok: true, calls, unchanged };
}
