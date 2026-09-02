CREATE TABLE IF NOT EXISTS accounts (
  id uuid PRIMARY KEY,
  email text UNIQUE NOT NULL,
  password_hash text NOT NULL,
  password_key_envelope jsonb NOT NULL,
  recovery_key_envelope jsonb NOT NULL,
  verified_at timestamptz,
  verification_token_hash text UNIQUE,
  verification_expires_at bigint,
  created_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS devices (
  id uuid PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  name text NOT NULL,
  created_at timestamptz NOT NULL,
  revoked_at timestamptz
);
CREATE TABLE IF NOT EXISTS sessions (
  refresh_hash text PRIMARY KEY,
  access_hash text UNIQUE NOT NULL,
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  device_id uuid NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  access_expires_at bigint NOT NULL,
  refresh_expires_at bigint NOT NULL,
  revoked_at timestamptz
);
CREATE TABLE IF NOT EXISTS device_enrollments (
  id uuid PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  secret_hash text NOT NULL,
  approval_code text NOT NULL,
  device_name text NOT NULL,
  expires_at bigint NOT NULL,
  approved_at timestamptz,
  completed_at timestamptz
);
CREATE TABLE IF NOT EXISTS sync_state (
  workspace_id uuid PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
  revision bigint NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS sync_entities (
  workspace_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  entity_type text NOT NULL,
  entity_id uuid NOT NULL,
  server_revision bigint NOT NULL,
  payload jsonb NOT NULL,
  action text NOT NULL DEFAULT 'upsert' CHECK (action IN ('upsert','delete')),
  deleted_at timestamptz,
  PRIMARY KEY (workspace_id, entity_type, entity_id)
);
CREATE TABLE IF NOT EXISTS sync_changes (
  workspace_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  server_revision bigint NOT NULL,
  operation_id uuid NOT NULL,
  device_id uuid NOT NULL,
  entity_type text NOT NULL,
  entity_id uuid NOT NULL,
  action text NOT NULL CHECK (action IN ('upsert', 'delete')),
  payload jsonb NOT NULL,
  PRIMARY KEY (workspace_id, server_revision),
  UNIQUE (workspace_id, operation_id)
);
CREATE INDEX IF NOT EXISTS sync_changes_cursor ON sync_changes(workspace_id, server_revision);
CREATE TABLE IF NOT EXISTS sync_tombstones (
  workspace_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  entity_type text NOT NULL,
  entity_id uuid NOT NULL,
  server_revision bigint NOT NULL,
  deleted_at timestamptz NOT NULL,
  PRIMARY KEY(workspace_id,entity_type,entity_id)
);
CREATE TABLE IF NOT EXISTS sync_device_cursors (
  workspace_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  device_id uuid NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  cursor bigint NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(workspace_id,device_id)
);
CREATE TABLE IF NOT EXISTS security_audit_events (
  id bigserial PRIMARY KEY,
  account_id uuid,
  device_id uuid,
  event_type text NOT NULL,
  outcome text NOT NULL,
  ip_hash text,
  created_at timestamptz NOT NULL DEFAULT now()
);
