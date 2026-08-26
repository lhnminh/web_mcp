import { createProject, getProject, updateProject } from '@/db/projects';
import { demoScene } from '@/lib/domain/demo-scene';
import { parseScene, SceneValidationError } from '@/lib/domain/scene-validation';

type Context = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: Context) {
  const { id } = await context.params;
  let project = await getProject(id);
  if (!project && id === 'demo') {
    project = await createProject({ id: 'demo', name: '197 Bedford Avenue · 4B', scene: demoScene });
  }
  return project
    ? Response.json(project)
    : Response.json({ error: 'Project not found' }, { status: 404 });
}

export async function PUT(request: Request, context: Context) {
  try {
    const { id } = await context.params;
    const body = (await request.json()) as { name?: unknown; scene?: unknown; expectedRevision?: unknown };
    if (typeof body.name !== 'string' || !body.name.trim()) {
      return Response.json({ error: 'name is required' }, { status: 400 });
    }
    if (!Number.isInteger(body.expectedRevision) || (body.expectedRevision as number) < 1) {
      return Response.json({ error: 'expectedRevision must be a positive integer' }, { status: 400 });
    }
    const result = await updateProject({
      id,
      name: body.name.trim(),
      scene: parseScene(body.scene),
      expectedRevision: body.expectedRevision as number,
    });
    if (result === 'conflict') {
      return Response.json({ error: 'Project changed since it was loaded', current: await getProject(id) }, { status: 409 });
    }
    return result
      ? Response.json(result)
      : Response.json({ error: 'Project not found' }, { status: 404 });
  } catch (error) {
    if (error instanceof SceneValidationError) {
      return Response.json({ error: error.message }, { status: 400 });
    }
    if (error instanceof SyntaxError) {
      return Response.json({ error: 'Request body must be valid JSON' }, { status: 400 });
    }
    throw error;
  }
}
