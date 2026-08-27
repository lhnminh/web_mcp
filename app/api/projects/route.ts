import { createProject, listProjects } from '@/db/projects';
import { blankApartmentScene } from '@/lib/domain/demo-scene';
import { jsonForProfile, resolveBrowserProfile } from '@/lib/server/browser-profile';

export async function GET(request: Request) {
  const profile = await resolveBrowserProfile(request);
  return jsonForProfile(profile, { projects: await listProjects(profile.id) });
}

export async function POST(request: Request) {
  const profile = await resolveBrowserProfile(request);
  try {
    const body = (await request.json()) as { name?: unknown };
    if (body.name !== undefined && typeof body.name !== 'string') {
      return jsonForProfile(profile, { error: 'name must be a string' }, { status: 400 });
    }
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    if (name.length > 80) {
      return jsonForProfile(profile, { error: 'name must be 80 characters or fewer' }, { status: 400 });
    }
    const project = await createProject({
      ownerProfileId: profile.id,
      name: name || 'Untitled apartment',
      scene: structuredClone(blankApartmentScene),
    });
    return jsonForProfile(profile, project, { status: 201 });
  } catch (error) {
    if (error instanceof SyntaxError) {
      return jsonForProfile(profile, { error: 'Request body must be valid JSON' }, { status: 400 });
    }
    throw error;
  }
}
