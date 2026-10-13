-- One layout per user per dashboard kind: the fleet welcome screen, group
-- overviews and switch homes are customized independently.
ALTER TABLE user_dashboard_widgets ADD COLUMN scope TEXT NOT NULL DEFAULT 'fleet'
  CHECK (scope IN ('fleet', 'group', 'switch'));
ALTER TABLE user_dashboard_widgets DROP CONSTRAINT user_dashboard_widgets_pkey;
ALTER TABLE user_dashboard_widgets ADD PRIMARY KEY (user_sub, scope);
