import type { ArchitecturalElement, Point2, RoomElement, WallElement } from './scene';

export type SunDirection = {
  position: [number, number, number];
  bearing: number;
  elevation: number;
};

const normalizeDegrees = (degrees: number) => ((degrees % 360) + 360) % 360;

/**
 * `northAngle` rotates true north clockwise from the scene's -Z axis.
 * Solar bearing is measured clockwise from true north.
 */
export function getSunDirection(hour: number, northAngle: number, distance = 10): SunDirection {
  const progress = Math.max(0, Math.min(1, (hour - 7) / 13));
  const bearing = 90 + progress * 180;
  const elevation = 12 + Math.sin(progress * Math.PI) * 48;
  const horizontalDistance = Math.cos(elevation * Math.PI / 180) * distance;
  const sceneBearing = (bearing + (Number.isFinite(northAngle) ? northAngle : 0)) * Math.PI / 180;

  return {
    position: [
      Math.sin(sceneBearing) * horizontalDistance,
      Math.sin(elevation * Math.PI / 180) * distance,
      -Math.cos(sceneBearing) * horizontalDistance,
    ],
    bearing,
    elevation,
  };
}

const pointInRoom = (point: Point2, room: RoomElement) => {
  let inside = false;
  for (let index = 0, previous = room.boundary.length - 1; index < room.boundary.length; previous = index++) {
    const a = room.boundary[index];
    const b = room.boundary[previous];
    const crosses = (a.y > point.y) !== (b.y > point.y)
      && point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x;
    if (crosses) inside = !inside;
  }
  return inside;
};

function outwardWallNormal(wall: WallElement, architecture: ArchitecturalElement[]): Point2 | null {
  const dx = wall.end.x - wall.start.x;
  const dy = wall.end.y - wall.start.y;
  const length = Math.hypot(dx, dy);
  if (length < 0.0001) return null;

  const rooms = architecture.filter((element): element is RoomElement => element.kind === 'room');
  const midpoint = { x: (wall.start.x + wall.end.x) / 2, y: (wall.start.y + wall.end.y) / 2 };
  const normal = { x: -dy / length, y: dx / length };
  const sampleDistance = Math.max(0.03, wall.thickness * 0.75);
  const sideA = rooms.some((room) => pointInRoom({ x: midpoint.x + normal.x * sampleDistance, y: midpoint.y + normal.y * sampleDistance }, room));
  const sideB = rooms.some((room) => pointInRoom({ x: midpoint.x - normal.x * sampleDistance, y: midpoint.y - normal.y * sampleDistance }, room));

  if (sideA && !sideB) return { x: -normal.x, y: -normal.y };
  if (sideB && !sideA) return normal;

  const roomPoints = rooms.flatMap((room) => room.boundary);
  if (roomPoints.length === 0) return null;
  const center = roomPoints.reduce((total, point) => ({ x: total.x + point.x / roomPoints.length, y: total.y + point.y / roomPoints.length }), { x: 0, y: 0 });
  const towardWall = { x: midpoint.x - center.x, y: midpoint.y - center.y };
  return towardWall.x * normal.x + towardWall.y * normal.y >= 0 ? normal : { x: -normal.x, y: -normal.y };
}

export function getWallExposure(wall: WallElement, architecture: ArchitecturalElement[], northAngle: number) {
  const normal = outwardWallNormal(wall, architecture);
  if (!normal || !Number.isFinite(northAngle)) return null;
  const sceneBearing = normalizeDegrees(Math.atan2(normal.x, -normal.y) * 180 / Math.PI);
  const trueBearing = normalizeDegrees(sceneBearing - northAngle);
  const labels = ['North', 'Northeast', 'East', 'Southeast', 'South', 'Southwest', 'West', 'Northwest'] as const;
  return labels[Math.round(trueBearing / 45) % labels.length];
}

export function getWindowExposureSummary(architecture: ArchitecturalElement[], northAngle: number) {
  if (!Number.isFinite(northAngle)) return 'Orientation not confirmed';
  const walls = new Map(architecture.flatMap((element) => element.kind === 'wall' ? [[element.id, element] as const] : []));
  const exposures = architecture.flatMap((element) => {
    if (element.kind !== 'opening' || element.openingType !== 'window') return [];
    const wall = walls.get(element.wallId);
    const exposure = wall ? getWallExposure(wall, architecture, northAngle) : null;
    return exposure ? [exposure] : [];
  });
  const unique = [...new Set(exposures)];
  if (unique.length === 0) return 'Window orientation unavailable';
  return `${unique.join(' + ')} window${unique.length === 1 ? '' : 's'}`;
}
