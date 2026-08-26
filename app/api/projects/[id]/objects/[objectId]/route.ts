import { getProject, updateProject } from '@/db/projects';
import { applyTransformPatch, SceneValidationError } from '@/lib/domain/scene-validation';

type Context = { params: Promise<{ id: string; objectId: string }> };

export async function PATCH(request: Request, context: Context) {
  try {
    const { id, objectId } = await context.params;
    const body = (await request.json()) as {
      layoutId?: unknown;
      transform?: unknown;
      expectedRevision?: unknown;
    };
    if (typeof body.layoutId !== 'string') {
      return Response.json({ error: 'layoutId is required' }, { status: 400 });
    }
    if (!Number.isInteger(body.expectedRevision) || (body.expectedRevision as number) < 1) {
      return Response.json({ error: 'expectedRevision must be a positive integer' }, { status: 400 });
    }

    const project = await getProject(id);
    if (!project) return Response.json({ error: 'Project not found' }, { status: 404 });
    if (project.revision !== body.expectedRevision) {
      return Response.json({ error: 'Project changed since it was loaded', current: project }, { status: 409 });
    }
    const layout = project.scene.layouts.find((candidate) => candidate.id === body.layoutId);
    if (!layout) return Response.json({ error: 'Layout not found' }, { status: 404 });
    const element = layout.elements.find((candidate) => candidate.id === objectId);
    if (!element) return Response.json({ error: 'Object not found in layout' }, { status: 404 });
    if (element.locked) return Response.json({ error: 'Object is locked' }, { status: 423 });

    element.transform = applyTransformPatch(element.transform, body.transform);
    const result = await updateProject({
      id,
      name: project.name,
      scene: project.scene,
      expectedRevision: project.revision,
    });
    if (result === 'conflict') {
      return Response.json({ error: 'Project changed while the object was being updated', current: await getProject(id) }, { status: 409 });
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
