-- Sessions no longer broker IdP tokens: no refresh token to store, no IdP
-- group snapshot to keep (roles are read fresh from user_roles every call).
ALTER TABLE sessions DROP COLUMN IF EXISTS refresh_enc;
ALTER TABLE sessions DROP COLUMN IF EXISTS user_groups;
ALTER TABLE sessions DROP COLUMN IF EXISTS roles;
