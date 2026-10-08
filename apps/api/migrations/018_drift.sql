-- Out-of-band detection (roadmap 4.6, decision 6.7). Each switch's applied
-- revision ID is polled on its groups' interval (shortest wins, default 30s);
-- a move our ApplyPipeline did not make is drift. Users acknowledge drift by
-- refreshing; until then they cannot open a new edit session on that switch.

ALTER TABLE groups ADD COLUMN poll_interval_sec INTEGER NOT NULL DEFAULT 30
  CHECK (poll_interval_sec BETWEEN 5 AND 86400);

CREATE TABLE switch_revisions (
  switch_id TEXT PRIMARY KEY REFERENCES switches (id) ON DELETE CASCADE,
  applied_id TEXT NOT NULL,
  checked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Latest out-of-band move (NULL = none seen): from → to, plus NVUE's last-apply attribution.
  drift_at TIMESTAMPTZ,
  drift_from TEXT,
  drift_to TEXT,
  drift_by JSONB
);

CREATE TABLE drift_acks (
  user_sub TEXT NOT NULL,
  switch_id TEXT NOT NULL REFERENCES switches (id) ON DELETE CASCADE,
  acked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_sub, switch_id)
);

-- When the draft's branch was cut: drafts older than a drift go to the conflict screen.
ALTER TABLE edit_sessions ADD COLUMN based_at TIMESTAMPTZ NOT NULL DEFAULT now();
