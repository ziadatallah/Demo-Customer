-- P3 operational activation: current service heartbeats for each organization.
CREATE TABLE IF NOT EXISTS service_heartbeats (
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  service_type text NOT NULL,
  instance_id text NOT NULL,
  status text NOT NULL,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id,service_type,instance_id)
);

CREATE INDEX IF NOT EXISTS service_heartbeats_recency_idx
  ON service_heartbeats (organization_id,service_type,last_seen_at DESC);
