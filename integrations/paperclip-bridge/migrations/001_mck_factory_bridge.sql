CREATE TABLE plugin_mck_factory_bridge_7ec566f3b4.bridge_deliveries (
  delivery_id text PRIMARY KEY,
  payload_hash text NOT NULL,
  event_type text NOT NULL,
  status text NOT NULL,
  mapping_correlation_id text,
  last_error text,
  processing_generation bigint NOT NULL DEFAULT 0,
  processing_owner_token text,
  lease_started_at timestamptz,
  received_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE plugin_mck_factory_bridge_7ec566f3b4.bridge_mappings (
  correlation_id text PRIMARY KEY,
  mck_task_id text NOT NULL,
  attempt_id text NOT NULL UNIQUE,
  dispatch_version integer NOT NULL,
  task_revision text NOT NULL,
  github_issue_url text NOT NULL,
  callback_url text,
  envelope jsonb NOT NULL,
  parent_issue_id uuid REFERENCES public.issues(id) ON DELETE SET NULL,
  plan_issue_id uuid REFERENCES public.issues(id) ON DELETE SET NULL,
  build_issue_id uuid REFERENCES public.issues(id) ON DELETE SET NULL,
  validate_issue_id uuid REFERENCES public.issues(id) ON DELETE SET NULL,
  review_issue_id uuid REFERENCES public.issues(id) ON DELETE SET NULL,
  release_issue_id uuid REFERENCES public.issues(id) ON DELETE SET NULL,
  intake_status text NOT NULL DEFAULT 'processing',
  lifecycle_status text,
  receipt_id text,
  last_error text,
  intake_generation bigint NOT NULL DEFAULT 0,
  intake_owner_token text,
  intake_lease_started_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE plugin_mck_factory_bridge_7ec566f3b4.lifecycle_deliveries (
  delivery_key text PRIMARY KEY,
  correlation_id text NOT NULL REFERENCES plugin_mck_factory_bridge_7ec566f3b4.bridge_mappings(correlation_id) ON DELETE CASCADE,
  delivery_id text NOT NULL UNIQUE,
  callback_url text NOT NULL,
  payload jsonb NOT NULL,
  raw_body text NOT NULL,
  payload_hash text NOT NULL,
  status text NOT NULL,
  attempt_count integer NOT NULL DEFAULT 0,
  http_status integer,
  last_error text,
  mck_lease_generation bigint NOT NULL DEFAULT 0,
  mck_lease_owner_token text,
  mck_lease_started_at timestamptz,
  outcome_status text NOT NULL DEFAULT 'pending',
  outcome_attempt_count integer NOT NULL DEFAULT 0,
  outcome_http_status integer,
  outcome_last_error text,
  outcome_lease_generation bigint NOT NULL DEFAULT 0,
  outcome_lease_owner_token text,
  outcome_lease_started_at timestamptz,
  outcome_delivery_id text,
  outcome_url text,
  outcome_raw_body text,
  outcome_payload_hash text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX bridge_mappings_parent_issue_idx
  ON plugin_mck_factory_bridge_7ec566f3b4.bridge_mappings(parent_issue_id);
CREATE INDEX bridge_mappings_stage_issues_idx
  ON plugin_mck_factory_bridge_7ec566f3b4.bridge_mappings(
    plan_issue_id,
    build_issue_id,
    validate_issue_id,
    review_issue_id,
    release_issue_id
  );
