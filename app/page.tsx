'use client';

import { FormEvent, KeyboardEvent, PointerEvent, ReactNode, useEffect, useRef, useState } from 'react';
import type { ArchitecturalElement, OpeningElement, Point2, RoomElement, SceneDocument, WallElement } from '@/lib/domain/scene';
import { getArchitectureBounds, isExteriorWall, isRectangularRoom, pointInRoom, polygonArea, polygonCentroid, rebuildSceneRooms, resizeSceneFootprint, roomForPoint, wallLength } from '@/lib/domain/architecture';
import ApartmentScene from './ApartmentScene';

type View = 'plan' | 'three' | 'evaluation';
type LayoutKey = 'A' | 'B';
type EditMode = 'architecture' | 'furnish';
type RoomId = string;

type SceneObject = {
  id: string;
  catalogItemId: string;
  name: string;
  category: string;
  userAdded: boolean;
  roomId: RoomId;
  dimensions: { width: number; depth: number; height: number };
  transform: { position: { x: number; y: number; z: number }; rotation: { x: number; y: number; z: number } };
};

type AddObjectInput = {
  name: string;
  category: 'bed' | 'sofa' | 'desk' | 'table' | 'storage' | 'other';
  roomId: RoomId;
  dimensions: SceneObject['dimensions'];
};

type ApiProject = {
  id: string;
  name: string;
  revision: number;
  scene: SceneDocument;
};

type HistoryEntry = {
  before: SceneDocument;
  after: SceneDocument;
};

const scores = [
  { label: 'Natural light', score: 88, note: 'Excellent', tone: 'high' },
  { label: 'Furniture fit', score: 92, note: 'All 5 items fit', tone: 'high' },
  { label: 'Work from home', score: 86, note: 'Strong daylight', tone: 'high' },
  { label: 'Open space', score: 78, note: 'One tight zone', tone: 'mid' },
  { label: 'Storage', score: 69, note: 'Below average', tone: 'low' },
];

const timeLabel = (hour: number) => {
  const whole = Math.floor(hour);
  const minute = Math.round((hour - whole) * 60);
  const suffix = whole >= 12 ? 'PM' : 'AM';
  const display = whole % 12 || 12;
  return `${display}:${minute.toString().padStart(2, '0')} ${suffix}`;
};

function resizeApartmentScene(scene: SceneDocument, width: number, depth: number, height: number) {
  const resized = resizeSceneFootprint(scene, width, depth);
  return {
    ...resized,
    architecture: resized.architecture.map((element): ArchitecturalElement => {
      if (element.kind === 'wall') return { ...element, height };
      if (element.kind === 'room') return { ...element, ceilingHeight: height };
      return element;
    }),
  };
}

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

