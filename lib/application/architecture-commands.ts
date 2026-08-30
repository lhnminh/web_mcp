import {
  getArchitectureBounds,
  isExteriorWall,
  pointInRoom,
  rebuildSceneRoomsWithReconciliation,
  wallLength,
  type RoomReconciliation,
} from '@/lib/domain/architecture';
import type { ArchitecturalElement, OpeningElement, Point2, RoomElement, SceneDocument, WallElement } from '@/lib/domain/scene';

export type ArchitectureSelection = { kind: 'room' | 'wall' | 'opening'; entityId: string; wallId?: string };
export type ArchitectureCommandCode = 'NOT_FOUND' | 'INVALID_INPUT' | 'PREREQUISITE_REQUIRED' | 'GEOMETRY_CONFLICT' | 'OPENING_DOES_NOT_FIT' | 'EXTERIOR_LOOP_INVALID';

export type ArchitectureCommandResult = {
  ok: true;
  scene: SceneDocument;
  message: string;
  selection?: ArchitectureSelection;
  reconciliation?: RoomReconciliation;
  data?: Record<string, unknown>;
} | {
  ok: false;
  code: ArchitectureCommandCode;
  message: string;
};

export type WallEndpoint = 'start' | 'end';
export type WallPatch = Partial<Pick<WallElement, 'start' | 'end' | 'thickness' | 'height'>> & { length?: number };
export type OpeningPatch = Partial<Pick<OpeningElement, 'offset' | 'width' | 'height' | 'sillHeight' | 'swing' | 'swingSide'>>;

const failure = (code: ArchitectureCommandCode, message: string): ArchitectureCommandResult => ({ ok: false, code, message });
const samePoint = (a: Point2, b: Point2, tolerance = 0.015) => Math.hypot(a.x - b.x, a.y - b.y) <= tolerance;
const geometryPointKey = (point: Point2) => `${Math.round(point.x * 100)},${Math.round(point.y * 100)}`;
const orientation = (a: Point2, b: Point2, c: Point2) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
const pointOnSegment = (point: Point2, start: Point2, end: Point2) => Math.abs(orientation(start, end, point)) < 0.0001
  && point.x >= Math.min(start.x, end.x) - 0.0001 && point.x <= Math.max(start.x, end.x) + 0.0001
  && point.y >= Math.min(start.y, end.y) - 0.0001 && point.y <= Math.max(start.y, end.y) + 0.0001;

const segmentsCross = (a: WallElement, b: WallElement) => {
  if ([a.start, a.end].some((pointA) => [b.start, b.end].some((pointB) => samePoint(pointA, pointB)))) return false;
  const abStart = orientation(a.start, a.end, b.start);
  const abEnd = orientation(a.start, a.end, b.end);
  const baStart = orientation(b.start, b.end, a.start);
  const baEnd = orientation(b.start, b.end, a.end);
  if (abStart * abEnd < 0 && baStart * baEnd < 0) return true;
  return (Math.abs(abStart) < 0.0001 && pointOnSegment(b.start, a.start, a.end))
    || (Math.abs(abEnd) < 0.0001 && pointOnSegment(b.end, a.start, a.end))
    || (Math.abs(baStart) < 0.0001 && pointOnSegment(a.start, b.start, b.end))
    || (Math.abs(baEnd) < 0.0001 && pointOnSegment(a.end, b.start, b.end));
};

const exteriorLoopError = (walls: WallElement[]) => {
  if (walls.length < 3) return 'The exterior perimeter needs at least three walls.';
  const degrees = new Map<string, number>();
  walls.forEach((wall) => [wall.start, wall.end].forEach((point) => degrees.set(geometryPointKey(point), (degrees.get(geometryPointKey(point)) ?? 0) + 1)));
  if ([...degrees.values()].some((degree) => degree !== 2)) return 'Exterior corners must remain connected.';
  for (let first = 0; first < walls.length; first += 1) {
    for (let second = first + 1; second < walls.length; second += 1) {
      if (segmentsCross(walls[first], walls[second])) return 'Exterior walls cannot cross each other.';
    }
  }
  const connected = new Set<string>([walls[0].id]);
  let changed = true;
  while (changed) {
    changed = false;
    walls.forEach((wall) => {
      if (connected.has(wall.id)) return;
      if (walls.some((candidate) => connected.has(candidate.id) && [wall.start, wall.end].some((point) => [candidate.start, candidate.end].some((candidatePoint) => samePoint(point, candidatePoint))))) {
        connected.add(wall.id);
        changed = true;
      }
    });
  }
  return connected.size === walls.length ? null : 'The exterior perimeter must remain one closed shape.';
};

