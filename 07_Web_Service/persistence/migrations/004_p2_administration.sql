-- P2 administration: organization-specific membership lifecycle.
ALTER TABLE organization_memberships
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active','inactive')),
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

CREATE INDEX IF NOT EXISTS organization_memberships_active_idx
  ON organization_memberships (organization_id, status, role);
