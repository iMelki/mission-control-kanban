ALTER TABLE plugin_mck_factory_bridge_7ec566f3b4.lifecycle_deliveries
  ADD COLUMN IF NOT EXISTS callback_url text;

ALTER TABLE plugin_mck_factory_bridge_7ec566f3b4.lifecycle_deliveries
  ADD COLUMN IF NOT EXISTS outcome_delivery_id text;

ALTER TABLE plugin_mck_factory_bridge_7ec566f3b4.lifecycle_deliveries
  ADD COLUMN IF NOT EXISTS outcome_url text;

ALTER TABLE plugin_mck_factory_bridge_7ec566f3b4.lifecycle_deliveries
  ADD COLUMN IF NOT EXISTS outcome_raw_body text;

ALTER TABLE plugin_mck_factory_bridge_7ec566f3b4.lifecycle_deliveries
  ADD COLUMN IF NOT EXISTS outcome_payload_hash text;

UPDATE plugin_mck_factory_bridge_7ec566f3b4.lifecycle_deliveries AS delivery
SET callback_url = mapping.callback_url
FROM plugin_mck_factory_bridge_7ec566f3b4.bridge_mappings AS mapping
WHERE delivery.correlation_id = mapping.correlation_id
  AND delivery.callback_url IS NULL;
