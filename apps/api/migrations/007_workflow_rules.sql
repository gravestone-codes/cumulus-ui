-- Workflow endpoint coverage for staging roles (roadmap 1.1 gate).
-- Staging (branch/stage/diff) is a config-write capability: operators and
-- above. NOC/viewer/auditor/app-admin stay out (read or manage only).

INSERT INTO role_rules (role_id, method, path_prefix)
SELECT r.id, m.method, '/api/v1/switches' FROM roles r CROSS JOIN (VALUES ('POST'), ('GET'), ('DELETE')) AS m(method)
WHERE r.id IN ('net-operator', 'net-admin', 'sys-admin');