export default function Home() {
  const [view, setView] = useState<View>('plan');
  const [editMode, setEditMode] = useState<EditMode>('furnish');
  const [compare, setCompare] = useState(false);
  const [selected, setSelected] = useState<string>('desk-1');
  const [hour, setHour] = useState(14.5);
  const [camera, setCamera] = useState(0);
  const [cameraReset, setCameraReset] = useState(0);
  const [showShadows, setShowShadows] = useState(true);
  const [showLightPaths, setShowLightPaths] = useState(true);
  const [showMeasurements, setShowMeasurements] = useState(false);
  const layout: LayoutKey = 'A';
  const [projectRevision, setProjectRevision] = useState<number | null>(null);
  const [project, setProject] = useState<ApiProject | null>(null);
  const [sceneObjects, setSceneObjects] = useState<Record<LayoutKey, SceneObject[]>>({ A: [], B: [] });
  const [collisionMessage, setCollisionMessage] = useState('');
  const [architectureMessage, setArchitectureMessage] = useState('');
  const [selectedWallId, setSelectedWallId] = useState('');
  const [selectedOpeningId, setSelectedOpeningId] = useState('');
  const [selectedRoomId, setSelectedRoomId] = useState('');
  const [drawingWall, setDrawingWall] = useState(false);
  const [architecturePreview, setArchitecturePreview] = useState<ArchitecturalElement[] | null>(null);
  const [zoom, setZoom] = useState(80);
  const [historyState, setHistoryState] = useState({ undo: 0, redo: 0 });
  const [historyBusy, setHistoryBusy] = useState(false);
  const projectRevisionRef = useRef<number | null>(null);
  const projectRef = useRef<ApiProject | null>(null);
  const moveSaveQueue = useRef<Promise<void>>(Promise.resolve());
  const undoStack = useRef<HistoryEntry[]>([]);
  const redoStack = useRef<HistoryEntry[]>([]);

  const updateHistoryState = () => setHistoryState({ undo: undoStack.current.length, redo: redoStack.current.length });

  const recordSceneEdit = (before: SceneDocument, after: SceneDocument) => {
    if (JSON.stringify(before) === JSON.stringify(after)) return;
    undoStack.current.push({ before: structuredClone(before), after: structuredClone(after) });
    redoStack.current = [];
    updateHistoryState();
  };

  const syncProject = (project: ApiProject) => {
    const catalog = new Map(project.scene.catalog.map((item) => [item.id, item]));
    const roomIds = new Set(project.scene.architecture.flatMap((element) => element.kind === 'room' ? [element.id] : []));
    const objectsFor = (key: LayoutKey): SceneObject[] => {
      const sceneLayout = project.scene.layouts.find((item) => item.id === `layout-${key.toLowerCase()}`);
      return (sceneLayout?.elements ?? []).flatMap((element) => {
        const item = catalog.get(element.catalogItemId);
        if (!item || !roomIds.has(element.roomId)) return [];
        return [{ id: element.id, catalogItemId: element.catalogItemId, name: item.name, category: item.category, userAdded: item.metadata?.userAdded === true, roomId: element.roomId, dimensions: item.dimensions, transform: element.transform }];
      });
    };
    setProjectRevision(project.revision);
    projectRevisionRef.current = project.revision;
    projectRef.current = project;
    setProject(project);
    setSceneObjects({ A: objectsFor('A'), B: objectsFor('B') });
  };

  useEffect(() => {
    fetch('/api/projects/blank')
      .then((response) => response.ok ? response.json() : Promise.reject(new Error('Could not load project')))
      .then((project: ApiProject) => syncProject(project))
      .catch(() => setProjectRevision(null));
  }, []);

  const enqueueMutation = <T,>(mutation: () => Promise<T>) => {
    const operation = moveSaveQueue.current.then(mutation);
    moveSaveQueue.current = operation.then(() => undefined, () => undefined);
    return operation;
  };

  const saveScene = async (scene: SceneDocument, successMessage: string, options: { recordHistory?: boolean } = {}) => {
    return enqueueMutation(async () => {
      const current = projectRef.current;
      const expectedRevision = projectRevisionRef.current;
      if (!current || expectedRevision === null) return 'The project is still loading.';
      setArchitectureMessage('Saving architecture…');
      try {
        const response = await fetch(`/api/projects/${current.id}`, {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ name: current.name, scene, expectedRevision }),
        });
        const result = await response.json() as ApiProject & { error?: string; current?: ApiProject };
        if (!response.ok) {
          if (result.current) syncProject(result.current);
          const message = result.error ?? 'The architecture could not be saved.';
          setArchitectureMessage(message);
          return message;
        }
        syncProject(result);
        setArchitecturePreview(null);
        if (options.recordHistory !== false) recordSceneEdit(current.scene, result.scene);
        setArchitectureMessage(successMessage);
        return null;
      } catch {
        const message = 'The architecture could not be saved. Check your connection and try again.';
        setArchitectureMessage(message);
        return message;
      }
    });
  };

  const resizeApartment = async (width: number, depth: number, height: number) => {
    await moveSaveQueue.current;
    const current = projectRef.current;
    if (!current) return 'The project is still loading.';
    if (![width, depth].every((value) => Number.isFinite(value) && value >= 2 && value <= 30) || !Number.isFinite(height) || height < 1.8 || height > 6) {
      const message = 'Width and depth must be between 2 and 30 meters, and height between 1.8 and 6 meters.';
      setArchitectureMessage(message);
      return message;
    }
    const error = await saveScene(rebuildSceneRooms(resizeApartmentScene(current.scene, width, depth, height)), `Apartment resized to ${width.toFixed(2)} × ${depth.toFixed(2)} × ${height.toFixed(2)} m.`);
    if (!error) setArchitecturePreview(null);
    return error;
  };

  const addWall = async (start: Point2, end: Point2) => {
    await moveSaveQueue.current;
    const current = projectRef.current;
    if (!current) return;
    const bounds = getArchitectureBounds(current.scene.architecture);
    const inside = (point: Point2) => point.x >= bounds.minX && point.x <= bounds.maxX && point.y >= bounds.minY && point.y <= bounds.maxY;
    if (!inside(start) || !inside(end) || Math.hypot(end.x - start.x, end.y - start.y) < 0.1) {
      setArchitectureMessage('Walls must be at least 0.10 m long and remain inside the apartment.');
      return;
    }
    const duplicate = current.scene.architecture.some((element) => element.kind === 'wall' && (
      (Math.hypot(element.start.x - start.x, element.start.y - start.y) < 0.02 && Math.hypot(element.end.x - end.x, element.end.y - end.y) < 0.02)
      || (Math.hypot(element.start.x - end.x, element.start.y - end.y) < 0.02 && Math.hypot(element.end.x - start.x, element.end.y - start.y) < 0.02)
    ));
    if (duplicate) {
      setArchitectureMessage('A wall already exists at that location.');
      return;
    }
    const wall: WallElement = { id: `wall-${crypto.randomUUID()}`, kind: 'wall', start, end, thickness: 0.12, height: 2.74 };
    const error = await saveScene(rebuildSceneRooms({ ...current.scene, architecture: [...current.scene.architecture, wall] }), `Wall added · ${wallLength(wall).toFixed(2)} m.`);
    if (!error) {
      setSelectedWallId(wall.id);
      setDrawingWall(false);
    }
  };

  const updateWall = async (wallId: string, patch: Partial<Pick<WallElement, 'start' | 'end' | 'thickness' | 'height'>>) => {
    await moveSaveQueue.current;
    const current = projectRef.current;
    if (!current) return false;
    const wall = current.scene.architecture.find((element): element is WallElement => element.kind === 'wall' && element.id === wallId);
    if (!wall) return false;
    const nextWall = { ...wall, ...patch };
    const bounds = getArchitectureBounds(current.scene.architecture);
    const currentWalls = current.scene.architecture.filter((element): element is WallElement => element.kind === 'wall');
    const exteriorIds = new Set(currentWalls.filter((candidate) => isExteriorWall(candidate, bounds, current.scene.architecture)).map((candidate) => candidate.id));
    const exterior = exteriorIds.has(wall.id);
    const geometryChanged = Math.hypot(nextWall.start.x - wall.start.x, nextWall.start.y - wall.start.y) > 0.001
      || Math.hypot(nextWall.end.x - wall.end.x, nextWall.end.y - wall.end.y) > 0.001;
    const inside = (point: Point2) => point.x >= bounds.minX && point.x <= bounds.maxX && point.y >= bounds.minY && point.y <= bounds.maxY;
    if (!exterior && geometryChanged && (!inside(nextWall.start) || !inside(nextWall.end))) {
      setArchitectureMessage('Walls must be at least 0.10 m long and remain inside the apartment.');
      return false;
    }
    const movedCorners = exterior && geometryChanged ? [
      ...(samePoint(wall.start, nextWall.start) ? [] : [{ before: wall.start, after: nextWall.start }]),
      ...(samePoint(wall.end, nextWall.end) ? [] : [{ before: wall.end, after: nextWall.end }]),
    ] : [];
    const nextWalls = currentWalls.map((candidate) => {
      if (candidate.id === wall.id) return nextWall;
      if (movedCorners.length === 0) return candidate;
      const movedStart = movedCorners.find((corner) => samePoint(candidate.start, corner.before));
      const movedEnd = movedCorners.find((corner) => samePoint(candidate.end, corner.before));
      return { ...candidate, start: movedStart?.after ?? candidate.start, end: movedEnd?.after ?? candidate.end };
    });
    if (nextWalls.some((candidate) => wallLength(candidate) < 0.1)) {
      setArchitectureMessage('Walls must be at least 0.10 m long.');
      return false;
    }
    const duplicate = nextWalls.some((candidate, index) => nextWalls.slice(index + 1).some((other) => (
      (samePoint(candidate.start, other.start) && samePoint(candidate.end, other.end))
      || (samePoint(candidate.start, other.end) && samePoint(candidate.end, other.start))
    )));
    if (duplicate) {
      setArchitectureMessage('A wall already exists at that location.');
      return false;
    }
    const nextWallMap = new Map(nextWalls.map((candidate) => [candidate.id, candidate]));
    const openingOutsideWall = current.scene.architecture.some((element) => element.kind === 'opening' && element.offset + element.width > wallLength(nextWallMap.get(element.wallId) ?? wall) + 0.001);
    if (openingOutsideWall) {
      setArchitectureMessage('This wall cannot be shorter than its doors or windows.');
      return false;
    }
    if (exterior && geometryChanged) {
      const perimeterError = exteriorLoopError(nextWalls.filter((candidate) => exteriorIds.has(candidate.id)));
      if (perimeterError) {
        setArchitectureMessage(perimeterError);
        return false;
      }
    }
    const architecture = current.scene.architecture.map((element) => element.kind === 'wall' ? nextWallMap.get(element.id) ?? element : element);
    const rebuilt = rebuildSceneRooms({ ...current.scene, architecture });
    const rebuiltRooms = rebuilt.architecture.filter((element): element is RoomElement => element.kind === 'room');
    const outsideFurniture = rebuilt.layouts.flatMap((sceneLayout) => sceneLayout.elements).filter((element) => !rebuiltRooms.some((room) => pointInRoom({ x: element.transform.position.x, y: element.transform.position.z }, room))).length;
    const successMessage = exterior && geometryChanged ? `Exterior shape updated${outsideFurniture ? ` · ${outsideFurniture} furniture item${outsideFurniture === 1 ? '' : 's'} outside the footprint` : ''}.` : 'Wall updated.';
    const error = await saveScene(rebuilt, successMessage);
    if (!error) setArchitecturePreview(null);
    return !error;
  };

  const addExteriorCorner = async (wallId: string) => {
    const current = projectRef.current;
    if (!current) return;
    const bounds = getArchitectureBounds(current.scene.architecture);
    const wall = current.scene.architecture.find((element): element is WallElement => element.kind === 'wall' && element.id === wallId);
    if (!wall || !isExteriorWall(wall, bounds, current.scene.architecture)) return;
    const splitOffset = wallLength(wall) / 2;
    if (splitOffset < 0.1) {
      setArchitectureMessage('This exterior edge is too short to add a corner.');
      return;
    }
    const crossingOpening = current.scene.architecture.some((element) => element.kind === 'opening' && element.wallId === wallId && element.offset < splitOffset && element.offset + element.width > splitOffset);
    if (crossingOpening) {
      setArchitectureMessage('Move the opening away from the middle of this wall before adding a corner.');
      return;
    }
    const ratio = splitOffset / wallLength(wall);
    const corner = { x: wall.start.x + (wall.end.x - wall.start.x) * ratio, y: wall.start.y + (wall.end.y - wall.start.y) * ratio };
    const addedWall: WallElement = { ...wall, id: `wall-${crypto.randomUUID()}`, start: corner };
    const architecture = current.scene.architecture.flatMap((element): ArchitecturalElement[] => {
      if (element.kind === 'wall' && element.id === wallId) return [{ ...element, end: corner }, addedWall];
      if (element.kind === 'opening' && element.wallId === wallId && element.offset >= splitOffset) return [{ ...element, wallId: addedWall.id, offset: element.offset - splitOffset }];
      return [element];
    });
    const error = await saveScene(rebuildSceneRooms({ ...current.scene, architecture }), 'Exterior corner added · drag the new corner to reshape the footprint.');
    if (!error) setSelectedWallId(wallId);
  };

  const removeExteriorCorner = async (wallId: string, endpoint: WallEndpoint) => {
    const current = projectRef.current;
    if (!current) return;
    const bounds = getArchitectureBounds(current.scene.architecture);
    const walls = current.scene.architecture.filter((element): element is WallElement => element.kind === 'wall');
    const exteriorWalls = walls.filter((wall) => isExteriorWall(wall, bounds, current.scene.architecture));
    const wall = exteriorWalls.find((candidate) => candidate.id === wallId);
    if (!wall || exteriorWalls.length <= 3) {
      setArchitectureMessage('The exterior perimeter needs at least three corners.');
      return;
    }
    const corner = endpoint === 'start' ? wall.start : wall.end;
    const neighbor = exteriorWalls.find((candidate) => candidate.id !== wall.id && (samePoint(candidate.start, corner) || samePoint(candidate.end, corner)));
    if (!neighbor) {
      setArchitectureMessage('This exterior corner is not connected correctly.');
      return;
    }
    if (current.scene.architecture.some((element) => element.kind === 'opening' && (element.wallId === wall.id || element.wallId === neighbor.id))) {
      setArchitectureMessage('Remove or relocate openings on these edges before removing the corner.');
      return;
    }
    const neighborFarPoint = samePoint(neighbor.start, corner) ? neighbor.end : neighbor.start;
    const wallFarPoint = endpoint === 'start' ? wall.end : wall.start;
    const mergedWall = { ...wall, start: endpoint === 'start' ? neighborFarPoint : wallFarPoint, end: endpoint === 'start' ? wallFarPoint : neighborFarPoint };
    const nextExterior = exteriorWalls.filter((candidate) => candidate.id !== neighbor.id && candidate.id !== wall.id).concat(mergedWall);
    const perimeterError = exteriorLoopError(nextExterior);
    if (perimeterError) {
      setArchitectureMessage(perimeterError);
      return;
    }
    const architecture = current.scene.architecture.filter((element) => element.id !== neighbor.id).map((element) => element.id === wall.id ? mergedWall : element);
    await saveScene(rebuildSceneRooms({ ...current.scene, architecture }), 'Exterior corner removed.');
  };

  const addDoor = async (wallId: string) => {
    const current = projectRef.current;
    if (!current) return;
    const wall = current.scene.architecture.find((element): element is WallElement => element.kind === 'wall' && element.id === wallId);
    if (!wall) return;
    const width = 0.91;
    const clearance = 0.1;
    const length = wallLength(wall);
    const openings = current.scene.architecture.filter((element): element is OpeningElement => element.kind === 'opening' && element.wallId === wallId).sort((a, b) => a.offset - b.offset);
    const candidates: number[] = [];
    let cursor = clearance;
    openings.forEach((opening) => {
      const gapEnd = opening.offset - clearance;
      if (gapEnd - cursor >= width) candidates.push(cursor + (gapEnd - cursor - width) / 2);
      cursor = Math.max(cursor, opening.offset + opening.width + clearance);
    });
    const finalGapEnd = length - clearance;
    if (finalGapEnd - cursor >= width) candidates.push(cursor + (finalGapEnd - cursor - width) / 2);
    const offset = candidates.sort((a, b) => Math.abs(a + width / 2 - length / 2) - Math.abs(b + width / 2 - length / 2))[0];
    if (offset === undefined) {
      setArchitectureMessage('This wall does not have enough clear space for a 0.91 m door.');
      return;
    }
    const door: OpeningElement = { id: `door-${crypto.randomUUID()}`, kind: 'opening', openingType: 'door', wallId, offset, width, height: Math.min(2.03, wall.height), sillHeight: 0, swing: 'left', swingSide: 'in' };
    const error = await saveScene({ ...current.scene, architecture: [...current.scene.architecture, door] }, 'Door added · drag it along the wall or enter an exact position.');
    if (!error) setSelectedOpeningId(door.id);
  };

  const updateOpening = async (openingId: string, patch: Partial<Pick<OpeningElement, 'offset' | 'width' | 'height' | 'swing' | 'swingSide'>>) => {
    const current = projectRef.current;
    if (!current) return false;
    const opening = current.scene.architecture.find((element): element is OpeningElement => element.kind === 'opening' && element.id === openingId);
    if (!opening) return false;
    const nextOpening = { ...opening, ...patch };
    const wall = current.scene.architecture.find((element): element is WallElement => element.kind === 'wall' && element.id === opening.wallId);
    if (!wall) return false;
    if (nextOpening.width < 0.5 || nextOpening.width > 3 || nextOpening.offset < 0.1 || nextOpening.offset + nextOpening.width > wallLength(wall) - 0.1) {
      setArchitectureMessage('Doors must be 0.50–3.00 m wide and remain at least 0.10 m from wall corners.');
      return false;
    }
    if (nextOpening.height < 1.8 || nextOpening.height > wall.height) {
      setArchitectureMessage('Door height must fit within the selected wall.');
      return false;
    }
    const overlaps = current.scene.architecture.some((element) => element.kind === 'opening' && element.id !== openingId && element.wallId === opening.wallId && nextOpening.offset < element.offset + element.width + 0.1 && nextOpening.offset + nextOpening.width + 0.1 > element.offset);
    if (overlaps) {
      setArchitectureMessage('Doors and windows need at least 0.10 m of separation.');
      return false;
    }
    const architecture = current.scene.architecture.map((element) => element.id === openingId ? nextOpening : element);
    const error = await saveScene({ ...current.scene, architecture }, 'Door updated.');
    return !error;
  };

  const deleteOpening = async (openingId: string) => {
    const current = projectRef.current;
    if (!current) return;
    const error = await saveScene({ ...current.scene, architecture: current.scene.architecture.filter((element) => element.id !== openingId) }, 'Door removed.');
    if (!error) setSelectedOpeningId('');
  };

  const deleteWall = async (wallId: string) => {
    await moveSaveQueue.current;
    const current = projectRef.current;
    if (!current) return;
    const bounds = getArchitectureBounds(current.scene.architecture);
    const wall = current.scene.architecture.find((element): element is WallElement => element.kind === 'wall' && element.id === wallId);
    if (!wall) return;
    if (isExteriorWall(wall, bounds, current.scene.architecture)) {
      setArchitectureMessage('Exterior walls are removed by removing one of their corners.');
      return;
    }
    if (current.scene.architecture.some((element) => element.kind === 'opening' && element.wallId === wallId)) {
      setArchitectureMessage('Remove this wall’s doors or windows before deleting it.');
      return;
    }
    const error = await saveScene(rebuildSceneRooms({ ...current.scene, architecture: current.scene.architecture.filter((element) => element.id !== wallId) }), 'Wall removed.');
    if (!error) setSelectedWallId('');
  };

  const renameRoom = async (roomId: string, name: string) => {
    await moveSaveQueue.current;
    const current = projectRef.current;
    if (!current || !name.trim()) return;
    const architecture = current.scene.architecture.map((element) => element.kind === 'room' && element.id === roomId ? { ...element, name: name.trim() } : element);
    await saveScene({ ...current.scene, architecture }, `Room renamed to ${name.trim()}.`);
  };

  const selectView = (next: View) => {
    setCompare(false);
    setView(next);
  };

  const addObject = async (input: AddObjectInput): Promise<string | null> => {
    return enqueueMutation(async () => {
      const current = projectRef.current;
      const expectedRevision = projectRevisionRef.current;
      if (!current || expectedRevision === null) return 'The project is still loading. Try again in a moment.';
      const response = await fetch('/api/projects/blank/objects', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...input, layoutId: `layout-${layout.toLowerCase()}`, expectedRevision }),
      });
      const result = await response.json() as { error?: string; current?: ApiProject; project?: ApiProject; objectId?: string };
      if (!response.ok) {
        if (result.current) syncProject(result.current);
        return result.error ?? 'The object could not be added.';
      }
      if (result.project) {
        syncProject(result.project);
        recordSceneEdit(current.scene, result.project.scene);
      }
      if (result.objectId) setSelected(result.objectId);
      return null;
    });
  };

  const moveObject = (objectId: string, placement: { position: { x: number; z: number }; roomId: RoomId }) => {
    const objects = sceneObjects[layout];
    const item = objects.find((candidate) => candidate.id === objectId);
    if (!item) return false;
    const candidate = { ...item, roomId: placement.roomId, transform: { ...item.transform, position: { ...item.transform.position, ...placement.position } } };
    const collision = findCollision(objects, candidate);
    if (collision) {
      setCollisionMessage(`${item.name} overlaps ${collision.name}.`);
      return false;
    }
    setCollisionMessage('');
    setSceneObjects((current) => ({
      ...current,
      [layout]: current[layout].map((item) => item.id === objectId
        ? candidate
        : item),
    }));
    return true;
  };

  const saveObjectTransform = (objectId: string, transform: { position?: { x: number; z: number }; rotation?: { y: number }; dimensions?: SceneObject['dimensions']; roomId?: RoomId }, layoutOverride?: LayoutKey) => {
    const layoutAtMove = layoutOverride ?? layout;
    void enqueueMutation(async () => {
      const current = projectRef.current;
      const expectedRevision = projectRevisionRef.current;
      if (!current || expectedRevision === null) return;
      const response = await fetch(`/api/projects/blank/objects/${objectId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ layoutId: `layout-${layoutAtMove.toLowerCase()}`, expectedRevision, transform: { position: transform.position, rotation: transform.rotation }, dimensions: transform.dimensions, roomId: transform.roomId }),
      });
      const result = await response.json() as ApiProject & { error?: string; current?: ApiProject };
      if (response.ok) {
        syncProject(result);
        recordSceneEdit(current.scene, result.scene);
      } else if (result.current) {
        syncProject(result.current);
      } else {
        syncProject(current);
        setCollisionMessage(result.error ?? 'The object change could not be saved.');
      }
    }).catch(() => undefined);
  };

  const applyHistoryScene = async (scene: SceneDocument, message: string) => {
    const error = await saveScene(structuredClone(scene), message, { recordHistory: false });
    if (error) return false;
    setSelected('');
    setSelectedWallId('');
    setSelectedOpeningId('');
    setSelectedRoomId('');
    setArchitecturePreview(null);
    setCollisionMessage('');
    return true;
  };

  const undo = async () => {
    if (historyBusy) return;
    setHistoryBusy(true);
    await moveSaveQueue.current;
    const edit = undoStack.current.at(-1);
    if (edit && await applyHistoryScene(edit.before, 'Undid last change.')) {
      undoStack.current.pop();
      redoStack.current.push(edit);
      updateHistoryState();
    }
    setHistoryBusy(false);
  };

  const redo = async () => {
    if (historyBusy) return;
    setHistoryBusy(true);
    await moveSaveQueue.current;
    const edit = redoStack.current.at(-1);
    if (edit && await applyHistoryScene(edit.after, 'Redid last change.')) {
      redoStack.current.pop();
      undoStack.current.push(edit);
      updateHistoryState();
    }
    setHistoryBusy(false);
  };

  const commitMove = (objectId: string, placement: ObjectPlacement, before: SceneObject) => {
    void before;
    saveObjectTransform(objectId, { position: placement.position, roomId: placement.roomId });
  };

  const rotateObject = (objectId: string, degrees: number) => {
    const objects = sceneObjects[layout];
    const item = objects.find((candidate) => candidate.id === objectId);
    if (!item) return;
    const rotation = { y: ((item.transform.rotation.y + degrees) % 360 + 360) % 360 };
    const rotated = { ...item, transform: { ...item.transform, rotation: { ...item.transform.rotation, ...rotation } } };
    const position = clampObjectPosition(rotated, item.transform.position, getArchitectureBounds(projectRef.current?.scene.architecture ?? []));
    const candidate = { ...rotated, transform: { ...rotated.transform, position: { ...rotated.transform.position, ...position } } };
    const collision = findCollision(objects, candidate);
    if (collision) {
      setCollisionMessage(`Cannot rotate ${item.name}: it would overlap ${collision.name}.`);
      return;
    }
    setCollisionMessage('');
    setSceneObjects((current) => ({ ...current, [layout]: current[layout].map((object) => object.id === objectId ? candidate : object) }));
    saveObjectTransform(objectId, { position, rotation });
  };

  const removeObject = async (objectId: string) => {
    await enqueueMutation(async () => {
      const current = projectRef.current;
      const expectedRevision = projectRevisionRef.current;
      if (!current || expectedRevision === null) return;
      const response = await fetch(`/api/projects/blank/objects/${objectId}`, {
        method: 'DELETE',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ layoutId: `layout-${layout.toLowerCase()}`, expectedRevision }),
      });
      const result = await response.json() as ApiProject & { error?: string; current?: ApiProject };
      if (response.ok) {
        syncProject(result);
        recordSceneEdit(current.scene, result.scene);
        setSelected('');
        setCollisionMessage('');
      } else if (result.current) syncProject(result.current);
      else setCollisionMessage(result.error ?? 'The object could not be removed.');
    });
  };

  const resizeObject = (objectId: string, dimensions: SceneObject['dimensions']) => {
    const objects = sceneObjects[layout];
    const item = objects.find((candidate) => candidate.id === objectId);
    if (!item) return false;
    const resized = { ...item, dimensions };
    const position = clampObjectPosition(resized, resized.transform.position, getArchitectureBounds(projectRef.current?.scene.architecture ?? []));
    const candidate = { ...resized, transform: { ...resized.transform, position: { ...resized.transform.position, ...position } } };
    const collision = findCollision(objects, candidate);
    if (collision) {
      setCollisionMessage(`Cannot resize ${item.name}: it would overlap ${collision.name}.`);
      return false;
    }
    setCollisionMessage('');
    setSceneObjects((current) => ({ ...current, [layout]: current[layout].map((object) => object.id === objectId ? candidate : object) }));
    return true;
  };

  const saveObjectDimensions = (objectId: string, dimensions: SceneObject['dimensions'], beforeDimensions: SceneObject['dimensions']) => {
    void beforeDimensions;
    const item = sceneObjects[layout].find((candidate) => candidate.id === objectId);
    if (!item) return;
    saveObjectTransform(objectId, { position: { x: item.transform.position.x, z: item.transform.position.z }, dimensions });
  };

  const architecture = project?.scene.architecture ?? [];
  const displayedArchitecture = architecturePreview ?? architecture;
  const rooms = architecture.filter((element): element is RoomElement => element.kind === 'room');
  const selectedWall = architecture.find((element): element is WallElement => element.kind === 'wall' && element.id === selectedWallId);
  const selectedOpening = architecture.find((element): element is OpeningElement => element.kind === 'opening' && element.id === selectedOpeningId);
  const previewApartment = (width: number, depth: number, height: number) => {
    const current = projectRef.current;
    if (!current) return;
    setArchitecturePreview(resizeApartmentScene(current.scene, width, depth, height).architecture);
  };
  const previewWall = (wallId: string, patch: Partial<Pick<WallElement, 'start' | 'end' | 'thickness' | 'height'>>) => {
    const current = projectRef.current;
    if (!current) return;
    const bounds = getArchitectureBounds(current.scene.architecture);
    const walls = current.scene.architecture.filter((element): element is WallElement => element.kind === 'wall');
    const wall = walls.find((candidate) => candidate.id === wallId);
    if (!wall) return;
    const nextWall = { ...wall, ...patch };
    const exterior = isExteriorWall(wall, bounds, current.scene.architecture);
    const movedCorners = exterior ? [
      ...(samePoint(wall.start, nextWall.start) ? [] : [{ before: wall.start, after: nextWall.start }]),
      ...(samePoint(wall.end, nextWall.end) ? [] : [{ before: wall.end, after: nextWall.end }]),
    ] : [];
    const nextWalls = new Map(walls.map((candidate) => {
      if (candidate.id === wallId) return [candidate.id, nextWall] as const;
      const movedStart = movedCorners.find((corner) => samePoint(candidate.start, corner.before));
      const movedEnd = movedCorners.find((corner) => samePoint(candidate.end, corner.before));
      return [candidate.id, movedStart || movedEnd ? { ...candidate, start: movedStart?.after ?? candidate.start, end: movedEnd?.after ?? candidate.end } : candidate] as const;
    }));
    const nextArchitecture = current.scene.architecture.map((element) => element.kind === 'wall' ? nextWalls.get(element.id) ?? element : element);
    setArchitecturePreview(rebuildSceneRooms({ ...current.scene, architecture: nextArchitecture }).architecture);
  };
  const previewOpening = (openingId: string, patch: Partial<Pick<OpeningElement, 'offset' | 'width' | 'height' | 'swing' | 'swingSide'>>) => {
    const current = projectRef.current;
    if (!current) return;
    setArchitecturePreview(current.scene.architecture.map((element) => element.kind === 'opening' && element.id === openingId ? { ...element, ...patch } : element));
  };
  const selectWall = (id: string) => { setArchitecturePreview(null); setSelectedWallId(id); setSelectedOpeningId(''); setSelectedRoomId(''); setDrawingWall(false); };
  const selectOpening = (id: string, wallId: string) => { setArchitecturePreview(null); setSelectedOpeningId(id); setSelectedWallId(wallId); setSelectedRoomId(''); setDrawingWall(false); };
  const selectRoom = (id: string) => { setArchitecturePreview(null); setSelectedRoomId(id); setSelectedWallId(''); setSelectedOpeningId(''); setDrawingWall(false); };
  const architectureSuccess = /^(Saving architecture|Wall added|Wall updated|Wall removed|Exterior shape updated|Exterior corner added|Exterior corner removed|Door added|Door updated|Door removed|Room renamed|Apartment resized)/.test(architectureMessage) && !architectureMessage.includes('outside the footprint');

  return (
    <main className="app-shell">
      <Header />
      <ModeBar view={view} compare={compare} editMode={editMode} zoom={zoom} canUndo={!historyBusy && historyState.undo > 0} canRedo={!historyBusy && historyState.redo > 0} onUndo={undo} onRedo={redo} onZoom={setZoom} onView={selectView} onEditMode={(mode) => { setArchitecturePreview(null); setEditMode(mode); }} />
      <div className={`workspace-grid ${compare ? 'is-comparing' : ''} ${view === 'plan' && !compare ? 'plan-builder-grid' : ''}`}>
        {compare ? (
          <ComparisonView onBack={() => setCompare(false)} />
        ) : (
          <>
            {view === 'plan' && editMode === 'furnish' && <FurniturePanel selected={selected} onSelect={setSelected} objects={sceneObjects[layout]} />}
            {view === 'plan' && editMode === 'architecture' && <ArchitecturePanel architecture={displayedArchitecture} selectedWallId={selectedWallId} selectedRoomId={selectedRoomId} onSelectWall={selectWall} onSelectRoom={selectRoom} onRenameRoom={renameRoom} />}
            {view === 'three' && <PreviewControls hour={hour} camera={camera} shadows={showShadows} lightPaths={showLightPaths} measurements={showMeasurements} onHour={setHour} onCamera={setCamera} onReset={() => setCameraReset((value) => value + 1)} onShadows={setShowShadows} onLightPaths={setShowLightPaths} onMeasurements={setShowMeasurements} />}
            {view === 'evaluation' && <PriorityPanel />}
            {view === 'plan' && <PlanView editMode={editMode} architecture={displayedArchitecture} selectedWallId={selectedWallId} selectedOpeningId={selectedOpeningId} selectedRoomId={selectedRoomId} drawingWall={drawingWall} selected={selected} onSelect={setSelected} onSelectWall={selectWall} onSelectOpening={selectOpening} onSelectRoom={selectRoom} layout={layout} zoom={zoom} objects={sceneObjects[layout]} collisionMessage={editMode === 'architecture' ? architectureMessage : collisionMessage} statusError={editMode === 'architecture' ? Boolean(architectureMessage) && !architectureSuccess : Boolean(collisionMessage)} onMove={moveObject} onCommitMove={commitMove} onRotate={rotateObject} onDelete={removeObject} onAddWall={addWall} onUpdateWall={updateWall} onUpdateOpening={updateOpening} />}
            {view === 'three' && <ThreeDView hour={hour} camera={camera} cameraReset={cameraReset} shadows={showShadows} lightPaths={showLightPaths} measurements={showMeasurements} objects={sceneObjects[layout]} architecture={displayedArchitecture} />}
            {view === 'evaluation' && <EvaluationView />}
          </>
        )}
        {view === 'plan' && !compare && editMode === 'furnish' && <AddObjectPanel rooms={rooms} loading={projectRevision === null} onAdd={addObject} selectedObject={sceneObjects[layout].find((item) => item.id === selected)} onResize={resizeObject} onCommitResize={saveObjectDimensions} />}
        {view === 'plan' && !compare && editMode === 'architecture' && <ArchitecturePropertiesPanel key={`${selectedOpening?.id ?? selectedWall?.id ?? 'apartment'}-${projectRevision}`} architecture={architecture} selectedWall={selectedWall} selectedOpening={selectedOpening} drawingWall={drawingWall} loading={projectRevision === null} onDrawingWall={(drawing) => { setArchitecturePreview(null); setDrawingWall(drawing); if (drawing) { setSelectedWallId(''); setSelectedOpeningId(''); setSelectedRoomId(''); } }} onPreviewApartment={previewApartment} onPreviewWall={previewWall} onPreviewOpening={previewOpening} onResizeApartment={resizeApartment} onUpdateWall={updateWall} onDeleteWall={deleteWall} onAddExteriorCorner={addExteriorCorner} onRemoveExteriorCorner={removeExteriorCorner} onAddDoor={addDoor} onUpdateOpening={updateOpening} onDeleteOpening={deleteOpening} onCloseOpening={() => { setArchitecturePreview(null); setSelectedOpeningId(''); }} />}
      </div>
    </main>
  );
}

function Header() {
  return (
    <header className="topbar">
      <div className="brand-lockup"><div className="brand-mark" aria-hidden="true"><span /></div><div className="brand-name">Dwellwise</div></div>
      <div className="project-title">
        <button className="icon-button back" aria-label="Back to apartments">←</button>
        <div><div className="project-name">197 Bedford Avenue · 4B</div><div className="project-meta">1 bed · 742 sq ft · Brooklyn, NY</div></div>
        <button className="mini-chevron" aria-label="Apartment menu">⌄</button>
      </div>
      <div className="top-actions">
        <span className="saved"><i /> Saved just now</span>
        {/* Comparison is temporarily hidden while the hackathon demo focuses on 2D, 3D, and sunlight. */}
        <button className="avatar" aria-label="Account">ML</button>
      </div>
    </header>
  );
}

function ModeBar({ view, compare, editMode, zoom, canUndo, canRedo, onUndo, onRedo, onZoom, onView, onEditMode }: { view: View; compare: boolean; editMode: EditMode; zoom: number; canUndo: boolean; canRedo: boolean; onUndo: () => void; onRedo: () => void; onZoom: (zoom: number) => void; onView: (view: View) => void; onEditMode: (mode: EditMode) => void }) {
  return (
    <section className="modebar">
      <nav className="view-tabs" aria-label="Apartment views">
        <button className={`view-tab ${view === 'plan' && !compare ? 'active' : ''}`} onClick={() => onView('plan')}><span className="plan-glyph" />2D plan</button>
        <button className={`view-tab ${view === 'three' && !compare ? 'active' : ''}`} onClick={() => onView('three')}><span className="cube-glyph">◇</span>3D preview</button>
        {/* Evaluation is temporarily hidden while the hackathon demo focuses on 2D, 3D, and sunlight. */}
      </nav>
      {view === 'plan' && !compare && <div className="edit-mode-switch" role="group" aria-label="Plan editing mode"><button className={editMode === 'architecture' ? 'active' : ''} onClick={() => onEditMode('architecture')}>Architecture</button><button className={editMode === 'furnish' ? 'active' : ''} onClick={() => onEditMode('furnish')}>Furnish</button></div>}
      {compare ? (
        <div className="comparison-mode-title"><span className="split-icon" /> SIDE-BY-SIDE DECISION</div>
      ) : view === 'plan' ? (
        <div className="plan-tools"><button aria-label="Undo last change" onClick={onUndo} disabled={!canUndo}>↶</button><button aria-label="Redo last change" onClick={onRedo} disabled={!canRedo}>↷</button><span /><button aria-label="Zoom out" onClick={() => onZoom(Math.max(50, zoom - 5))} disabled={zoom <= 50}>−</button><strong>{zoom}%</strong><button aria-label="Zoom in" onClick={() => onZoom(Math.min(120, zoom + 5))} disabled={zoom >= 120}>+</button></div>
      ) : view === 'three' ? (
        <div className="view-context">LIVE SUN STUDY · MAY 12</div>
      ) : (
        <div className="view-context">WEIGHTED TO YOUR PRIORITIES</div>
      )}
    </section>
  );
}

function ArchitecturePanel({ architecture, selectedWallId, selectedRoomId, onSelectWall, onSelectRoom, onRenameRoom }: { architecture: ArchitecturalElement[]; selectedWallId: string; selectedRoomId: string; onSelectWall: (id: string) => void; onSelectRoom: (id: string) => void; onRenameRoom: (id: string, name: string) => Promise<void> }) {
  const bounds = getArchitectureBounds(architecture);
  const rooms = architecture.filter((element): element is RoomElement => element.kind === 'room');
  const walls = architecture.filter((element): element is WallElement => element.kind === 'wall');
  return (
    <aside className="library-panel architecture-panel">
      <div className="panel-heading"><div><span className="eyebrow">YOUR SPACE</span><h2>Architecture</h2></div><span className="object-count">{walls.length}</span></div>
      <div className="architecture-summary"><div><span>FOOTPRINT</span><strong>{bounds.width.toFixed(2)} × {bounds.depth.toFixed(2)} m</strong></div><div><span>ROOM AREA</span><strong>{rooms.reduce((total, room) => total + polygonArea(room.boundary), 0).toFixed(1)} m²</strong></div></div>
      <div className="architecture-list-heading"><span>ROOMS</span><small>{rooms.length} detected</small></div>
      <div className="room-architecture-list">
        {rooms.map((room, index) => {
          const roomBounds = getArchitectureBounds([room]);
          const rectangular = isRectangularRoom(room);
          const edgeLengths = room.boundary.map((point, pointIndex) => {
            const next = room.boundary[(pointIndex + 1) % room.boundary.length];
            return Math.hypot(next.x - point.x, next.y - point.y);
          });
          return <section key={room.id} className={selectedRoomId === room.id ? 'selected' : ''}><button type="button" onClick={() => onSelectRoom(room.id)}><i>{String(index + 1).padStart(2, '0')}</i><span><strong>{room.name}</strong><small>{polygonArea(room.boundary).toFixed(1)} m² · {rectangular ? `${roomBounds.width.toFixed(2)} × ${roomBounds.depth.toFixed(2)} m` : `${room.boundary.length} edges`}</small></span></button>{selectedRoomId === room.id && <RoomNameEditor key={room.name} room={room} edgeLengths={edgeLengths} onRenameRoom={onRenameRoom} />}</section>;
        })}
      </div>
      <div className="architecture-list-heading"><span>WALLS</span><small>{walls.length} total</small></div>
      <div className="wall-list">
        {walls.map((wall, index) => {
          const exterior = isExteriorWall(wall, bounds, architecture);
          return <button key={wall.id} className={selectedWallId === wall.id ? 'selected' : ''} onClick={() => onSelectWall(wall.id)}><i>{String(index + 1).padStart(2, '0')}</i><span><strong>{exterior ? 'Exterior wall' : 'Interior wall'}</strong><small>{wallLength(wall).toFixed(2)} m · {wall.thickness.toFixed(2)} m thick</small></span></button>;
        })}
      </div>
      <div className="library-note"><span className="verified">✓</span><div><strong>Shared architecture</strong><p>Wall changes apply to every furniture layout and the 3D preview.</p></div></div>
    </aside>
  );
}

function RoomNameEditor({ room, edgeLengths, onRenameRoom }: { room: RoomElement; edgeLengths: number[]; onRenameRoom: (id: string, name: string) => Promise<void> }) {
  const [name, setName] = useState(room.name);
  const [saving, setSaving] = useState(false);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!name.trim() || name.trim() === room.name) return;
    setSaving(true);
    await onRenameRoom(room.id, name);
    setSaving(false);
  };
  return <form className="room-name-editor" onSubmit={submit}><label>ROOM NAME<input value={name} onChange={(event) => setName(event.target.value)} maxLength={40} /></label>{!isRectangularRoom(room) && <div className="room-edge-lengths"><span>EDGE LENGTHS</span><p>{edgeLengths.map((length, index) => <b key={index}>{index + 1} · {length.toFixed(2)} m</b>)}</p></div>}<button disabled={saving || !name.trim() || name.trim() === room.name}>{saving ? 'Saving…' : 'Save name'}</button></form>;
}

function ArchitecturePropertiesPanel({ architecture, selectedWall, selectedOpening, drawingWall, loading, onDrawingWall, onPreviewApartment, onPreviewWall, onPreviewOpening, onResizeApartment, onUpdateWall, onDeleteWall, onAddExteriorCorner, onRemoveExteriorCorner, onAddDoor, onUpdateOpening, onDeleteOpening, onCloseOpening }: { architecture: ArchitecturalElement[]; selectedWall?: WallElement; selectedOpening?: OpeningElement; drawingWall: boolean; loading: boolean; onDrawingWall: (drawing: boolean) => void; onPreviewApartment: (width: number, depth: number, height: number) => void; onPreviewWall: (id: string, patch: Partial<Pick<WallElement, 'start' | 'end' | 'thickness' | 'height'>>) => void; onPreviewOpening: (id: string, patch: Partial<Pick<OpeningElement, 'offset' | 'width' | 'height' | 'swing' | 'swingSide'>>) => void; onResizeApartment: (width: number, depth: number, height: number) => Promise<string | null>; onUpdateWall: (id: string, patch: Partial<Pick<WallElement, 'start' | 'end' | 'thickness' | 'height'>>) => Promise<boolean>; onDeleteWall: (id: string) => Promise<void>; onAddExteriorCorner: (id: string) => Promise<void>; onRemoveExteriorCorner: (id: string, endpoint: WallEndpoint) => Promise<void>; onAddDoor: (wallId: string) => Promise<void>; onUpdateOpening: (id: string, patch: Partial<Pick<OpeningElement, 'offset' | 'width' | 'height' | 'swing' | 'swingSide'>>) => Promise<boolean>; onDeleteOpening: (id: string) => Promise<void>; onCloseOpening: () => void }) {
  const bounds = getArchitectureBounds(architecture);
  const walls = architecture.filter((element): element is WallElement => element.kind === 'wall');
  const [width, setWidth] = useState(bounds.width);
  const [depth, setDepth] = useState(bounds.depth);
  const [height, setHeight] = useState(() => walls[0]?.height ?? 2.74);
  const [saving, setSaving] = useState(false);
  const [wallValues, setWallValues] = useState(() => selectedWall ? { length: wallLength(selectedWall), thickness: selectedWall.thickness, height: selectedWall.height } : { length: 0, thickness: 0.12, height: 2.74 });
  const [doorValues, setDoorValues] = useState(() => selectedOpening ? { offset: selectedOpening.offset, width: selectedOpening.width, height: selectedOpening.height, swing: selectedOpening.swing ?? 'left', swingSide: selectedOpening.swingSide ?? 'in' } : { offset: 0.1, width: 0.91, height: 2.03, swing: 'left' as const, swingSide: 'in' as const });
  const exterior = selectedWall ? isExteriorWall(selectedWall, bounds, architecture) : false;

  const changeApartmentValue = (key: 'width' | 'depth' | 'height', value: number) => {
    const next = { width, depth, height, [key]: value };
    setWidth(next.width);
    setDepth(next.depth);
    setHeight(next.height);
    onPreviewApartment(next.width, next.depth, next.height);
  };

  const wallPatch = (values: typeof wallValues) => {
    if (!selectedWall) return {};
    const scale = values.length / wallLength(selectedWall);
    return {
      end: {
        x: selectedWall.start.x + (selectedWall.end.x - selectedWall.start.x) * scale,
        y: selectedWall.start.y + (selectedWall.end.y - selectedWall.start.y) * scale,
      },
      thickness: values.thickness,
      height: values.height,
    };
  };

  const changeWallValue = (key: keyof typeof wallValues, value: number) => {
    const next = { ...wallValues, [key]: value };
    setWallValues(next);
    if (selectedWall) onPreviewWall(selectedWall.id, wallPatch(next));
  };

  const changeDoorValues = (patch: Partial<typeof doorValues>) => {
    const next = { ...doorValues, ...patch };
    setDoorValues(next);
    if (selectedOpening) onPreviewOpening(selectedOpening.id, next);
  };

  const resize = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    await onResizeApartment(width, depth, height);
    setSaving(false);
  };

  const saveWall = async (event: FormEvent) => {
    event.preventDefault();
    if (!selectedWall) return;
    setSaving(true);
    await onUpdateWall(selectedWall.id, wallPatch(wallValues));
    setSaving(false);
  };

  const saveDoor = async (event: FormEvent) => {
    event.preventDefault();
    if (!selectedOpening) return;
    setSaving(true);
    await onUpdateOpening(selectedOpening.id, doorValues);
    setSaving(false);
  };

  const heading = selectedOpening ? 'Door properties' : selectedWall ? 'Wall properties' : drawingWall ? 'Add interior wall' : 'Apartment size';
  const description = selectedOpening ? 'Drag the door along its wall or enter exact dimensions and swing below.'
    : selectedWall ? exterior ? 'Drag either corner or the highlighted edge to reshape the exterior perimeter.' : 'Drag either endpoint in the plan, or enter exact dimensions below.'
      : drawingWall ? 'Choose a start point and an end point directly on the plan.' : 'Resize the full plan or start drawing a new interior wall.';

  const safePreviewWidth = Math.max(width, 0.1);
  const safePreviewDepth = Math.max(depth, 0.1);
  const previewScale = Math.min(132 / safePreviewWidth, 88 / safePreviewDepth);
  const previewWidth = safePreviewWidth * previewScale;
  const previewDepth = safePreviewDepth * previewScale;
  const previewRise = 5 + ((height - 1.8) / 4.2) * 16;
  const previewStyle = {
    width: `${previewWidth}px`,
    height: `${previewDepth}px`,
    boxShadow: `${previewRise}px ${-previewRise}px 0 rgba(49,90,114,.24)`,
    transform: `translate(${-previewRise / 2}px, ${previewRise / 2}px)`,
  };

  return (
    <aside className="add-object-panel architecture-properties">
      <div className="add-object-heading"><span className="eyebrow">ARCHITECTURE</span><h2>{heading}</h2><p>{description}</p></div>
      {selectedOpening && selectedWall ? (
        <form onSubmit={saveDoor}>
          <button type="button" className="back-to-wall-button" onClick={onCloseOpening}>← Back to wall</button>
          <div className="selected-wall-badge"><span>DOOR · {exterior ? 'EXTERIOR' : 'INTERIOR'} WALL</span><strong>{selectedOpening.id}</strong></div>
          <label className="dimension-control"><span>POSITION FROM START · METERS</span><div><input aria-label="Door position slider" type="range" min="0.1" max={Math.max(0.1, wallLength(selectedWall) - doorValues.width - 0.1)} step="0.01" value={doorValues.offset} onChange={(event) => changeDoorValues({ offset: Number(event.target.value) })} /><input aria-label="Exact door position" type="number" min="0.1" max={Math.max(0.1, wallLength(selectedWall) - doorValues.width - 0.1)} step="0.01" value={doorValues.offset} onChange={(event) => changeDoorValues({ offset: Number(event.target.value) })} /></div></label>
          <label className="dimension-control"><span>WIDTH · METERS</span><div><input aria-label="Door width slider" type="range" min="0.5" max="3" step="0.01" value={doorValues.width} onChange={(event) => changeDoorValues({ width: Number(event.target.value) })} /><input aria-label="Exact door width" type="number" min="0.5" max="3" step="0.01" value={doorValues.width} onChange={(event) => changeDoorValues({ width: Number(event.target.value) })} /></div></label>
          <label className="dimension-control"><span>HEIGHT · METERS</span><div><input aria-label="Door height slider" type="range" min="1.8" max={selectedWall.height} step="0.01" value={doorValues.height} onChange={(event) => changeDoorValues({ height: Number(event.target.value) })} /><input aria-label="Exact door height" type="number" min="1.8" max={selectedWall.height} step="0.01" value={doorValues.height} onChange={(event) => changeDoorValues({ height: Number(event.target.value) })} /></div></label>
          <fieldset className="door-toggle"><legend>HINGE SIDE</legend><button type="button" className={doorValues.swing === 'left' ? 'active' : ''} onClick={() => changeDoorValues({ swing: 'left' })}>Left</button><button type="button" className={doorValues.swing === 'right' ? 'active' : ''} onClick={() => changeDoorValues({ swing: 'right' })}>Right</button></fieldset>
          <fieldset className="door-toggle"><legend>SWING DIRECTION</legend><button type="button" className={doorValues.swingSide === 'in' ? 'active' : ''} onClick={() => changeDoorValues({ swingSide: 'in' })}>Inward</button><button type="button" className={doorValues.swingSide === 'out' ? 'active' : ''} onClick={() => changeDoorValues({ swingSide: 'out' })}>Outward</button></fieldset>
          <button className="place-object" disabled={loading || saving}>{saving ? 'Saving…' : 'Apply door changes'}</button>
          <button type="button" className="delete-wall-button" disabled={saving} onClick={() => onDeleteOpening(selectedOpening.id)}>Remove door</button>
        </form>
      ) : selectedWall ? (
        <form onSubmit={saveWall}>
          <div className="selected-wall-badge"><span>{exterior ? 'EXTERIOR' : 'INTERIOR'}</span><strong>{selectedWall.id}</strong></div>
          <div className="wall-drag-hint"><span>↔</span><p><strong>{exterior ? 'Drag corners or edge' : 'Drag either endpoint'}</strong>Measurements update live and save when released.</p></div>
          <button type="button" className="add-door-button" disabled={loading || saving} onClick={() => onAddDoor(selectedWall.id)}>＋ Add door</button>
          {exterior && <div className="exterior-corner-actions"><button type="button" onClick={() => onAddExteriorCorner(selectedWall.id)}>＋ Add corner</button><button type="button" onClick={() => onRemoveExteriorCorner(selectedWall.id, 'start')}>− Start corner</button><button type="button" onClick={() => onRemoveExteriorCorner(selectedWall.id, 'end')}>− End corner</button></div>}
          <label className="dimension-control"><span>LENGTH · METERS <small>Start fixed for exact edits</small></span><div><input aria-label="Wall length slider" type="range" min="0.1" max="30" step="0.01" value={wallValues.length} onChange={(event) => changeWallValue('length', Number(event.target.value))} /><input aria-label="Exact wall length" type="number" min="0.1" max="30" step="0.01" value={wallValues.length} onChange={(event) => changeWallValue('length', Number(event.target.value))} /></div></label>
          <label className="dimension-control"><span>THICKNESS · METERS</span><div><input aria-label="Wall thickness slider" type="range" min="0.05" max="0.5" step="0.01" value={wallValues.thickness} onChange={(event) => changeWallValue('thickness', Number(event.target.value))} /><input aria-label="Exact wall thickness" type="number" min="0.05" max="0.5" step="0.01" value={wallValues.thickness} onChange={(event) => changeWallValue('thickness', Number(event.target.value))} /></div></label>
          <label className="dimension-control"><span>HEIGHT · METERS</span><div><input aria-label="Wall height slider" type="range" min="1.8" max="6" step="0.01" value={wallValues.height} onChange={(event) => changeWallValue('height', Number(event.target.value))} /><input aria-label="Exact wall height" type="number" min="1.8" max="6" step="0.01" value={wallValues.height} onChange={(event) => changeWallValue('height', Number(event.target.value))} /></div></label>
          <div className="wall-coordinate-readout"><span>START</span><strong>{selectedWall.start.x.toFixed(2)}, {selectedWall.start.y.toFixed(2)}</strong><span>END</span><strong>{selectedWall.end.x.toFixed(2)}, {selectedWall.end.y.toFixed(2)}</strong></div>
          <button className="place-object" disabled={loading || saving}>{saving ? 'Saving…' : 'Apply wall dimensions'}</button>
          {!exterior && <button type="button" className="delete-wall-button" disabled={saving} onClick={() => onDeleteWall(selectedWall.id)}>Remove interior wall</button>}
        </form>
      ) : (
        <>
          <div className="wall-creation-tool">
            <button type="button" className={`draw-wall-button ${drawingWall ? 'active' : ''}`} onClick={() => onDrawingWall(!drawingWall)}>{drawingWall ? '× Cancel wall drawing' : '＋ Add interior wall'}</button>
            {drawingWall && <p className="tool-instruction">Click a start point, then an end point. Walls snap to corners, edges, the grid, horizontal, and vertical lines.</p>}
          </div>
          <form onSubmit={resize}>
            <fieldset className="apartment-dimensions"><legend>OVERALL DIMENSIONS · METERS</legend><label className="dimension-control"><span>W · WIDTH</span><div><input aria-label="Apartment width slider" type="range" min="2" max="30" step="0.01" value={width} onChange={(event) => changeApartmentValue('width', Number(event.target.value))} /><input aria-label="Exact apartment width" type="number" min="2" max="30" step="0.01" value={width} onChange={(event) => changeApartmentValue('width', Number(event.target.value))} /></div></label><label className="dimension-control"><span>D · DEPTH</span><div><input aria-label="Apartment depth slider" type="range" min="2" max="30" step="0.01" value={depth} onChange={(event) => changeApartmentValue('depth', Number(event.target.value))} /><input aria-label="Exact apartment depth" type="number" min="2" max="30" step="0.01" value={depth} onChange={(event) => changeApartmentValue('depth', Number(event.target.value))} /></div></label><label className="dimension-control"><span>H · HEIGHT</span><div><input aria-label="Apartment height slider" type="range" min="1.8" max="6" step="0.01" value={height} onChange={(event) => changeApartmentValue('height', Number(event.target.value))} /><input aria-label="Exact apartment height" type="number" min="1.8" max="6" step="0.01" value={height} onChange={(event) => changeApartmentValue('height', Number(event.target.value))} /></div></label></fieldset>
            <div className="footprint-preview"><div className="apartment-preview-stage"><div className="apartment-preview-box" style={previewStyle} /></div><span>{width.toFixed(2)} × {depth.toFixed(2)} × {height.toFixed(2)} m · {(width * depth).toFixed(1)} m²</span></div>
            <button className="place-object" disabled={loading || saving}>{saving ? 'Resizing…' : 'Apply apartment size'}</button>
          </form>
        </>
      )}
      <div className="placement-note"><span>01</span><p>Geometry is stored in meters and rendered from the same source in 2D and 3D.</p></div>
    </aside>
  );
}

function FurniturePanel({ selected, onSelect, objects }: { selected: string; onSelect: (item: string) => void; objects: SceneObject[] }) {
  const [query, setQuery] = useState('');
  const visible = objects.filter((item) => item.name.toLowerCase().includes(query.toLowerCase()));
  return (
    <aside className="library-panel">
      <div className="panel-heading"><div><span className="eyebrow">YOUR SPACE</span><h2>Furniture</h2></div><span className="object-count">{objects.length}</span></div>
      <div className="fit-summary"><div><strong>{objects.length} {objects.length === 1 ? 'object' : 'objects'}</strong><span>in this layout</span></div><div className="fit-ring"><span>{objects.length ? '✓' : '0'}</span></div></div>
      <label className="search-box"><span>⌕</span><input aria-label="Search furniture" placeholder="Search furniture" value={query} onChange={(event) => setQuery(event.target.value)} /></label>
      <div className="furniture-list">
        {visible.length === 0 && <div className="empty-furniture-list"><span>＋</span><strong>No furniture yet</strong><p>Add an item from the object library on the right.</p></div>}
        {visible.map((item) => (
          <button key={item.id} className={`furniture-row ${selected === item.id ? 'selected' : ''}`} onClick={() => onSelect(item.id)}>
            <span className={`furniture-thumb ${furnitureVisualKind(item)}`}><i /></span><span className="furniture-copy"><strong>{item.name}</strong><small>{formatDimensions(item.dimensions)}</small></span><span className="drag-dots">⠿</span>
          </button>
        ))}
      </div>
      <div className="library-note"><span className="verified">✓</span><div><strong>Dimensions verified</strong><p>All furniture uses your exact measurements.</p></div></div>
    </aside>
  );
}

function furnitureVisualKind(item: SceneObject) {
  const name = item.name.toLowerCase();
  if (name.includes('bed')) return 'bed';
  if (name.includes('sofa')) return 'sofa';
  if (name.includes('desk')) return 'desk';
  if (name.includes('table')) return 'table';
  if (name.includes('dresser')) return 'dresser';
  return 'custom';
}

function PlanView({ editMode, architecture, selectedWallId, selectedOpeningId, selectedRoomId, drawingWall, selected, onSelect, onSelectWall, onSelectOpening, onSelectRoom, layout, zoom, objects, collisionMessage, statusError, onMove, onCommitMove, onRotate, onDelete, onAddWall, onUpdateWall, onUpdateOpening }: { editMode: EditMode; architecture: ArchitecturalElement[]; selectedWallId: string; selectedOpeningId: string; selectedRoomId: string; drawingWall: boolean; selected: string; onSelect: (item: string) => void; onSelectWall: (id: string) => void; onSelectOpening: (id: string, wallId: string) => void; onSelectRoom: (id: string) => void; layout: LayoutKey; zoom: number; objects: SceneObject[]; collisionMessage: string; statusError: boolean; onMove: (id: string, placement: ObjectPlacement) => boolean; onCommitMove: (id: string, placement: ObjectPlacement, before: SceneObject) => void; onRotate: (id: string, degrees: number) => void; onDelete: (id: string) => void; onAddWall: (start: Point2, end: Point2) => Promise<void>; onUpdateWall: (id: string, patch: Partial<Pick<WallElement, 'start' | 'end'>>) => Promise<boolean>; onUpdateOpening: (id: string, patch: Partial<Pick<OpeningElement, 'offset'>>) => Promise<boolean> }) {
  const selectedObject = objects.find((item) => item.id === selected);
  const bounds = getArchitectureBounds(architecture);
  const frame = planFrameSize(bounds.width, bounds.depth);
  const shared = { selected, onSelect, onMove, onCommitMove, architecture, bounds };
  return (
    <section className={`plan-workspace edit-${editMode}`} aria-label="2D floor plan editor">
      {editMode === 'furnish' && selectedObject && <div className="object-toolbar" aria-label={`Edit ${selectedObject.name}`}><strong>{selectedObject.name}</strong><button onClick={() => onRotate(selectedObject.id, -90)} aria-label="Rotate left">↶ 90°</button><button onClick={() => onRotate(selectedObject.id, 90)} aria-label="Rotate right">↷ 90°</button><button className="delete-object" onClick={() => onDelete(selectedObject.id)} aria-label={`Remove ${selectedObject.name}`}>Remove</button></div>}
      <div className="drawing-index"><strong>A–01</strong><span>FURNITURE PLAN</span><small>ISSUE 02 · AI STUDY</small></div>
      <div className="north-marker"><span>N</span><i /></div><div className="scale-key"><span /> 5 ft</div>
      <div className={`floor-plan-wrap layout-${layout.toLowerCase()}`} style={{ transform: `translate(-50%, -49%) scale(${zoom / 100})` }}>
        <div className="geometry-measure top" style={{ width: frame.width }}>{bounds.width.toFixed(2)} m</div><div className="geometry-measure left" style={{ height: frame.height }}>{bounds.depth.toFixed(2)} m</div>
        <div className="floor-plan geometry-plan" style={{ width: frame.width, height: frame.height }}>
          <ArchitecturePlanLayer key={drawingWall ? 'drawing' : 'selecting'} architecture={architecture} bounds={bounds} editMode={editMode} selectedWallId={selectedWallId} selectedOpeningId={selectedOpeningId} selectedRoomId={selectedRoomId} drawingWall={drawingWall} onSelectWall={onSelectWall} onSelectOpening={onSelectOpening} onSelectRoom={onSelectRoom} onAddWall={onAddWall} onUpdateWall={onUpdateWall} onUpdateOpening={onUpdateOpening} />
          {editMode === 'furnish' && objects.map((item) => <PlanFurniture key={item.id} item={item} {...shared} />)}
        </div>
      </div>
      <div className="sheet-titleblock" aria-label="Drawing title block">
        <div><span>PROJECT</span><strong>197 BEDFORD AVE · 4B</strong></div>
        <div><span>DRAWING</span><strong>FURNITURE + CLEARANCE PLAN</strong></div>
        <div className="sheet-meta"><span>SCALE<br /><b>1/4″ = 1′–0″</b></span><span>DATE<br /><b>26 AUG 2026</b></span><strong>A–01</strong></div>
      </div>
      <div className={`plan-status ${statusError ? 'has-collision' : ''}`} role="status"><span className={statusError ? 'status-collision' : 'status-good'}>{collisionMessage ? `${statusError ? '⚠' : '✓'} ${collisionMessage}` : editMode === 'architecture' ? '✓ Architecture is valid' : '✓ No furniture collisions'}</span><span>{editMode === 'architecture' ? drawingWall ? 'Click two points to add a wall · Escape cancels' : 'Drag wall corners, exterior edges, or doors directly in the plan' : 'Drag anywhere in the apartment · arrows move · toolbar rotates/removes'}</span></div>
    </section>
  );
}

function planFrameSize(width: number, depth: number) {
  const maximum = { width: 620, height: 515 };
  const scale = Math.min(maximum.width / Math.max(width, 0.1), maximum.height / Math.max(depth, 0.1));
  return { width: Math.max(180, width * scale), height: Math.max(180, depth * scale) };
}

function snapPoint(raw: Point2, architecture: ArchitecturalElement[], bounds: ReturnType<typeof getArchitectureBounds>, clampToBounds = true) {
  const grid = (value: number) => Math.round(value * 10) / 10;
  const tolerance = Math.min(0.25, Math.max(bounds.width, bounds.depth) * 0.018);
  const walls = architecture.filter((element): element is WallElement => element.kind === 'wall');
  const vertices = walls.flatMap((wall) => [wall.start, wall.end]);
  const nearestVertex = vertices.reduce<Point2 | null>((nearest, point) => {
    if (Math.hypot(point.x - raw.x, point.y - raw.y) > tolerance) return nearest;
    return !nearest || Math.hypot(point.x - raw.x, point.y - raw.y) < Math.hypot(nearest.x - raw.x, nearest.y - raw.y) ? point : nearest;
  }, null);
  if (nearestVertex) return nearestVertex;

  const nearestWallPoint = walls.reduce<Point2 | null>((nearest, wall) => {
    const dx = wall.end.x - wall.start.x;
    const dy = wall.end.y - wall.start.y;
    const lengthSquared = dx * dx + dy * dy;
    const t = Math.max(0, Math.min(1, ((raw.x - wall.start.x) * dx + (raw.y - wall.start.y) * dy) / lengthSquared));
    const point = { x: wall.start.x + t * dx, y: wall.start.y + t * dy };
    if (Math.hypot(point.x - raw.x, point.y - raw.y) > tolerance) return nearest;
    return !nearest || Math.hypot(point.x - raw.x, point.y - raw.y) < Math.hypot(nearest.x - raw.x, nearest.y - raw.y) ? point : nearest;
  }, null);
  const point = nearestWallPoint ?? { x: grid(raw.x), y: grid(raw.y) };
  if (!clampToBounds) return point;
  return {
    x: Math.max(bounds.minX, Math.min(bounds.maxX, point.x)),
    y: Math.max(bounds.minY, Math.min(bounds.maxY, point.y)),
  };
}

function snapWallEnd(start: Point2, raw: Point2, architecture: ArchitecturalElement[], bounds: ReturnType<typeof getArchitectureBounds>, clampToBounds = true) {
  const dx = raw.x - start.x;
  const dy = raw.y - start.y;
  const angle = Math.atan2(dy, dx);
  const horizontalDistance = Math.min(Math.abs(angle), Math.abs(Math.PI - Math.abs(angle)));
  const verticalDistance = Math.abs(Math.PI / 2 - Math.abs(angle));
  const threshold = Math.PI / 18;
  const aligned = horizontalDistance < threshold ? { x: raw.x, y: start.y }
    : verticalDistance < threshold ? { x: start.x, y: raw.y }
    : raw;
  return snapPoint(aligned, architecture, bounds, clampToBounds);
}

type WallEndpoint = 'start' | 'end';
type WallDragState = { wallId: string; mode: 'endpoint' | 'edge'; endpoint?: WallEndpoint; pointerId: number; pointerStart: Point2; originStart: Point2; originEnd: Point2; start: Point2; end: Point2 };
type DoorDragState = { openingId: string; pointerId: number; offset: number };

function ArchitecturePlanLayer({ architecture, bounds, editMode, selectedWallId, selectedOpeningId, selectedRoomId, drawingWall, onSelectWall, onSelectOpening, onSelectRoom, onAddWall, onUpdateWall, onUpdateOpening }: { architecture: ArchitecturalElement[]; bounds: ReturnType<typeof getArchitectureBounds>; editMode: EditMode; selectedWallId: string; selectedOpeningId: string; selectedRoomId: string; drawingWall: boolean; onSelectWall: (id: string) => void; onSelectOpening: (id: string, wallId: string) => void; onSelectRoom: (id: string) => void; onAddWall: (start: Point2, end: Point2) => Promise<void>; onUpdateWall: (id: string, patch: Partial<Pick<WallElement, 'start' | 'end'>>) => Promise<boolean>; onUpdateOpening: (id: string, patch: Partial<Pick<OpeningElement, 'offset'>>) => Promise<boolean> }) {
  const [draftStart, setDraftStart] = useState<Point2 | null>(null);
  const [draftEnd, setDraftEnd] = useState<Point2 | null>(null);
  const [wallDrag, setWallDrag] = useState<WallDragState | null>(null);
  const [doorDrag, setDoorDrag] = useState<DoorDragState | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const rooms = architecture.filter((element): element is RoomElement => element.kind === 'room');
  const walls = architecture.filter((element): element is WallElement => element.kind === 'wall');
  const openings = architecture.filter((element): element is OpeningElement => element.kind === 'opening');
  const draggedOriginal = wallDrag ? walls.find((wall) => wall.id === wallDrag.wallId) : undefined;
  const draggedExterior = draggedOriginal ? isExteriorWall(draggedOriginal, bounds, architecture) : false;
  const movedCorners = wallDrag && draggedExterior ? [
    ...(samePoint(wallDrag.originStart, wallDrag.start) ? [] : [{ before: wallDrag.originStart, after: wallDrag.start }]),
    ...(samePoint(wallDrag.originEnd, wallDrag.end) ? [] : [{ before: wallDrag.originEnd, after: wallDrag.end }]),
  ] : [];
  const renderedWalls = walls.map((wall) => {
    if (wallDrag?.wallId === wall.id) return { ...wall, start: wallDrag.start, end: wallDrag.end };
    const movedStart = movedCorners.find((corner) => samePoint(wall.start, corner.before));
    const movedEnd = movedCorners.find((corner) => samePoint(wall.end, corner.before));
    return movedStart || movedEnd ? { ...wall, start: movedStart?.after ?? wall.start, end: movedEnd?.after ?? wall.end } : wall;
  });
  const renderedOpenings = openings.map((opening) => doorDrag?.openingId === opening.id ? { ...opening, offset: doorDrag.offset } : opening);

  useEffect(() => {
    const cancel = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') {
        setDraftStart(null);
        setDraftEnd(null);
        setWallDrag(null);
        setDoorDrag(null);
      }
    };
    window.addEventListener('keydown', cancel);
    return () => window.removeEventListener('keydown', cancel);
  }, []);

  const pointFromClient = (clientX: number, clientY: number): Point2 | null => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect || rect.width <= 0 || rect.height <= 0) return null;
    return {
      x: bounds.minX + ((clientX - rect.left) / rect.width) * bounds.width,
      y: bounds.minY + ((clientY - rect.top) / rect.height) * bounds.depth,
    };
  };
  const pointFromEvent = (event: PointerEvent<SVGSVGElement | SVGCircleElement | SVGLineElement>) => pointFromClient(event.clientX, event.clientY);

  const wallDragAtPoint = (current: WallDragState, raw: Point2): WallDragState => {
    const wall = walls.find((candidate) => candidate.id === current.wallId);
    if (!wall) return current;
    if (current.mode === 'edge') {
      const delta = { x: Math.round((raw.x - current.pointerStart.x) * 10) / 10, y: Math.round((raw.y - current.pointerStart.y) * 10) / 10 };
      return { ...current, start: { x: current.originStart.x + delta.x, y: current.originStart.y + delta.y }, end: { x: current.originEnd.x + delta.x, y: current.originEnd.y + delta.y } };
    }
    const endpoint = current.endpoint ?? 'end';
    const fixedPoint = endpoint === 'start' ? current.originEnd : current.originStart;
    const movingOrigin = endpoint === 'start' ? current.originStart : current.originEnd;
    const exterior = isExteriorWall(wall, bounds, architecture);
    const excludedWallIds = new Set(walls.filter((candidate) => candidate.id === wall.id || (exterior && [candidate.start, candidate.end].some((point) => samePoint(point, movingOrigin)))).map((candidate) => candidate.id));
    const snappingArchitecture = architecture.filter((element) => !excludedWallIds.has(element.id));
    const point = snapWallEnd(fixedPoint, raw, snappingArchitecture, bounds, !exterior);
    return { ...current, [endpoint]: point };
  };

  const doorOffsetAtPoint = (opening: OpeningElement, raw: Point2) => {
    const wall = walls.find((candidate) => candidate.id === opening.wallId);
    if (!wall) return opening.offset;
    const dx = wall.end.x - wall.start.x;
    const dy = wall.end.y - wall.start.y;
    const length = wallLength(wall);
    const projectedCenter = ((raw.x - wall.start.x) * dx + (raw.y - wall.start.y) * dy) / length;
    const offset = Math.round((projectedCenter - opening.width / 2) * 20) / 20;
    return Math.max(0.1, Math.min(length - opening.width - 0.1, offset));
  };

  const pointerMove = (event: PointerEvent<SVGSVGElement>) => {
    const point = pointFromEvent(event);
    if (!point) return;
    if (wallDrag && event.pointerId === wallDrag.pointerId) {
      event.preventDefault();
      setWallDrag((current) => current ? wallDragAtPoint(current, point) : current);
      return;
    }
    if (doorDrag && event.pointerId === doorDrag.pointerId) {
      event.preventDefault();
      const opening = openings.find((candidate) => candidate.id === doorDrag.openingId);
      if (opening) setDoorDrag((current) => current ? { ...current, offset: doorOffsetAtPoint(opening, point) } : current);
      return;
    }
    if (drawingWall && draftStart) setDraftEnd(snapWallEnd(draftStart, point, architecture, bounds));
  };

  const pointerDown = async (event: PointerEvent<SVGSVGElement>) => {
    if (!drawingWall) return;
    event.preventDefault();
    const raw = pointFromEvent(event);
    if (!raw) return;
    const point = draftStart ? snapWallEnd(draftStart, raw, architecture, bounds) : snapPoint(raw, architecture, bounds);
    if (!draftStart) {
      setDraftStart(point);
      setDraftEnd(point);
      return;
    }
    await onAddWall(draftStart, point);
    setDraftStart(null);
    setDraftEnd(null);
  };

  const beginWallEndpointDrag = (event: PointerEvent<SVGCircleElement>, wall: WallElement, endpoint: WallEndpoint) => {
    if (drawingWall) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    const pointerStart = pointFromEvent(event);
    if (!pointerStart) return;
    setWallDrag({ wallId: wall.id, mode: 'endpoint', endpoint, pointerId: event.pointerId, pointerStart, originStart: wall.start, originEnd: wall.end, start: wall.start, end: wall.end });
  };

  const beginWallEdgeDrag = (event: PointerEvent<SVGLineElement>, wall: WallElement) => {
    if (drawingWall || selectedWallId !== wall.id || !isExteriorWall(wall, bounds, architecture)) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    const pointerStart = pointFromEvent(event);
    if (!pointerStart) return;
    setWallDrag({ wallId: wall.id, mode: 'edge', pointerId: event.pointerId, pointerStart, originStart: wall.start, originEnd: wall.end, start: wall.start, end: wall.end });
  };

  const beginDoorDrag = (event: PointerEvent<SVGLineElement>, opening: OpeningElement) => {
    event.preventDefault();
    event.stopPropagation();
    if (selectedOpeningId !== opening.id) onSelectOpening(opening.id, opening.wallId);
    event.currentTarget.setPointerCapture(event.pointerId);
    setDoorDrag({ openingId: opening.id, pointerId: event.pointerId, offset: opening.offset });
  };

  const beginDoorHandleDrag = (event: PointerEvent<SVGCircleElement>, opening: OpeningElement) => {
    event.preventDefault();
    event.stopPropagation();
    if (selectedOpeningId !== opening.id) onSelectOpening(opening.id, opening.wallId);
    event.currentTarget.setPointerCapture(event.pointerId);
    setDoorDrag({ openingId: opening.id, pointerId: event.pointerId, offset: opening.offset });
  };

  const finishInteraction = async (event: PointerEvent<SVGSVGElement>) => {
    const point = pointFromEvent(event);
    if (!point) {
      setWallDrag(null);
      setDoorDrag(null);
      return;
    }
    if (wallDrag && event.pointerId === wallDrag.pointerId) {
      event.preventDefault();
      const next = wallDragAtPoint(wallDrag, point);
      setWallDrag(next);
      if (!samePoint(next.start, next.originStart) || !samePoint(next.end, next.originEnd)) await onUpdateWall(next.wallId, { start: next.start, end: next.end });
      setWallDrag(null);
      return;
    }
    if (doorDrag && event.pointerId === doorDrag.pointerId) {
      event.preventDefault();
      const opening = openings.find((candidate) => candidate.id === doorDrag.openingId);
      if (opening) {
        const offset = doorOffsetAtPoint(opening, point);
        setDoorDrag({ ...doorDrag, offset });
        if (Math.abs(offset - opening.offset) > 0.001) await onUpdateOpening(opening.id, { offset });
      }
      setDoorDrag(null);
    }
  };

  const fontSize = Math.max(bounds.width, bounds.depth) / 55;
  return (
    <svg ref={svgRef} className={`architecture-svg ${drawingWall ? 'drawing-wall' : ''} ${wallDrag ? 'dragging-wall' : ''} ${doorDrag ? 'dragging-door' : ''}`} viewBox={`${bounds.minX} ${bounds.minY} ${bounds.width} ${bounds.depth}`} preserveAspectRatio="none" onPointerMove={pointerMove} onPointerDown={pointerDown} onPointerUp={finishInteraction} onPointerCancel={() => { setWallDrag(null); setDoorDrag(null); }} aria-label="Apartment rooms and walls">
      {rooms.map((room, index) => {
        const center = polygonCentroid(room.boundary);
        return <g key={room.id} className={`architecture-room-group ${selectedRoomId === room.id ? 'selected' : ''}`} onPointerDown={(event) => { if (!drawingWall && editMode === 'architecture') { event.stopPropagation(); onSelectRoom(room.id); } }}><polygon className={`architecture-room room-tone-${index % 4}`} points={room.boundary.map((point) => `${point.x},${point.y}`).join(' ')} /><text x={center.x} y={center.y - fontSize * 0.15} fontSize={fontSize} textAnchor="middle">{room.name.toUpperCase()}</text><text className="room-area-label" x={center.x} y={center.y + fontSize} fontSize={fontSize * 0.82} textAnchor="middle">{polygonArea(room.boundary).toFixed(1)} m²</text></g>;
      })}
      {renderedWalls.map((wall) => {
        const originalWall = walls.find((candidate) => candidate.id === wall.id) ?? wall;
        const exterior = isExteriorWall(originalWall, bounds, architecture);
        const selectedWall = editMode === 'architecture' && selectedWallId === wall.id;
        return <g key={wall.id} className={`architecture-wall ${selectedWall ? 'selected' : ''} ${wallDrag?.wallId === wall.id ? 'dragging' : ''}`} onPointerDown={(event) => { if (!drawingWall && editMode === 'architecture') { event.stopPropagation(); onSelectWall(wall.id); } }}><line className="wall-visible" x1={wall.start.x} y1={wall.start.y} x2={wall.end.x} y2={wall.end.y} strokeWidth={Math.max(wall.thickness, 0.07)} /><line className={`wall-hit-target ${selectedWall && exterior ? 'edge-draggable' : ''}`} x1={wall.start.x} y1={wall.start.y} x2={wall.end.x} y2={wall.end.y} strokeWidth={Math.max(wall.thickness * 4, 0.28)} onPointerDown={(event) => beginWallEdgeDrag(event, originalWall)} />{selectedWall && <><circle role="button" aria-label="Drag wall start point" className="wall-endpoint-hit" cx={wall.start.x} cy={wall.start.y} r={fontSize} onPointerDown={(event) => beginWallEndpointDrag(event, originalWall, 'start')} /><circle className="wall-endpoint-handle start" pointerEvents="none" cx={wall.start.x} cy={wall.start.y} r={fontSize * 0.5} /><circle role="button" aria-label="Drag wall end point" className="wall-endpoint-hit" cx={wall.end.x} cy={wall.end.y} r={fontSize} onPointerDown={(event) => beginWallEndpointDrag(event, originalWall, 'end')} /><circle className="wall-endpoint-handle end" pointerEvents="none" cx={wall.end.x} cy={wall.end.y} r={fontSize * 0.5} /><text className="wall-length-label" x={(wall.start.x + wall.end.x) / 2} y={(wall.start.y + wall.end.y) / 2 - fontSize * 0.65} fontSize={fontSize * 0.9} textAnchor="middle">{wallLength(wall).toFixed(2)} m · H {wall.height.toFixed(2)} m · {wallDrag?.wallId === wall.id ? 'DRAGGING' : exterior ? 'DRAG CORNERS OR EDGE' : 'DRAG EITHER END'}</text></>}</g>;
      })}
      {renderedOpenings.map((opening) => {
        const wall = renderedWalls.find((candidate) => candidate.id === opening.wallId);
        if (!wall) return null;
        const length = wallLength(wall);
        const along = (offset: number) => ({ x: wall.start.x + ((wall.end.x - wall.start.x) * offset) / length, y: wall.start.y + ((wall.end.y - wall.start.y) * offset) / length });
        const start = along(opening.offset);
        const end = along(opening.offset + opening.width);
        if (opening.openingType !== 'door') return <line key={opening.id} className="architecture-opening window" x1={start.x} y1={start.y} x2={end.x} y2={end.y} strokeWidth={Math.max(wall.thickness * 1.7, 0.12)} />;
        const selectedDoor = selectedOpeningId === opening.id;
        const center = along(opening.offset + opening.width / 2);
        const hinge = opening.swing === 'right' ? end : start;
        const closedEnd = opening.swing === 'right' ? start : end;
        const normalSign = opening.swingSide === 'out' ? -1 : 1;
        const tangent = { x: (end.x - start.x) / opening.width, y: (end.y - start.y) / opening.width };
        const leafEnd = { x: hinge.x - tangent.y * opening.width * normalSign, y: hinge.y + tangent.x * opening.width * normalSign };
        const control = { x: (closedEnd.x + leafEnd.x) / 2 + (hinge.x - (closedEnd.x + leafEnd.x) / 2) * 0.45, y: (closedEnd.y + leafEnd.y) / 2 + (hinge.y - (closedEnd.y + leafEnd.y) / 2) * 0.45 };
        return <g key={opening.id} className={`architecture-door ${selectedDoor ? 'selected' : ''} ${doorDrag?.openingId === opening.id ? 'dragging' : ''}`}><line className="door-gap" x1={start.x} y1={start.y} x2={end.x} y2={end.y} strokeWidth={Math.max(wall.thickness * 1.8, 0.13)} /><path className="door-swing" d={`M ${closedEnd.x} ${closedEnd.y} Q ${control.x} ${control.y} ${leafEnd.x} ${leafEnd.y}`} /><line className="door-leaf" x1={hinge.x} y1={hinge.y} x2={leafEnd.x} y2={leafEnd.y} /><line role="button" aria-label="Drag door along wall" className="door-hit-target" x1={start.x} y1={start.y} x2={end.x} y2={end.y} strokeWidth={Math.max(wall.thickness * 5, 0.4)} onPointerDown={(event) => beginDoorDrag(event, opening)} /><circle role="button" aria-label="Select and drag door" className="door-grab-handle" cx={center.x} cy={center.y} r={fontSize * 0.48} onPointerDown={(event) => beginDoorHandleDrag(event, opening)} /></g>;
      })}
      {drawingWall && draftStart && draftEnd && <g className="draft-wall"><line x1={draftStart.x} y1={draftStart.y} x2={draftEnd.x} y2={draftEnd.y} strokeWidth={0.12} /><circle cx={draftStart.x} cy={draftStart.y} r={fontSize * 0.42} /><circle cx={draftEnd.x} cy={draftEnd.y} r={fontSize * 0.42} /><text x={(draftStart.x + draftEnd.x) / 2} y={(draftStart.y + draftEnd.y) / 2 - fontSize * 0.65} fontSize={fontSize * 0.9} textAnchor="middle">{Math.hypot(draftEnd.x - draftStart.x, draftEnd.y - draftStart.y).toFixed(2)} m</text></g>}
    </svg>
  );
}

function PlanFurniture({ item, ...props }: { item: SceneObject; selected: string; onSelect: (id: string) => void; onMove: (id: string, placement: ObjectPlacement) => boolean; onCommitMove: (id: string, placement: ObjectPlacement, before: SceneObject) => void; architecture: ArchitecturalElement[]; bounds: ReturnType<typeof getArchitectureBounds> }) {
  const name = item.name.toLowerCase();
  if (item.category === 'sofa' || name.includes('sofa')) return <DraggablePlanObject item={item} className="sofa" {...props}><i /><i /><i /></DraggablePlanObject>;
  if (item.category === 'desk' || name.includes('desk')) return <DraggablePlanObject item={item} className="desk" {...props}><i className="chair" /><span className="computer" /><b className="clearance">3′ CLEAR</b></DraggablePlanObject>;
  if (item.category === 'bed' || name.includes('bed')) return <DraggablePlanObject item={item} className="bed" {...props}><span /><i /><i /></DraggablePlanObject>;
  if (name.includes('dining') || name.includes('coffee table') || item.category === 'table') return <DraggablePlanObject item={item} className="table" {...props}><i /><i /><i /><i /></DraggablePlanObject>;
  if (name.includes('dresser')) return <DraggablePlanObject item={item} className="dresser" {...props}><i /><i /><i /></DraggablePlanObject>;
  return <DraggablePlanObject item={item} className="added-object" {...props}><span>{item.name}</span></DraggablePlanObject>;
}

type ObjectPlacement = { position: { x: number; z: number }; roomId: RoomId };

function displayPointFor(item: SceneObject, bounds: ReturnType<typeof getArchitectureBounds>) {
  return {
    x: (item.transform.position.x - bounds.minX) / bounds.width,
    y: (item.transform.position.z - bounds.minY) / bounds.depth,
  };
}

function placementFromDisplayPoint(x: number, y: number, preferredRoom: RoomId, architecture: ArchitecturalElement[], bounds: ReturnType<typeof getArchitectureBounds>): ObjectPlacement {
  const position = {
    x: bounds.minX + x * bounds.width,
    z: bounds.minY + y * bounds.depth,
  };
  const room = roomForPoint(architecture, { x: position.x, y: position.z }, preferredRoom);
  return {
    roomId: room?.id ?? preferredRoom,
    position,
  };
}

function clampObjectPosition(item: SceneObject, position: { x: number; z: number }, bounds: ReturnType<typeof getArchitectureBounds>) {
  const angle = item.transform.rotation.y * Math.PI / 180;
  const halfX = Math.abs(Math.cos(angle)) * item.dimensions.width / 2 + Math.abs(Math.sin(angle)) * item.dimensions.depth / 2;
  const halfZ = Math.abs(Math.sin(angle)) * item.dimensions.width / 2 + Math.abs(Math.cos(angle)) * item.dimensions.depth / 2;
  return {
    x: Math.max(bounds.minX + halfX, Math.min(bounds.maxX - halfX, position.x)),
    z: Math.max(bounds.minY + halfZ, Math.min(bounds.maxY - halfZ, position.z)),
  };
}

function objectBounds(item: SceneObject) {
  const angle = item.transform.rotation.y * Math.PI / 180;
  const halfX = Math.abs(Math.cos(angle)) * item.dimensions.width / 2 + Math.abs(Math.sin(angle)) * item.dimensions.depth / 2;
  const halfZ = Math.abs(Math.sin(angle)) * item.dimensions.width / 2 + Math.abs(Math.cos(angle)) * item.dimensions.depth / 2;
  return { left: item.transform.position.x - halfX, right: item.transform.position.x + halfX, top: item.transform.position.z - halfZ, bottom: item.transform.position.z + halfZ };
}

function findCollision(objects: SceneObject[], candidate: SceneObject) {
  const a = objectBounds(candidate);
  return objects.find((item) => {
    if (item.id === candidate.id) return false;
    const b = objectBounds(item);
    return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
  });
}

function planObjectStyle(item: SceneObject, bounds: ReturnType<typeof getArchitectureBounds>) {
  const point = displayPointFor(item, bounds);
  return {
    left: `${point.x * 100}%`,
    top: `${point.y * 100}%`,
    width: `${Math.max(3, (item.dimensions.width / bounds.width) * 100)}%`,
    height: `${Math.max(3, (item.dimensions.depth / bounds.depth) * 100)}%`,
    transform: `translate(-50%, -50%) rotate(${item.transform.rotation.y}deg)`,
  };
}

function DraggablePlanObject({ item, className, selected, onSelect, onMove, onCommitMove, architecture, bounds, children }: { item: SceneObject; className: string; selected: string; onSelect: (id: string) => void; onMove: (id: string, placement: ObjectPlacement) => boolean; onCommitMove: (id: string, placement: ObjectPlacement, before: SceneObject) => void; architecture: ArchitecturalElement[]; bounds: ReturnType<typeof getArchitectureBounds>; children: ReactNode }) {
  const drag = useRef<{ pointerId: number; clientX: number; clientY: number; startDisplayX: number; startDisplayY: number; latest: ObjectPlacement; before: SceneObject } | null>(null);

  const pointerDown = (event: PointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    onSelect(item.id);
    event.currentTarget.setPointerCapture(event.pointerId);
    const start = displayPointFor(item, bounds);
    drag.current = { pointerId: event.pointerId, clientX: event.clientX, clientY: event.clientY, startDisplayX: start.x, startDisplayY: start.y, latest: { roomId: item.roomId, position: { x: item.transform.position.x, z: item.transform.position.z } }, before: structuredClone(item) };
  };

  const pointerMove = (event: PointerEvent<HTMLButtonElement>) => {
    if (!drag.current || drag.current.pointerId !== event.pointerId) return;
    const floorPlan = event.currentTarget.closest('.floor-plan');
    if (!floorPlan) return;
    const floorPlanBounds = floorPlan.getBoundingClientRect();
    const placement = placementFromDisplayPoint(
      drag.current.startDisplayX + (event.clientX - drag.current.clientX) / floorPlanBounds.width,
      drag.current.startDisplayY + (event.clientY - drag.current.clientY) / floorPlanBounds.height,
      drag.current.latest.roomId,
      architecture,
      bounds,
    );
    const candidate = { ...item, roomId: placement.roomId };
    placement.position = clampObjectPosition(candidate, placement.position, bounds);
    if (onMove(item.id, placement)) drag.current.latest = placement;
  };

  const finishDrag = (event: PointerEvent<HTMLButtonElement>) => {
    if (!drag.current || drag.current.pointerId !== event.pointerId) return;
    const placement = drag.current.latest;
    const before = drag.current.before;
    drag.current = null;
    event.currentTarget.releasePointerCapture(event.pointerId);
    onCommitMove(item.id, placement, before);
  };

  const keyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    const distance = event.shiftKey ? 0.25 : 0.1;
    const delta = event.key === 'ArrowLeft' ? { x: -distance, z: 0 }
      : event.key === 'ArrowRight' ? { x: distance, z: 0 }
      : event.key === 'ArrowUp' ? { x: 0, z: -distance }
      : event.key === 'ArrowDown' ? { x: 0, z: distance }
      : null;
    if (!delta) return;
    event.preventDefault();
    const position = clampObjectPosition(item, { x: item.transform.position.x + delta.x, z: item.transform.position.z + delta.z }, bounds);
    const placement = { roomId: roomForPoint(architecture, { x: position.x, y: position.z }, item.roomId)?.id ?? item.roomId, position };
    if (onMove(item.id, placement)) onCommitMove(item.id, placement, structuredClone(item));
  };

  return (
    <button
      className={`plan-object draggable-object ${className} ${selected === item.id ? 'object-selected' : ''}`}
      style={planObjectStyle(item, bounds)}
      onPointerDown={pointerDown}
      onPointerMove={pointerMove}
      onPointerUp={finishDrag}
      onPointerCancel={finishDrag}
      onKeyDown={keyDown}
      aria-label={`${item.name}. Drag or use arrow keys to move. Use the edit toolbar to rotate or remove.`}
      title="Select and drag · Arrow keys for precise movement"
    >
      {children}
      <em className="object-height-label" style={{ transform: `rotate(${-item.transform.rotation.y}deg)` }}>
        H {item.dimensions.height.toFixed(2)} m
      </em>
    </button>
  );
}

const objectPresets: Array<AddObjectInput & { shortLabel: string }> = [
  { shortLabel: 'Queen bed', name: 'Queen bed', category: 'bed', roomId: 'bedroom', dimensions: { width: 1.52, depth: 2.03, height: 0.61 } },
  { shortLabel: 'Sofa', name: 'Sofa', category: 'sofa', roomId: 'living', dimensions: { width: 2.18, depth: 0.91, height: 0.84 } },
  { shortLabel: 'Desk', name: 'Desk', category: 'desk', roomId: 'living', dimensions: { width: 1.22, depth: 0.61, height: 0.76 } },
  { shortLabel: 'Dining table', name: 'Dining table', category: 'table', roomId: 'living', dimensions: { width: 1.22, depth: 0.91, height: 0.76 } },
  { shortLabel: 'Dresser', name: 'Dresser', category: 'storage', roomId: 'bedroom', dimensions: { width: 1.52, depth: 0.51, height: 0.84 } },
  { shortLabel: 'Chair', name: 'Accent chair', category: 'other', roomId: 'living', dimensions: { width: 0.76, depth: 0.81, height: 0.86 } },
  { shortLabel: 'Nightstand', name: 'Nightstand', category: 'storage', roomId: 'bedroom', dimensions: { width: 0.56, depth: 0.46, height: 0.61 } },
  { shortLabel: 'Bookcase', name: 'Bookcase', category: 'storage', roomId: 'living', dimensions: { width: 0.91, depth: 0.35, height: 1.83 } },
  { shortLabel: 'Coffee table', name: 'Coffee table', category: 'table', roomId: 'living', dimensions: { width: 1.07, depth: 0.61, height: 0.43 } },
];

function DimensionPreview({ name, dimensions }: { name: string; dimensions: SceneObject['dimensions'] }) {
  const previewWidth = Math.min(126, 42 + dimensions.width * 24);
  const previewHeight = Math.min(88, 20 + dimensions.height * 23);
  const previewDepth = Math.min(25, 5 + dimensions.depth * 7);

  return (
    <section className="dimension-preview" aria-label={`Live size preview for ${name}`}>
      <div className="dimension-preview-title"><span>LIVE SIZE PREVIEW</span><strong>{name}</strong></div>
      <div className="dimension-preview-stage">
        <span className="preview-height-guide" style={{ height: `${previewHeight}px` }}><b>H</b></span>
        <div
          className="dimension-preview-object"
          style={{
            width: `${previewWidth}px`,
            height: `${previewHeight}px`,
            boxShadow: `${previewDepth}px ${-Math.round(previewDepth / 2)}px 0 #aebdc0`,
          }}
        />
      </div>
      <div className="dimension-preview-values"><span>W {dimensions.width.toFixed(2)}</span><span>D {dimensions.depth.toFixed(2)}</span><span>H {dimensions.height.toFixed(2)} m</span></div>
    </section>
  );
}

