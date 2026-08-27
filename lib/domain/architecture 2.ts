import type {
  ArchitecturalElement,
  Point2,
  RoomElement,
  SceneDocument,
  WallElement,
} from './scene';

export type ArchitectureBounds = {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  width: number;
  depth: number;
};

const architecturePoints = (architecture: ArchitecturalElement[]): Point2[] => architecture.flatMap((element) => {
  if (element.kind === 'room') return element.boundary;
  if (element.kind === 'wall') return [element.start, element.end];
  return [];
});

export function getArchitectureBounds(architecture: ArchitecturalElement[]): ArchitectureBounds {
  const points = architecturePoints(architecture);
  if (points.length === 0) return { minX: 0, minY: 0, maxX: 1, maxY: 1, width: 1, depth: 1 };
  const minX = Math.min(...points.map((point) => point.x));
  const maxX = Math.max(...points.map((point) => point.x));
  const minY = Math.min(...points.map((point) => point.y));
  const maxY = Math.max(...points.map((point) => point.y));
  return { minX, minY, maxX, maxY, width: maxX - minX, depth: maxY - minY };
}

export const wallLength = (wall: WallElement) => Math.hypot(wall.end.x - wall.start.x, wall.end.y - wall.start.y);

export const polygonArea = (boundary: Point2[]) => Math.abs(boundary.reduce((area, point, index) => {
  const next = boundary[(index + 1) % boundary.length];
  return area + point.x * next.y - next.x * point.y;
}, 0)) / 2;

const signedPolygonArea = (boundary: Point2[]) => boundary.reduce((area, point, index) => {
  const next = boundary[(index + 1) % boundary.length];
  return area + point.x * next.y - next.x * point.y;
}, 0) / 2;

const pointKey = (point: Point2) => `${Math.round(point.x * 10000)},${Math.round(point.y * 10000)}`;

const segmentIntersection = (a: WallElement, b: WallElement): Point2 | null => {
  const denominator = (a.end.x - a.start.x) * (b.end.y - b.start.y) - (a.end.y - a.start.y) * (b.end.x - b.start.x);
  if (Math.abs(denominator) < 1e-9) return null;
  const t = ((b.start.x - a.start.x) * (b.end.y - b.start.y) - (b.start.y - a.start.y) * (b.end.x - b.start.x)) / denominator;
  const u = ((b.start.x - a.start.x) * (a.end.y - a.start.y) - (b.start.y - a.start.y) * (a.end.x - a.start.x)) / denominator;
  if (t < -1e-8 || t > 1 + 1e-8 || u < -1e-8 || u > 1 + 1e-8) return null;
  return { x: a.start.x + t * (a.end.x - a.start.x), y: a.start.y + t * (a.end.y - a.start.y) };
};

const simplifyBoundary = (boundary: Point2[]) => {
  const simplified = [...boundary];
  let changed = true;
  while (changed && simplified.length >= 3) {
    changed = false;
    for (let index = 0; index < simplified.length; index += 1) {
      const previous = simplified[(index - 1 + simplified.length) % simplified.length];
      const current = simplified[index];
      const next = simplified[(index + 1) % simplified.length];
      const backtracks = pointKey(previous) === pointKey(next);
      const cross = (current.x - previous.x) * (next.y - current.y) - (current.y - previous.y) * (next.x - current.x);
      if (backtracks || Math.abs(cross) < 1e-8) {
        simplified.splice(index, 1);
        changed = true;
        break;
      }
    }
  }
  return simplified;
};

