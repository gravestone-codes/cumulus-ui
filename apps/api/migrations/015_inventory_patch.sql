-- Rename endpoints arrived after the seed: app-admin may PATCH inventory
-- (display names). Idempotent for re-runs.
INSERT INTO role_rules (role_id, method, path_prefix)
SELECT 'app-admin', 'PATCH', '/api/v1/inventory'
WHERE NOT EXISTS (
  SELECT 1 FROM role_rules WHERE role_id = 'app-admin' AND method = 'PATCH' AND path_prefix = '/api/v1/inventory'
);
