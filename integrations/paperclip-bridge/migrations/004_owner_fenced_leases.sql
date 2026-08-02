ALTER TABLE plugin_mck_factory_bridge_7ec566f3b4.bridge_deliveries
  ADD COLUMN IF NOT EXISTS processing_generation bigint NOT NULL DEFAULT 0;

ALTER TABLE plugin_mck_factory_bridge_7ec566f3b4.bridge_deliveries
  ADD COLUMN IF NOT EXISTS processing_owner_token text;

ALTER TABLE plugin_mck_factory_bridge_7ec566f3b4.bridge_deliveries
  ADD COLUMN IF NOT EXISTS lease_started_at timestamptz;

UPDATE plugin_mck_factory_bridge_7ec566f3b4.bridge_deliveries
SET lease_started_at = updated_at
WHERE status = 'processing' AND lease_started_at IS NULL;

ALTER TABLE plugin_mck_factory_bridge_7ec566f3b4.bridge_mappings
  ADD COLUMN IF NOT EXISTS intake_generation bigint NOT NULL DEFAULT 0;

ALTER TABLE plugin_mck_factory_bridge_7ec566f3b4.bridge_mappings
  ADD COLUMN IF NOT EXISTS intake_owner_token text;

ALTER TABLE plugin_mck_factory_bridge_7ec566f3b4.bridge_mappings
  ADD COLUMN IF NOT EXISTS intake_lease_started_at timestamptz;

UPDATE plugin_mck_factory_bridge_7ec566f3b4.bridge_mappings
SET intake_lease_started_at = updated_at
WHERE intake_status = 'processing' AND intake_lease_started_at IS NULL;

ALTER TABLE plugin_mck_factory_bridge_7ec566f3b4.lifecycle_deliveries
  ADD COLUMN IF NOT EXISTS mck_lease_generation bigint NOT NULL DEFAULT 0;

ALTER TABLE plugin_mck_factory_bridge_7ec566f3b4.lifecycle_deliveries
  ADD COLUMN IF NOT EXISTS mck_lease_owner_token text;

ALTER TABLE plugin_mck_factory_bridge_7ec566f3b4.lifecycle_deliveries
  ADD COLUMN IF NOT EXISTS mck_lease_started_at timestamptz;

ALTER TABLE plugin_mck_factory_bridge_7ec566f3b4.lifecycle_deliveries
  ADD COLUMN IF NOT EXISTS outcome_lease_generation bigint NOT NULL DEFAULT 0;

ALTER TABLE plugin_mck_factory_bridge_7ec566f3b4.lifecycle_deliveries
  ADD COLUMN IF NOT EXISTS outcome_lease_owner_token text;

ALTER TABLE plugin_mck_factory_bridge_7ec566f3b4.lifecycle_deliveries
  ADD COLUMN IF NOT EXISTS outcome_lease_started_at timestamptz;

UPDATE plugin_mck_factory_bridge_7ec566f3b4.lifecycle_deliveries
SET mck_lease_started_at = updated_at
WHERE status = 'sending' AND mck_lease_started_at IS NULL;

UPDATE plugin_mck_factory_bridge_7ec566f3b4.lifecycle_deliveries
SET outcome_lease_started_at = updated_at
WHERE outcome_status = 'sending' AND outcome_lease_started_at IS NULL;
