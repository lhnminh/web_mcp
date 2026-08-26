import { env } from 'cloudflare:workers';
import type { ProjectRecord, ProjectSummary, SceneDocument } from '@/lib/domain/scene';
import { parseScene } from '@/lib/domain/scene-validation';
import { createProjectsTableSql, createProjectsUpdatedAtIndexSql } from './schema';

type ProjectRow = {
  id: string;
  name: string;
  scene_json: string;
  revision: number;
  created_at: string;
  updated_at: string;
};

let schemaReady: Promise<void> | undefined;

const database = (): D1Database => (env as unknown as { DB: D1Database }).DB;

async function ensureSchema(): Promise<void> {
  schemaReady ??= (async () => {
    const db = database();
    await db.batch([
      db.prepare(createProjectsTableSql),
      db.prepare(createProjectsUpdatedAtIndexSql),
    ]);
  })();
  return schemaReady;
}

const toProject = (row: ProjectRow): ProjectRecord => ({
  id: row.id,
  name: row.name,
  revision: row.revision,
  scene: parseScene(JSON.parse(row.scene_json)),
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

export async function listProjects(): Promise<ProjectSummary[]> {
  await ensureSchema();
  const result = await database()
    .prepare('SELECT id, name, revision, created_at, updated_at FROM projects ORDER BY updated_at DESC')
    .all<Omit<ProjectRow, 'scene_json'>>();
  return result.results.map((row) => ({
    id: row.id,
    name: row.name,
    revision: row.revision,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));
}

export async function getProject(id: string): Promise<ProjectRecord | null> {
  await ensureSchema();
  const row = await database()
    .prepare('SELECT id, name, scene_json, revision, created_at, updated_at FROM projects WHERE id = ?')
    .bind(id)
    .first<ProjectRow>();
  return row ? toProject(row) : null;
}

export async function createProject(input: { id?: string; name: string; scene: SceneDocument }): Promise<ProjectRecord> {
  await ensureSchema();
  const id = input.id ?? crypto.randomUUID();
  const now = new Date().toISOString();
  await database()
    .prepare('INSERT INTO projects (id, name, scene_json, revision, created_at, updated_at) VALUES (?, ?, ?, 1, ?, ?)')
    .bind(id, input.name, JSON.stringify(parseScene(input.scene)), now, now)
    .run();
  return (await getProject(id))!;
}

export async function updateProject(input: {
  id: string;
  name: string;
  scene: SceneDocument;
  expectedRevision: number;
}): Promise<ProjectRecord | 'conflict' | null> {
  await ensureSchema();
  const now = new Date().toISOString();
  const result = await database()
    .prepare('UPDATE projects SET name = ?, scene_json = ?, revision = revision + 1, updated_at = ? WHERE id = ? AND revision = ?')
    .bind(input.name, JSON.stringify(parseScene(input.scene)), now, input.id, input.expectedRevision)
    .run();
  if (result.meta.changes === 0) {
    return (await getProject(input.id)) ? 'conflict' : null;
  }
  return getProject(input.id);
}
