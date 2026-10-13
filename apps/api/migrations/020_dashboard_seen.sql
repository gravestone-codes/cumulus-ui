-- Catalog ids a user has already been offered. Widgets shipped later than a
-- user's last save join their dashboard once; removing one then sticks.
ALTER TABLE user_dashboard_widgets ADD COLUMN seen TEXT[] NOT NULL DEFAULT '{}';
