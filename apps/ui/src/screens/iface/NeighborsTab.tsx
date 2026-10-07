/**
 * Neighbors tab (3A.5, catalogue §10): LLDP neighbors and the ARP/ND table
 * for one interface. Group scope is the same tables with a Switch column.
 */
import { Card } from '../../components/cards.js';
import { DataTable, type GridColumn } from '../../components/DataTable.js';
import { Spinner } from '../../components/ui.js';
import { firstDefined } from '../../lib/format.js';
import { usePerSwitch, type Scope } from './scope.js';
import { displayValue } from './ConfigTab.js';

type Obj = Record<string, unknown>;
type Row = { sw: string; id: string; o: Obj; family?: string };

export function NeighborsTab({
  scope,
  ifaceId,
  present,
}: {
  scope: Scope;
  ifaceId: string;
  present: string[];
}) {
  const lldp = usePerSwitch<Obj>(scope, `/interface/${ifaceId}/lldp/neighbor`);
  const ip = usePerSwitch<Obj>(scope, `/interface/${ifaceId}/ip/neighbor`);
  const group = scope.kind === 'group';
  const sw: GridColumn<Row>[] = group ? [{ key: 'sw', label: 'Switch', value: (r) => r.sw }] : [];

  const lldpRows: Row[] = present.flatMap((s) =>
    Object.entries(lldp.objects[s] ?? {}).map(([id, o]) => ({ sw: s, id, o: (o ?? {}) as Obj })),
  );
  const ipRows: Row[] = present.flatMap((s) =>
    (['ipv4', 'ipv6'] as const).flatMap((family) =>
      Object.entries(((ip.objects[s] ?? {})[family] as Obj | undefined) ?? {}).map(([id, o]) => ({
        sw: s,
        id,
        family,
        o: (o ?? {}) as Obj,
      })),
    ),
  );

  const lldpCols: GridColumn<Row>[] = [
    ...sw,
    {
      key: 'name',
      label: 'System',
      always: true,
      value: (r) => firstDefined(r.o, 'chassis/system-name', 'chassis/chassis-id') ?? r.id,
    },
    {
      key: 'port',
      label: 'Port',
      value: (r) => firstDefined(r.o, 'port/name', 'port/description', 'port/port-id') ?? '—',
    },
    {
      key: 'mgmt',
      label: 'Mgmt address',
      value: (r) => displayValue((r.o['chassis'] as Obj | undefined)?.['management-address-ipv4']) || '—',
    },
    {
      key: 'desc',
      label: 'Description',
      value: (r) => firstDefined(r.o, 'chassis/system-description') ?? '—',
    },
  ];
  const ipCols: GridColumn<Row>[] = [
    ...sw,
    { key: 'addr', label: 'Address', always: true, value: (r) => r.id },
    { key: 'family', label: 'Family', value: (r) => r.family ?? '—' },
    { key: 'mac', label: 'MAC', value: (r) => firstDefined(r.o, 'lladdr') ?? '—' },
    { key: 'state', label: 'State', value: (r) => displayValue(r.o['state']) || '—' },
    { key: 'flags', label: 'Flags', value: (r) => displayValue(r.o['flag']) || '—' },
  ];

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <Card title="LLDP neighbors">
        {lldp.loading ? (
          <Spinner label="Loading LLDP neighbors" />
        ) : (
          <DataTable
            cols={lldpCols}
            rows={lldpRows}
            storageKey={`cumulus.iface-lldp.${scope.kind}.v1`}
            empty={<p style={muted}>No LLDP neighbors seen on this port.</p>}
          />
        )}
      </Card>
      <Card title="ARP / ND">
        {ip.loading ? (
          <Spinner label="Loading IP neighbors" />
        ) : (
          <DataTable
            cols={ipCols}
            rows={ipRows}
            storageKey={`cumulus.iface-ipneigh.${scope.kind}.v1`}
            empty={<p style={muted}>No IP neighbors on this port.</p>}
          />
        )}
      </Card>
    </div>
  );
}

const muted: React.CSSProperties = { fontSize: 14, color: 'var(--color-muted)', margin: 0 };
