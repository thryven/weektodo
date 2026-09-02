ALTER TABLE accounts ADD COLUMN IF NOT EXISTS verification_token_hash text;
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS verification_expires_at bigint;
CREATE UNIQUE INDEX IF NOT EXISTS accounts_verification_token_hash ON accounts(verification_token_hash);

CREATE TABLE IF NOT EXISTS security_audit_events (
  id bigserial PRIMARY KEY,
  account_id uuid,
  device_id uuid,
  event_type text NOT NULL,
  outcome text NOT NULL,
  ip_hash text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS security_audit_events_created_at ON security_audit_events(created_at);