function AddObjectPanel({ rooms, loading, onAdd, selectedObject, onResize, onCommitResize }: { rooms: RoomElement[]; loading: boolean; onAdd: (input: AddObjectInput) => Promise<string | null>; selectedObject?: SceneObject; onResize: (id: string, dimensions: SceneObject['dimensions']) => boolean; onCommitResize: (id: string, dimensions: SceneObject['dimensions'], before: SceneObject['dimensions']) => void }) {
  const [presetIndex, setPresetIndex] = useState(0);
  const [name, setName] = useState(objectPresets[0].name);
  const [roomId, setRoomId] = useState<RoomId>('living');
  const [dimensions, setDimensions] = useState(objectPresets[0].dimensions);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const resizeStart = useRef<SceneObject['dimensions'] | null>(null);

  const choosePreset = (index: number) => {
    const preset = objectPresets[index];
    setPresetIndex(index);
    setName(preset.name);
    setRoomId(rooms.some((room) => room.id === preset.roomId) ? preset.roomId : rooms[0]?.id ?? preset.roomId);
    setDimensions(preset.dimensions);
    setError('');
    setSuccess('');
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setError('');
    setSuccess('');
    const destinationRoomId = rooms.some((room) => room.id === roomId) ? roomId : rooms[0]?.id ?? roomId;
    const message = await onAdd({ name: name.trim(), category: objectPresets[presetIndex].category, roomId: destinationRoomId, dimensions });
    setSaving(false);
    if (message) setError(message);
    else setSuccess(`${name.trim()} placed in ${rooms.find((room) => room.id === destinationRoomId)?.name ?? 'the selected room'}.`);
  };

  const activeDimensions = selectedObject?.dimensions ?? dimensions;
  const setDimension = (key: keyof SceneObject['dimensions'], value: number) => {
    const next = { ...activeDimensions, [key]: Math.max(0.1, value || 0.1) };
    if (selectedObject) onResize(selectedObject.id, next);
    else setDimensions(next);
  };
  const commitDimension = (key: keyof SceneObject['dimensions'], value: number) => {
    if (selectedObject) {
      onCommitResize(selectedObject.id, { ...selectedObject.dimensions, [key]: value }, resizeStart.current ?? selectedObject.dimensions);
      resizeStart.current = null;
    }
  };

  return (
    <aside className="add-object-panel">
      <div className="add-object-heading"><span className="eyebrow">OBJECT LIBRARY</span><h2>Add object</h2><p>Choose an object, confirm its size, then place it into a room.</p></div>
      <form onSubmit={submit}>
        <fieldset><legend>OBJECT TYPE</legend><div className="preset-grid">{objectPresets.map((preset, index) => <button type="button" key={preset.shortLabel} className={presetIndex === index ? 'active' : ''} onClick={() => choosePreset(index)}><i className={`preset-icon preset-${preset.category}`} />{preset.shortLabel}</button>)}</div></fieldset>
        <label className="field-label">NAME<input required value={name} onChange={(event) => setName(event.target.value)} /></label>
        <label className="field-label">PLACE IN<select value={rooms.some((room) => room.id === roomId) ? roomId : rooms[0]?.id ?? ''} onChange={(event) => setRoomId(event.target.value)}>{rooms.map((room) => <option key={room.id} value={room.id}>{room.name}</option>)}</select></label>
        <DimensionPreview name={selectedObject?.name ?? name} dimensions={activeDimensions} />
        <fieldset className="rhs-dimension-sliders"><legend>{selectedObject ? `EDIT ${selectedObject.name.toUpperCase()} · METERS` : 'DIMENSIONS · METERS'}</legend>{(['width', 'depth', 'height'] as const).map((key) => <label key={key}><span>{key[0].toUpperCase()} · {key.toUpperCase()}</span><input type="range" min="0.1" max={key === 'height' ? 3 : 4} step="0.01" value={activeDimensions[key]} onPointerDown={() => { resizeStart.current = selectedObject ? { ...selectedObject.dimensions } : null; }} onKeyDown={() => { if (!resizeStart.current && selectedObject) resizeStart.current = { ...selectedObject.dimensions }; }} onChange={(event) => setDimension(key, Number(event.target.value))} onPointerUp={(event) => commitDimension(key, Number(event.currentTarget.value))} onKeyUp={(event) => commitDimension(key, Number(event.currentTarget.value))} /><output>{activeDimensions[key].toFixed(2)}</output></label>)}</fieldset>
        <button className="place-object" disabled={loading || saving || !name.trim()}>{saving ? 'Placing…' : loading ? 'Loading project…' : '＋ Place in room'}</button>
        {error && <p className="object-form-message error" role="alert">{error}</p>}
        {success && <p className="object-form-message success" role="status">✓ {success}</p>}
      </form>
      <div className="placement-note"><span>01</span><p>New objects are centered in the selected room and saved to the active layout.</p></div>
    </aside>
  );
}

