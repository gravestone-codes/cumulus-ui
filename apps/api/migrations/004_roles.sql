-- RBAC (roadmap 0.8): roles as data. Rules are (method, path-prefix) pairs;
-- an empty role_groups set means global scope, otherwise the rule applies only
-- to switches in one of the role's groups. `system` roles ship with the app and
-- are immutable; `can_dangerous` gates the §6.6 dangerous class.

CREATE TABLE roles (
  id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  system BOOLEAN NOT NULL DEFAULT false,
  can_dangerous BOOLEAN NOT NULL DEFAULT false
);

CREATE TABLE role_rules (
  role_id TEXT NOT NULL REFERENCES roles (id) ON DELETE CASCADE,
  method TEXT NOT NULL,
  path_prefix TEXT NOT NULL,
  PRIMARY KEY (role_id, method, path_prefix)
);

CREATE TABLE role_groups (
  role_id TEXT NOT NULL REFERENCES roles (id) ON DELETE CASCADE,
  group_id TEXT NOT NULL REFERENCES groups (id) ON DELETE CASCADE,
  PRIMARY KEY (role_id, group_id)
);

CREATE TABLE user_roles (
  user_sub TEXT NOT NULL,
  role_id TEXT NOT NULL REFERENCES roles (id) ON DELETE CASCADE,
  PRIMARY KEY (user_sub, role_id)
);

-- Shipped defaults (roadmap §3). Custom roles are rows, not code.
INSERT INTO roles (id, display_name, description, system, can_dangerous) VALUES
  ('viewer', 'Viewer', 'Read everything, change nothing.', true, false),
  ('auditor', 'Auditor', 'Read everything plus audit logs.', true, false),
  ('noc', 'NOC', 'Read plus safe operational actions.', true, false),
  ('net-operator', 'Network operator', 'Stage config, run safe actions. Cannot apply.', true, false),
  ('net-admin', 'Network admin', 'Full network config including apply.', true, true),
  ('sys-admin', 'System admin', 'Everything including system accounts and images.', true, true),
  ('app-admin', 'App admin', 'Manages the app itself: roles, inventory, settings.', true, false);

-- viewer / auditor: read-only everywhere (prefix '/' matches all paths)
INSERT INTO role_rules (role_id, method, path_prefix)
SELECT r.id, 'GET', '/' FROM roles r WHERE r.id IN ('viewer', 'auditor', 'noc', 'net-operator', 'net-admin', 'sys-admin');

-- noc: safe operational actions only (counter clears, LED, tech-support read-out)
INSERT INTO role_rules (role_id, method, path_prefix) VALUES
  ('noc', 'POST', '/interface'),
  ('noc', 'POST', '/platform'),
  ('noc', 'POST', '/system/tech-support');

-- net-operator: stage (PATCH/DELETE) network domains, safe actions, never apply (/config)
INSERT INTO role_rules (role_id, method, path_prefix)
SELECT 'net-operator', m.method, m.prefix FROM (VALUES
  ('PATCH', '/interface'), ('PATCH', '/bridge'), ('PATCH', '/vrf'), ('PATCH', '/router'),
  ('PATCH', '/evpn'), ('PATCH', '/nve'), ('PATCH', '/mlag'), ('PATCH', '/acl'), ('PATCH', '/qos'),
  ('DELETE', '/interface'), ('DELETE', '/bridge'), ('DELETE', '/vrf'), ('DELETE', '/router'),
  ('DELETE', '/evpn'), ('DELETE', '/nve'), ('DELETE', '/mlag'), ('DELETE', '/acl'), ('DELETE', '/qos'),
  ('POST', '/interface'), ('POST', '/bridge'), ('POST', '/vrf'), ('POST', '/router'),
  ('POST', '/evpn'), ('POST', '/nve'), ('POST', '/mlag'), ('POST', '/acl'), ('POST', '/qos'), ('POST', '/platform')
) AS m(method, prefix);

-- net-admin: everything network, except system accounts/API surface
INSERT INTO role_rules (role_id, method, path_prefix)
SELECT 'net-admin', m.method, m.prefix FROM (VALUES
  ('PATCH', '/interface'), ('PATCH', '/bridge'), ('PATCH', '/vrf'), ('PATCH', '/router'),
  ('PATCH', '/evpn'), ('PATCH', '/nve'), ('PATCH', '/mlag'), ('PATCH', '/acl'), ('PATCH', '/qos'),
  ('PATCH', '/platform'), ('PATCH', '/service'), ('PATCH', '/system'), ('PATCH', '/maintenance'),
  ('DELETE', '/interface'), ('DELETE', '/bridge'), ('DELETE', '/vrf'), ('DELETE', '/router'),
  ('DELETE', '/evpn'), ('DELETE', '/nve'), ('DELETE', '/mlag'), ('DELETE', '/acl'), ('DELETE', '/qos'),
  ('DELETE', '/platform'), ('DELETE', '/service'), ('DELETE', '/system'), ('DELETE', '/maintenance'),
  ('POST', '/interface'), ('POST', '/bridge'), ('POST', '/vrf'), ('POST', '/router'),
  ('POST', '/evpn'), ('POST', '/nve'), ('POST', '/mlag'), ('POST', '/acl'), ('POST', '/qos'),
  ('POST', '/platform'), ('POST', '/service'), ('POST', '/system'), ('POST', '/maintenance'),
  ('POST', '/config'), ('POST', '/action'), ('POST', '/revision')
) AS m(method, prefix);

-- sys-admin: absolutely everything, including AAA and the API surface itself
INSERT INTO role_rules (role_id, method, path_prefix)
SELECT 'sys-admin', m.method, m.prefix FROM (VALUES
  ('PATCH', '/'), ('DELETE', '/'), ('POST', '/')
) AS m(method, prefix);

-- app-admin: manages the app (roles, inventory, audit reads), no switch config
INSERT INTO role_rules (role_id, method, path_prefix) VALUES
  ('app-admin', 'GET', '/api/v1/roles'),
  ('app-admin', 'POST', '/api/v1/roles'),
  ('app-admin', 'PUT', '/api/v1/roles'),
  ('app-admin', 'DELETE', '/api/v1/roles'),
  ('app-admin', 'GET', '/api/v1/inventory'),
  ('app-admin', 'POST', '/api/v1/inventory'),
  ('app-admin', 'PUT', '/api/v1/inventory'),
  ('app-admin', 'DELETE', '/api/v1/inventory'),
  ('app-admin', 'GET', '/api/v1/audit'),
  ('app-admin', 'GET', '/api/v1/settings');

-- auditors read audit trails (span of groups decided at read time, Phase 3H)
INSERT INTO role_rules (role_id, method, path_prefix) VALUES
  ('auditor', 'GET', '/api/v1/audit');