const findOpeningPlacement = (architecture: ArchitecturalElement[], wall: WallElement, preferredWidth: number, minimumWidth = preferredWidth) => {
  const cornerClearance = 0.1;
  const length = wallLength(wall);
  const openings = architecture.filter((element): element is OpeningElement => element.kind === 'opening' && element.wallId === wall.id).sort((a, b) => a.offset - b.offset);
  const gaps: Array<{ start: number; end: number }> = [];
  let cursor = cornerClearance;
  openings.forEach((opening) => {
    gaps.push({ start: cursor, end: opening.offset });
    cursor = Math.max(cursor, opening.offset + opening.width);
  });
  gaps.push({ start: cursor, end: length - cornerClearance });
  return gaps.map((gap) => {
    const width = Math.min(preferredWidth, gap.end - gap.start);
    return { width, offset: gap.start + (gap.end - gap.start - width) / 2 };
  }).filter((placement) => placement.width >= minimumWidth)
    .sort((a, b) => b.width - a.width || Math.abs(a.offset + a.width / 2 - length / 2) - Math.abs(b.offset + b.width / 2 - length / 2))[0];
};

const createEntityId = (prefix: string) => `${prefix}-${crypto.randomUUID()}`;

const rebuiltResult = (scene: SceneDocument, message: string, selection?: ArchitectureSelection, data?: Record<string, unknown>): ArchitectureCommandResult => {
  const rebuilt = rebuildSceneRoomsWithReconciliation(scene);
  const rebuiltRooms = rebuilt.scene.architecture.filter((element): element is RoomElement => element.kind === 'room');
  const outsideFurniture = rebuilt.scene.layouts.flatMap((layout) => layout.elements)
    .filter((element) => !rebuiltRooms.some((room) => pointInRoom({ x: element.transform.position.x, y: element.transform.position.z }, room))).map((element) => element.id);
  return { ok: true, scene: rebuilt.scene, message, selection, reconciliation: rebuilt.reconciliation, data: { ...data, outsideFurniture } };
};

export function renameRoomCommand(scene: SceneDocument, roomId: string, name: string): ArchitectureCommandResult {
  const trimmedName = name.trim();
  if (!trimmedName || trimmedName.length > 40) return failure('INVALID_INPUT', 'Room names must be between 1 and 40 characters.');
  const room = scene.architecture.find((element): element is RoomElement => element.kind === 'room' && element.id === roomId);
  if (!room) return failure('NOT_FOUND', 'The requested room was not found.');
  const architecture = scene.architecture.map((element) => element.id === roomId ? { ...room, name: trimmedName } : element);
  return { ok: true, scene: { ...scene, architecture }, message: `Room renamed to ${trimmedName}.`, selection: { kind: 'room', entityId: roomId }, data: { roomId } };
}

export function addWallCommand(scene: SceneDocument, start: Point2, end: Point2, options: { thickness?: number; height?: number; createId?: (prefix: string) => string } = {}): ArchitectureCommandResult {
  const bounds = getArchitectureBounds(scene.architecture);
  const inside = (point: Point2) => point.x >= bounds.minX && point.x <= bounds.maxX && point.y >= bounds.minY && point.y <= bounds.maxY;
  if (![start.x, start.y, end.x, end.y].every(Number.isFinite) || !inside(start) || !inside(end) || Math.hypot(end.x - start.x, end.y - start.y) < 0.1) return failure('GEOMETRY_CONFLICT', 'Walls must be at least 0.10 m long and remain inside the apartment.');
  const thickness = options.thickness ?? 0.12;
  const height = options.height ?? scene.architecture.find((element): element is WallElement => element.kind === 'wall')?.height ?? 2.74;
  if (!Number.isFinite(thickness) || thickness < 0.05 || thickness > 1 || !Number.isFinite(height) || height < 1.8 || height > 6) return failure('INVALID_INPUT', 'Wall thickness must be 0.05–1.00 m and height must be 1.80–6.00 m.');
  const duplicate = scene.architecture.some((element) => element.kind === 'wall' && ((samePoint(element.start, start) && samePoint(element.end, end)) || (samePoint(element.start, end) && samePoint(element.end, start))));
  if (duplicate) return failure('GEOMETRY_CONFLICT', 'A wall already exists at that location.');
  const wall: WallElement = { id: (options.createId ?? createEntityId)('wall'), kind: 'wall', start, end, thickness, height };
  return rebuiltResult({ ...scene, architecture: [...scene.architecture, wall] }, `Wall added · ${wallLength(wall).toFixed(2)} m.`, { kind: 'wall', entityId: wall.id }, { wallId: wall.id });
}