/** Finds bounded faces in a planar straight-wall graph. */
export function deriveRoomBoundaries(architecture: ArchitecturalElement[]) {
  const walls = architecture.filter((element): element is WallElement => element.kind === 'wall');
  const vertices = new Map<string, Point2>();
  const adjacency = new Map<string, Set<string>>();
  const connect = (a: Point2, b: Point2) => {
    const aKey = pointKey(a);
    const bKey = pointKey(b);
    if (aKey === bKey) return;
    vertices.set(aKey, a);
    vertices.set(bKey, b);
    if (!adjacency.has(aKey)) adjacency.set(aKey, new Set());
    if (!adjacency.has(bKey)) adjacency.set(bKey, new Set());
    adjacency.get(aKey)?.add(bKey);
    adjacency.get(bKey)?.add(aKey);
  };

  walls.forEach((wall, wallIndex) => {
    const points = [wall.start, wall.end];
    walls.forEach((candidate, candidateIndex) => {
      if (candidateIndex === wallIndex) return;
      const intersection = segmentIntersection(wall, candidate);
      if (intersection) points.push(intersection);
    });
    const dx = wall.end.x - wall.start.x;
    const dy = wall.end.y - wall.start.y;
    const parameter = (point: Point2) => Math.abs(dx) >= Math.abs(dy) ? (point.x - wall.start.x) / (dx || 1) : (point.y - wall.start.y) / (dy || 1);
    const ordered = [...new Map(points.map((point) => [pointKey(point), point])).values()].sort((a, b) => parameter(a) - parameter(b));
    ordered.slice(0, -1).forEach((point, index) => connect(point, ordered[index + 1]));
  });

  const sortedNeighbors = new Map([...adjacency.entries()].map(([key, neighbors]) => {
    const origin = vertices.get(key) as Point2;
    return [key, [...neighbors].sort((a, b) => {
      const pointA = vertices.get(a) as Point2;
      const pointB = vertices.get(b) as Point2;
      return Math.atan2(pointA.y - origin.y, pointA.x - origin.x) - Math.atan2(pointB.y - origin.y, pointB.x - origin.x);
    })] as const;
  }));

  const visited = new Set<string>();
  const faces: Point2[][] = [];
  for (const [start, neighbors] of sortedNeighbors) {
    for (const first of neighbors) {
      const startingEdge = `${start}|${first}`;
      if (visited.has(startingEdge)) continue;
      const keys: string[] = [];
      let from = start;
      let to = first;
      for (let steps = 0; steps < walls.length * 8 + 16; steps += 1) {
        const edge = `${from}|${to}`;
        if (visited.has(edge)) break;
        visited.add(edge);
        keys.push(from);
        const nextNeighbors = sortedNeighbors.get(to) ?? [];
        const reverseIndex = nextNeighbors.indexOf(from);
        if (reverseIndex < 0 || nextNeighbors.length === 0) break;
        const next = nextNeighbors[(reverseIndex - 1 + nextNeighbors.length) % nextNeighbors.length];
        from = to;
        to = next;
        if (`${from}|${to}` === startingEdge) {
          const boundary = simplifyBoundary(keys.map((key) => vertices.get(key) as Point2));
          if (boundary.length >= 3 && signedPolygonArea(boundary) > 0.01) faces.push(boundary);
          break;
        }
      }
    }
  }
  return faces;
}

export const polygonCentroid = (boundary: Point2[]) => {
  let crossSum = 0;
  let xSum = 0;
  let ySum = 0;
  boundary.forEach((point, index) => {
    const next = boundary[(index + 1) % boundary.length];
    const cross = point.x * next.y - next.x * point.y;
    crossSum += cross;
    xSum += (point.x + next.x) * cross;
    ySum += (point.y + next.y) * cross;
  });
  if (Math.abs(crossSum) < 1e-8) return boundary.reduce((total, point) => ({ x: total.x + point.x / boundary.length, y: total.y + point.y / boundary.length }), { x: 0, y: 0 });
  return { x: xSum / (3 * crossSum), y: ySum / (3 * crossSum) };
};

export function rebuildSceneRooms(scene: SceneDocument): SceneDocument {
  const existingRooms = scene.architecture.filter((element): element is RoomElement => element.kind === 'room');
  const boundaries = deriveRoomBoundaries(scene.architecture).sort((a, b) => polygonArea(b) - polygonArea(a));
  const availableRooms = new Set(existingRooms.map((room) => room.id));
  const rooms = boundaries.map((boundary, index): RoomElement => {
    const center = polygonCentroid(boundary);
    const face = { id: 'derived-face', kind: 'room', name: '', boundary, floorElevation: 0, ceilingHeight: 2.74 } satisfies RoomElement;
    const match = existingRooms.find((room) => availableRooms.has(room.id) && (pointInRoom(center, room) || pointInRoom(polygonCentroid(room.boundary), face)));
    if (match) availableRooms.delete(match.id);
    return {
      id: match?.id ?? `room-${crypto.randomUUID()}`,
      kind: 'room',
      name: match?.name ?? `Room ${index + 1}`,
      boundary,
      floorElevation: match?.floorElevation ?? 0,
      ceilingHeight: match?.ceilingHeight ?? existingRooms[0]?.ceilingHeight ?? 2.74,
    };
  });
  const withoutRooms = scene.architecture.filter((element) => element.kind !== 'room');
  const architecture: ArchitecturalElement[] = [...rooms, ...withoutRooms];
  return {
    ...scene,
    architecture,
    layouts: scene.layouts.map((layout) => ({
      ...layout,
      elements: layout.elements.map((element) => ({
        ...element,
        roomId: roomForPoint(architecture, { x: element.transform.position.x, y: element.transform.position.z }, element.roomId)?.id ?? rooms[0]?.id ?? element.roomId,
      })),
    })),
  };
}

