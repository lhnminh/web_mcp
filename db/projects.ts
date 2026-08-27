import { neon } from '@neondatabase/serverless';
import type { ProjectRecord, ProjectSummary, SceneDocument } from '@/lib/domain/scene';
import { parseScene } from '@/lib/domain/scene-validation';
import {
  addProjectOwnerSql,
  createAnonymousProfilesTableSql,
  createProjectsOwnerUpdatedAtIndexSql,
  createProjectsTableSql,
  createProjectsUpdatedAtIndexSql,
} from './schema';

type ProjectRow = {
  id: string;
  owner_profile_id: string | null;
  name: string;
  scene_json: string;
  revision: number;
  created_at: string;
  updated_at: string;
};

let schemaReady: Promise<void> | undefined;
const memoryProfiles = new Set<string>();
const memoryProjects = new Map<string, ProjectRecord>();

const hasConfiguredDatabase = () => /^postgres(?:ql)?:\/\//.test(process.env.DATABASE_URL ?? '');
const cloneProject = (project: ProjectRecord): ProjectRecord => structuredClone(project);

const database = () => {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error('DATABASE_URL is not configured');
  return neon(connectionString);
};

async function ensureSchema(): Promise<void> {
  schemaReady ??= (async () => {
    const db = database();
    await db.query(createAnonymousProfilesTableSql);
    await db.query(createProjectsTableSql);
    await db.query(addProjectOwnerSql);
    await db.query(createProjectsUpdatedAtIndexSql);
    await db.query(createProjectsOwnerUpdatedAtIndexSql);
  })();
  return schemaReady;
}

const toProject = (row: ProjectRow): ProjectRecord => ({
  id: row.id,
  ownerProfileId: row.owner_profile_id,
  name: row.name,
  revision: row.revision,
  scene: parseScene(JSON.parse(row.scene_json)),
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const toSummary = ({ id, name, revision, createdAt, updatedAt }: ProjectRecord): ProjectSummary => ({
  id,
  name,
  revision,
  createdAt,
  updatedAt,
});

export async function ensureAnonymousProfile(id: string): Promise<void> {
  if (!hasConfiguredDatabase()) {
    memoryProfiles.add(id);
    return;
  }
  await ensureSchema();
  const now = new Date().toISOString();
  await database().query(
    `INSERT INTO anonymous_profiles (id, created_at, last_seen_at)
     VALUES ($1, $2, $2)
     ON CONFLICT (id) DO UPDATE SET last_seen_at = EXCLUDED.last_seen_at`,
    [id, now],
  );
}

export async function listProjects(ownerProfileId: string): Promise<ProjectSummary[]> {
  if (!hasConfiguredDatabase()) {
    return [...memoryProjects.values()]
      .filter((project) => project.ownerProfileId === ownerProfileId)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .map(toSummary);
  }
  await ensureSchema();
  const rows = (await database().query(
    `SELECT id, name, revision, created_at, updated_at
     FROM projects
     WHERE owner_profile_id = $1
     ORDER BY updated_at DESC`,
    [ownerProfileId],
  )) as Omit<ProjectRow, 'owner_profile_id' | 'scene_json'>[];
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    revision: row.revision,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));
}

export async function getProject(id: string, ownerProfileId: string): Promise<ProjectRecord | null> {
  if (!hasConfiguredDatabase()) {
    const project = memoryProjects.get(id);
    return project?.ownerProfileId === ownerProfileId ? cloneProject(project) : null;
  }
  await ensureSchema();
  const rows = (await database().query(
    `SELECT id, owner_profile_id, name, scene_json, revision, created_at, updated_at
     FROM projects
     WHERE id = $1 AND owner_profile_id = $2`,
    [id, ownerProfileId],
  )) as ProjectRow[];
  return rows[0] ? toProject(rows[0]) : null;
}

export async function createProject(input: { ownerProfileId: string; name: string; scene: SceneDocument }): Promise<ProjectRecord> {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  if (!hasConfiguredDatabase()) {
    const project: ProjectRecord = {
      id,
      ownerProfileId: input.ownerProfileId,
      name: input.name,
      revision: 1,
      scene: parseScene(structuredClone(input.scene)),
      createdAt: now,
      updatedAt: now,
    };
    memoryProjects.set(id, project);
    return cloneProject(project);
  }
  await ensureSchema();
  const rows = (await database().query(
    `INSERT INTO projects (id, owner_profile_id, name, scene_json, revision, created_at, updated_at)
     VALUES ($1, $2, $3, $4, 1, $5, $5)
     RETURNING id, owner_profile_id, name, scene_json, revision, created_at, updated_at`,
    [id, input.ownerProfileId, input.name, JSON.stringify(parseScene(input.scene)), now],
  )) as ProjectRow[];
  return toProject(rows[0]);
}

export async function updateProject(input: {
  id: string;
  ownerProfileId: string;
  name: string;
  scene: SceneDocument;
  expectedRevision: number;
}): Promise<ProjectRecord | 'conflict' | null> {
  if (!hasConfiguredDatabase()) {
    const current = memoryProjects.get(input.id);
    if (!current || current.ownerProfileId !== input.ownerProfileId) return null;
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
     WHERE id = $4 AND owner_profile_id = $5 AND revision = $6
     RETURNING id, owner_profile_id, name, scene_json, revision, created_at, updated_at`,
    [input.name, JSON.stringify(parseScene(input.scene)), now, input.id, input.ownerProfileId, input.expectedRevision],
  )) as ProjectRow[];
  if (rows.length === 0) return (await getProject(input.id, input.ownerProfileId)) ? 'conflict' : null;
  return toProject(rows[0]);
}

export async function deleteProject(id: string, ownerProfileId: string): Promise<boolean> {
  if (!hasConfiguredDatabase()) {
    const project = memoryProjects.get(id);
    if (!project || project.ownerProfileId !== ownerProfileId) return false;
    return memoryProjects.delete(id);
  }
  await ensureSchema();
  const rows = (await database().query(
    `DELETE FROM projects WHERE id = $1 AND owner_profile_id = $2 RETURNING id`,
    [id, ownerProfileId],
  )) as { id: string }[];
  return rows.length > 0;
}
