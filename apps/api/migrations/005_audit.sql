-- Audit trail (roadmap 0.9: R2e). Append-only by convention (no UPDATE/DELETE
-- grants needed — enforced by code, not shown here): every material action with
-- its decision context, hash-chained for tamper evidence.

CREATE TABLE audit_log (
  id BIGSERIAL PRIMARY KEY,
  ts TIMESTAMPTZ NOT NULL DEFAULT now(),
  user_sub TEXT NOT NULL,
  username TEXT NOT NULL,
  roles JSONB NOT NULL DEFAULT '[]',
  switch_id TEXT,
  method TEXT NOT NULL,
  path TEXT NOT NULL,
  before JSONB,
  after JSONB,
  rev TEXT,
  job_id TEXT,
  prev_hash TEXT NOT NULL,
  hash TEXT NOT NULL
);
CREATE INDEX audit_log_ts_idx ON audit_log (ts DESC);
CREATE INDEX audit_log_user_idx ON audit_log (user_sub, ts DESC);
CREATE INDEX audit_log_switch_idx ON audit_log (switch_id, ts DESC);
