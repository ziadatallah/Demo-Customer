ALTER TABLE build_jobs ALTER COLUMN configuration_id DROP NOT NULL;
ALTER TABLE build_jobs ADD COLUMN IF NOT EXISTS idempotency_key char(64);
ALTER TABLE build_jobs ADD COLUMN IF NOT EXISTS input_hash char(64);
ALTER TABLE build_jobs ADD COLUMN IF NOT EXISTS attempt integer NOT NULL DEFAULT 0;
ALTER TABLE build_jobs ADD COLUMN IF NOT EXISTS worker_id text;
ALTER TABLE build_jobs ADD COLUMN IF NOT EXISTS error text;
ALTER TABLE build_jobs ADD COLUMN IF NOT EXISTS log_object jsonb;
ALTER TABLE build_jobs ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
CREATE UNIQUE INDEX IF NOT EXISTS build_jobs_idempotency_active_idx
  ON build_jobs(organization_id,idempotency_key)
  WHERE status NOT IN ('failed','cancelled') AND idempotency_key IS NOT NULL;
