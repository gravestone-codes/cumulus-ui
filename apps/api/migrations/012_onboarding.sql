-- Onboarding freshness + explicit trust (roadmap §8).
-- last_seen/last_check drive cached displays (always labeled with age);
-- trust_verified records the human TOFU decision (bulk rows start false).

ALTER TABLE switches ADD COLUMN last_seen_at TIMESTAMPTZ;
ALTER TABLE switches ADD COLUMN last_check_at TIMESTAMPTZ;
ALTER TABLE switches ADD COLUMN last_check_ok BOOLEAN;
ALTER TABLE switches ADD COLUMN trust_verified BOOLEAN NOT NULL DEFAULT false;