function formatDimensions(dimensions: SceneObject['dimensions']) {
  return `${dimensions.width.toFixed(2)} × ${dimensions.depth.toFixed(2)} m`;
}

function PreviewControls({ hour, camera, shadows, lightPaths, measurements, onHour, onCamera, onReset, onShadows, onLightPaths, onMeasurements }: { hour: number; camera: number; shadows: boolean; lightPaths: boolean; measurements: boolean; onHour: (n: number) => void; onCamera: (n: number) => void; onReset: () => void; onShadows: (value: boolean) => void; onLightPaths: (value: boolean) => void; onMeasurements: (value: boolean) => void }) {
  return (
    <aside className="library-panel preview-controls">
      <div className="panel-heading"><div><span className="eyebrow">3D MODEL</span><h2>View controls</h2></div><span className="live-badge"><i /> LIVE</span></div>
      <div className="control-section"><label>CAMERA ANGLE <span>{camera > 0 ? '+' : ''}{camera * 12}°</span></label><div className="camera-pad"><button onClick={() => onCamera(Math.max(-2, camera - 1))} aria-label="Rotate camera left">↶</button><div className={`camera-orbit orbit-${camera}`}><i /><span /></div><button onClick={() => onCamera(Math.min(2, camera + 1))} aria-label="Rotate camera right">↷</button></div><button className="wide-control" onClick={() => { onCamera(0); onReset(); }}>Reset perspective</button></div>
      <div className="control-section daylight-control"><label>SUNLIGHT <span>{timeLabel(hour)}</span></label><div className="sun-readout"><span className="sun-icon">☀</span><div><strong>{hour < 12 ? 'Morning light' : hour < 16 ? 'Strong afternoon light' : 'Warm evening light'}</strong><small>East + south windows</small></div></div><input aria-label="Sunlight time" type="range" min="7" max="20" step="0.25" value={hour} onChange={(e) => onHour(Number(e.target.value))} /><div className="range-labels"><span>7 AM</span><span>NOON</span><span>8 PM</span></div></div>
      <div className="control-section"><label>DISPLAY</label><label className="toggle-row">Furniture shadows <input type="checkbox" checked={shadows} onChange={(event) => onShadows(event.target.checked)} /><i /></label><label className="toggle-row">Window light paths <input type="checkbox" checked={lightPaths} onChange={(event) => onLightPaths(event.target.checked)} /><i /></label><label className="toggle-row">Measurements <input type="checkbox" checked={measurements} onChange={(event) => onMeasurements(event.target.checked)} /><i /></label></div>
      <div className="sun-fact"><span>✦</span><div><strong>5.7 hrs useful daylight</strong><p>at the desk on a typical May day</p></div></div>
    </aside>
  );
}

