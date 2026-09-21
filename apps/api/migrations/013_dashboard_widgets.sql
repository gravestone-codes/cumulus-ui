-- Personal dashboard prefs (one row per platform user; keyed by user_sub so
-- every admin gets their own dashboard, never a shared one).
CREATE TABLE user_dashboard_widgets (
  user_sub TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  widgets JSONB NOT NULL DEFAULT '[]'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
