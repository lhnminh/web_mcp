CREATE TABLE IF NOT EXISTS anonymous_profiles (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  owner_profile_id TEXT REFERENCES anonymous_profiles(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  scene_json TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_projects_updated_at
ON projects(updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_projects_owner_updated_at
ON projects(owner_profile_id, updated_at DESC);

PRAGMA optimize;