function ThreeDView({ hour, camera, cameraReset, shadows, lightPaths, measurements, objects, architecture }: { hour: number; camera: number; cameraReset: number; shadows: boolean; lightPaths: boolean; measurements: boolean; objects: SceneObject[]; architecture: ArchitecturalElement[] }) {
  return (
    <section className="preview-workspace" aria-label="3D apartment preview">
      <div className="preview-topline"><div><span className="eyebrow">LIVING ROOM · EAST VIEW</span><strong>{timeLabel(hour)}</strong></div></div>
      <ApartmentScene hour={hour} cameraStep={camera} cameraReset={cameraReset} shadows={shadows} lightPaths={lightPaths} measurements={measurements} objects={objects} architecture={architecture} />
      <div className="light-meter"><span>DESK DAYLIGHT</span><strong>{Math.round(180 + Math.sin(((hour - 7) / 13) * Math.PI) * 520)} lux</strong><i /></div>
      <div className="sun-timeline"><div /><div className="timeline-track"><div className="daylight-band"><i style={{ left: `${((hour - 7) / 13) * 100}%` }} /></div><div className="time-ticks"><span>7 AM</span><span>10 AM</span><span>1 PM</span><span>4 PM</span><span>8 PM</span></div></div><div /></div>
    </section>
  );
}

