CREATE TABLE IF NOT EXISTS anonymous_profiles (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL
);

ALTER TABLE projects
ADD COLUMN IF NOT EXISTS owner_profile_id TEXT
REFERENCES anonymous_profiles(id)
ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_projects_owner_updated_at
ON projects(owner_profile_id, updated_at DESC);
