ALTER TABLE sync_entities ADD COLUMN IF NOT EXISTS action text NOT NULL DEFAULT 'upsert';
ALTER TABLE sync_entities ADD COLUMN IF NOT EXISTS deleted_at timestamptz;

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
