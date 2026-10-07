/**
 * Statistics depth (3A.4, catalogue §10): drop/error breakdown, transceiver
 * and PHY health. Counters and transceiver work in both scopes (one column
 * per switch); PHY detail is per switch by nature (design §7), so groups
 * link out instead.
 */
import { Card } from '../../components/cards.js';
import { ValueGrid } from '../../components/resource.js';
import { MixedValue } from '../../components/mixed.js';
import { mergeValues } from '../../lib/merge.js';
import { packets } from '../../components/cards.js';
import { usePerSwitch, type Scope } from './scope.js';
import { displayValue } from './ConfigTab.js';

type Obj = Record<string, unknown>;

const cellStyle: React.CSSProperties = {
  padding: '8px 12px',
  borderTop: '1px solid var(--color-border)',
  fontSize: 13,
  fontVariantNumeric: 'tabular-nums',
};
const headStyle: React.CSSProperties = {
  ...cellStyle,
  borderTop: 'none',
  fontSize: 11,
  fontWeight: 700,
  textTransform: 'uppercase',
  letterSpacing: '0.06em',
  color: 'var(--color-muted)',
  textAlign: 'left',
};

const num = (v: unknown) => (typeof v === 'number' ? packets(v) : v === undefined ? '—' : String(v));

/** Drop and error counters by cause (`/counters`): rows per cause, rx/tx per switch. */
export function CountersCard({
  scope,
  ifaceId,
  present,
}: {
  scope: Scope;
  ifaceId: string;
  present: string[];
}) {
  const read = usePerSwitch<Obj>(scope, `/interface/${ifaceId}/counters`);
  if (read.loading || read.error) return null;
  const causes = (kind: 'drops' | 'errors') => [
    ...new Set(present.flatMap((sw) => Object.keys((read.objects[sw]?.[kind] as Obj | undefined) ?? {}))),
  ];
  const at = (sw: string, kind: string, cause: string) =>
    ((read.objects[sw]?.[kind] as Obj | undefined)?.[cause] as Obj | undefined) ?? {};
  const rows = (['drops', 'errors'] as const).flatMap((kind) =>
    causes(kind).map((cause) => ({ kind, cause })),
  );
  if (rows.length === 0) return null;
  return (
    <Card
      title="Discards & errors by cause"
      info="Cumulative since the last clear. Clear counters lives in the Actions menu."
    >
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th style={headStyle}>Counter</th>
              {present.map((sw) => (
                <th key={sw} style={headStyle} colSpan={1}>
                  {present.length > 1 ? `${sw} · rx / tx` : 'Receive / transmit'}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map(({ kind, cause }) => (
              <tr key={`${kind}-${cause}`}>
                <td style={{ ...cellStyle, fontWeight: cause.startsWith('Total') ? 700 : 400 }}>{cause}</td>
                {present.map((sw) => {
                  const c = at(sw, kind, cause);
                  const hot = [c['receive'], c['transmit']].some((v) => typeof v === 'number' && v > 0);
                  return (
                    <td key={sw} style={{ ...cellStyle, color: hot ? 'var(--color-warn)' : undefined }}>
                      {num(c['receive'])} / {num(c['transmit'])}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

/** Transceiver identity + health (scalar leaves). Hidden when every member reports nothing. */
export function TransceiverCard({
  scope,
  ifaceId,
  present,
}: {
  scope: Scope;
  ifaceId: string;
  present: string[];
}) {
  const read = usePerSwitch<Obj>(scope, `/interface/${ifaceId}/transceiver`);
  if (read.loading || read.error) return null;
  const leaves = [
    ...new Set(
      present.flatMap((sw) =>
        Object.entries(read.objects[sw] ?? {})
          .filter(([, v]) => typeof v !== 'object')
          .map(([k]) => k),
      ),
    ),
  ];
  const items = leaves
    .map((leaf) => ({
      leaf,
      m: mergeValues(Object.fromEntries(present.map((sw) => [sw, displayValue(read.objects[sw]?.[leaf])]))),
    }))
    .filter(({ m }) => !(m.kind === 'same' && (m.value === '' || m.value === 'N/A')));
  return (
    <Card title="Transceiver">
      {items.length === 0 ? (
        <p style={{ fontSize: 14, color: 'var(--color-muted)', margin: 0 }}>
          No transceiver data reported for this port.
        </p>
      ) : (
        <ValueGrid
          items={items.map(({ leaf, m }) => ({
            label: leaf.replace(/-/g, ' '),
            value:
              m.kind === 'mixed' ? (
                <MixedValue groups={m.groups} label={leaf} />
              ) : m.kind === 'same' ? (
                m.value
              ) : (
                '—'
              ),
          }))}
        />
      )}
    </Card>
  );
}

const PHY_LEAVES: Array<[string, string]> = [
  ['effective-ber', 'Effective BER'],
  ['raw-ber', 'Raw BER'],
  ['symbol-ber', 'Symbol BER'],
  ['effective-errors', 'Effective errors'],
  ['symbol-errors', 'Symbol errors'],
  ['phy-received-bits', 'Received bits'],
  ['time-since-last-clear-min', 'Since last clear (min)'],
];

/** PHY signal health for one switch (`link/phy-detail`). */
export function PhyCard({ switchId, ifaceId }: { switchId: string; ifaceId: string }) {
  const read = usePerSwitch<Obj>({ kind: 'switch', id: switchId }, `/interface/${ifaceId}/link/phy-detail`);
  const o = read.objects[switchId];
  if (read.loading || read.error || !o || Object.keys(o).length === 0) return null;
  return (
    <Card title="PHY" info="Signal health from the port's PHY. Clear PHY counters lives in the Actions menu.">
      <ValueGrid
        items={PHY_LEAVES.filter(([k]) => o[k] !== undefined).map(([k, label]) => ({
          label,
          value: num(o[k]),
        }))}
      />
    </Card>
  );
}
