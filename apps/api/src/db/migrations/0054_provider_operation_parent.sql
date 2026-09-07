ALTER TABLE provider_operations
  ADD COLUMN parent_operation_id uuid
  REFERENCES provider_operations(id) ON DELETE RESTRICT;

CREATE INDEX provider_operations_parent_time_idx
  ON provider_operations(parent_operation_id, started_at, id)
  WHERE parent_operation_id IS NOT NULL;
