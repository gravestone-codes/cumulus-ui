-- Edit sessions: one active staging branch per (user, switch) (roadmap 1.1/§4).
-- staged_paths holds [{path, method, before}] snapshots for OCC overlap checks.

CREATE TABLE edit_sessions (
  user_sub TEXT NOT NULL,
  switch_id TEXT NOT NULL REFERENCES switches (id) ON DELETE CASCADE,
  branch TEXT NOT NULL,
  base_rev TEXT,
  staged_paths JSONB NOT NULL DEFAULT '[]',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_sub, switch_id)
);

-- Presence heartbeats (roadmap 1.2/R19). Writers upsert; readers filter by recency.
-- No TTL delete needed — stale rows are simply ignored (>90s).

CREATE TABLE presence (
  user_sub TEXT NOT NULL,
  switch_id TEXT NOT NULL,
  path TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_sub, switch_id, path)
);
