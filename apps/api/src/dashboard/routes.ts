/**
 * Personal dashboard prefs (Phase 2 shell). The widget catalog is a server
 * registry — the UI can only add/remove known ids, so a client can never
 * inject an unknown widget. Rows are keyed by user_sub + scope (fleet,
 * group, switch): dashboards are personal, never shared, and each kind has
 * its own catalog and defaults. Per-widget config (sort, device filter) rides
 * along as opaque JSON the widget owns. `seen` records the catalog a user
 * was last offered, so widgets shipped later appear once, then obey removal.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { problem } from '../lib/problems.js';
import { type AuthConfig } from '../auth/config.js';
import { resolveCaller } from '../auth/caller.js';
import { db } from '../db.js';

/** Server-owned catalog. A widget ships here first; the UI catalog mirrors it. */
export const WIDGET_CATALOG = [
  'fleet-stats',
  'reachability',
  'recent-activity',
  'traffic',
  'interfaces-by-device',
  'health',
  'cpu',
  'memory',
  'port-status',
  'interface-errors',
  'top-talkers',
  'environment',
  'software',
  'connection',
  'members',
  'temperatures',
  'flapping-ports',
  'down-ports',
  'bgp-sessions',
  'route-summary',
  'unsaved-config',
] as const;
export type WidgetId = (typeof WIDGET_CATALOG)[number];

export const DASHBOARD_SCOPES = ['fleet', 'group', 'switch'] as const;
export type DashboardScope = (typeof DASHBOARD_SCOPES)[number];

/**
 * Per dashboard kind: which widgets fit (connection is one switch's, members
 * a group's, inventory roll-ups need many switches) and the starting layout.
 * Widgets outside `defaults` are offered only through Customize.
 */
const SCOPES: Record<DashboardScope, { allowed: readonly WidgetId[]; defaults: readonly WidgetId[] }> = {
  fleet: {
    allowed: WIDGET_CATALOG.filter((id) => id !== 'connection' && id !== 'members'),
    defaults: [
      'fleet-stats',
      'health',
      'reachability',
      'cpu',
      'memory',
      'port-status',
      'traffic',
      'interface-errors',
      'top-talkers',
      'environment',
      'software',
      'recent-activity',
    ],
  },
  group: {
    allowed: WIDGET_CATALOG.filter((id) => id !== 'connection'),
    defaults: [
      'health',
      'port-status',
      'cpu',
      'memory',
      'environment',
      'interface-errors',
      'top-talkers',
      'traffic',
      'recent-activity',
      'members',
    ],
  },
  switch: {
    allowed: WIDGET_CATALOG.filter(
      (id) => !['fleet-stats', 'reachability', 'interfaces-by-device', 'members'].includes(id),
    ),
    defaults: [
      'software',
      'health',
      'cpu',
      'memory',
      'port-status',
      'environment',
      'interface-errors',
      'top-talkers',
      'recent-activity',
      'connection',
      'traffic',
    ],
  },
};

/** Retired ids map forward (in place) so existing prefs keep working across renames and splits. */
const RETIRED_IDS: Record<string, WidgetId[]> = {
  'fleet-health': ['fleet-stats'],
  'needs-attention': ['fleet-stats'],
  resources: ['cpu', 'memory'],
};

const forward = (id: string): WidgetId[] =>
  (WIDGET_CATALOG as readonly string[]).includes(id) ? [id as WidgetId] : (RETIRED_IDS[id] ?? []);

const ScopeQuery = z.object({ scope: z.enum(DASHBOARD_SCOPES).default('fleet') });
const WidgetEntry = z.object({
  id: z.enum(WIDGET_CATALOG),
  config: z.record(z.string(), z.unknown()).optional(),
});
const PrefsBody = z.object({ widgets: z.array(WidgetEntry).max(WIDGET_CATALOG.length) });

export type DashboardPrefs = {
  widgets: Array<{ id: WidgetId; config?: Record<string, unknown> }>;
  /** Every widget this dashboard kind can show — the Customize picker's source. */
  available: WidgetId[];
};

const defaultsOf = (scope: DashboardScope) => SCOPES[scope].defaults.map((id) => ({ id }));

export async function getDashboardPrefs(userSub: string, scope: DashboardScope): Promise<DashboardPrefs> {
  const { allowed } = SCOPES[scope];
  const available = [...allowed];
  const { rows } = await db().query<{ widgets: DashboardPrefs['widgets']; seen: string[] }>(
    'SELECT widgets, seen FROM user_dashboard_widgets WHERE user_sub = $1 AND scope = $2',
    [userSub, scope],
  );
  const widgets = rows[0]?.widgets;
  const offered = new Set((rows[0]?.seen ?? []).flatMap(forward));
  if (!Array.isArray(widgets) || widgets.length === 0) return { widgets: defaultsOf(scope), available };
  const seen = new Set<string>();
  const known = widgets.flatMap((w) =>
    forward(typeof w?.id === 'string' ? (w.id as string) : '').flatMap((id) => {
      if (seen.has(id) || !allowed.includes(id)) return [];
      seen.add(id);
      return [{ ...w, id }];
    }),
  );
  if (known.length === 0) return { widgets: defaultsOf(scope), available };
  // Defaults shipped after the last save join once; ids already offered stay as the user left them.
  const fresh = defaultsOf(scope).filter((w) => !offered.has(w.id) && !seen.has(w.id));
  return { widgets: [...known, ...fresh], available };
}

export async function dashboardRoutes(app: FastifyInstance, deps: { cfg: AuthConfig }): Promise<void> {
  const { cfg } = deps;

  app.get('/api/v1/me/dashboard', async (request, reply) => {
    const who = await resolveCaller(request, cfg);
    if (!who) return problem(reply, 401, 'Unauthorized', 'no active session', request.url);
    const q = ScopeQuery.safeParse(request.query);
    if (!q.success)
      return problem(reply, 400, 'Bad Request', 'scope must be fleet, group or switch', request.url);
    return getDashboardPrefs(who.sub, q.data.scope);
  });

  app.put('/api/v1/me/dashboard', async (request, reply) => {
    const who = await resolveCaller(request, cfg);
    if (!who) return problem(reply, 401, 'Unauthorized', 'no active session', request.url);
    const q = ScopeQuery.safeParse(request.query);
    if (!q.success)
      return problem(reply, 400, 'Bad Request', 'scope must be fleet, group or switch', request.url);
    const { scope } = q.data;
    const parsed = PrefsBody.safeParse(request.body);
    if (!parsed.success)
      return problem(reply, 400, 'Bad Request', 'unknown widget or bad shape', request.url);
    const { allowed } = SCOPES[scope];
    const misfit = parsed.data.widgets.find((w) => !allowed.includes(w.id));
    if (misfit)
      return problem(
        reply,
        400,
        'Bad Request',
        `${misfit.id} does not fit a ${scope} dashboard`,
        request.url,
      );
    const widgets = parsed.data.widgets.length > 0 ? parsed.data.widgets : defaultsOf(scope);
    await db().query(
      `INSERT INTO user_dashboard_widgets (user_sub, scope, widgets, seen, updated_at)
       VALUES ($1, $2, $3::jsonb, $4, now())
       ON CONFLICT (user_sub, scope) DO UPDATE SET widgets = EXCLUDED.widgets, seen = EXCLUDED.seen, updated_at = now()`,
      [who.sub, scope, JSON.stringify(widgets), [...allowed]],
    );
    return { widgets, available: [...allowed] };
  });
}
