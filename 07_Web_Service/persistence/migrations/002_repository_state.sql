ALTER TABLE programs
  ADD COLUMN repository_state jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE programs
  ADD CONSTRAINT programs_repository_state_object
  CHECK (jsonb_typeof(repository_state) = 'object');
