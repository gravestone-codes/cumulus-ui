-- Full removal: presence rows die with their switch (edit_sessions,
-- switch_credentials and memberships already cascade; audit_log stays —
-- history is append-only and outlives the switch).
DELETE FROM presence WHERE switch_id NOT IN (SELECT id FROM switches);
ALTER TABLE presence ADD CONSTRAINT presence_switch_fk FOREIGN KEY (switch_id) REFERENCES switches (id) ON DELETE CASCADE;
