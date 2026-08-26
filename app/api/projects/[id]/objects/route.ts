import { getProject, updateProject } from '@/db/projects';

type Context = { params: Promise<{ id: string }> };
type Category = 'bed' | 'sofa' | 'desk' | 'table' | 'storage' | 'fixture' | 'other';

const categories = new Set<Category>(['bed', 'sofa', 'desk', 'table', 'storage', 'fixture', 'other']);

export async function POST(request: Request, context: Context) {
  try {
    const { id } = await context.params;
    const body = (await request.json()) as {
      layoutId?: unknown;
      expectedRevision?: unknown;
      name?: unknown;
      category?: unknown;
      roomId?: unknown;
      dimensions?: { width?: unknown; depth?: unknown; height?: unknown };
    };
    if (typeof body.layoutId !== 'string' || typeof body.roomId !== 'string') {
      return Response.json({ error: 'layoutId and roomId are required' }, { status: 400 });
    }
    if (typeof body.name !== 'string' || !body.name.trim()) {
      return Response.json({ error: 'Object name is required' }, { status: 400 });
    }
    if (typeof body.category !== 'string' || !categories.has(body.category as Category)) {
      return Response.json({ error: 'Object category is not supported' }, { status: 400 });
    }
    if (!Number.isInteger(body.expectedRevision) || (body.expectedRevision as number) < 1) {
      return Response.json({ error: 'expectedRevision must be a positive integer' }, { status: 400 });
    }
    const dimensions = body.dimensions;
    if (!dimensions || ![dimensions.width, dimensions.depth, dimensions.height].every((value) => typeof value === 'number' && Number.isFinite(value) && value > 0 && value <= 5)) {
      return Response.json({ error: 'Dimensions must be numbers between 0 and 5 meters' }, { status: 400 });
    }

    const project = await getProject(id);
    if (!project) return Response.json({ error: 'Project not found' }, { status: 404 });
    if (project.revision !== body.expectedRevision) {
      return Response.json({ error: 'Project changed since it was loaded', current: project }, { status: 409 });
    }
    const layout = project.scene.layouts.find((candidate) => candidate.id === body.layoutId);
    if (!layout) return Response.json({ error: 'Layout not found' }, { status: 404 });
    const room = project.scene.architecture.find((candidate) => candidate.id === body.roomId && candidate.kind === 'room');
    if (!room || room.kind !== 'room') return Response.json({ error: 'Room not found' }, { status: 404 });

    const catalogItemId = `catalog-${crypto.randomUUID()}`;
    const objectId = `object-${crypto.randomUUID()}`;
    const center = room.boundary.reduce((total, point) => ({ x: total.x + point.x, y: total.y + point.y }), { x: 0, y: 0 });
    const customCount = layout.elements.filter((element) => element.id.startsWith('object-') && element.roomId === body.roomId).length;
    const offset = Math.min(customCount, 4) * 0.18;

    project.scene.catalog.push({
      id: catalogItemId,
      name: body.name.trim(),
      category: body.category as Category,
      dimensions: dimensions as { width: number; depth: number; height: number },
      metadata: { userAdded: true },
    });
    layout.elements.push({
      id: objectId,
      kind: 'furniture',
      catalogItemId,
      roomId: body.roomId,
      transform: {
        position: { x: center.x / room.boundary.length + offset, y: room.floorElevation, z: center.y / room.boundary.length + offset },
        rotation: { x: 0, y: 0, z: 0 },
      },
      clearance: 0.46,
    });

    const updated = await updateProject({ id, name: project.name, scene: project.scene, expectedRevision: project.revision });
    if (updated === 'conflict') {
      return Response.json({ error: 'Project changed while the object was being added', current: await getProject(id) }, { status: 409 });
    }
    return updated
      ? Response.json({ project: updated, objectId, catalogItemId }, { status: 201 })
      : Response.json({ error: 'Project not found' }, { status: 404 });
  } catch (error) {
    if (error instanceof SyntaxError) return Response.json({ error: 'Request body must be valid JSON' }, { status: 400 });
    throw error;
  }
}