function PriorityPanel() {
  const priorities = [['Natural light', 35], ['Work from home', 25], ['Furniture fit', 20], ['Open space', 15], ['Storage', 5]] as const;
  return (
    <aside className="library-panel priorities-panel">
      <div className="panel-heading"><div><span className="eyebrow">DECISION MODEL</span><h2>Your priorities</h2></div><button className="add-button" aria-label="Edit priorities">⌁</button></div>
      <p className="panel-intro">The score reflects what matters most to your daily life.</p>
      <div className="priority-list">{priorities.map(([name, value], index) => <div className="priority-row" key={name}><div><span>{index + 1}</span><strong>{name}</strong><b>{value}%</b></div><i><em style={{ width: `${value * 2.25}%` }} /></i></div>)}</div>
      <div className="control-section property-facts"><label>APARTMENT FACTS</label><dl><div><dt>Floor area</dt><dd>742 sq ft</dd></div><div><dt>Exposure</dt><dd>East · South</dd></div><div><dt>Windows</dt><dd>4 total</dd></div><div><dt>Closets</dt><dd>2 built-in</dd></div><div><dt>Rent</dt><dd>$3,850 / mo</dd></div></dl></div>
      <button className="wide-control export-button">Export evaluation</button>
    </aside>
  );
}

function EvaluationView() {
  return (
    <section className="evaluation-workspace">
      <div className="evaluation-scroll">
        <div className="evaluation-hero">
          <div><span className="eyebrow">APARTMENT FIT REPORT</span><h1>A strong fit for your life.</h1><p>The apartment works especially well for daylight-focused remote work and fits every piece you own.</p><div className="verdict-tag"><i /> RECOMMENDATION · TOUR AGAIN</div></div>
          <div className="overall-score"><div className="score-dial"><span><strong>84</strong><small>/ 100</small></span></div><b>STRONG MATCH</b><small>Top 18% of apartments reviewed</small></div>
        </div>
        <div className="score-grid">
          {scores.map((item) => <article className="score-card" key={item.label}><div className="score-card-top"><span>{item.label}</span><strong>{item.score}</strong></div><div className={`metric-track ${item.tone}`}><i style={{ width: `${item.score}%` }} /></div><small>{item.note}</small></article>)}
        </div>
        <div className="evaluation-columns">
          <div className="findings-column">
            <div className="section-title"><span>WHAT WORKS</span><b>3</b></div>
            <article className="finding positive"><i>01</i><div><strong>A real daylight work zone</strong><p>Your desk gets useful indirect light for 5.7 hours without screen glare. The main living path stays clear.</p><small>High impact · Natural light + WFH</small></div><span>↗</span></article>
            <article className="finding positive"><i>02</i><div><strong>Every essential piece fits</strong><p>The queen bed, sofa, desk, table, and dresser fit with no collisions and at least 3 feet of circulation.</p><small>High impact · Furniture fit</small></div><span>↗</span></article>
            <article className="finding positive"><i>03</i><div><strong>Separate work and rest zones</strong><p>The desk remains visually separate from the bedroom, supporting a healthier daily routine.</p><small>Medium impact · Livability</small></div><span>↗</span></article>
          </div>
          <div className="findings-column concerns">
            <div className="section-title"><span>WATCH OUT FOR</span><b>2</b></div>
            <article className="finding negative"><i>01</i><div><strong>Limited built-in storage</strong><p>Closet capacity is about 18% below your stated needs. A storage bed would close most of the gap.</p><small>Medium impact · Storage</small></div><span>↘</span></article>
            <article className="finding negative"><i>02</i><div><strong>Dining clearance is tight</strong><p>Pulling all four chairs out at once narrows the kitchen route to 28 inches.</p><small>Low impact · Open space</small></div><span>↘</span></article>
            <div className="confidence-card"><div><span>MODEL CONFIDENCE</span><strong>High · 94%</strong></div><p>Based on verified room and furniture dimensions, window orientation, and a May 12 sun path.</p></div>
          </div>
        </div>
      </div>
    </section>
  );
}

