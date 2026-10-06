/**
 * Per-table column show/hide + order, persisted to localStorage. Ported from
 * GRG's useColumnPrefs: order reconciles against the live catalog (unknown
 * keys dropped, new ones appended), `always` pins first and stays visible.
 */
import { useCallback, useEffect, useState } from 'react';

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

function load<K extends string>(storageKey: string, catalog: ColumnCatalogEntry<K>[]): ColumnPrefs<K> {
  try {
    const raw = localStorage.getItem(storageKey);
    return reconcile(catalog, raw ? (JSON.parse(raw) as Partial<ColumnPrefs<K>>) : null);
  } catch {
    return reconcile(catalog, null);
  }
}

export function useColumnPrefs<K extends string>(storageKey: string, catalog: ColumnCatalogEntry<K>[]) {
  const [prefs, setPrefs] = useState<ColumnPrefs<K>>(() => load(storageKey, catalog));

  useEffect(() => {
    try {
      localStorage.setItem(storageKey, JSON.stringify(prefs));
    } catch {
      /* storage disabled — prefs last the session */
    }
  }, [storageKey, prefs]);

  const toggle = useCallback(
    (key: K) => {
      setPrefs((p) => {
        if (catalog.find((c) => c.key === key)?.always) return p;
        const hidden = p.hidden.includes(key) ? p.hidden.filter((k) => k !== key) : [...p.hidden, key];
        return { ...p, hidden };
      });
    },
    [catalog],
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
    [catalog],
  );

  const reset = useCallback(() => setPrefs(reconcile(catalog, null)), [catalog]);

  const visibleKeys = prefs.order.filter((k) => !prefs.hidden.includes(k));

  return { prefs, visibleKeys, toggle, move, reset };
}