export function updateWallCommand(scene: SceneDocument, wallId: string, patch: WallPatch): ArchitectureCommandResult {
  const wall = scene.architecture.find((element): element is WallElement => element.kind === 'wall' && element.id === wallId);
  if (!wall) return failure('NOT_FOUND', 'The requested wall was not found.');
  const normalizedPatch = Object.fromEntries(Object.entries(patch).filter(([, value]) => value !== undefined)) as WallPatch;
  if (Object.keys(normalizedPatch).length === 0) return failure('INVALID_INPUT', 'Provide at least one wall property to update.');
  let nextWall = { ...wall, ...normalizedPatch };
  if (normalizedPatch.length !== undefined) {
    if (!Number.isFinite(normalizedPatch.length) || normalizedPatch.length < 0.1 || normalizedPatch.length > 100) return failure('INVALID_INPUT', 'Wall length must be between 0.10 and 100 meters.');
    const currentLength = wallLength(nextWall);
    if (currentLength < 1e-9) return failure('GEOMETRY_CONFLICT', 'The wall direction cannot be determined from coincident endpoints.');
    nextWall = { ...nextWall, end: { x: nextWall.start.x + (nextWall.end.x - nextWall.start.x) * normalizedPatch.length / currentLength, y: nextWall.start.y + (nextWall.end.y - nextWall.start.y) * normalizedPatch.length / currentLength } };
  }
  if (![nextWall.start.x, nextWall.start.y, nextWall.end.x, nextWall.end.y, nextWall.thickness, nextWall.height].every(Number.isFinite)) return failure('INVALID_INPUT', 'Wall values must be finite numbers.');
  if (nextWall.thickness < 0.05 || nextWall.thickness > 1 || nextWall.height < 1.8 || nextWall.height > 6) return failure('INVALID_INPUT', 'Wall thickness must be 0.05–1.00 m and height must be 1.80–6.00 m.');
  const bounds = getArchitectureBounds(scene.architecture);
  const currentWalls = scene.architecture.filter((element): element is WallElement => element.kind === 'wall');
  const exteriorIds = new Set(currentWalls.filter((candidate) => isExteriorWall(candidate, bounds, scene.architecture)).map((candidate) => candidate.id));
  const exterior = exteriorIds.has(wall.id);
  const geometryChanged = !samePoint(nextWall.start, wall.start, 0.001) || !samePoint(nextWall.end, wall.end, 0.001);
  const inside = (point: Point2) => point.x >= bounds.minX && point.x <= bounds.maxX && point.y >= bounds.minY && point.y <= bounds.maxY;
  if (!exterior && geometryChanged && (!inside(nextWall.start) || !inside(nextWall.end))) return failure('GEOMETRY_CONFLICT', 'Interior walls must remain inside the apartment.');
  const movedCorners = exterior && geometryChanged ? [
    ...(samePoint(wall.start, nextWall.start) ? [] : [{ before: wall.start, after: nextWall.start }]),
    ...(samePoint(wall.end, nextWall.end) ? [] : [{ before: wall.end, after: nextWall.end }]),
  ] : [];
  const nextWalls = currentWalls.map((candidate) => {
    if (candidate.id === wall.id) return nextWall;
    const movedStart = movedCorners.find((corner) => samePoint(candidate.start, corner.before));
    const movedEnd = movedCorners.find((corner) => samePoint(candidate.end, corner.before));
    return movedStart || movedEnd ? { ...candidate, start: movedStart?.after ?? candidate.start, end: movedEnd?.after ?? candidate.end } : candidate;
  });
  if (nextWalls.some((candidate) => wallLength(candidate) < 0.1)) return failure('GEOMETRY_CONFLICT', 'Walls must be at least 0.10 m long.');
  if (nextWalls.some((candidate, index) => nextWalls.slice(index + 1).some((other) => (samePoint(candidate.start, other.start) && samePoint(candidate.end, other.end)) || (samePoint(candidate.start, other.end) && samePoint(candidate.end, other.start))))) return failure('GEOMETRY_CONFLICT', 'A wall already exists at that location.');
  const nextWallMap = new Map(nextWalls.map((candidate) => [candidate.id, candidate]));
  if (scene.architecture.some((element) => element.kind === 'opening' && element.offset + element.width > wallLength(nextWallMap.get(element.wallId) ?? wall) + 0.001)) return failure('OPENING_DOES_NOT_FIT', 'This wall cannot be shorter than its doors or windows.');
  if (exterior && geometryChanged) {
    const perimeterError = exteriorLoopError(nextWalls.filter((candidate) => exteriorIds.has(candidate.id)));
    if (perimeterError) return failure('EXTERIOR_LOOP_INVALID', perimeterError);
  }
  const architecture = scene.architecture.map((element) => element.kind === 'wall' ? nextWallMap.get(element.id) ?? element : element);
  return rebuiltResult({ ...scene, architecture }, exterior && geometryChanged ? 'Exterior shape updated.' : 'Wall updated.', { kind: 'wall', entityId: wallId }, { wallId });
}

