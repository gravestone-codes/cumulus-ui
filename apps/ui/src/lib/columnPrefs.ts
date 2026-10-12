/**
 * Per-table column show/hide + order, persisted to localStorage. Ported from
 * GRG's useColumnPrefs: order reconciles against the live catalog (unknown
 * keys dropped, new ones appended), `always` pins first and stays visible.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';

export interface ColumnCatalogEntry<K extends string> {
  key: K;
  label: string;
  always?: boolean;
}

export interface ColumnPrefs<K extends string> {
  order: K[];
  hidden: K[];
}

function reconcile<K extends string>(
  catalog: ColumnCatalogEntry<K>[],
  raw: Partial<ColumnPrefs<K>> | null,
): ColumnPrefs<K> {
  const byKey = new Map(catalog.map((c) => [c.key, c]));
  const defaultOrder = catalog.map((c) => c.key);
  const known = new Set(defaultOrder);
  const stored = (raw?.order ?? []).filter((k): k is K => known.has(k));
  const appended = defaultOrder.filter((k) => !stored.includes(k));
  const anchors = defaultOrder.filter((k) => byKey.get(k)?.always);
  const rest = [...stored, ...appended].filter((k) => !byKey.get(k)?.always);
  const order = [...anchors, ...rest];
  const hidden = (raw?.hidden ?? []).filter((k): k is K => known.has(k) && !byKey.get(k)?.always);
  return { order, hidden };
}

/** Stored prefs as saved: reconciling here would drop picks for columns the schema has not delivered yet. */
function load<K extends string>(storageKey: string, catalog: ColumnCatalogEntry<K>[]): ColumnPrefs<K> {
  try {
    const raw = localStorage.getItem(storageKey);
    const parsed = raw ? (JSON.parse(raw) as Partial<ColumnPrefs<K>>) : null;
    if (parsed && Array.isArray(parsed.order) && Array.isArray(parsed.hidden)) {
      return { order: parsed.order, hidden: parsed.hidden };
    }
  } catch {
    /* unreadable: defaults */
  }
  return reconcile(catalog, null);
}

export function useColumnPrefs<K extends string>(storageKey: string, catalog: ColumnCatalogEntry<K>[]) {
  const [stored, setStored] = useState<ColumnPrefs<K>>(() => load(storageKey, catalog));
  // Reconcile every render: catalogs grow once the schema loads, and columns
  // missing at first mount must still appear (unknown keys never reach render).
  const prefs = useMemo(() => reconcile(catalog, stored), [catalog, stored]);
  const setPrefs = useCallback(
    (fn: (p: ColumnPrefs<K>) => ColumnPrefs<K>) => setStored((s) => fn(reconcile(catalog, s))),
    [catalog],
  );

  useEffect(() => {
    try {
      localStorage.setItem(storageKey, JSON.stringify(stored));
    } catch {
      /* storage disabled — prefs last the session */
    }
  }, [storageKey, stored]);

  const toggle = useCallback(
    (key: K) => {
      setPrefs((p) => {
        if (catalog.find((c) => c.key === key)?.always) return p;
        const hidden = p.hidden.includes(key) ? p.hidden.filter((k) => k !== key) : [...p.hidden, key];
        return { ...p, hidden };
      });
    },
    [catalog, setPrefs],
  );

  const move = useCallback(
    (key: K, dir: -1 | 1) => {
      setPrefs((p) => {
        const order = [...p.order];
        const i = order.indexOf(key);
        const j = i + dir;
        if (i < 0 || j < 0 || j >= order.length) return p;
        const byKey = new Map(catalog.map((c) => [c.key, c]));
        const a = order[i];
        const b = order[j];
        if (a === undefined || b === undefined) return p;
        if (byKey.get(a)?.always || byKey.get(b)?.always) return p;
        order[i] = b;
        order[j] = a;
        return { ...p, order };
      });
    },
    [catalog, setPrefs],
  );

  const reset = useCallback(() => setStored(reconcile(catalog, null)), [catalog]);

  const visibleKeys = prefs.order.filter((k) => !prefs.hidden.includes(k));

  return { prefs, visibleKeys, toggle, move, reset };
}
