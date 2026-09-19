-- Workflow group endpoints for mirrored writes (roadmap 1.6/R22).
-- Same staging population as single-switch writes.

INSERT INTO role_rules (role_id, method, path_prefix)
SELECT r.id, m.method, '/api/v1/groups' FROM roles r CROSS JOIN (VALUES ('POST'), ('GET')) AS m(method)
WHERE r.id IN ('net-operator', 'net-admin', 'sys-admin');
