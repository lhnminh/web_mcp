export const createProjectsTableSql = `
  CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    scene_json TEXT NOT NULL,
    revision INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )
`;

export const createProjectsUpdatedAtIndexSql = `
  CREATE INDEX IF NOT EXISTS idx_projects_updated_at
  ON projects(updated_at DESC)
`;