export function isRectangularRoom(room: RoomElement) {
  if (room.boundary.length !== 4) return false;
  return room.boundary.every((point, index) => {
    const next = room.boundary[(index + 1) % room.boundary.length];
    return Math.abs(point.x - next.x) < 1e-6 || Math.abs(point.y - next.y) < 1e-6;
  });
}

export function pointInRoom(point: Point2, room: RoomElement) {
  let inside = false;
  for (let index = 0, previous = room.boundary.length - 1; index < room.boundary.length; previous = index++) {
    const a = room.boundary[index];
    const b = room.boundary[previous];
    const crosses = (a.y > point.y) !== (b.y > point.y)
      && point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x;
    if (crosses) inside = !inside;
  }
  return inside;
}

export function roomForPoint(architecture: ArchitecturalElement[], point: Point2, preferredRoomId?: string) {
  const rooms = architecture.filter((element): element is RoomElement => element.kind === 'room');
  const containing = rooms.filter((room) => pointInRoom(point, room));
  return containing.find((room) => room.id === preferredRoomId) ?? containing[0] ?? rooms.reduce<RoomElement | undefined>((nearest, room) => {
    if (!nearest) return room;
    const center = (candidate: RoomElement) => candidate.boundary.reduce((total, vertex) => ({
      x: total.x + vertex.x / candidate.boundary.length,
      y: total.y + vertex.y / candidate.boundary.length,
    }), { x: 0, y: 0 });
    const a = center(nearest);
    const b = center(room);
    return Math.hypot(point.x - b.x, point.y - b.y) < Math.hypot(point.x - a.x, point.y - a.y) ? room : nearest;
  }, undefined);
}

export function isExteriorWall(wall: WallElement, bounds: ArchitectureBounds) {
  const tolerance = 0.005;
  const on = (value: number, edge: number) => Math.abs(value - edge) <= tolerance;
  return (on(wall.start.x, bounds.minX) && on(wall.end.x, bounds.minX))
    || (on(wall.start.x, bounds.maxX) && on(wall.end.x, bounds.maxX))
    || (on(wall.start.y, bounds.minY) && on(wall.end.y, bounds.minY))
    || (on(wall.start.y, bounds.maxY) && on(wall.end.y, bounds.maxY));
}

export function resizeSceneFootprint(scene: SceneDocument, width: number, depth: number): SceneDocument {
  const bounds = getArchitectureBounds(scene.architecture);
  const scaleX = width / bounds.width;
  const scaleY = depth / bounds.depth;
  const transformPoint = (point: Point2): Point2 => ({
    x: bounds.minX + (point.x - bounds.minX) * scaleX,
    y: bounds.minY + (point.y - bounds.minY) * scaleY,
  });

  const originalWalls = new Map(scene.architecture.flatMap((element) => element.kind === 'wall' ? [[element.id, element] as const] : []));
  const resizedWalls = new Map<string, WallElement>();
  const architecture = scene.architecture.map((element): ArchitecturalElement => {
    if (element.kind === 'room') return { ...element, boundary: element.boundary.map(transformPoint) };
    if (element.kind === 'wall') {
      const resized = { ...element, start: transformPoint(element.start), end: transformPoint(element.end) };
      resizedWalls.set(element.id, resized);
      return resized;
    }
    return { ...element };
  }).map((element): ArchitecturalElement => {
    if (element.kind !== 'opening') return element;
    const originalWall = originalWalls.get(element.wallId);
    const resizedWall = resizedWalls.get(element.wallId);
    if (!originalWall || !resizedWall) return element;
    const ratio = wallLength(resizedWall) / wallLength(originalWall);
    return { ...element, offset: element.offset * ratio, width: element.width * ratio };
  });

  return {
    ...scene,
    architecture,
    layouts: scene.layouts.map((layout) => ({
      ...layout,
      elements: layout.elements.map((element) => ({
        ...element,
        transform: {
          ...element.transform,
          position: {
            ...element.transform.position,
            x: bounds.minX + (element.transform.position.x - bounds.minX) * scaleX,
            z: bounds.minY + (element.transform.position.z - bounds.minY) * scaleY,
          },
        },
      })),
    })),
  };
}
