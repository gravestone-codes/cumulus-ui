-- Journey runs (journey-roadmap.md): personal progress through a guided
-- operation, like dashboard prefs never shared. `steps` and `vals` hold the
-- engine's RunState; `version` makes concurrent advances (two tabs) refuse
-- instead of overwriting. Terminal runs keep their row and link the audit entry.
CREATE TABLE journey_runs (
  id BIGSERIAL PRIMARY KEY,
  user_sub TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  journey TEXT NOT NULL,
  scope_kind TEXT NOT NULL CHECK (scope_kind IN ('switch', 'group')),
  scope_id TEXT NOT NULL,
  members JSONB NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('in-progress', 'blocked', 'done', 'abandoned')),
  current TEXT,
  steps JSONB NOT NULL DEFAULT '{}'::jsonb,
  vals JSONB NOT NULL DEFAULT '{}'::jsonb,
  note TEXT,
  audit_id BIGINT,
  version INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX journey_runs_user ON journey_runs (user_sub, updated_at DESC);
