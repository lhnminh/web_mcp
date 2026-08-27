import { deleteProject, getProject, updateProject } from '@/db/projects';
import { parseScene, SceneValidationError } from '@/lib/domain/scene-validation';
import { jsonForProfile, resolveBrowserProfile } from '@/lib/server/browser-profile';

type Context = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: Context) {
  const profile = await resolveBrowserProfile(request);
  const { id } = await context.params;
  const project = await getProject(id, profile.id);
  return project
    ? jsonForProfile(profile, project)
    : jsonForProfile(profile, { error: 'Project not found' }, { status: 404 });
}

export async function PUT(request: Request, context: Context) {
  const profile = await resolveBrowserProfile(request);
  try {
    const { id } = await context.params;
    const body = (await request.json()) as { name?: unknown; scene?: unknown; expectedRevision?: unknown };
    if (typeof body.name !== 'string' || !body.name.trim() || body.name.trim().length > 80) {
      return jsonForProfile(profile, { error: 'name must be between 1 and 80 characters' }, { status: 400 });
    }
    if (!Number.isInteger(body.expectedRevision) || (body.expectedRevision as number) < 1) {
      return jsonForProfile(profile, { error: 'expectedRevision must be a positive integer' }, { status: 400 });
    }
    const result = await updateProject({
      id,
      ownerProfileId: profile.id,
      name: body.name.trim(),
      scene: parseScene(body.scene),
      expectedRevision: body.expectedRevision as number,
    });
    if (result === 'conflict') {
      return jsonForProfile(profile, { error: 'Project changed since it was loaded', current: await getProject(id, profile.id) }, { status: 409 });
    }
    return result
      ? jsonForProfile(profile, result)
      : jsonForProfile(profile, { error: 'Project not found' }, { status: 404 });
  } catch (error) {
    if (error instanceof SceneValidationError) {
      return jsonForProfile(profile, { error: error.message }, { status: 400 });
    }
    if (error instanceof SyntaxError) {
      return jsonForProfile(profile, { error: 'Request body must be valid JSON' }, { status: 400 });
    }
    throw error;
  }
}

export async function PATCH(request: Request, context: Context) {
  const profile = await resolveBrowserProfile(request);
  try {
    const { id } = await context.params;
    const body = (await request.json()) as { name?: unknown; expectedRevision?: unknown };
    if (typeof body.name !== 'string' || !body.name.trim() || body.name.trim().length > 80) {
      return jsonForProfile(profile, { error: 'name must be between 1 and 80 characters' }, { status: 400 });
    }
    if (!Number.isInteger(body.expectedRevision) || (body.expectedRevision as number) < 1) {
      return jsonForProfile(profile, { error: 'expectedRevision must be a positive integer' }, { status: 400 });
    }
    const current = await getProject(id, profile.id);
    if (!current) return jsonForProfile(profile, { error: 'Project not found' }, { status: 404 });
    const result = await updateProject({
      id,
      ownerProfileId: profile.id,
      name: body.name.trim(),
      scene: current.scene,
      expectedRevision: body.expectedRevision as number,
    });
    if (result === 'conflict') {
      return jsonForProfile(profile, { error: 'Project changed since it was loaded', current: await getProject(id, profile.id) }, { status: 409 });
    }
    return result
      ? jsonForProfile(profile, result)
      : jsonForProfile(profile, { error: 'Project not found' }, { status: 404 });
  } catch (error) {
    if (error instanceof SyntaxError) {
      return jsonForProfile(profile, { error: 'Request body must be valid JSON' }, { status: 400 });
    }
    throw error;
  }
}

export async function DELETE(request: Request, context: Context) {
  const profile = await resolveBrowserProfile(request);
  const { id } = await context.params;
  const deleted = await deleteProject(id, profile.id);
  return deleted
    ? jsonForProfile(profile, { deleted: true })
    : jsonForProfile(profile, { error: 'Project not found' }, { status: 404 });
}
