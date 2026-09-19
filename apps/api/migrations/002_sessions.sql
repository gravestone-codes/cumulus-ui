CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  user_sub TEXT NOT NULL,
  username TEXT NOT NULL,
  roles TEXT NOT NULL DEFAULT '[]',
  user_groups TEXT NOT NULL DEFAULT '[]',
  refresh_enc TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX sessions_user_sub_idx ON sessions (user_sub);
