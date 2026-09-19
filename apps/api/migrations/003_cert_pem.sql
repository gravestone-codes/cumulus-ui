-- TOFU needs the full certificate, not just its fingerprint: Node only runs
-- checkServerIdentity when chain verification is active, so the enrolled cert
-- itself is passed as the CA and the fingerprint pin is compared on top.
-- Rows with a pin but no PEM predate this and must re-enrol.
ALTER TABLE switches ADD COLUMN cert_pem TEXT;
