import { neon } from '@neondatabase/serverless';
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
const memoryProjects = new Map<string, ProjectRecord>();

const hasConfiguredDatabase = () => /^postgres(?:ql)?:\/\//.test(process.env.DATABASE_URL ?? '');
const cloneProject = (project: ProjectRecord): ProjectRecord => structuredClone(project);

const database = () => {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL is not configured');
  }
  return neon(connectionString);
};

async function ensureSchema(): Promise<void> {
  schemaReady ??= (async () => {
    const db = database();
    await db.query(createProjectsTableSql);
    await db.query(createProjectsUpdatedAtIndexSql);
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
  if (!hasConfiguredDatabase()) {
    return [...memoryProjects.values()]
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .map(({ id, name, revision, createdAt, updatedAt }) => ({ id, name, revision, createdAt, updatedAt }));
  }
  await ensureSchema();
  const rows = (await database().query(
    'SELECT id, name, revision, created_at, updated_at FROM projects ORDER BY updated_at DESC',
  )) as Omit<ProjectRow, 'scene_json'>[];
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    revision: row.revision,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));
}

export async function getProject(id: string): Promise<ProjectRecord | null> {
  if (!hasConfiguredDatabase()) return memoryProjects.has(id) ? cloneProject(memoryProjects.get(id) as ProjectRecord) : null;
  await ensureSchema();
  const rows = (await database().query(
    'SELECT id, name, scene_json, revision, created_at, updated_at FROM projects WHERE id = $1',
    [id],
  )) as ProjectRow[];
  const row = rows[0];
  return row ? toProject(row) : null;
}

export async function createProject(input: { id?: string; name: string; scene: SceneDocument }): Promise<ProjectRecord> {
  if (!hasConfiguredDatabase()) {
    const id = input.id ?? crypto.randomUUID();
    const existing = memoryProjects.get(id);
    if (existing) return cloneProject(existing);
    const now = new Date().toISOString();
    const project: ProjectRecord = { id, name: input.name, revision: 1, scene: parseScene(structuredClone(input.scene)), createdAt: now, updatedAt: now };
    memoryProjects.set(id, project);
    return cloneProject(project);
  }
  await ensureSchema();
  const id = input.id ?? crypto.randomUUID();
  const now = new Date().toISOString();
  const rows = (await database().query(
    `INSERT INTO projects (id, name, scene_json, revision, created_at, updated_at)
     VALUES ($1, $2, $3, 1, $4, $5)
     RETURNING id, name, scene_json, revision, created_at, updated_at`,
    [id, input.name, JSON.stringify(parseScene(input.scene)), now, now],
  )) as ProjectRow[];
  return toProject(rows[0]);
}

export async function updateProject(input: {
  id: string;
  name: string;
  scene: SceneDocument;
  expectedRevision: number;
}): Promise<ProjectRecord | 'conflict' | null> {
  if (!hasConfiguredDatabase()) {
    const current = memoryProjects.get(input.id);
    if (!current) return null;
    if (current.revision !== input.expectedRevision) return 'conflict';
    const project: ProjectRecord = {
      ...current,
      name: input.name,
      scene: parseScene(structuredClone(input.scene)),
      revision: current.revision + 1,
      updatedAt: new Date().toISOString(),
    };
    memoryProjects.set(input.id, project);
    return cloneProject(project);
  }
  await ensureSchema();
  const now = new Date().toISOString();
  const rows = (await database().query(
    `UPDATE projects
     SET name = $1, scene_json = $2, revision = revision + 1, updated_at = $3
     WHERE id = $4 AND revision = $5
     RETURNING id, name, scene_json, revision, created_at, updated_at`,
    [input.name, JSON.stringify(parseScene(input.scene)), now, input.id, input.expectedRevision],
  )) as ProjectRow[];
  if (rows.length === 0) {
    return (await getProject(input.id)) ? 'conflict' : null;
  }
  return toProject(rows[0]);
}