export function removeWallCommand(scene: SceneDocument, wallId: string): ArchitectureCommandResult {
  const bounds = getArchitectureBounds(scene.architecture);
  const wall = scene.architecture.find((element): element is WallElement => element.kind === 'wall' && element.id === wallId);
  if (!wall) return failure('NOT_FOUND', 'The requested wall was not found.');
  if (isExteriorWall(wall, bounds, scene.architecture)) return failure('PREREQUISITE_REQUIRED', 'Exterior walls are removed by removing one of their corners.');
  if (scene.architecture.some((element) => element.kind === 'opening' && element.wallId === wallId)) return failure('PREREQUISITE_REQUIRED', 'Remove this wall’s doors or windows before deleting it.');
  return rebuiltResult({ ...scene, architecture: scene.architecture.filter((element) => element.id !== wallId) }, 'Wall removed.', undefined, { wallId });
}

export function addExteriorCornerCommand(scene: SceneDocument, wallId: string, offsetMeters?: number, createId: (prefix: string) => string = createEntityId): ArchitectureCommandResult {
  const bounds = getArchitectureBounds(scene.architecture);
  const wall = scene.architecture.find((element): element is WallElement => element.kind === 'wall' && element.id === wallId);
  if (!wall) return failure('NOT_FOUND', 'The requested wall was not found.');
  if (!isExteriorWall(wall, bounds, scene.architecture)) return failure('PREREQUISITE_REQUIRED', 'Corners can only be added to an exterior wall.');
  const length = wallLength(wall);
  const splitOffset = offsetMeters ?? length / 2;
  if (!Number.isFinite(splitOffset) || splitOffset < 0.1 || splitOffset > length - 0.1) return failure('GEOMETRY_CONFLICT', 'The corner offset must leave both exterior edges at least 0.10 m long.');
  if (scene.architecture.some((element) => element.kind === 'opening' && element.wallId === wallId && element.offset < splitOffset && element.offset + element.width > splitOffset)) return failure('PREREQUISITE_REQUIRED', 'Move the opening away from the requested split before adding a corner.');
  const ratio = splitOffset / length;
  const corner = { x: wall.start.x + (wall.end.x - wall.start.x) * ratio, y: wall.start.y + (wall.end.y - wall.start.y) * ratio };
  const addedWall: WallElement = { ...wall, id: createId('wall'), start: corner };
  const architecture = scene.architecture.flatMap((element): ArchitecturalElement[] => {
    if (element.kind === 'wall' && element.id === wallId) return [{ ...element, end: corner }, addedWall];
    if (element.kind === 'opening' && element.wallId === wallId && element.offset >= splitOffset) return [{ ...element, wallId: addedWall.id, offset: element.offset - splitOffset }];
    return [element];
  });
  return rebuiltResult({ ...scene, architecture }, 'Exterior corner added · move the new corner to reshape the footprint.', { kind: 'wall', entityId: addedWall.id }, { wallId, addedWallId: addedWall.id, offsetMeters: splitOffset });
}

