/**
 * MAC table tab (roadmap 3B.3): live learned MACs on one bridge domain —
 * MAC, VLAN, interface, type, age. Operational read, flat rows with a Switch
 * column in group scope (the NeighborsTab pattern: search + filters come
 * from DataTable). Clear actions run through ActionRunner: flush-all on the
 * domain, or one MAC by id. Routine class → plain confirm; groups pick
 * members first, as with clear counters.
 */
import { useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api, ApiError, type MemberResult } from '../../lib/api.js';
import { DataTable, type GridColumn } from '../../components/DataTable.js';
import { Alert, Button, Confirm, Modal, Spinner, useToast } from '../../components/ui.js';
import { ReadError } from '../../components/resource.js';
import { ResultList } from '../iface/ChangeFlow.js';
import { refreshInterfaces, usePerSwitch, type Scope } from '../iface/scope.js';
import { clearAllBody, clearOneBody, macEntries, macRows, type MacView } from './mac.js';

type Row = MacView & { sw: string };

const CLEARABLE = new Set(['dynamic', '']);

export function MacTab({
  scope,
  domainId,
  present,
  filterIface,
  onClearFilter,
}: {
  scope: Scope;
  domainId: string;
  present: string[];
  /** When set (from an interface page), rows narrow to this port with a reset chip. */
  filterIface?: string;
  onClearFilter?: () => void;
}) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const group = scope.kind === 'group';
  const path = `/bridge/domain/${domainId}/mac-table`;
  const read = usePerSwitch<Record<string, Record<string, unknown>>>(scope, path);
  const tables = useMemo(
    () => Object.fromEntries(present.map((sw) => [sw, macEntries(read.objects[sw] as never)])),
    [present, read.objects],
  );
  const all = useMemo(() => macRows(present, tables), [present, tables]);
  const rows = filterIface ? all.filter((r) => r.iface === filterIface) : all;
  const failed = Object.keys(read.errors);

  const [confirmAll, setConfirmAll] = useState(false);
  const [picked, setPicked] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<MemberResult[] | null>(null);
  const [confirmOne, setConfirmOne] = useState<Row | null>(null);

  const refresh = () => {
    refreshInterfaces(queryClient);
    read.refetch();
  };

  function openClearAll() {
    setPicked(present);
    setResults(null);
    setError(null);
    setConfirmAll(true);
  }

  async function runClearAll() {
    const body = clearAllBody();
    setBusy(true);
    setError(null);
    try {
      if (scope.kind === 'switch') {
        await api.runAction(scope.id, { path: `${path}/dynamic`, body });
        toast('pass', `Dynamic MACs cleared on ${domainId}.`);
        refresh();
        setConfirmAll(false);
        return;
      }
      const res = await api.groupAction(scope.id, {
        path: `${path}/dynamic`,
        body,
        members: picked,
      });
      setResults(res.results);
      refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Clear failed.');
    }
    setBusy(false);
  }

  async function runClearOne(row: Row) {
    setBusy(true);
    setError(null);
    try {
      await api.runAction(row.sw, {
        path: `${path}/dynamic/mac`,
        body: clearOneBody(row.mac),
      });
      toast('pass', `${row.mac} cleared on ${row.sw}.`);
      refresh();
      setConfirmOne(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Clear failed.');
    }
    setBusy(false);
  }

  const cols: GridColumn<Row>[] = [
    ...(group ? [{ key: 'sw', label: 'Switch', value: (r: Row) => r.sw } satisfies GridColumn<Row>] : []),
    { key: 'mac', label: 'MAC', always: true, value: (r) => r.mac },
    { key: 'vlan', label: 'VLAN', value: (r) => r.vlan || '—' },
    { key: 'iface', label: 'Interface', value: (r) => r.iface || '—' },
    { key: 'type', label: 'Type', value: (r) => r.type || '—' },
    { key: 'age', label: 'Age (s)', value: (r) => r.age || '—' },
  ];

  if (read.loading) return <Spinner label="Loading MAC table" />;
  if (read.error) {
    return <ReadError switchId={group ? '' : scope.id} message={read.error.message} onFixed={read.refetch} />;
  }

  return (
    <section style={{ display: 'flex', flexDirection: 'column', flex: 1 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
        <span style={{ fontSize: 13, color: 'var(--color-muted)' }}>
          {rows.length} learned MAC{rows.length === 1 ? '' : 's'}
          {filterIface && ` on ${filterIface}`}
        </span>
        {filterIface && onClearFilter && (
          <Button auto variant="secondary" onClick={onClearFilter}>
            Show all ports
          </Button>
        )}
        <span style={{ flex: 1 }} />
        <Button auto variant="secondary" onClick={openClearAll} disabled={present.length === 0}>
          {group ? 'Clear dynamic MACs on…' : 'Clear dynamic MACs'}
        </Button>
      </div>
      {failed.length > 0 && (
        <div style={{ marginBottom: 12 }}>
          <Alert tone="warn">
            Could not read {failed.map((sw) => `${sw} (${read.errors[sw]})`).join(', ')} — shown without
            {failed.length === 1 ? ' it' : ' them'}.
          </Alert>
        </div>
      )}
      {error && !confirmAll && !confirmOne && (
        <div style={{ marginBottom: 12 }}>
          <Alert tone="fail">{error}</Alert>
        </div>
      )}
      <DataTable
        cols={cols}
        rows={rows}
        storageKey={`cumulus.bridge-macs.${scope.kind}.v1`}
        empty={
          <p style={{ color: 'var(--color-muted)', fontSize: 14 }}>
            {filterIface ? `No MACs learned on ${filterIface}.` : 'No MACs learned on this domain.'}
          </p>
        }
        actions={(row) => [
          {
            label: `Clear ${row.mac}`,
            danger: true,
            disabled: !CLEARABLE.has(row.type),
            title: CLEARABLE.has(row.type) ? undefined : 'Only dynamic entries can be cleared',
            onClick: () => {
              setError(null);
              setConfirmOne(row);
            },
          },
        ]}
      />
      {confirmOne && !group && (
        <Confirm
          open
          title={`Clear ${confirmOne.mac} on ${domainId}?`}
          body={`Removes this dynamic entry learned on ${confirmOne.iface || 'this domain'}. It relearns on next traffic.`}
          confirmLabel="Clear MAC"
          busy={busy}
          onConfirm={() => void runClearOne(confirmOne)}
          onCancel={() => setConfirmOne(null)}
        />
      )}
      {confirmOne && group && (
        <Confirm
          open
          title={`Clear ${confirmOne.mac} on ${confirmOne.sw}?`}
          body={`Removes this dynamic entry learned on ${confirmOne.iface || 'this domain'}. It relearns on next traffic.`}
          confirmLabel="Clear MAC"
          busy={busy}
          onConfirm={() => void runClearOne(confirmOne)}
          onCancel={() => setConfirmOne(null)}
        />
      )}
      {confirmOne && error && (
        <div style={{ marginTop: 12 }}>
          <Alert tone="fail">{error}</Alert>
        </div>
      )}
      {!group && confirmAll && (
        <Confirm
          open
          title={`Clear dynamic MACs on ${domainId}?`}
          body="Flushes every dynamically learned entry on this domain. Static entries stay. Entries relearn on next traffic."
          confirmLabel="Clear dynamic MACs"
          busy={busy}
          onConfirm={() => void runClearAll()}
          onCancel={() => setConfirmAll(false)}
        />
      )}
      {group && confirmAll && (
        <Modal open onClose={() => setConfirmAll(false)} title={`Clear dynamic MACs · ${domainId}`}>
          {results ? (
            <ResultList results={results} />
          ) : (
            <>
              <p style={{ fontSize: 14, color: 'var(--color-muted)', margin: '0 0 12px' }}>
                Flushes every dynamically learned entry on this domain. Static entries stay.
              </p>
              <div role="group" aria-label="Switches" style={{ display: 'grid', gap: 2 }}>
                {present.map((sw) => (
                  <label key={sw} className="check-row">
                    <input
                      type="checkbox"
                      checked={picked.includes(sw)}
                      onChange={(e) =>
                        setPicked((p) => (e.target.checked ? [...p, sw] : p.filter((x) => x !== sw)))
                      }
                    />
                    {sw}
                  </label>
                ))}
              </div>
            </>
          )}
          {error && <Alert tone="fail">{error}</Alert>}
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 }}>
            {results ? (
              <Button auto onClick={() => setConfirmAll(false)}>
                Done
              </Button>
            ) : (
              <>
                <Button auto variant="secondary" onClick={() => setConfirmAll(false)} disabled={busy}>
                  Cancel
                </Button>
                <Button auto onClick={() => void runClearAll()} disabled={busy || picked.length === 0}>
                  {busy ? 'Running…' : `Run on ${picked.length} switch${picked.length === 1 ? '' : 'es'}`}
                </Button>
              </>
            )}
          </div>
        </Modal>
      )}
    </section>
  );
}
