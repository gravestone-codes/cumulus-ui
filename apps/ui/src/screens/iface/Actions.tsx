/**
 * Interface actions (3A.4, design §7B): POST actions through ActionRunner.
 * One switch: confirm → run. Group: pick members (all ticked) → run →
 * per-switch results. Per-switch-only actions stay disabled in groups.
 */
import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api, ApiError, type MemberResult } from '../../lib/api.js';
import { Alert, Button, Confirm, Modal, RowMenu, useToast } from '../../components/ui.js';
import { ResultList } from './ChangeFlow.js';
import { refreshInterfaces, type Scope } from './scope.js';

interface ActionDef {
  id: string;
  label: string;
  /** Sub-path under the interface that takes the POST. */
  path: string;
  /** Interface types it applies to; omitted = all. */
  types?: string[];
  /** Meaningful on one switch only (PHY state is per port, per box). */
  switchOnly?: boolean;
  what: string;
}

// Action bodies follow NVUE's simple-action shape: {"@clear": {"state": "start"}}.
const ACTIONS: ActionDef[] = [
  {
    id: 'counters',
    label: 'Clear counters',
    path: 'counters',
    what: 'Resets this port’s traffic, drop and error counters to zero.',
  },
  {
    id: 'flap',
    label: 'Clear flap protection',
    path: 'link/flap-protection',
    types: ['swp'],
    what: 'Clears a link flap-protection violation so the port can come back up.',
  },
  {
    id: 'phy',
    label: 'Clear PHY counters',
    path: 'link/phy-detail',
    types: ['swp'],
    switchOnly: true,
    what: 'Resets the PHY error and BER counters.',
  },
];
const CLEAR = { '@clear': { state: 'start' } };

export function InterfaceActions({
  scope,
  ifaceId,
  present,
  type,
}: {
  scope: Scope;
  ifaceId: string;
  present: string[];
  type?: string;
}) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [chosen, setChosen] = useState<ActionDef | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<MemberResult[] | null>(null);
  const group = scope.kind === 'group';
  const actions = ACTIONS.filter((a) => !a.types || !type || a.types.includes(type));

  function open(a: ActionDef) {
    setChosen(a);
    setPicked(present);
    setResults(null);
    setError(null);
  }
  const close = () => {
    setChosen(null);
    setBusy(false);
  };
  const refresh = () => refreshInterfaces(queryClient);

  async function run() {
    if (!chosen) return;
    const path = `/interface/${ifaceId}/${chosen.path}`;
    setBusy(true);
    setError(null);
    try {
      if (scope.kind === 'switch') {
        await api.runAction(scope.id, { path, body: CLEAR });
        toast('pass', `${chosen.label}: done on ${ifaceId}.`);
        refresh();
        close();
        return;
      }
      const res = await api.groupAction(scope.id, { path, body: CLEAR, members: picked });
      setResults(res.results);
      refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Action failed.');
    }
    setBusy(false);
  }

  return (
    <>
      <RowMenu
        label="Interface actions"
        items={actions.map((a) => ({
          label: group && !a.switchOnly ? `${a.label} on…` : a.label,
          onClick: () => open(a),
          disabled: group && a.switchOnly,
          title: group && a.switchOnly ? 'Per switch — open the interface on one switch' : undefined,
        }))}
      />
      {chosen && !group && (
        <Confirm
          open
          title={`${chosen.label} on ${ifaceId}?`}
          body={chosen.what}
          confirmLabel={chosen.label}
          busy={busy}
          onConfirm={run}
          onCancel={close}
        />
      )}
      {chosen && group && (
        <Modal open onClose={close} title={`${chosen.label} · ${ifaceId}`}>
          {results ? (
            <ResultList results={results} />
          ) : (
            <>
              <p style={{ fontSize: 14, color: 'var(--color-muted)', margin: '0 0 12px' }}>{chosen.what}</p>
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
              <Button auto onClick={close}>
                Done
              </Button>
            ) : (
              <>
                <Button auto variant="secondary" onClick={close} disabled={busy}>
                  Cancel
                </Button>
                <Button auto onClick={run} disabled={busy || picked.length === 0}>
                  {busy ? 'Running…' : `Run on ${picked.length} switch${picked.length === 1 ? '' : 'es'}`}
                </Button>
              </>
            )}
          </div>
        </Modal>
      )}
    </>
  );
}
