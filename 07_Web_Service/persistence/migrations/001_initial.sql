-- ISAF v5.0.0 initial multiuser persistence schema.
-- Immutable after qualification; add a new numbered migration for later changes.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE organizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  slug text NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended','archived')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subject text NOT NULL UNIQUE,
  email text NOT NULL,
  display_name text NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','disabled')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE organization_memberships (
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('organization_admin','program_manager','contributor','reviewer','approver','read_only','service_account')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id,user_id)
);

CREATE TABLE programs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  name text NOT NULL,
  company text NOT NULL,
  document_prefix text NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','closed','archived')),
  document_control_enabled boolean NOT NULL DEFAULT false,
  revision bigint NOT NULL DEFAULT 0,
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id,id),
  UNIQUE (organization_id,name,document_prefix)
);

CREATE TABLE stored_objects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  sha256 char(64) NOT NULL,
  byte_size bigint NOT NULL CHECK (byte_size >= 0),
  media_type text NOT NULL,
  storage_provider text NOT NULL,
  storage_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id,id),
  UNIQUE (organization_id,sha256)
);

CREATE TABLE program_configurations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  program_id uuid NOT NULL,
  object_id uuid NOT NULL,
  filename text NOT NULL,
  parsed_data jsonb NOT NULL,
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (organization_id,program_id) REFERENCES programs(organization_id,id),
  FOREIGN KEY (organization_id,object_id) REFERENCES stored_objects(organization_id,id),
  UNIQUE (organization_id,id)
);

CREATE TABLE documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  program_id uuid NOT NULL,
  document_number text NOT NULL,
  title text NOT NULL,
  category text NOT NULL,
  lifecycle_state text NOT NULL DEFAULT 'in_preparation',
  generation_key text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (organization_id,program_id) REFERENCES programs(organization_id,id),
  UNIQUE (organization_id,id),
  UNIQUE (organization_id,program_id,document_number)
);

CREATE TABLE document_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  document_id uuid NOT NULL,
  object_id uuid NOT NULL,
  revision text NOT NULL,
  version_label text NOT NULL,
  status text NOT NULL CHECK (status IN ('draft','candidate','released','obsolete')),
  source_kind text NOT NULL,
  source_detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  change_summary text NOT NULL,
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (organization_id,document_id) REFERENCES documents(organization_id,id),
  FOREIGN KEY (organization_id,object_id) REFERENCES stored_objects(organization_id,id),
  UNIQUE (organization_id,id),
  UNIQUE (organization_id,document_id,version_label)
);

CREATE TABLE document_checkouts (
  organization_id uuid NOT NULL REFERENCES organizations(id),
  document_id uuid PRIMARY KEY,
  base_version_id uuid NOT NULL,
  checked_out_by uuid NOT NULL REFERENCES users(id),
  checkout_token_hash char(64) NOT NULL,
  checked_out_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (organization_id,document_id) REFERENCES documents(organization_id,id),
  FOREIGN KEY (organization_id,base_version_id) REFERENCES document_versions(organization_id,id)
);

CREATE TABLE baselines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  program_id uuid NOT NULL,
  name text NOT NULL,
  milestone text,
  comment text NOT NULL,
  created_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (organization_id,program_id) REFERENCES programs(organization_id,id),
  UNIQUE (organization_id,id),
  UNIQUE (organization_id,program_id,name)
);

CREATE TABLE baseline_entries (
  organization_id uuid NOT NULL REFERENCES organizations(id),
  baseline_id uuid NOT NULL,
  document_id uuid NOT NULL,
  version_id uuid NOT NULL,
  PRIMARY KEY (baseline_id,document_id),
  FOREIGN KEY (organization_id,baseline_id) REFERENCES baselines(organization_id,id),
  FOREIGN KEY (organization_id,document_id) REFERENCES documents(organization_id,id),
  FOREIGN KEY (organization_id,version_id) REFERENCES document_versions(organization_id,id)
);

CREATE TABLE build_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  program_id uuid NOT NULL,
  status text NOT NULL CHECK (status IN ('queued','running','succeeded','failed','cancelled')),
  requested_phase text NOT NULL,
  configuration_id uuid NOT NULL,
  engine_version text NOT NULL,
  request jsonb NOT NULL DEFAULT '{}'::jsonb,
  result jsonb,
  log_object_id uuid,
  package_object_id uuid,
  requested_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  completed_at timestamptz,
  FOREIGN KEY (organization_id,program_id) REFERENCES programs(organization_id,id),
  FOREIGN KEY (organization_id,configuration_id) REFERENCES program_configurations(organization_id,id),
  FOREIGN KEY (organization_id,log_object_id) REFERENCES stored_objects(organization_id,id),
  FOREIGN KEY (organization_id,package_object_id) REFERENCES stored_objects(organization_id,id),
  UNIQUE (organization_id,id)
);

