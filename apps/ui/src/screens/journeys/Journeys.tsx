/**
 * Journeys (switch or group scope): the served catalog of guided operations
 * plus my runs here. Starting a journey already under way resumes it. A
 * journey this user's roles cannot finish shows locked with the reason —
 * cosmetic; every stage, apply and check is gated again server-side.
 */
import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api, ApiError, type JourneyDef, type JourneyRun } from '../../lib/api.js';
import { timeAgo } from '../../lib/format.js';
import { Alert, Badge, Breadcrumb, Button, Spinner, useToast } from '../../components/ui.js';
import { Card, MiniTable } from '../../components/cards.js';
import { ScopeShell } from '../iface/ScopeShell.js';
import { scopeBase, type Scope } from '../iface/scope.js';

const AREAS: Array<{ id: JourneyDef['area']; title: string; hint: string }> = [
  {
    id: 'provision',
    title: 'Provision',
    hint: 'Build something new, step by step, each step checked on the switch.',
  },
  { id: 'diagnose', title: 'Diagnose', hint: 'Walk a decision path from symptom to verified fix.' },
];

/** Badge for a run's state (words, not colour alone). */
export function RunBadge({ state }: { state: JourneyRun['state'] }) {
  const tone =
    state === 'done' ? 'pass' : state === 'blocked' ? 'fail' : state === 'abandoned' ? 'muted' : 'warn';
  const text = state === 'in-progress' ? 'In progress' : state[0]?.toUpperCase() + state.slice(1);
  return <Badge tone={tone}>{text}</Badge>;
}

export function Journeys() {
  const { switchId, groupId } = useParams();
  const scope: Scope = groupId ? { kind: 'group', id: groupId } : { kind: 'switch', id: switchId ?? '' };
  const base = scopeBase(scope);
  const navigate = useNavigate();
  const toast = useToast();
  const [starting, setStarting] = useState<string | null>(null);
  const catalog = useQuery({
    queryKey: ['journeys', scope.kind, scope.id],
    queryFn: () => api.journeys(scope),
    retry: false,
  });
  const runs = useQuery({
    queryKey: ['journey-runs', scope.kind, scope.id],
    queryFn: () => api.journeyRuns(scope),
    retry: false,
  });
  const all = runs.data?.runs ?? [];
  const active = all.filter((r) => r.state === 'in-progress' || r.state === 'blocked');
  const finished = all.filter((r) => r.state === 'done' || r.state === 'abandoned').slice(0, 8);
  const stepTitle = (r: JourneyRun) =>
    catalog.data?.journeys.find((j) => j.key === r.journey)?.steps.find((s) => s.id === r.current)?.title ??
    '—';
  const open = (r: JourneyRun) => navigate(`${base}/journeys/${r.id}`);

  async function start(key: string) {
    setStarting(key);
    try {
      const run = await api.startJourney(key, scope);
      navigate(`${base}/journeys/${run.id}`);
    } catch (err) {
      toast('fail', err instanceof ApiError ? err.message : 'Could not start the journey.');
      setStarting(null);
    }
  }

  return (
    <ScopeShell scope={scope} active="/journeys">
      <Breadcrumb trail={[{ label: scope.id, to: base }, { label: 'Journeys' }]} onNav={navigate} />
      <div className="list-head">
        <h1 style={{ fontSize: 20, fontWeight: 800, margin: 0 }}>Journeys</h1>
      </div>
      <p style={{ fontSize: 13, color: 'var(--color-muted)', margin: '0 0 16px' }}>
        Guided operations. Every change goes through the usual review and apply; a step completes only when
        the switch confirms it.
      </p>
      {catalog.isError ? (
        <Alert tone="fail">{catalog.error.message}</Alert>
      ) : catalog.isPending ? (
        <Spinner label="Loading journeys" />
      ) : (
        <div style={{ display: 'grid', gap: 20 }}>
          {active.length > 0 && (
            <Card title="In progress" hint="Pick up where you left off.">
              <MiniTable
                cols={[
                  { label: 'Journey', cell: (r: JourneyRun) => r.label },
                  { label: 'Step', cell: (r: JourneyRun) => stepTitle(r) },
                  { label: 'State', cell: (r: JourneyRun) => <RunBadge state={r.state} /> },
                  { label: 'Updated', align: 'right', cell: (r: JourneyRun) => timeAgo(r.updatedAt) },
                ]}
                rows={active}
                rowKey={(r) => r.id}
                onRow={open}
              />
            </Card>
          )}
          {AREAS.map((area) => {
            const list = catalog.data.journeys.filter((j) => j.area === area.id);
            if (list.length === 0) return null;
            return (
              <section key={area.id} style={{ display: 'grid', gap: 10 }}>
                <div>
                  <h2 style={{ fontSize: 15, fontWeight: 800, margin: 0 }}>{area.title}</h2>
                  <p style={{ fontSize: 13, color: 'var(--color-muted)', margin: '2px 0 0' }}>{area.hint}</p>
                </div>
                <div
                  style={{
                    display: 'grid',
                    gap: 12,
                    gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
                  }}
                >
                  {list.map((j) => {
                    const resumable = active.find((r) => r.journey === j.key);
                    return (
                      <Card
                        key={j.key}
                        title={j.label}
                        hint={j.summary}
                        actions={
                          <Button
                            auto
                            variant={resumable ? 'secondary' : 'primary'}
                            disabled={j.locked !== null || starting !== null}
                            onClick={() => (resumable ? open(resumable) : void start(j.key))}
                          >
                            {starting === j.key ? 'Starting…' : resumable ? 'Resume' : 'Start'}
                          </Button>
                        }
                      >
                        <ol style={{ margin: 0, paddingLeft: 18, fontSize: 13, color: 'var(--color-muted)' }}>
                          {j.steps.map((s) => (
                            <li key={s.id}>{s.title}</li>
                          ))}
                        </ol>
                        {j.locked && (
                          <p style={{ fontSize: 12, color: 'var(--color-muted)', margin: '10px 0 0' }}>
                            Locked — {j.locked}
                          </p>
                        )}
                      </Card>
                    );
                  })}
                </div>
              </section>
            );
          })}
          {finished.length > 0 && (
            <Card title="Recent" hint="Finished and abandoned runs; each wrote one audit entry.">
              <MiniTable
                cols={[
                  { label: 'Journey', cell: (r: JourneyRun) => r.label },
                  { label: 'Outcome', cell: (r: JourneyRun) => <RunBadge state={r.state} /> },
                  { label: 'Note', cell: (r: JourneyRun) => r.note ?? '—' },
                  { label: 'When', align: 'right', cell: (r: JourneyRun) => timeAgo(r.updatedAt) },
                ]}
                rows={finished}
                rowKey={(r) => r.id}
                onRow={open}
              />
            </Card>
          )}
        </div>
      )}
    </ScopeShell>
  );
}