export function removeExteriorCornerCommand(scene: SceneDocument, wallId: string, endpoint: WallEndpoint): ArchitectureCommandResult {
  const bounds = getArchitectureBounds(scene.architecture);
  const walls = scene.architecture.filter((element): element is WallElement => element.kind === 'wall');
  const exteriorWalls = walls.filter((wall) => isExteriorWall(wall, bounds, scene.architecture));
  const wall = exteriorWalls.find((candidate) => candidate.id === wallId);
  if (!wall) return failure('NOT_FOUND', 'The requested exterior wall was not found.');
  if (exteriorWalls.length <= 3) return failure('EXTERIOR_LOOP_INVALID', 'The exterior perimeter needs at least three corners.');
  const corner = endpoint === 'start' ? wall.start : wall.end;
  const neighbor = exteriorWalls.find((candidate) => candidate.id !== wall.id && (samePoint(candidate.start, corner) || samePoint(candidate.end, corner)));
  if (!neighbor) return failure('EXTERIOR_LOOP_INVALID', 'This exterior corner is not connected correctly.');
  if (scene.architecture.some((element) => element.kind === 'opening' && (element.wallId === wall.id || element.wallId === neighbor.id))) return failure('PREREQUISITE_REQUIRED', 'Remove or relocate openings on these edges before removing the corner.');
  const neighborFarPoint = samePoint(neighbor.start, corner) ? neighbor.end : neighbor.start;
  const wallFarPoint = endpoint === 'start' ? wall.end : wall.start;
  const mergedWall = { ...wall, start: endpoint === 'start' ? neighborFarPoint : wallFarPoint, end: endpoint === 'start' ? wallFarPoint : neighborFarPoint };
  const perimeterError = exteriorLoopError(exteriorWalls.filter((candidate) => candidate.id !== neighbor.id && candidate.id !== wall.id).concat(mergedWall));
  if (perimeterError) return failure('EXTERIOR_LOOP_INVALID', perimeterError);
  const architecture = scene.architecture.filter((element) => element.id !== neighbor.id).map((element) => element.id === wall.id ? mergedWall : element);
  return rebuiltResult({ ...scene, architecture }, 'Exterior corner removed.', { kind: 'wall', entityId: wallId }, { wallId, removedWallId: neighbor.id, endpoint });
}

export function addOpeningCommand(scene: SceneDocument, input: { openingType: 'door' | 'window'; wallId: string; offset?: number; width?: number; height?: number; sillHeight?: number; swing?: 'left' | 'right'; swingSide?: 'in' | 'out'; createId?: (prefix: string) => string }): ArchitectureCommandResult {
  const wall = scene.architecture.find((element): element is WallElement => element.kind === 'wall' && element.id === input.wallId);
  if (!wall) return failure('NOT_FOUND', 'The requested wall was not found.');
  const preferredWidth = input.width ?? (input.openingType === 'door' ? 0.91 : 1.2);
  const minimumWidth = input.width ?? (input.openingType === 'door' ? 0.91 : 0.5);
  const placement = input.offset === undefined ? findOpeningPlacement(scene.architecture, wall, preferredWidth, minimumWidth) : { offset: input.offset, width: preferredWidth };
  if (!placement) return failure('OPENING_DOES_NOT_FIT', `This wall does not have enough clear space for the requested ${input.openingType}.`);
  const sillHeight = input.openingType === 'door' ? 0 : input.sillHeight ?? Math.min(0.9, Math.max(0, wall.height - 0.3));
  const height = input.height ?? (input.openingType === 'door' ? Math.min(2.03, wall.height) : Math.min(1.2, wall.height - sillHeight));
  const opening: OpeningElement = { id: (input.createId ?? createEntityId)(input.openingType), kind: 'opening', openingType: input.openingType, wallId: wall.id, offset: placement.offset, width: placement.width, height, sillHeight, ...(input.openingType === 'door' ? { swing: input.swing ?? 'left', swingSide: input.swingSide ?? 'in' } : {}) };
  const validation = validateOpening(scene, opening);
  if (validation) return validation;
  return { ok: true, scene: { ...scene, architecture: [...scene.architecture, opening] }, message: `${input.openingType === 'door' ? 'Door' : 'Window'} added.`, selection: { kind: 'opening', entityId: opening.id, wallId: wall.id }, data: { openingId: opening.id, wallId: wall.id } };
}

