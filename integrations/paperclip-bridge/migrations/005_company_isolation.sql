ALTER TABLE plugin_mck_factory_bridge_7ec566f3b4.bridge_mappings
  ADD COLUMN IF NOT EXISTS company_id uuid;

ALTER TABLE plugin_mck_factory_bridge_7ec566f3b4.bridge_deliveries
  ADD COLUMN IF NOT EXISTS company_id uuid;

ALTER TABLE plugin_mck_factory_bridge_7ec566f3b4.lifecycle_deliveries
  ADD COLUMN IF NOT EXISTS company_id uuid;

-- The bridge was not live before this migration. The bounded backfill exists
-- for pre-release test data that already points at Paperclip issues. Rows with
-- no authoritative issue/mapping company are rejected instead of guessed.
UPDATE plugin_mck_factory_bridge_7ec566f3b4.bridge_mappings AS mapping
SET company_id = (
  SELECT min(issue.company_id::text)::uuid
  FROM public.issues AS issue
  WHERE issue.id IN (
    mapping.parent_issue_id,
    mapping.plan_issue_id,
    mapping.build_issue_id,
    mapping.validate_issue_id,
    mapping.review_issue_id,
    mapping.release_issue_id
  )
  HAVING count(DISTINCT issue.company_id) = 1
)
WHERE mapping.company_id IS NULL;

UPDATE plugin_mck_factory_bridge_7ec566f3b4.lifecycle_deliveries AS delivery
SET company_id = mapping.company_id
FROM plugin_mck_factory_bridge_7ec566f3b4.bridge_mappings AS mapping
WHERE delivery.correlation_id = mapping.correlation_id
  AND delivery.company_id IS NULL;

UPDATE plugin_mck_factory_bridge_7ec566f3b4.bridge_deliveries AS delivery
SET company_id = mapping.company_id
FROM plugin_mck_factory_bridge_7ec566f3b4.bridge_mappings AS mapping
WHERE delivery.mapping_correlation_id = mapping.correlation_id
  AND delivery.company_id IS NULL;

-- These NOT NULL transitions are the fail-closed gate. The aggregate above
-- leaves missing, ambiguous, or cross-company legacy mappings unscoped, and
-- the host applies the whole migration transactionally.
ALTER TABLE plugin_mck_factory_bridge_7ec566f3b4.bridge_mappings
  ALTER COLUMN company_id SET NOT NULL;
ALTER TABLE plugin_mck_factory_bridge_7ec566f3b4.bridge_deliveries
  ALTER COLUMN company_id SET NOT NULL;
ALTER TABLE plugin_mck_factory_bridge_7ec566f3b4.lifecycle_deliveries
  ALTER COLUMN company_id SET NOT NULL;

ALTER TABLE plugin_mck_factory_bridge_7ec566f3b4.lifecycle_deliveries
  DROP CONSTRAINT IF EXISTS lifecycle_deliveries_correlation_id_fkey;
ALTER TABLE plugin_mck_factory_bridge_7ec566f3b4.lifecycle_deliveries
  DROP CONSTRAINT IF EXISTS lifecycle_deliveries_delivery_id_key;
ALTER TABLE plugin_mck_factory_bridge_7ec566f3b4.lifecycle_deliveries
  DROP CONSTRAINT IF EXISTS lifecycle_deliveries_pkey;
ALTER TABLE plugin_mck_factory_bridge_7ec566f3b4.bridge_mappings
  DROP CONSTRAINT IF EXISTS bridge_mappings_attempt_id_key;
ALTER TABLE plugin_mck_factory_bridge_7ec566f3b4.bridge_mappings
  DROP CONSTRAINT IF EXISTS bridge_mappings_pkey;
ALTER TABLE plugin_mck_factory_bridge_7ec566f3b4.bridge_deliveries
  DROP CONSTRAINT IF EXISTS bridge_deliveries_pkey;

ALTER TABLE plugin_mck_factory_bridge_7ec566f3b4.bridge_mappings
  ADD CONSTRAINT bridge_mappings_pkey
    PRIMARY KEY (company_id, correlation_id),
  ADD CONSTRAINT bridge_mappings_company_attempt_key
    UNIQUE (company_id, attempt_id);

ALTER TABLE plugin_mck_factory_bridge_7ec566f3b4.bridge_deliveries
  ADD CONSTRAINT bridge_deliveries_pkey
    PRIMARY KEY (company_id, delivery_id),
  ADD CONSTRAINT bridge_deliveries_mapping_company_fkey
    FOREIGN KEY (company_id, mapping_correlation_id)
    REFERENCES plugin_mck_factory_bridge_7ec566f3b4.bridge_mappings(company_id, correlation_id);

ALTER TABLE plugin_mck_factory_bridge_7ec566f3b4.lifecycle_deliveries
  ADD CONSTRAINT lifecycle_deliveries_pkey
    PRIMARY KEY (company_id, delivery_key),
  ADD CONSTRAINT lifecycle_deliveries_company_delivery_key
    UNIQUE (company_id, delivery_id),
  ADD CONSTRAINT lifecycle_deliveries_mapping_company_fkey
    FOREIGN KEY (company_id, correlation_id)
    REFERENCES plugin_mck_factory_bridge_7ec566f3b4.bridge_mappings(company_id, correlation_id)
    ON DELETE CASCADE;

-- Phase-1 host policy forbids destructive DROP statements. Retain the two
-- pre-company indexes as harmless compatibility indexes and add scoped ones.
CREATE INDEX bridge_mappings_company_parent_issue_idx
  ON plugin_mck_factory_bridge_7ec566f3b4.bridge_mappings(company_id, parent_issue_id);
CREATE INDEX bridge_mappings_company_stage_issues_idx
  ON plugin_mck_factory_bridge_7ec566f3b4.bridge_mappings(
    company_id,
    plan_issue_id,
    build_issue_id,
    validate_issue_id,
    review_issue_id,
    release_issue_id
  );
CREATE INDEX bridge_deliveries_company_status_idx
  ON plugin_mck_factory_bridge_7ec566f3b4.bridge_deliveries(company_id, status, updated_at);
CREATE INDEX lifecycle_deliveries_company_retry_idx
  ON plugin_mck_factory_bridge_7ec566f3b4.lifecycle_deliveries(
    company_id,
    status,
    outcome_status,
    updated_at
  );
