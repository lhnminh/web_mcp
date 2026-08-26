import { createProject, listProjects } from '@/db/projects';
import { demoScene } from '@/lib/domain/demo-scene';
import { parseScene, SceneValidationError } from '@/lib/domain/scene-validation';

export async function GET() {
  return Response.json({ projects: await listProjects() });
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { id?: string; name?: string; scene?: unknown };
    const project = await createProject({
      id: body.id,
      name: body.name?.trim() || 'Untitled apartment',
      scene: body.scene === undefined ? demoScene : parseScene(body.scene),
    });
    return Response.json(project, { status: 201 });
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