const validateOpening = (scene: SceneDocument, opening: OpeningElement, excludingId?: string): Extract<ArchitectureCommandResult, { ok: false }> | null => {
  const wall = scene.architecture.find((element): element is WallElement => element.kind === 'wall' && element.id === opening.wallId);
  if (!wall) return { ok: false, code: 'NOT_FOUND', message: 'The opening’s parent wall was not found.' };
  const maximumWidth = opening.openingType === 'window' ? 30 : 3;
  if (opening.width < 0.5 || opening.width > maximumWidth || opening.offset < 0.1 || opening.offset + opening.width > wallLength(wall) - 0.1) return { ok: false, code: 'OPENING_DOES_NOT_FIT', message: `${opening.openingType === 'window' ? 'Windows' : 'Doors'} must be 0.50–${maximumWidth.toFixed(2)} m wide and remain at least 0.10 m from wall corners.` };
  const minimumHeight = opening.openingType === 'window' ? 0.3 : 1.8;
  if (opening.height < minimumHeight || opening.sillHeight < 0 || opening.sillHeight + opening.height > wall.height) return { ok: false, code: 'OPENING_DOES_NOT_FIT', message: 'Opening height and sill height must fit within the selected wall.' };
  if (scene.architecture.some((element) => element.kind === 'opening' && element.id !== excludingId && element.wallId === opening.wallId && opening.offset < element.offset + element.width && opening.offset + opening.width > element.offset)) return { ok: false, code: 'OPENING_DOES_NOT_FIT', message: 'Doors and windows cannot overlap.' };
  return null;
};

export function updateOpeningCommand(scene: SceneDocument, openingId: string, patch: OpeningPatch): ArchitectureCommandResult {
  const opening = scene.architecture.find((element): element is OpeningElement => element.kind === 'opening' && element.id === openingId);
  if (!opening) return failure('NOT_FOUND', 'The requested opening was not found.');
  const normalizedPatch = Object.fromEntries(Object.entries(patch).filter(([, value]) => value !== undefined)) as OpeningPatch;
  if (Object.keys(normalizedPatch).length === 0) return failure('INVALID_INPUT', 'Provide at least one opening property to update.');
  if (opening.openingType === 'window' && (normalizedPatch.swing !== undefined || normalizedPatch.swingSide !== undefined)) return failure('INVALID_INPUT', 'Door swing properties cannot be applied to a window.');
  if (opening.openingType === 'door' && normalizedPatch.sillHeight !== undefined && normalizedPatch.sillHeight !== 0) return failure('INVALID_INPUT', 'Doors must have a sill height of zero.');
  const nextOpening = { ...opening, ...normalizedPatch };
  if (![nextOpening.offset, nextOpening.width, nextOpening.height, nextOpening.sillHeight].every(Number.isFinite)) return failure('INVALID_INPUT', 'Opening values must be finite numbers.');
  const validation = validateOpening(scene, nextOpening, openingId);
  if (validation) return validation;
  const architecture = scene.architecture.map((element) => element.id === openingId ? nextOpening : element);
  return { ok: true, scene: { ...scene, architecture }, message: `${opening.openingType === 'window' ? 'Window' : 'Door'} updated.`, selection: { kind: 'opening', entityId: openingId, wallId: opening.wallId }, data: { openingId } };
}

export function removeOpeningCommand(scene: SceneDocument, openingId: string): ArchitectureCommandResult {
  const opening = scene.architecture.find((element): element is OpeningElement => element.kind === 'opening' && element.id === openingId);
  if (!opening) return failure('NOT_FOUND', 'The requested opening was not found.');
  return { ok: true, scene: { ...scene, architecture: scene.architecture.filter((element) => element.id !== openingId) }, message: `${opening.openingType === 'window' ? 'Window' : 'Door'} removed.`, selection: { kind: 'wall', entityId: opening.wallId }, data: { openingId, wallId: opening.wallId } };
}
