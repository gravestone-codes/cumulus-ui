-- Platform users + switch-credential extension (roadmap: users are created in
-- our UI, never via IdP redirect). One identity, two credential sets:
-- users.* is the platform login; switch_credentials extends a user with
-- per-switch device credentials (encrypted at rest, see SWITCH_CRED_KEY).

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  disabled BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE switch_credentials (
  user_sub TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  switch_id TEXT NOT NULL REFERENCES switches (id) ON DELETE CASCADE,
  switch_username TEXT NOT NULL,
  password_enc TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_sub, switch_id)
);
