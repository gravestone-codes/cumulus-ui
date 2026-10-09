-- MAC clear for NOC (roadmap 3B.3): flushing dynamic MACs is a safe
-- operational action like clearing counters — no PATCH, no apply.
-- Idempotent for re-runs.
INSERT INTO role_rules (role_id, method, path_prefix)
SELECT 'noc', 'POST', '/bridge'
WHERE NOT EXISTS (
  SELECT 1 FROM role_rules WHERE role_id = 'noc' AND method = 'POST' AND path_prefix = '/bridge'
);
