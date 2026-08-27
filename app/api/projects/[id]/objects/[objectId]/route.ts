import { getProject, updateProject } from '@/db/projects';
import { applyTransformPatch, SceneValidationError } from '@/lib/domain/scene-validation';
import { jsonForProfile, resolveBrowserProfile } from '@/lib/server/browser-profile';

type Context = { params: Promise<{ id: string; objectId: string }> };

export async function PATCH(request: Request, context: Context) {
  const profile = await resolveBrowserProfile(request);
  try {
    const { id, objectId } = await context.params;
    const body = (await request.json()) as {
      layoutId?: unknown;
      transform?: unknown;
      dimensions?: { width?: unknown; depth?: unknown; height?: unknown };
      roomId?: unknown;
      expectedRevision?: unknown;
    };
    if (typeof body.layoutId !== 'string') {
      return jsonForProfile(profile, { error: 'layoutId is required' }, { status: 400 });
    }
    if (!Number.isInteger(body.expectedRevision) || (body.expectedRevision as number) < 1) {
      return jsonForProfile(profile, { error: 'expectedRevision must be a positive integer' }, { status: 400 });
    }

    const project = await getProject(id, profile.id);
    if (!project) return jsonForProfile(profile, { error: 'Project not found' }, { status: 404 });
    if (project.revision !== body.expectedRevision) {
      return jsonForProfile(profile, { error: 'Project changed since it was loaded', current: project }, { status: 409 });
    }
    const layout = project.scene.layouts.find((candidate) => candidate.id === body.layoutId);
    if (!layout) return jsonForProfile(profile, { error: 'Layout not found' }, { status: 404 });
    const element = layout.elements.find((candidate) => candidate.id === objectId);
    if (!element) return jsonForProfile(profile, { error: 'Object not found in layout' }, { status: 404 });
    if (element.locked) return jsonForProfile(profile, { error: 'Object is locked' }, { status: 423 });

    const nextRoomId = body.roomId === undefined ? element.roomId : body.roomId;
    if (typeof nextRoomId !== 'string' || !project.scene.architecture.some((candidate) => candidate.kind === 'room' && candidate.id === nextRoomId)) {
      return jsonForProfile(profile, { error: 'Destination room was not found' }, { status: 400 });
    }

    const nextTransform = body.transform === undefined ? element.transform : applyTransformPatch(element.transform, body.transform);
    const catalogItem = project.scene.catalog.find((item) => item.id === element.catalogItemId);
    if (!catalogItem) return jsonForProfile(profile, { error: 'Furniture catalog item not found' }, { status: 422 });
    let nextDimensions = catalogItem.dimensions;
    if (body.dimensions !== undefined) {
      const values = [body.dimensions.width, body.dimensions.depth, body.dimensions.height];
      if (!values.every((value) => typeof value === 'number' && Number.isFinite(value) && value >= 0.1 && value <= 5)) {
        return jsonForProfile(profile, { error: 'Dimensions must be numbers between 0.1 and 5 meters' }, { status: 400 });
      }
      nextDimensions = body.dimensions as typeof catalogItem.dimensions;
    }
    const bounds = footprint(nextTransform.position.x, nextTransform.position.z, nextTransform.rotation.y, nextDimensions.width, nextDimensions.depth);
    const collision = layout.elements.find((candidate) => {
      if (candidate.id === element.id) return false;
      const candidateItem = project.scene.catalog.find((item) => item.id === candidate.catalogItemId);
      if (!candidateItem) return false;
      const other = footprint(candidate.transform.position.x, candidate.transform.position.z, candidate.transform.rotation.y, candidateItem.dimensions.width, candidateItem.dimensions.depth);
      return bounds.left < other.right && bounds.right > other.left && bounds.top < other.bottom && bounds.bottom > other.top;
    });
    if (collision) return jsonForProfile(profile, { error: `Object overlaps ${collision.id}` }, { status: 422 });
    element.transform = nextTransform;
    element.roomId = nextRoomId;
    catalogItem.dimensions = nextDimensions;
    const result = await updateProject({
      id,
      ownerProfileId: profile.id,
      name: project.name,
      scene: project.scene,
      expectedRevision: project.revision,
    });
    if (result === 'conflict') {
      return jsonForProfile(profile, { error: 'Project changed while the object was being updated', current: await getProject(id, profile.id) }, { status: 409 });
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

function footprint(x: number, z: number, rotation: number, width: number, depth: number) {
  const angle = rotation * Math.PI / 180;
  const halfX = Math.abs(Math.cos(angle)) * width / 2 + Math.abs(Math.sin(angle)) * depth / 2;
  const halfZ = Math.abs(Math.sin(angle)) * width / 2 + Math.abs(Math.cos(angle)) * depth / 2;
  return { left: x - halfX, right: x + halfX, top: z - halfZ, bottom: z + halfZ };
}

export async function DELETE(request: Request, context: Context) {
  const profile = await resolveBrowserProfile(request);
  try {
    const { id, objectId } = await context.params;
    const body = (await request.json()) as { layoutId?: unknown; expectedRevision?: unknown };
    if (typeof body.layoutId !== 'string') return jsonForProfile(profile, { error: 'layoutId is required' }, { status: 400 });
    if (!Number.isInteger(body.expectedRevision) || (body.expectedRevision as number) < 1) {
      return jsonForProfile(profile, { error: 'expectedRevision must be a positive integer' }, { status: 400 });
    }
    const project = await getProject(id, profile.id);
    if (!project) return jsonForProfile(profile, { error: 'Project not found' }, { status: 404 });
    if (project.revision !== body.expectedRevision) return jsonForProfile(profile, { error: 'Project changed since it was loaded', current: project }, { status: 409 });
    const layout = project.scene.layouts.find((candidate) => candidate.id === body.layoutId);
    if (!layout) return jsonForProfile(profile, { error: 'Layout not found' }, { status: 404 });
    const index = layout.elements.findIndex((candidate) => candidate.id === objectId);
    if (index < 0) return jsonForProfile(profile, { error: 'Object not found in layout' }, { status: 404 });
    if (layout.elements[index].locked) return jsonForProfile(profile, { error: 'Object is locked' }, { status: 423 });
    layout.elements.splice(index, 1);
    const result = await updateProject({ id, ownerProfileId: profile.id, name: project.name, scene: project.scene, expectedRevision: project.revision });
    if (result === 'conflict') return jsonForProfile(profile, { error: 'Project changed while the object was being removed', current: await getProject(id, profile.id) }, { status: 409 });
    return result ? jsonForProfile(profile, result) : jsonForProfile(profile, { error: 'Project not found' }, { status: 404 });
  } catch (error) {
    if (error instanceof SyntaxError) return jsonForProfile(profile, { error: 'Request body must be valid JSON' }, { status: 400 });
    throw error;
  }
}