CREATE TABLE integrations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  name text NOT NULL,
  connector_type text NOT NULL,
  base_url text NOT NULL,
  secret_ref text NOT NULL,
  status text NOT NULL DEFAULT 'disabled' CHECK (status IN ('disabled','active','error')),
  configuration jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_tested_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id,id),
  UNIQUE (organization_id,name)
);

CREATE TABLE external_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  program_id uuid NOT NULL,
  integration_id uuid NOT NULL,
  local_kind text NOT NULL,
  local_id uuid NOT NULL,
  remote_id text NOT NULL,
  remote_revision text,
  remote_url text,
  remote_digest text,
  synchronized_at timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  FOREIGN KEY (organization_id,program_id) REFERENCES programs(organization_id,id),
  FOREIGN KEY (organization_id,integration_id) REFERENCES integrations(organization_id,id),
  UNIQUE (organization_id,id),
  UNIQUE (organization_id,integration_id,local_kind,local_id,remote_id)
);

CREATE TABLE audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  program_id uuid,
  actor_id uuid REFERENCES users(id),
  actor_label text NOT NULL,
  action text NOT NULL,
  entity_kind text NOT NULL,
  entity_id uuid,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  previous_hash char(64),
  event_hash char(64) NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (organization_id,program_id) REFERENCES programs(organization_id,id),
  UNIQUE (organization_id,id)
);

CREATE OR REPLACE FUNCTION reject_audit_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'audit_events are append-only';
END;
$$;

CREATE TRIGGER audit_events_no_update BEFORE UPDATE ON audit_events FOR EACH ROW EXECUTE FUNCTION reject_audit_mutation();
CREATE TRIGGER audit_events_no_delete BEFORE DELETE ON audit_events FOR EACH ROW EXECUTE FUNCTION reject_audit_mutation();

ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE organization_memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE programs ENABLE ROW LEVEL SECURITY;
ALTER TABLE stored_objects ENABLE ROW LEVEL SECURITY;
ALTER TABLE program_configurations ENABLE ROW LEVEL SECURITY;
ALTER TABLE documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE document_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE document_checkouts ENABLE ROW LEVEL SECURITY;
ALTER TABLE baselines ENABLE ROW LEVEL SECURITY;
ALTER TABLE baseline_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE build_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE integrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE external_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_organizations ON organizations USING (id = nullif(current_setting('app.organization_id',true),'')::uuid);
CREATE POLICY tenant_memberships ON organization_memberships USING (organization_id = nullif(current_setting('app.organization_id',true),'')::uuid);
CREATE POLICY tenant_programs ON programs USING (organization_id = nullif(current_setting('app.organization_id',true),'')::uuid);
CREATE POLICY tenant_objects ON stored_objects USING (organization_id = nullif(current_setting('app.organization_id',true),'')::uuid);
CREATE POLICY tenant_configurations ON program_configurations USING (organization_id = nullif(current_setting('app.organization_id',true),'')::uuid);
CREATE POLICY tenant_documents ON documents USING (organization_id = nullif(current_setting('app.organization_id',true),'')::uuid);
CREATE POLICY tenant_versions ON document_versions USING (organization_id = nullif(current_setting('app.organization_id',true),'')::uuid);
CREATE POLICY tenant_checkouts ON document_checkouts USING (organization_id = nullif(current_setting('app.organization_id',true),'')::uuid);
CREATE POLICY tenant_baselines ON baselines USING (organization_id = nullif(current_setting('app.organization_id',true),'')::uuid);
CREATE POLICY tenant_baseline_entries ON baseline_entries USING (organization_id = nullif(current_setting('app.organization_id',true),'')::uuid);
CREATE POLICY tenant_build_jobs ON build_jobs USING (organization_id = nullif(current_setting('app.organization_id',true),'')::uuid);
CREATE POLICY tenant_integrations ON integrations USING (organization_id = nullif(current_setting('app.organization_id',true),'')::uuid);
CREATE POLICY tenant_external_links ON external_links USING (organization_id = nullif(current_setting('app.organization_id',true),'')::uuid);
CREATE POLICY tenant_audit_events ON audit_events USING (organization_id = nullif(current_setting('app.organization_id',true),'')::uuid);

CREATE INDEX programs_organization_idx ON programs(organization_id,updated_at DESC);
CREATE INDEX documents_program_idx ON documents(organization_id,program_id,document_number);
CREATE INDEX versions_document_idx ON document_versions(organization_id,document_id,created_at DESC);
CREATE INDEX builds_program_idx ON build_jobs(organization_id,program_id,created_at DESC);
CREATE INDEX audit_program_idx ON audit_events(organization_id,program_id,occurred_at DESC);
CREATE INDEX external_links_local_idx ON external_links(organization_id,local_kind,local_id);
