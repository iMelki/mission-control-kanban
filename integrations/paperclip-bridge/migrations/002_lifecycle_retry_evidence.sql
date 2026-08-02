ALTER TABLE plugin_mck_factory_bridge_7ec566f3b4.lifecycle_deliveries
  ADD COLUMN IF NOT EXISTS raw_body text;

ALTER TABLE plugin_mck_factory_bridge_7ec566f3b4.lifecycle_deliveries
  ADD COLUMN IF NOT EXISTS payload_hash text;

ALTER TABLE plugin_mck_factory_bridge_7ec566f3b4.lifecycle_deliveries
  ADD COLUMN IF NOT EXISTS attempt_count integer NOT NULL DEFAULT 0;

ALTER TABLE plugin_mck_factory_bridge_7ec566f3b4.lifecycle_deliveries
  ADD COLUMN IF NOT EXISTS outcome_status text NOT NULL DEFAULT 'pending';

ALTER TABLE plugin_mck_factory_bridge_7ec566f3b4.lifecycle_deliveries
  ADD COLUMN IF NOT EXISTS outcome_attempt_count integer NOT NULL DEFAULT 0;

ALTER TABLE plugin_mck_factory_bridge_7ec566f3b4.lifecycle_deliveries
  ADD COLUMN IF NOT EXISTS outcome_http_status integer;

ALTER TABLE plugin_mck_factory_bridge_7ec566f3b4.lifecycle_deliveries
  ADD COLUMN IF NOT EXISTS outcome_last_error text;

UPDATE plugin_mck_factory_bridge_7ec566f3b4.lifecycle_deliveries
SET
  raw_body = COALESCE(raw_body, payload::text),
  payload_hash = COALESCE(payload_hash, encode(sha256(convert_to(COALESCE(raw_body, payload::text), 'UTF8')), 'hex'))
WHERE raw_body IS NULL OR payload_hash IS NULL;

ALTER TABLE plugin_mck_factory_bridge_7ec566f3b4.lifecycle_deliveries
  ALTER COLUMN raw_body SET NOT NULL;

ALTER TABLE plugin_mck_factory_bridge_7ec566f3b4.lifecycle_deliveries
  ALTER COLUMN payload_hash SET NOT NULL;
