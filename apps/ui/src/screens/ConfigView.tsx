/**
 * Config screen: what `nv config show` (YAML) and `nv config show -o
 * commands` print, for the applied or startup revision, plus the unsaved
 * delta (applied vs startup — what a reboot would lose). One read of `/`
 * per revision; renderings are pure (lib/nvconfig). Copy and download.
 */
import { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api.js';
import { Badge, Breadcrumb, Button, Hint, SelectMenu, Spinner, Tabs, useToast } from '../components/ui.js';
import { ReadError } from '../components/resource.js';
import { CodeBlock, copyText, downloadText, type CodeLine } from '../components/CodeBlock.js';
import { configYaml, diffCommands, toCommands } from '../lib/nvconfig.js';
import { ScopeShell } from './iface/ScopeShell.js';

type Format = 'commands' | 'yaml' | 'unsaved';
type Rev = 'applied' | 'startup';

/** One revision of the whole tree; `filled` adds every default the CLI leaves out. */
function useRevision(switchId: string, rev: Rev, filled: boolean, enabled: boolean) {
  return useQuery({
    queryKey: ['config', switchId, rev, filled],
    queryFn: () => api.query<Record<string, unknown>>(switchId, '/', { rev, filled }),
    enabled,
    retry: false,
    staleTime: 30_000,
  });
}

export function ConfigView() {
  const { switchId = '' } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const [format, setFormat] = useState<Format>('commands');
  const [rev, setRev] = useState<Rev>('applied');
  const [section, setSection] = useState('');
  const [query, setQuery] = useState('');
  const [defaults, setDefaults] = useState(false);
  const applied = useRevision(switchId, 'applied', defaults, true);
  const startup = useRevision(switchId, 'startup', defaults, rev === 'startup' || format === 'unsaved');
  const shown = format === 'unsaved' || rev === 'applied' ? applied : startup;

  const sections = Object.keys(shown.data?.data ?? applied.data?.data ?? {});

  const lines: CodeLine[] = useMemo(() => {
    const pick = (tree: Record<string, unknown> | undefined) =>
      tree && section ? { [section]: tree[section] } : (tree ?? {});
    if (format === 'unsaved') {
      if (!applied.data || !startup.data) return [];
      return diffCommands(toCommands(pick(startup.data.data)), toCommands(pick(applied.data.data))).map(
        (d) => ({ text: d.line, tone: d.op === '+' ? ('add' as const) : ('del' as const) }),
      );
    }
    if (!shown.data) return [];
    const raw = format === 'yaml' ? configYaml(pick(shown.data.data)) : toCommands(pick(shown.data.data));
    return raw.map((text) => ({ text }));
  }, [format, section, shown.data, applied.data, startup.data]);
  const q = query.trim().toLowerCase();
  const visible = q ? lines.filter((l) => l.text.toLowerCase().includes(q)) : lines;
  const text = visible
    .map((l) => (l.tone === 'add' ? '+ ' : l.tone === 'del' ? '- ' : '') + l.text)
    .join('\n');
  const loading = shown.isPending || (format === 'unsaved' && startup.isPending);
  const error = shown.error ?? (format === 'unsaved' ? startup.error : null);

  return (
    <ScopeShell scope={{ kind: 'switch', id: switchId }} active="/config">
      <Breadcrumb
        trail={[{ label: switchId, to: `/switches/${switchId}` }, { label: 'Config' }]}
        onNav={navigate}
      />
      <div className="list-head" style={{ gap: 12 }}>
        <h1 style={{ fontSize: 20, fontWeight: 800, margin: 0 }}>
          Configuration
          <Hint text="The switch's own configuration as NVUE stores it. Commands = nv config show -o commands; YAML = nv config show. Unsaved = differences between the running (applied) and startup revisions — what a reboot would lose without nv config save." />
        </h1>
        <span style={{ flex: 1 }} />
        <Button
          auto
          variant="secondary"
          disabled={visible.length === 0}
          onClick={async () => {
            const ok = await copyText(text);
            toast(
              ok ? 'pass' : 'fail',
              ok ? `Copied ${visible.length} lines.` : 'Copy blocked by the browser.',
            );
          }}
        >
          Copy
        </Button>
        <Button
          auto
          variant="secondary"
          disabled={visible.length === 0}
          onClick={() =>
            downloadText(
              `${switchId}-${format === 'unsaved' ? 'unsaved' : rev}${format === 'yaml' ? '.yaml' : '.txt'}`,
              text,
            )
          }
        >
          Download
        </Button>
      </div>
      <Tabs
        tabs={[
          { id: 'commands', label: 'Commands' },
          { id: 'yaml', label: 'YAML' },
          { id: 'unsaved', label: 'Unsaved changes' },
        ]}
        active={format}
        onChange={(id) => setFormat(id as Format)}
      />
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 12, marginBottom: 16 }}>
        {format !== 'unsaved' && (
          <SelectMenu
            label="Revision"
            value={rev}
            options={[
              { value: 'applied', label: 'Applied (running)' },
              { value: 'startup', label: 'Startup (saved)' },
            ]}
            onChange={(v) => setRev(v as Rev)}
            width={190}
          />
        )}
        <SelectMenu
          label="Section"
          value={section}
          options={[{ value: '', label: 'All sections' }, ...sections.map((s) => ({ value: s, label: s }))]}
          onChange={setSection}
          width={170}
        />
        <label className="check-row" style={{ padding: 0 }}>
          <input type="checkbox" checked={defaults} onChange={(e) => setDefaults(e.target.checked)} />
          Include defaults
        </label>
        <span className="lf" style={{ flex: 1, minWidth: 180, maxWidth: 320 }}>
          <input
            aria-label="Filter lines"
            placeholder="Filter lines…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </span>
        {!loading && !error && (
          <span style={{ fontSize: 13, color: 'var(--color-muted)' }}>
            {visible.length.toLocaleString()} line{visible.length === 1 ? '' : 's'}
          </span>
        )}
      </div>
      {error ? (
        <ReadError switchId={switchId} message={error.message} onFixed={() => shown.refetch()} />
      ) : loading ? (
        <Spinner label="Loading configuration" />
      ) : format === 'unsaved' && lines.length === 0 ? (
        <span style={{ display: 'inline-flex', gap: 8, alignItems: 'center', fontSize: 14 }}>
          <Badge tone="pass">saved</Badge>
          <span style={{ color: 'var(--color-muted)' }}>
            Running and startup match — a reboot keeps everything.
          </span>
        </span>
      ) : visible.length === 0 ? (
        <p style={{ fontSize: 14, color: 'var(--color-muted)' }}>No lines match.</p>
      ) : (
        <CodeBlock lines={visible} />
      )}
    </ScopeShell>
  );
}
