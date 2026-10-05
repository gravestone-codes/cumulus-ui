-- Switch reads for the bootstrap admin: app-admin keeps "no switch config"
-- but may read NVUE state (the fleet UI reads through this grant).
-- Idempotent for re-runs.
INSERT INTO role_rules (role_id, method, path_prefix)
SELECT 'app-admin', 'GET', '/'
WHERE NOT EXISTS (
  SELECT 1 FROM role_rules WHERE role_id = 'app-admin' AND method = 'GET' AND path_prefix = '/'
);
