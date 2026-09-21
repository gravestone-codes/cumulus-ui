/**
 * Personal dashboard prefs (Phase 2 shell). The widget catalog is a server
 * registry — the UI can only add/remove known ids, so a client can never
 * inject an unknown widget. Rows are keyed by user_sub: dashboards are
 * personal, never shared. Per-widget config (sort, device filter) rides
 * along as opaque JSON the widget owns.
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
] as const;
export type WidgetId = (typeof WIDGET_CATALOG)[number];

const DEFAULT_WIDGETS: Array<{ id: WidgetId }> = [
  { id: 'fleet-stats' },
  { id: 'reachability' },
  { id: 'traffic' },
];

/** Retired ids map forward so existing prefs keep working across renames. */
const RETIRED_IDS: Record<string, WidgetId> = {
  'fleet-health': 'fleet-stats',
  'needs-attention': 'fleet-stats',
};

const WidgetEntry = z.object({
  id: z.enum(WIDGET_CATALOG),
  config: z.record(z.string(), z.unknown()).optional(),
});
const PrefsBody = z.object({ widgets: z.array(WidgetEntry).max(20) });

export type DashboardPrefs = { widgets: Array<{ id: WidgetId; config?: Record<string, unknown> }> };

export async function getDashboardPrefs(userSub: string): Promise<DashboardPrefs> {
  const { rows } = await db().query<{ widgets: DashboardPrefs['widgets'] }>(
    'SELECT widgets FROM user_dashboard_widgets WHERE user_sub = $1',
    [userSub],
  );
  const widgets = rows[0]?.widgets;
  if (!Array.isArray(widgets) || widgets.length === 0) return { widgets: DEFAULT_WIDGETS };
  const seen = new Set<string>();
  const known = widgets.flatMap((w) => {
    const id = typeof w?.id === 'string' ? (w.id as string) : '';
    const mapped = (WIDGET_CATALOG as readonly string[]).includes(id) ? (id as WidgetId) : RETIRED_IDS[id];
    if (!mapped || seen.has(mapped)) return [];
    seen.add(mapped);
    return [{ ...w, id: mapped }];
  });
  return { widgets: known.length > 0 ? known : DEFAULT_WIDGETS };
}

export async function dashboardRoutes(app: FastifyInstance, deps: { cfg: AuthConfig }): Promise<void> {
  const { cfg } = deps;

  app.get('/api/v1/me/dashboard', async (request, reply) => {
    const who = await resolveCaller(request, cfg);
    if (!who) return problem(reply, 401, 'Unauthorized', 'no active session', request.url);
    return getDashboardPrefs(who.sub);
  });

  app.put('/api/v1/me/dashboard', async (request, reply) => {
    const who = await resolveCaller(request, cfg);
    if (!who) return problem(reply, 401, 'Unauthorized', 'no active session', request.url);
    const parsed = PrefsBody.safeParse(request.body);
    if (!parsed.success)
      return problem(reply, 400, 'Bad Request', 'unknown widget or bad shape', request.url);
    const widgets = parsed.data.widgets.length > 0 ? parsed.data.widgets : DEFAULT_WIDGETS;
    await db().query(
      `INSERT INTO user_dashboard_widgets (user_sub, widgets, updated_at) VALUES ($1, $2::jsonb, now())
       ON CONFLICT (user_sub) DO UPDATE SET widgets = EXCLUDED.widgets, updated_at = now()`,
      [who.sub, JSON.stringify(widgets)],
    );
    return { widgets };
  });
}
