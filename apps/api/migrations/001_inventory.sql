-- Fleet inventory: switches, groups (DC → role), membership (roadmap 0.4).
-- cert_fingerprint is the TOFU pin: captured at enrolment, verified on every
-- switch connection by NvueClient (0.7). NULL means not yet enrolled.

CREATE TABLE switches (
  id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  base_url TEXT NOT NULL,
  base_path TEXT NOT NULL DEFAULT '/nvue_v1',
  cert_fingerprint TEXT,
  enabled BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE groups (
  id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  parent_id TEXT REFERENCES groups (id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE switch_groups (
  switch_id TEXT NOT NULL REFERENCES switches (id) ON DELETE CASCADE,
  group_id TEXT NOT NULL REFERENCES groups (id) ON DELETE CASCADE,
  PRIMARY KEY (switch_id, group_id)
);