function ComparisonView({ onBack }: { onBack: () => void }) {
  const apartmentMetrics = [
    { name: 'Furniture fit', a: 92, b: 76 }, { name: 'Natural light', a: 88, b: 95 }, { name: 'Work from home', a: 86, b: 79 }, { name: 'Open space', a: 78, b: 89 }, { name: 'Storage', a: 69, b: 84 },
  ];
  return (
    <section className="comparison-workspace">
      <div className="comparison-heading"><button onClick={onBack}>← Back to evaluation</button><div><span className="eyebrow">APARTMENT COMPARISON</span><h1>Which one fits your life?</h1><p>Weighted for natural light, remote work, and the furniture you already own.</p></div><div className="priority-chip"><span>Top priority</span><strong>Natural light · 35%</strong></div></div>
      <div className="comparison-cards">
        <article className="apartment-card winner"><div className="winner-ribbon">BEST FIT FOR YOU</div><div className="apartment-card-head"><div><span>APARTMENT A</span><h2>197 Bedford Ave · 4B</h2><p>1 bed · 742 sq ft · $3,850/mo</p></div><div className="compare-score"><strong>84</strong><span>/100</span></div></div><MiniPlan variant="a" /><div className="apartment-verdict"><i>✦</i><p><strong>Best for focused work</strong><span>Better furniture fit and a stronger dedicated workspace.</span></p></div></article>
        <div className="versus"><span>VS</span></div>
        <article className="apartment-card"><div className="apartment-card-head"><div><span>APARTMENT B</span><h2>61 North 6th St · 2A</h2><p>1 bed · 805 sq ft · $4,050/mo</p></div><div className="compare-score"><strong>82</strong><span>/100</span></div></div><MiniPlan variant="b" /><div className="apartment-verdict alternate"><i>☀</i><p><strong>Best for all-day light</strong><span>Brighter overall with more storage, but a compromised desk zone.</span></p></div></article>
      </div>
      <div className="metrics-comparison">
        <div className="metrics-title"><span>SCORE BREAKDOWN</span><strong>A</strong><strong>B</strong></div>
        {apartmentMetrics.map((metric) => <div className="comparison-metric" key={metric.name}><span>{metric.name}</span><div className="dual-bar a"><i style={{ width: `${metric.a}%` }} /><b>{metric.a}</b></div><div className="dual-bar b"><i style={{ width: `${metric.b}%` }} /><b>{metric.b}</b></div><em>{metric.a > metric.b ? 'A' : 'B'}</em></div>)}
      </div>
      <div className="final-recommendation"><div className="recommend-mark">✦</div><div><span>DWELLWISE RECOMMENDS</span><h2>Choose Apartment A.</h2><p>It scores only 2 points higher overall, but its advantages align with your two most important priorities: a viable daylight desk position and fitting all existing furniture without compromise.</p></div><button>View Apartment A plan <b>→</b></button></div>
    </section>
  );
}

function MiniPlan({ variant }: { variant: 'a' | 'b' }) {
  return <div className={`mini-plan variant-${variant}`}><div className="mp-room one"><i /><b /></div><div className="mp-room two"><span /></div><div className="mp-room three"><i /></div><div className="mp-room four" /><span className="mp-window one" /><span className="mp-window two" /></div>;
}
