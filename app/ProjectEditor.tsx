'use client';

import { FormEvent, KeyboardEvent, PointerEvent, ReactNode, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { ArchitecturalElement, OpeningElement, Point2, RoomElement, SceneDocument, WallElement } from '@/lib/domain/scene';
import { getArchitectureBounds, isExteriorWall, isRectangularRoom, polygonArea, polygonCentroid, rebuildSceneRooms, resizeSceneFootprint, roomForPoint, wallLength } from '@/lib/domain/architecture';
import { blankApartmentScene } from '@/lib/domain/demo-scene';
import { getWindowExposureSummary, northAngleForPlanFacing, planFacingFromNorthAngle, type CardinalDirection } from '@/lib/domain/sunlight';
import ApartmentScene, { clearSavedApartmentCamera } from './ApartmentScene';
import { getFurnitureKind } from '@/lib/domain/furniture';
import { finishTargetsForScene, pruneMaterialOverrides, type FinishTarget } from '@/lib/domain/materials';
import { useWebMcpTools } from '@/app/hooks/use-webmcp-tools';
import { buildEditorTools, CURRENT_EDITOR_TOOL_NAMES, type AddFurnitureToolInput, type AddOpeningToolInput, type AddWallToolInput, type UpdateFurnitureToolInput, type UpdateOpeningToolInput, type UpdateWallToolInput } from '@/app/webmcp/editor-tools';
import { toolFailure, toolFailureFromMessage, toolSuccess } from '@/app/webmcp/result';
import { addExteriorCornerCommand, addOpeningCommand, addWallCommand, removeExteriorCornerCommand, removeOpeningCommand, removeWallCommand, renameRoomCommand, updateOpeningCommand, updateWallCommand, type ArchitectureCommandResult, type OpeningPatch, type WallPatch } from '@/lib/application/architecture-commands';
import DestructiveConfirmationDialog from '@/app/DestructiveConfirmationDialog';

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
  category: 'bed' | 'sofa' | 'desk' | 'table' | 'storage' | 'fixture' | 'other';
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

export default function ProjectEditor({ projectId }: { projectId: string }) {
  const router = useRouter();
  const [view, setView] = useState<View>('plan');
  const [editMode, setEditMode] = useState<EditMode>('furnish');
  const [compare, setCompare] = useState(false);
  const [selected, setSelected] = useState<string>('desk-1');
  const [hour, setHour] = useState(14.5);
  const [camera, setCamera] = useState(0);
  const [cameraReset, setCameraReset] = useState(0);
  const [showMeasurements, setShowMeasurements] = useState(false);
  const layout: LayoutKey = 'A';
  const [projectRevision, setProjectRevision] = useState<number | null>(null);
  const [project, setProject] = useState<ApiProject | null>(null);
  const [projectLoadError, setProjectLoadError] = useState('');
  const [sceneObjects, setSceneObjects] = useState<Record<LayoutKey, SceneObject[]>>({ A: [], B: [] });
  const [collisionMessage, setCollisionMessage] = useState('');
  const [architectureMessage, setArchitectureMessage] = useState('');
  const [selectedWallId, setSelectedWallId] = useState('');
  const [selectedOpeningId, setSelectedOpeningId] = useState('');
  const [selectedRoomId, setSelectedRoomId] = useState('');
  const [drawingWall, setDrawingWall] = useState(false);
  const [architecturePreview, setArchitecturePreview] = useState<ArchitecturalElement[] | null>(null);
  const [zoom, setZoom] = useState(90);
  const [historyState, setHistoryState] = useState({ undo: 0, redo: 0 });
  const [historyBusy, setHistoryBusy] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [pendingReset, setPendingReset] = useState<{ projectId: string; projectName: string; revision: number } | null>(null);
  const projectRevisionRef = useRef<number | null>(null);
  const projectRef = useRef<ApiProject | null>(null);
  const pendingObjectDimensions = useRef(new Map<string, SceneObject['dimensions']>());
  const moveSaveQueue = useRef<Promise<void>>(Promise.resolve());
  const undoStack = useRef<HistoryEntry[]>([]);
  const redoStack = useRef<HistoryEntry[]>([]);

  useEffect(() => {
    if (!pendingReset) return;
    const timeout = window.setTimeout(() => setPendingReset((current) => current === pendingReset ? null : current), 60_000);
    return () => window.clearTimeout(timeout);
  }, [pendingReset]);

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
        return [{ id: element.id, catalogItemId: element.catalogItemId, name: item.name, category: item.category, userAdded: item.metadata?.userAdded === true, roomId: element.roomId, dimensions: pendingObjectDimensions.current.get(element.id) ?? item.dimensions, transform: element.transform }];
      });
    };
    setProjectRevision(project.revision);
    projectRevisionRef.current = project.revision;
    projectRef.current = project;
    setProject(project);
    setPendingReset((current) => current && (current.projectId !== project.id || current.revision !== project.revision) ? null : current);
    setSceneObjects({ A: objectsFor('A'), B: objectsFor('B') });
  };

  useEffect(() => {
    fetch(`/api/projects/${encodeURIComponent(projectId)}`)
      .then(async (response) => {
        if (response.ok) return response.json();
        const result = await response.json().catch(() => ({})) as { error?: string };
        throw new Error(result.error ?? 'Could not load project');
      })
      .then((project: ApiProject) => syncProject(project))
      .catch((error: Error) => setProjectLoadError(error.message));
  }, [projectId]);

  const enqueueMutation = <T,>(mutation: () => Promise<T>) => {
    const operation = moveSaveQueue.current.then(mutation);
    moveSaveQueue.current = operation.then(() => undefined, () => undefined);
    return operation;
  };

  const saveScene = async (scene: SceneDocument, successMessage: string, options: { recordHistory?: boolean; signal?: AbortSignal } = {}) => {
    return enqueueMutation(async () => {
      const current = projectRef.current;
      const expectedRevision = projectRevisionRef.current;
      if (!current || expectedRevision === null) return 'The project is still loading.';
      const sceneToSave = pruneMaterialOverrides(scene);
      setArchitectureMessage('Saving architecture…');
      try {
        const response = await fetch(`/api/projects/${current.id}`, {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ name: current.name, scene: sceneToSave, expectedRevision }),
          signal: options.signal,
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
      } catch (error) {
        if (options.signal?.aborted || (error instanceof DOMException && error.name === 'AbortError')) throw error;
        const message = 'The architecture could not be saved. Check your connection and try again.';
        setArchitectureMessage(message);
        return message;
      }
    });
  };

  const updateMaterialFinish = async (targetKey: string, color: string | null, signal?: AbortSignal) => {
    await moveSaveQueue.current;
    const current = projectRef.current;
    if (!current) return 'The project is still loading.';
    if (!finishTargetsForScene(current.scene).some((target) => target.targetKey === targetKey)) return 'That finish target is no longer available. Refresh the finish target list and try again.';
    const materialOverrides = { ...(current.scene.materialOverrides ?? {}) };
    if (color === null) delete materialOverrides[targetKey];
    else materialOverrides[targetKey] = color;
    return saveScene({ ...current.scene, materialOverrides }, color === null ? 'Original finish restored.' : '3D finish updated.', { signal });
  };

  const resizeApartment = async (width: number, depth: number, height: number, signal?: AbortSignal) => {
    await moveSaveQueue.current;
    const current = projectRef.current;
    if (!current) return 'The project is still loading.';
    if (![width, depth].every((value) => Number.isFinite(value) && value >= 2 && value <= 30) || !Number.isFinite(height) || height < 1.8 || height > 6) {
      const message = 'Width and depth must be between 2 and 30 meters, and height between 1.8 and 6 meters.';
      setArchitectureMessage(message);
      return message;
    }
    const error = await saveScene(rebuildSceneRooms(resizeApartmentScene(current.scene, width, depth, height)), `Apartment resized to ${width.toFixed(2)} × ${depth.toFixed(2)} × ${height.toFixed(2)} m.`, { signal });
    if (!error) setArchitecturePreview(null);
    return error;
  };

  const updatePlanOrientation = async (direction: CardinalDirection) => {
    await moveSaveQueue.current;
    const current = projectRef.current;
    if (!current) return 'The project is still loading.';
    const northAngle = northAngleForPlanFacing(direction);
    if (current.scene.northAngle === northAngle) return null;
    const directionName = { N: 'north', E: 'east', S: 'south', W: 'west' }[direction];
    return saveScene({ ...current.scene, northAngle }, `Orientation set · top of plan faces ${directionName}.`);
  };

  const persistArchitectureCommand = async (result: ArchitectureCommandResult, signal?: AbortSignal) => {
    if (!result.ok) {
      setArchitectureMessage(result.message);
      return { error: result.message, result };
    }
    const error = await saveScene(result.scene, result.message, { signal });
    if (error) return { error, result };
    setArchitecturePreview(null);
    setDrawingWall(false);
    if (result.selection?.kind === 'room') {
      setSelectedRoomId(result.selection.entityId); setSelectedWallId(''); setSelectedOpeningId('');
    } else if (result.selection?.kind === 'wall') {
      setSelectedWallId(result.selection.entityId); setSelectedRoomId(''); setSelectedOpeningId('');
    } else if (result.selection?.kind === 'opening') {
      setSelectedOpeningId(result.selection.entityId); setSelectedWallId(result.selection.wallId ?? ''); setSelectedRoomId('');
    } else {
      setSelectedWallId(''); setSelectedOpeningId(''); setSelectedRoomId('');
    }
    return { error: null, result };
  };

  const currentScene = () => projectRef.current?.scene;
  const addWall = async (start: Point2, end: Point2, signal?: AbortSignal) => { await moveSaveQueue.current; return persistArchitectureCommand(currentScene() ? addWallCommand(currentScene() as SceneDocument, start, end) : { ok: false, code: 'NOT_FOUND', message: 'The project is still loading.' }, signal); };
  const updateWall = async (wallId: string, patch: WallPatch, signal?: AbortSignal) => { await moveSaveQueue.current; return persistArchitectureCommand(currentScene() ? updateWallCommand(currentScene() as SceneDocument, wallId, patch) : { ok: false, code: 'NOT_FOUND', message: 'The project is still loading.' }, signal); };
  const deleteWall = async (wallId: string, signal?: AbortSignal) => persistArchitectureCommand(currentScene() ? removeWallCommand(currentScene() as SceneDocument, wallId) : { ok: false, code: 'NOT_FOUND', message: 'The project is still loading.' }, signal);
  const addExteriorCorner = async (wallId: string, offsetMeters?: number, signal?: AbortSignal) => persistArchitectureCommand(currentScene() ? addExteriorCornerCommand(currentScene() as SceneDocument, wallId, offsetMeters) : { ok: false, code: 'NOT_FOUND', message: 'The project is still loading.' }, signal);
  const removeExteriorCorner = async (wallId: string, endpoint: WallEndpoint, signal?: AbortSignal) => persistArchitectureCommand(currentScene() ? removeExteriorCornerCommand(currentScene() as SceneDocument, wallId, endpoint) : { ok: false, code: 'NOT_FOUND', message: 'The project is still loading.' }, signal);
  const addOpening = async (input: Parameters<typeof addOpeningCommand>[1], signal?: AbortSignal) => { await moveSaveQueue.current; return persistArchitectureCommand(currentScene() ? addOpeningCommand(currentScene() as SceneDocument, input) : { ok: false, code: 'NOT_FOUND', message: 'The project is still loading.' }, signal); };
  const addDoor = async (wallId: string) => addOpening({ openingType: 'door', wallId });
  const addWindow = async (wallId: string) => addOpening({ openingType: 'window', wallId });
  const updateOpening = async (openingId: string, patch: OpeningPatch, signal?: AbortSignal) => { await moveSaveQueue.current; return persistArchitectureCommand(currentScene() ? updateOpeningCommand(currentScene() as SceneDocument, openingId, patch) : { ok: false, code: 'NOT_FOUND', message: 'The project is still loading.' }, signal); };
  const deleteOpening = async (openingId: string, signal?: AbortSignal) => persistArchitectureCommand(currentScene() ? removeOpeningCommand(currentScene() as SceneDocument, openingId) : { ok: false, code: 'NOT_FOUND', message: 'The project is still loading.' }, signal);
  const renameRoom = async (roomId: string, name: string, signal?: AbortSignal) => persistArchitectureCommand(currentScene() ? renameRoomCommand(currentScene() as SceneDocument, roomId, name) : { ok: false, code: 'NOT_FOUND', message: 'The project is still loading.' }, signal);

  const architectureToolResponse = async (operation: ReturnType<typeof persistArchitectureCommand>) => {
    const outcome = await operation;
    const current = projectRef.current;
    if (outcome.error) {
      if (!outcome.result.ok) return toolFailure(outcome.result.code, outcome.result.message, { currentRevision: current?.revision });
      return toolFailureFromMessage(outcome.error, current?.revision);
    }
    const result = outcome.result;
    if (!result.ok) return toolFailure(result.code, result.message, { currentRevision: current?.revision });
    return toolSuccess(result.message, {
      projectId: current?.id,
      revision: current?.revision,
      data: { ...result.data, selection: result.selection, reconciliation: result.reconciliation },
    });
  };

  const renameProject = async (name: string, signal?: AbortSignal): Promise<string | null> => {
    return enqueueMutation(async () => {
      const current = projectRef.current;
      const expectedRevision = projectRevisionRef.current;
      const trimmedName = name.trim();
      if (!current || expectedRevision === null) return 'The project is still loading.';
      if (!trimmedName || trimmedName.length > 80) return 'The apartment name must be between 1 and 80 characters.';
      if (trimmedName === current.name) return null;
      try {
        const response = await fetch(`/api/projects/${encodeURIComponent(current.id)}`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ name: trimmedName, expectedRevision }),
          signal,
        });
        const result = await response.json() as ApiProject & { error?: string; current?: ApiProject };
        if (!response.ok) {
          if (result.current) syncProject(result.current);
          return result.error ?? 'The apartment could not be renamed.';
        }
        syncProject(result);
        return null;
      } catch (error) {
        if (signal?.aborted || (error instanceof DOMException && error.name === 'AbortError')) throw error;
        return 'The apartment could not be renamed. Check your connection and try again.';
      }
    });
  };

  const selectView = (next: View) => {
    setCompare(false);
    if (next === 'three' && view !== 'three') {
      setCamera(0);
      setCameraReset((value) => value + 1);
    }
    setView(next);
  };

  const addObjectCommand = async (input: AddObjectInput, signal?: AbortSignal): Promise<{ error: string | null; objectId?: string }> => {
    return enqueueMutation(async () => {
      const current = projectRef.current;
      const expectedRevision = projectRevisionRef.current;
      if (!current || expectedRevision === null) return { error: 'The project is still loading. Try again in a moment.' };
      try {
        const response = await fetch(`/api/projects/${encodeURIComponent(current.id)}/objects`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ ...input, layoutId: `layout-${layout.toLowerCase()}`, expectedRevision }),
          signal,
        });
        const result = await response.json() as { error?: string; current?: ApiProject; project?: ApiProject; objectId?: string };
        if (!response.ok) {
          if (result.current) syncProject(result.current);
          return { error: result.error ?? 'The object could not be added.' };
        }
        if (result.project) {
          syncProject(result.project);
          recordSceneEdit(current.scene, result.project.scene);
        }
        if (result.objectId) setSelected(result.objectId);
        return { error: null, objectId: result.objectId };
      } catch (error) {
        if (signal?.aborted || (error instanceof DOMException && error.name === 'AbortError')) throw error;
        return { error: 'The object could not be added. Check your connection and try again.' };
      }
    });
  };

  const addObject = async (input: AddObjectInput): Promise<string | null> => (await addObjectCommand(input)).error;

  const moveObject = (objectId: string, placement: { position: { x: number; z: number }; roomId: RoomId }) => {
    const objects = sceneObjects[layout];
    const item = objects.find((candidate) => candidate.id === objectId);
    if (!item) return false;
    const candidate = { ...item, roomId: placement.roomId, transform: { ...item.transform, position: { ...item.transform.position, ...placement.position } } };
    const collision = findCollision(objects, candidate);
    setCollisionMessage(collision ? `${item.name} overlaps ${collision.name}.` : '');
    setSceneObjects((current) => ({
      ...current,
      [layout]: current[layout].map((item) => item.id === objectId
        ? candidate
        : item),
    }));
    return true;
  };

  const persistObjectUpdate = (objectId: string, transform: { position?: { x: number; z: number }; rotation?: { y: number }; dimensions?: SceneObject['dimensions']; roomId?: RoomId }, layoutOverride?: LayoutKey, signal?: AbortSignal, options?: { allowOverlap?: boolean }): Promise<string | null> => {
    const layoutAtMove = layoutOverride ?? layout;
    const allowOverlap = options?.allowOverlap === true;
    return enqueueMutation(async () => {
      const current = projectRef.current;
      const expectedRevision = projectRevisionRef.current;
      if (!current || expectedRevision === null) return 'The project is still loading. Try again in a moment.';
      try {
        const response = await fetch(`/api/projects/${encodeURIComponent(current.id)}/objects/${encodeURIComponent(objectId)}`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ layoutId: `layout-${layoutAtMove.toLowerCase()}`, expectedRevision, transform: { position: transform.position, rotation: transform.rotation }, dimensions: transform.dimensions, roomId: transform.roomId, allowOverlap }),
          signal,
        });
        const result = await response.json() as ApiProject & { error?: string; current?: ApiProject };
        if (response.ok) {
          if (transform.dimensions && JSON.stringify(pendingObjectDimensions.current.get(objectId)) === JSON.stringify(transform.dimensions)) pendingObjectDimensions.current.delete(objectId);
          syncProject(result);
          recordSceneEdit(current.scene, result.scene);
          if (!allowOverlap) setCollisionMessage('');
          return null;
        }
        if (transform.dimensions && JSON.stringify(pendingObjectDimensions.current.get(objectId)) === JSON.stringify(transform.dimensions)) pendingObjectDimensions.current.delete(objectId);
        if (result.current) syncProject(result.current);
        else syncProject(current);
        const message = result.error ?? 'The object change could not be saved.';
        setCollisionMessage(message);
        return message;
      } catch (error) {
        if (signal?.aborted || (error instanceof DOMException && error.name === 'AbortError')) throw error;
        const message = 'The object change could not be saved. Check your connection and try again.';
        if (transform.dimensions && JSON.stringify(pendingObjectDimensions.current.get(objectId)) === JSON.stringify(transform.dimensions)) pendingObjectDimensions.current.delete(objectId);
        syncProject(current);
        setCollisionMessage(message);
        return message;
      }
    });
  };

  const saveObjectTransform = (objectId: string, transform: { position?: { x: number; z: number }; rotation?: { y: number }; dimensions?: SceneObject['dimensions']; roomId?: RoomId }, options?: { allowOverlap?: boolean }) => {
    void persistObjectUpdate(objectId, transform, undefined, undefined, options).catch(() => undefined);
  };

  const applyHistoryScene = async (scene: SceneDocument, message: string, signal?: AbortSignal) => {
    const error = await saveScene(structuredClone(scene), message, { recordHistory: false, signal });
    if (error) return false;
    setSelected('');
    setSelectedWallId('');
    setSelectedOpeningId('');
    setSelectedRoomId('');
    setArchitecturePreview(null);
    setCollisionMessage('');
    return true;
  };

  const undo = async (signal?: AbortSignal) => {
    if (historyBusy) return false;
    setHistoryBusy(true);
    await moveSaveQueue.current;
    const edit = undoStack.current.at(-1);
    if (edit && await applyHistoryScene(edit.before, 'Undid last change.', signal)) {
      undoStack.current.pop();
      redoStack.current.push(edit);
      updateHistoryState();
      setHistoryBusy(false);
      return true;
    }
    setHistoryBusy(false);
    return false;
  };

  const redo = async (signal?: AbortSignal) => {
    if (historyBusy) return false;
    setHistoryBusy(true);
    await moveSaveQueue.current;
    const edit = redoStack.current.at(-1);
    if (edit && await applyHistoryScene(edit.after, 'Redid last change.', signal)) {
      redoStack.current.pop();
      undoStack.current.push(edit);
      updateHistoryState();
      setHistoryBusy(false);
      return true;
    }
    setHistoryBusy(false);
    return false;
  };

  const prepareResetProject = () => {
    const current = projectRef.current;
    if (!current || resetting) return;
    setPendingReset({ projectId: current.id, projectName: current.name, revision: current.revision });
  };

  const resetEverything = async () => {
    const confirmation = pendingReset;
    const current = projectRef.current;
    if (resetting || !confirmation || !current || confirmation.projectId !== current.id || confirmation.revision !== current.revision) {
      setPendingReset(null);
      return;
    }
    setPendingReset(null);
    setResetting(true);
    await moveSaveQueue.current;
    const error = await saveScene(structuredClone(blankApartmentScene), 'Everything reset · start again from the blank apartment.', { recordHistory: false });
    if (!error) {
      clearSavedApartmentCamera(current.id);
      undoStack.current = [];
      redoStack.current = [];
      updateHistoryState();
      setSelected('');
      setSelectedWallId('');
      setSelectedOpeningId('');
      setSelectedRoomId('');
      setDrawingWall(false);
      setArchitecturePreview(null);
      setCollisionMessage('');
      setCompare(false);
      setView('plan');
      setEditMode('architecture');
      setZoom(90);
      setHour(14.5);
      setCamera(0);
      setCameraReset((value) => value + 1);
      setShowMeasurements(false);
    }
    setResetting(false);
  };

  const commitMove = (objectId: string, placement: ObjectPlacement, before: SceneObject) => {
    void before;
    saveObjectTransform(objectId, { position: placement.position, roomId: placement.roomId }, { allowOverlap: true });
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

  const removeObjectCommand = async (objectId: string, signal?: AbortSignal): Promise<string | null> => {
    return enqueueMutation(async () => {
      const current = projectRef.current;
      const expectedRevision = projectRevisionRef.current;
      if (!current || expectedRevision === null) return 'The project is still loading. Try again in a moment.';
      try {
        const response = await fetch(`/api/projects/${encodeURIComponent(current.id)}/objects/${encodeURIComponent(objectId)}`, {
          method: 'DELETE',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ layoutId: `layout-${layout.toLowerCase()}`, expectedRevision }),
          signal,
        });
        const result = await response.json() as ApiProject & { error?: string; current?: ApiProject };
        if (response.ok) {
          syncProject(result);
          recordSceneEdit(current.scene, result.scene);
          setSelected('');
          setCollisionMessage('');
          return null;
        }
        if (result.current) syncProject(result.current);
        const message = result.error ?? 'The object could not be removed.';
        setCollisionMessage(message);
        return message;
      } catch (error) {
        if (signal?.aborted || (error instanceof DOMException && error.name === 'AbortError')) throw error;
        const message = 'The object could not be removed. Check your connection and try again.';
        setCollisionMessage(message);
        return message;
      }
    });
  };

  const removeObject = async (objectId: string) => { await removeObjectCommand(objectId); };

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
    pendingObjectDimensions.current.set(objectId, dimensions);
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
  const previewOpening = (openingId: string, patch: Partial<Pick<OpeningElement, 'offset' | 'width' | 'height' | 'sillHeight' | 'swing' | 'swingSide'>>) => {
    const current = projectRef.current;
    if (!current) return;
    setArchitecturePreview(current.scene.architecture.map((element) => element.kind === 'opening' && element.id === openingId ? { ...element, ...patch } : element));
  };
  const selectWall = (id: string) => { setArchitecturePreview(null); setSelectedWallId(id); setSelectedOpeningId(''); setSelectedRoomId(''); setDrawingWall(false); };
  const selectOpening = (id: string, wallId: string) => { setArchitecturePreview(null); setSelectedOpeningId(id); setSelectedWallId(wallId); setSelectedRoomId(''); setDrawingWall(false); };
  const selectRoom = (id: string) => { setArchitecturePreview(null); setSelectedRoomId(id); setSelectedWallId(''); setSelectedOpeningId(''); setDrawingWall(false); };

  // WebMCP callbacks run after render and intentionally read the latest saved project refs.
  /* eslint-disable react-hooks/refs */
  useWebMcpTools(buildEditorTools({
    getSnapshot: () => {
      const current = projectRef.current;
      if (!current) return null;
      return {
        project: current,
        objects: sceneObjects[layout],
        view,
        editMode,
        hour,
        camera,
        measurements: showMeasurements,
        zoom,
        selection: selectedOpeningId
          ? { kind: 'opening' as const, entityId: selectedOpeningId }
          : selectedRoomId
            ? { kind: 'room' as const, entityId: selectedRoomId }
            : selectedWallId
              ? { kind: 'wall' as const, entityId: selectedWallId }
              : sceneObjects[layout].some((item) => item.id === selected)
                ? { kind: 'furniture' as const, entityId: selected }
                : null,
        canUndo: !historyBusy && historyState.undo > 0,
        canRedo: !historyBusy && historyState.redo > 0,
        architecturePreviewActive: architecturePreview !== null,
        confirmationActive: pendingReset !== null,
        availableTools: [...CURRENT_EDITOR_TOOL_NAMES],
      };
    },
    renameProject: async (requestedProjectId, name, signal) => {
      const before = projectRef.current;
      if (requestedProjectId && before?.id !== requestedProjectId) return toolFailure('NOT_FOUND', 'That apartment is not the active editor project.', { currentRevision: before?.revision });
      const error = await renameProject(name, signal);
      const current = projectRef.current;
      if (error) return toolFailureFromMessage(error, current?.revision);
      return toolSuccess(`Renamed the apartment to “${name.slice(0, 80)}”.`, { projectId: current?.id, revision: current?.revision });
    },
    addFurniture: async (input: AddFurnitureToolInput, signal) => {
      const current = projectRef.current;
      if (!current) return toolFailure('NOT_READY', 'The project is still loading.', { retryable: true });
      const room = current.scene.architecture.find((element): element is RoomElement => element.kind === 'room' && element.id === input.roomId);
      if (!room) return toolFailure('NOT_FOUND', 'The requested room was not found.', { currentRevision: current.revision });
      const result = await addObjectCommand(input, signal);
      const updated = projectRef.current;
      if (result.error) return toolFailureFromMessage(result.error, updated?.revision);
      return toolSuccess(`${input.name.slice(0, 80)} was added to ${room.name.slice(0, 80)}.`, {
        projectId: updated?.id,
        revision: updated?.revision,
        data: { furnitureId: result.objectId },
      });
    },
    updateFurniture: async (input: UpdateFurnitureToolInput, signal) => {
      const current = projectRef.current;
      if (!current) return toolFailure('NOT_READY', 'The project is still loading.', { retryable: true });
      const objects = sceneObjects[layout];
      const item = objects.find((candidate) => candidate.id === input.furnitureId);
      if (!item) return toolFailure('NOT_FOUND', 'The requested furniture item was not found in the active layout.', { currentRevision: current.revision });
      const roomsById = new Map(current.scene.architecture.filter((element): element is RoomElement => element.kind === 'room').map((room) => [room.id, room]));
      const destination = input.roomId ? roomsById.get(input.roomId) : undefined;
      if (input.roomId && !destination) return toolFailure('NOT_FOUND', 'The destination room was not found.', { currentRevision: current.revision });
      const center = destination && !input.position ? polygonCentroid(destination.boundary) : null;
      const requestedPosition = input.position ?? (center ? { x: center.x, z: center.y } : { x: item.transform.position.x, z: item.transform.position.z });
      const dimensions = input.dimensions ?? item.dimensions;
      const rotationY = input.rotationY === undefined ? item.transform.rotation.y : ((input.rotationY % 360) + 360) % 360;
      const roomId = input.roomId ?? roomForPoint(current.scene.architecture, { x: requestedPosition.x, y: requestedPosition.z }, item.roomId)?.id ?? item.roomId;
      const candidate: SceneObject = {
        ...item,
        roomId,
        dimensions,
        transform: {
          ...item.transform,
          position: { ...item.transform.position, x: requestedPosition.x, z: requestedPosition.z },
          rotation: { ...item.transform.rotation, y: rotationY },
        },
      };
      const clamped = clampObjectPosition(candidate, requestedPosition, getArchitectureBounds(current.scene.architecture));
      if (Math.hypot(clamped.x - requestedPosition.x, clamped.z - requestedPosition.z) > 0.001) {
        return toolFailure('VALIDATION_FAILED', 'That position would place part of the furniture outside the apartment.', { retryable: true, currentRevision: current.revision });
      }
      const collision = findCollision(objects, candidate);
      if (collision) return toolFailure('COLLISION', `${item.name.slice(0, 80)} overlaps ${collision.name.slice(0, 80)}.`, { retryable: true, currentRevision: current.revision });
      const error = await persistObjectUpdate(item.id, { position: requestedPosition, rotation: { y: rotationY }, dimensions, roomId }, layout, signal);
      const updated = projectRef.current;
      if (error) return toolFailureFromMessage(error, updated?.revision);
      setSelected(item.id);
      return toolSuccess(`${item.name.slice(0, 80)} was updated.`, { projectId: updated?.id, revision: updated?.revision, data: { furnitureId: item.id } });
    },
    updateFinish: async (target: FinishTarget, color, signal) => {
      const error = await updateMaterialFinish(target.targetKey, color, signal);
      const current = projectRef.current;
      if (error) return toolFailureFromMessage(error, current?.revision);
      return toolSuccess(color === null ? 'The original 3D finish was restored.' : 'The 3D finish was refined and saved.', { projectId: current?.id, revision: current?.revision, data: { target, operation: color === null ? 'reset' : 'apply', effectiveColor: color ?? target.defaultColor, overridden: color !== null } });
    },
    removeFurniture: async (furnitureId, signal) => {
      const current = projectRef.current;
      if (!current) return toolFailure('NOT_READY', 'The project is still loading.', { retryable: true });
      const item = sceneObjects[layout].find((candidate) => candidate.id === furnitureId);
      if (!item) return toolFailure('NOT_FOUND', 'The requested furniture item was not found in the active layout.', { currentRevision: current.revision });
      const error = await removeObjectCommand(furnitureId, signal);
      const updated = projectRef.current;
      if (error) return toolFailureFromMessage(error, updated?.revision);
      return toolSuccess(`${item.name.slice(0, 80)} was removed.`, { projectId: updated?.id, revision: updated?.revision, data: { furnitureId } });
    },
    resizeApartment: async (width, depth, height, signal) => {
      const error = await resizeApartment(width, depth, height, signal);
      const current = projectRef.current;
      if (error) return toolFailureFromMessage(error, current?.revision);
      return toolSuccess(`Apartment resized to ${width.toFixed(2)} × ${depth.toFixed(2)} × ${height.toFixed(2)} meters.`, { projectId: current?.id, revision: current?.revision });
    },
    renameRoom: (roomId, name, signal) => architectureToolResponse(renameRoom(roomId, name, signal)),
    addWall: (input: AddWallToolInput, signal) => architectureToolResponse(persistArchitectureCommand(currentScene() ? addWallCommand(currentScene() as SceneDocument, input.start, input.end, { thickness: input.thickness, height: input.height }) : { ok: false, code: 'NOT_FOUND', message: 'The project is still loading.' }, signal)),
    updateWall: (input: UpdateWallToolInput, signal) => architectureToolResponse(updateWall(input.wallId, { start: input.start, end: input.end, length: input.length, thickness: input.thickness, height: input.height }, signal)),
    removeWall: (wallId, signal) => architectureToolResponse(deleteWall(wallId, signal)),
    addExteriorCorner: (wallId, offsetMeters, signal) => architectureToolResponse(addExteriorCorner(wallId, offsetMeters, signal)),
    removeExteriorCorner: (wallId, endpoint, signal) => architectureToolResponse(removeExteriorCorner(wallId, endpoint, signal)),
    addOpening: (input: AddOpeningToolInput, signal) => architectureToolResponse(addOpening(input, signal)),
    updateOpening: (input: UpdateOpeningToolInput, signal) => architectureToolResponse(updateOpening(input.openingId, { offset: input.offset, width: input.width, height: input.height, sillHeight: input.sillHeight, swing: input.swing, swingSide: input.swingSide }, signal)),
    removeOpening: (openingId, signal) => architectureToolResponse(deleteOpening(openingId, signal)),
    setEditorView: (nextView, nextEditMode) => {
      setArchitecturePreview(null);
      if (nextEditMode) setEditMode(nextEditMode);
      selectView(nextView);
      return toolSuccess(`The current page now shows the ${nextView === 'three' ? '3D preview' : nextView} view. This view change was not saved.`, { projectId: projectRef.current?.id, revision: projectRef.current?.revision, data: { saved: false, view: nextView, editMode: nextEditMode ?? editMode } });
    },
    setSunlightPreview: (nextHour, nextCamera, measurements) => {
      selectView('three');
      if (nextHour !== undefined) setHour(nextHour);
      if (nextCamera !== undefined) setCamera(nextCamera);
      if (measurements !== undefined) setShowMeasurements(measurements);
      return toolSuccess('The current 3D visual sunlight preview was updated. This preview state was not saved.', { projectId: projectRef.current?.id, revision: projectRef.current?.revision, data: { saved: false, hour: nextHour ?? hour, camera: nextCamera ?? camera, measurements: measurements ?? showMeasurements } });
    },
    selectEntity: (kind, entityId) => {
      const current = projectRef.current;
      if (!current) return toolFailure('NOT_READY', 'The project is still loading.', { retryable: true });
      if (kind === 'furniture') {
        if (!sceneObjects[layout].some((item) => item.id === entityId)) return toolFailure('NOT_FOUND', 'That furniture item was not found.', { currentRevision: current.revision });
        setArchitecturePreview(null);
        setEditMode('furnish');
        selectView('plan');
        setSelected(entityId);
        setSelectedWallId('');
        setSelectedOpeningId('');
        setSelectedRoomId('');
      } else {
        const element = current.scene.architecture.find((candidate) => candidate.id === entityId && candidate.kind === kind);
        if (!element) return toolFailure('NOT_FOUND', `That ${kind} was not found.`, { currentRevision: current.revision });
        setEditMode('architecture');
        selectView('plan');
        if (element.kind === 'room') selectRoom(element.id);
        else if (element.kind === 'wall') selectWall(element.id);
        else selectOpening(element.id, element.wallId);
      }
      return toolSuccess(`Selected ${kind} ${entityId.slice(0, 128)} for inspection. This selection was not saved.`, { projectId: current.id, revision: current.revision, data: { saved: false, kind, entityId } });
    },
    undo: async (signal) => {
      const changed = await undo(signal);
      const current = projectRef.current;
      if (!changed) return toolFailure('NO_HISTORY', 'There is no available change to undo.', { currentRevision: current?.revision });
      return toolSuccess('Undid the latest editor change.', { projectId: current?.id, revision: current?.revision, data: { canUndo: undoStack.current.length > 0, canRedo: redoStack.current.length > 0 } });
    },
    redo: async (signal) => {
      const changed = await redo(signal);
      const current = projectRef.current;
      if (!changed) return toolFailure('NO_HISTORY', 'There is no available change to redo.', { currentRevision: current?.revision });
      return toolSuccess('Redid the latest editor change.', { projectId: current?.id, revision: current?.revision, data: { canUndo: undoStack.current.length > 0, canRedo: redoStack.current.length > 0 } });
    },
    setPlanZoom: (nextZoom) => {
      setArchitecturePreview(null);
      setCompare(false);
      setView('plan');
      setZoom(nextZoom);
      return toolSuccess(`Plan zoom is now ${nextZoom}%. This view change was not saved.`, { projectId: projectRef.current?.id, revision: projectRef.current?.revision, data: { saved: false, zoom: nextZoom } });
    },
    reset3dCamera: () => {
      setArchitecturePreview(null);
      selectView('three');
      setCamera(0);
      setCameraReset((value) => value + 1);
      return toolSuccess('The 3D camera perspective was reset. This view change was not saved.', { projectId: projectRef.current?.id, revision: projectRef.current?.revision, data: { saved: false, camera: 0 } });
    },
    goToDashboard: () => {
      setPendingReset(null);
      router.push('/');
      return toolSuccess('Opening the Dwellwise apartment dashboard.', { projectId: projectRef.current?.id, revision: projectRef.current?.revision, data: { saved: false } });
    },
    prepareResetProject: () => {
      const current = projectRef.current;
      if (!current) return toolFailure('NOT_READY', 'The project is still loading.', { retryable: true });
      prepareResetProject();
      return toolFailure('CONFIRMATION_REQUIRED', 'Review the visible reset confirmation in Dwellwise. Only a human can complete this action.', {
        currentRevision: current.revision,
        data: { saved: false, targetType: 'project', targetId: current.id, targetRevision: current.revision },
      });
    },
  }), Boolean(project));
  /* eslint-enable react-hooks/refs */

  const architectureSuccess = /^(Saving architecture|Wall added|Wall updated|Wall removed|Exterior shape updated|Exterior corner added|Exterior corner removed|Door added|Door updated|Door removed|Window added|Window updated|Window removed|Room renamed|Apartment resized|Orientation set|Everything reset)/.test(architectureMessage) && !architectureMessage.includes('outside the footprint');

  if (projectLoadError) {
    return (
      <main className="project-unavailable">
        <Link className="brand-lockup brand-home-link" href="/" aria-label="Dwellwise home"><div className="brand-mark" aria-hidden="true"><span /></div><div className="brand-name">Dwellwise</div></Link>
        <section><span>PROJECT UNAVAILABLE</span><h1>This apartment could not be opened.</h1><p>It may have been deleted, or it may belong to a different browser.</p><Link href="/">← Return to your apartments</Link></section>
      </main>
    );
  }

  if (!project) {
    return <main className="project-loading"><Link className="brand-lockup brand-home-link" href="/" aria-label="Dwellwise home"><div className="brand-mark" aria-hidden="true"><span /></div><div className="brand-name">Dwellwise</div></Link><p>Loading apartment…</p></main>;
  }

  return (
    <main className="app-shell">
      <Header key={project.id} projectName={project.name} onRename={renameProject} resetting={resetting} onReset={prepareResetProject} />
      <ModeBar view={view} compare={compare} editMode={editMode} zoom={zoom} canUndo={!historyBusy && historyState.undo > 0} canRedo={!historyBusy && historyState.redo > 0} onUndo={undo} onRedo={redo} onZoom={setZoom} onView={selectView} onEditMode={(mode) => { setArchitecturePreview(null); setSelected(''); setEditMode(mode); }} />
      <div className={`workspace-grid ${compare ? 'is-comparing' : ''} ${view === 'plan' && !compare ? 'plan-builder-grid' : ''}`}>
        {compare ? (
          <ComparisonView onBack={() => setCompare(false)} />
        ) : (
          <>
            {view === 'plan' && editMode === 'furnish' && <FurniturePanel selected={selected} onSelect={setSelected} objects={sceneObjects[layout]} />}
            {view === 'plan' && editMode === 'architecture' && <ArchitecturePanel architecture={displayedArchitecture} selectedWallId={selectedWallId} selectedRoomId={selectedRoomId} onSelectWall={selectWall} onSelectRoom={selectRoom} onRenameRoom={renameRoom} />}
            {view === 'three' && <PreviewControls hour={hour} northAngle={project.scene.northAngle} architecture={displayedArchitecture} measurements={showMeasurements} onHour={setHour} onReset={() => { setCamera(0); setCameraReset((value) => value + 1); }} onMeasurements={setShowMeasurements} />}
            {view === 'evaluation' && <PriorityPanel />}
            {view === 'plan' && <PlanView northAngle={project.scene.northAngle} onOrientation={updatePlanOrientation} editMode={editMode} architecture={displayedArchitecture} selectedWallId={selectedWallId} selectedOpeningId={selectedOpeningId} selectedRoomId={selectedRoomId} drawingWall={drawingWall} selected={selected} onSelect={setSelected} onDeselect={() => setSelected('')} onSelectWall={selectWall} onSelectOpening={selectOpening} onSelectRoom={selectRoom} layout={layout} zoom={zoom} objects={sceneObjects[layout]} collisionMessage={editMode === 'architecture' ? architectureMessage : collisionMessage} statusError={editMode === 'architecture' ? Boolean(architectureMessage) && !architectureSuccess : Boolean(collisionMessage)} onMove={moveObject} onCommitMove={commitMove} onRotate={rotateObject} onDelete={removeObject} onAddWall={addWall} onUpdateWall={updateWall} onUpdateOpening={updateOpening} />}
            {view === 'three' && <ThreeDView projectId={project.id} hour={hour} northAngle={project.scene.northAngle} camera={camera} cameraReset={cameraReset} measurements={showMeasurements} objects={sceneObjects[layout]} architecture={displayedArchitecture} materialOverrides={project.scene.materialOverrides ?? {}} onMaterialChange={updateMaterialFinish} />}
            {view === 'evaluation' && <EvaluationView />}
          </>
        )}
        {view === 'plan' && !compare && editMode === 'furnish' && <AddObjectPanel rooms={rooms} loading={projectRevision === null} onAdd={addObject} selectedObject={sceneObjects[layout].find((item) => item.id === selected)} onDeselect={() => setSelected('')} onResize={resizeObject} onCommitResize={saveObjectDimensions} />}
        {view === 'plan' && !compare && editMode === 'architecture' && <ArchitecturePropertiesPanel key={`${selectedOpening?.id ?? selectedWall?.id ?? 'apartment'}-${projectRevision}`} architecture={architecture} selectedWall={selectedWall} selectedOpening={selectedOpening} drawingWall={drawingWall} loading={projectRevision === null} onDrawingWall={(drawing) => { setArchitecturePreview(null); setDrawingWall(drawing); if (drawing) { setSelectedWallId(''); setSelectedOpeningId(''); setSelectedRoomId(''); } }} onPreviewApartment={previewApartment} onPreviewWall={previewWall} onPreviewOpening={previewOpening} onResizeApartment={resizeApartment} onUpdateWall={updateWall} onDeleteWall={deleteWall} onAddExteriorCorner={addExteriorCorner} onRemoveExteriorCorner={removeExteriorCorner} onAddDoor={addDoor} onAddWindow={addWindow} onUpdateOpening={updateOpening} onDeleteOpening={deleteOpening} onCloseOpening={() => { setArchitecturePreview(null); setSelectedOpeningId(''); }} />}
      </div>
      {pendingReset && <DestructiveConfirmationDialog kind="reset" projectName={pendingReset.projectName} busy={resetting} onCancel={() => setPendingReset(null)} onConfirm={() => void resetEverything()} />}
    </main>
  );
}

function Header({ projectName, onRename, resetting, onReset }: { projectName: string; onRename: (name: string) => Promise<string | null>; resetting: boolean; onReset: () => void }) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(projectName);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const trimmedName = name.trim();
    if (!trimmedName || trimmedName === projectName) {
      setEditing(false);
      setName(projectName);
      return;
    }
    setSaving(true);
    setError('');
    const renameError = await onRename(trimmedName);
    setSaving(false);
    if (renameError) {
      setError(renameError);
      return;
    }
    setEditing(false);
  };

  return (
    <header className="topbar">
      <Link className="brand-lockup brand-home-link" href="/" aria-label="Dwellwise home"><div className="brand-mark" aria-hidden="true"><span /></div><div className="brand-name">Dwellwise</div></Link>
      <div className="project-title">
        <Link className="icon-button back" href="/" aria-label="Back to apartments">←</Link>
        {editing ? (
          <form className="editor-project-rename" onSubmit={submit}>
            <input autoFocus aria-label="Apartment name" maxLength={80} value={name} onChange={(event) => setName(event.target.value)} onKeyDown={(event) => { if (event.key === 'Escape') { setEditing(false); setName(projectName); setError(''); } }} />
            <button disabled={saving || !name.trim()}>{saving ? 'Saving…' : 'Save'}</button>
            <button type="button" onClick={() => { setEditing(false); setName(projectName); setError(''); }}>Cancel</button>
            {error && <span role="alert">{error}</span>}
          </form>
        ) : (
          <div className="editor-project-heading"><div><div className="project-name">{projectName}</div><div className="project-meta">Saved in this browser</div></div><button className="project-rename-trigger" onClick={() => setEditing(true)} aria-label="Rename apartment">Rename</button></div>
        )}
      </div>
      <div className="top-actions">
        <span className="saved"><i /> Saved just now</span>
        <button className="reset-everything-button" onClick={onReset} disabled={resetting}>{resetting ? 'Resetting…' : '↺ Reset everything'}</button>
        {/* Comparison is temporarily hidden while the hackathon demo focuses on 2D, 3D, and sunlight. */}
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
        <div className="plan-tools"><button aria-label="Undo last change" onClick={() => { void onUndo(); }} disabled={!canUndo}>↶</button><button aria-label="Redo last change" onClick={() => { void onRedo(); }} disabled={!canRedo}>↷</button><div className="zoom-tools"><button aria-label="Zoom out" onClick={() => onZoom(Math.max(50, zoom - 5))} disabled={zoom <= 50}>−</button><strong>{zoom}%</strong><button aria-label="Zoom in" onClick={() => onZoom(Math.min(120, zoom + 5))} disabled={zoom >= 120}>+</button></div></div>
      ) : view === 'three' ? (
        <div className="three-mode-tools">
          <span>ORIENTATION-AWARE VISUAL PREVIEW</span>
          <div className="three-history-tools" role="group" aria-label="3D edit history">
            <button aria-label="Undo last change" onClick={() => { void onUndo(); }} disabled={!canUndo}>↶</button>
            <button aria-label="Redo last change" onClick={() => { void onRedo(); }} disabled={!canRedo}>↷</button>
          </div>
        </div>
      ) : (
        <div className="view-context">WEIGHTED TO YOUR PRIORITIES</div>
      )}
    </section>
  );
}

function ArchitecturePanel({ architecture, selectedWallId, selectedRoomId, onSelectWall, onSelectRoom, onRenameRoom }: { architecture: ArchitecturalElement[]; selectedWallId: string; selectedRoomId: string; onSelectWall: (id: string) => void; onSelectRoom: (id: string) => void; onRenameRoom: (id: string, name: string) => Promise<unknown> }) {
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

function RoomNameEditor({ room, edgeLengths, onRenameRoom }: { room: RoomElement; edgeLengths: number[]; onRenameRoom: (id: string, name: string) => Promise<unknown> }) {
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

function ArchitecturePropertiesPanel({ architecture, selectedWall, selectedOpening, drawingWall, loading, onDrawingWall, onPreviewApartment, onPreviewWall, onPreviewOpening, onResizeApartment, onUpdateWall, onDeleteWall, onAddExteriorCorner, onRemoveExteriorCorner, onAddDoor, onAddWindow, onUpdateOpening, onDeleteOpening, onCloseOpening }: { architecture: ArchitecturalElement[]; selectedWall?: WallElement; selectedOpening?: OpeningElement; drawingWall: boolean; loading: boolean; onDrawingWall: (drawing: boolean) => void; onPreviewApartment: (width: number, depth: number, height: number) => void; onPreviewWall: (id: string, patch: Partial<Pick<WallElement, 'start' | 'end' | 'thickness' | 'height'>>) => void; onPreviewOpening: (id: string, patch: Partial<Pick<OpeningElement, 'offset' | 'width' | 'height' | 'sillHeight' | 'swing' | 'swingSide'>>) => void; onResizeApartment: (width: number, depth: number, height: number) => Promise<string | null>; onUpdateWall: (id: string, patch: Partial<Pick<WallElement, 'start' | 'end' | 'thickness' | 'height'>>) => Promise<unknown>; onDeleteWall: (id: string) => Promise<unknown>; onAddExteriorCorner: (id: string) => Promise<unknown>; onRemoveExteriorCorner: (id: string, endpoint: WallEndpoint) => Promise<unknown>; onAddDoor: (wallId: string) => Promise<unknown>; onAddWindow: (wallId: string) => Promise<unknown>; onUpdateOpening: (id: string, patch: Partial<Pick<OpeningElement, 'offset' | 'width' | 'height' | 'sillHeight' | 'swing' | 'swingSide'>>) => Promise<unknown>; onDeleteOpening: (id: string) => Promise<unknown>; onCloseOpening: () => void }) {
  const bounds = getArchitectureBounds(architecture);
  const walls = architecture.filter((element): element is WallElement => element.kind === 'wall');
  const [width, setWidth] = useState(bounds.width);
  const [depth, setDepth] = useState(bounds.depth);
  const [height, setHeight] = useState(() => walls[0]?.height ?? 2.74);
  const [saving, setSaving] = useState(false);
  const [wallValues, setWallValues] = useState(() => selectedWall ? { length: wallLength(selectedWall), thickness: selectedWall.thickness, height: selectedWall.height } : { length: 0, thickness: 0.12, height: 2.74 });
  const [openingValues, setOpeningValues] = useState(() => selectedOpening ? { offset: selectedOpening.offset, width: selectedOpening.width, height: selectedOpening.height, sillHeight: selectedOpening.sillHeight, swing: selectedOpening.swing ?? 'left', swingSide: selectedOpening.swingSide ?? 'in' } : { offset: 0, width: 0.91, height: 2.03, sillHeight: 0, swing: 'left' as const, swingSide: 'in' as const });
  const selectedWindow = selectedOpening?.openingType === 'window';
  const exterior = selectedWall ? isExteriorWall(selectedWall, bounds, architecture) : false;
  const openingClearance = 0;
  const selectedWallLength = selectedWall ? wallLength(selectedWall) : 0;
  const openingHeightMinimum = selectedWindow ? 0.3 : 1.8;
  // Slider tracks stay stable when a related opening dimension changes. The
  // change handlers enforce the real geometric limit without moving siblings.
  const positionSliderMaximum = Math.max(openingClearance, selectedWallLength - openingClearance);
  const positionValueMaximum = Math.max(openingClearance, selectedWallLength - openingValues.width - openingClearance);
  const openingWidthMaximum = selectedWindow ? 30 : 3;
  const widthSliderMaximum = Math.max(0.5, Math.min(openingWidthMaximum, selectedWallLength - openingClearance * 2));
  const widthValueMaximum = Math.max(0.5, Math.min(widthSliderMaximum, selectedWallLength - openingValues.offset - openingClearance));
  const heightSliderMaximum = Math.max(openingHeightMinimum, selectedWall?.height ?? openingHeightMinimum);
  const heightValueMaximum = Math.max(openingHeightMinimum, (selectedWall?.height ?? openingHeightMinimum) - openingValues.sillHeight);
  const sillSliderMaximum = Math.max(0, selectedWall?.height ?? 0);
  const sillValueMaximum = Math.max(0, (selectedWall?.height ?? 0) - openingValues.height);

  const changeApartmentValue = (key: 'width' | 'depth' | 'height', value: number) => {
    const next = { width, depth, height, [key]: value };
    setWidth(next.width);
    setDepth(next.depth);
    setHeight(next.height);
    onPreviewApartment(next.width, next.depth, next.height);
    return next;
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
    return next;
  };

  const changeOpeningValues = (patch: Partial<typeof openingValues>) => {
    const next = { ...openingValues, ...patch };
    setOpeningValues(next);
    if (selectedOpening) onPreviewOpening(selectedOpening.id, selectedWindow ? { offset: next.offset, width: next.width, height: next.height, sillHeight: next.sillHeight } : next);
    return next;
  };

  const saveApartmentValues = async (values = { width, depth, height }) => {
    setSaving(true);
    await onResizeApartment(values.width, values.depth, values.height);
    setSaving(false);
  };

  const saveWallValues = async (values = wallValues) => {
    if (!selectedWall) return;
    setSaving(true);
    await onUpdateWall(selectedWall.id, wallPatch(values));
    setSaving(false);
  };

  const saveOpeningValues = async (values = openingValues) => {
    if (!selectedOpening) return;
    setSaving(true);
    await onUpdateOpening(selectedOpening.id, selectedWindow ? { offset: values.offset, width: values.width, height: values.height, sillHeight: values.sillHeight } : values);
    setSaving(false);
  };

  const blurOnEnter = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') event.currentTarget.blur();
  };

  const heading = selectedOpening ? `${selectedWindow ? 'Window' : 'Door'} properties` : selectedWall ? 'Wall properties' : drawingWall ? 'Add interior wall' : 'Apartment size';
  const description = selectedOpening ? selectedWindow ? 'Drag the window or edit its dimensions below.' : 'Drag the door or edit its dimensions and swing below.'
    : selectedWall ? exterior ? 'Drag the perimeter or edit its dimensions below.' : 'Drag the wall or edit its dimensions below.'
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
        <form onSubmit={(event) => event.preventDefault()}>
          <button type="button" className="back-to-wall-button" onClick={onCloseOpening}>← Back to wall</button>
          <div className="selected-wall-badge"><span>{selectedWindow ? 'WINDOW' : 'DOOR'} · {exterior ? 'EXTERIOR' : 'INTERIOR'} WALL</span><strong>{selectedOpening.id}</strong></div>
          <label className="dimension-control"><span>POSITION FROM START · METERS</span><div><input aria-label={`${selectedWindow ? 'Window' : 'Door'} position slider`} type="range" min={openingClearance} max={positionSliderMaximum} step="0.01" value={openingValues.offset} onChange={(event) => changeOpeningValues({ offset: Math.min(Number(event.target.value), positionValueMaximum) })} onPointerUp={() => { void saveOpeningValues(); }} onKeyUp={() => { void saveOpeningValues(); }} /><input aria-label={`Exact ${selectedWindow ? 'window' : 'door'} position`} type="number" min={openingClearance} max={positionValueMaximum} step="0.01" value={openingValues.offset} onChange={(event) => changeOpeningValues({ offset: Math.min(Number(event.target.value), positionValueMaximum) })} onKeyDown={blurOnEnter} onBlur={() => { void saveOpeningValues(); }} /></div></label>
          <label className="dimension-control"><span>WIDTH · METERS</span><div><input aria-label={`${selectedWindow ? 'Window' : 'Door'} width slider`} type="range" min="0.5" max={widthSliderMaximum} step="0.01" value={openingValues.width} onChange={(event) => changeOpeningValues({ width: Math.min(Number(event.target.value), widthValueMaximum) })} onPointerUp={() => { void saveOpeningValues(); }} onKeyUp={() => { void saveOpeningValues(); }} /><input aria-label={`Exact ${selectedWindow ? 'window' : 'door'} width`} type="number" min="0.5" max={widthValueMaximum} step="0.01" value={openingValues.width} onChange={(event) => changeOpeningValues({ width: Math.min(Number(event.target.value), widthValueMaximum) })} onKeyDown={blurOnEnter} onBlur={() => { void saveOpeningValues(); }} /></div></label>
          <label className="dimension-control"><span>HEIGHT · METERS</span><div><input aria-label={`${selectedWindow ? 'Window' : 'Door'} height slider`} type="range" min={openingHeightMinimum} max={heightSliderMaximum} step="0.01" value={openingValues.height} onChange={(event) => changeOpeningValues({ height: Math.min(Number(event.target.value), heightValueMaximum) })} onPointerUp={() => { void saveOpeningValues(); }} onKeyUp={() => { void saveOpeningValues(); }} /><input aria-label={`Exact ${selectedWindow ? 'window' : 'door'} height`} type="number" min={openingHeightMinimum} max={heightValueMaximum} step="0.01" value={openingValues.height} onChange={(event) => changeOpeningValues({ height: Math.min(Number(event.target.value), heightValueMaximum) })} onKeyDown={blurOnEnter} onBlur={() => { void saveOpeningValues(); }} /></div></label>
          {selectedWindow && <label className="dimension-control"><span>SILL HEIGHT · METERS</span><div><input aria-label="Window sill height slider" type="range" min="0" max={sillSliderMaximum} step="0.01" value={openingValues.sillHeight} onChange={(event) => changeOpeningValues({ sillHeight: Math.min(Number(event.target.value), sillValueMaximum) })} onPointerUp={() => { void saveOpeningValues(); }} onKeyUp={() => { void saveOpeningValues(); }} /><input aria-label="Exact window sill height" type="number" min="0" max={sillValueMaximum} step="0.01" value={openingValues.sillHeight} onChange={(event) => changeOpeningValues({ sillHeight: Math.min(Number(event.target.value), sillValueMaximum) })} onKeyDown={blurOnEnter} onBlur={() => { void saveOpeningValues(); }} /></div></label>}
          {!selectedWindow && <><fieldset className="door-toggle"><legend>HINGE SIDE</legend><button type="button" className={openingValues.swing === 'left' ? 'active' : ''} onClick={() => { void saveOpeningValues(changeOpeningValues({ swing: 'left' })); }}>Left</button><button type="button" className={openingValues.swing === 'right' ? 'active' : ''} onClick={() => { void saveOpeningValues(changeOpeningValues({ swing: 'right' })); }}>Right</button></fieldset><fieldset className="door-toggle"><legend>SWING DIRECTION</legend><button type="button" className={openingValues.swingSide === 'in' ? 'active' : ''} onClick={() => { void saveOpeningValues(changeOpeningValues({ swingSide: 'in' })); }}>Inward</button><button type="button" className={openingValues.swingSide === 'out' ? 'active' : ''} onClick={() => { void saveOpeningValues(changeOpeningValues({ swingSide: 'out' })); }}>Outward</button></fieldset></>}
          <button type="button" className="delete-wall-button" disabled={saving} onClick={() => onDeleteOpening(selectedOpening.id)}>Remove {selectedWindow ? 'window' : 'door'}</button>
        </form>
      ) : selectedWall ? (
        <form onSubmit={(event) => event.preventDefault()}>
          <div className="selected-wall-badge"><span>{exterior ? 'EXTERIOR' : 'INTERIOR'}</span><strong>{selectedWall.id}</strong></div>
          <div className="wall-drag-hint"><span>↔</span><p><strong>{exterior ? 'Drag corners or edge' : 'Drag wall or either endpoint'}</strong>Measurements update live and save when released.</p></div>
          <div className="opening-actions"><button type="button" className="add-door-button" disabled={loading || saving} onClick={() => onAddDoor(selectedWall.id)}>＋ Add door</button><button type="button" className="add-window-button" disabled={loading || saving} onClick={() => onAddWindow(selectedWall.id)}>＋ Add window</button></div>
          {exterior && <div className="exterior-corner-actions"><button type="button" onClick={() => onAddExteriorCorner(selectedWall.id)}>＋ Add corner</button><button type="button" onClick={() => onRemoveExteriorCorner(selectedWall.id, 'start')}>− Start corner</button><button type="button" onClick={() => onRemoveExteriorCorner(selectedWall.id, 'end')}>− End corner</button></div>}
          <label className="dimension-control"><span>LENGTH · METERS <small>Start fixed for exact edits</small></span><div><input aria-label="Wall length slider" type="range" min="0.1" max="30" step="0.01" value={wallValues.length} onChange={(event) => changeWallValue('length', Number(event.target.value))} onPointerUp={() => { void saveWallValues(); }} onKeyUp={() => { void saveWallValues(); }} /><input aria-label="Exact wall length" type="number" min="0.1" max="30" step="0.01" value={wallValues.length} onChange={(event) => changeWallValue('length', Number(event.target.value))} onKeyDown={blurOnEnter} onBlur={() => { void saveWallValues(); }} /></div></label>
          <label className="dimension-control"><span>THICKNESS · METERS</span><div><input aria-label="Wall thickness slider" type="range" min="0.05" max="1" step="0.01" value={wallValues.thickness} onChange={(event) => changeWallValue('thickness', Number(event.target.value))} onPointerUp={() => { void saveWallValues(); }} onKeyUp={() => { void saveWallValues(); }} /><input aria-label="Exact wall thickness" type="number" min="0.05" max="1" step="0.01" value={wallValues.thickness} onChange={(event) => changeWallValue('thickness', Number(event.target.value))} onKeyDown={blurOnEnter} onBlur={() => { void saveWallValues(); }} /></div></label>
          <label className="dimension-control"><span>HEIGHT · METERS</span><div><input aria-label="Wall height slider" type="range" min="1.8" max="6" step="0.01" value={wallValues.height} onChange={(event) => changeWallValue('height', Number(event.target.value))} onPointerUp={() => { void saveWallValues(); }} onKeyUp={() => { void saveWallValues(); }} /><input aria-label="Exact wall height" type="number" min="1.8" max="6" step="0.01" value={wallValues.height} onChange={(event) => changeWallValue('height', Number(event.target.value))} onKeyDown={blurOnEnter} onBlur={() => { void saveWallValues(); }} /></div></label>
          <div className="wall-coordinate-readout"><span>START</span><strong>{selectedWall.start.x.toFixed(2)}, {selectedWall.start.y.toFixed(2)}</strong><span>END</span><strong>{selectedWall.end.x.toFixed(2)}, {selectedWall.end.y.toFixed(2)}</strong></div>
          {!exterior && <button type="button" className="delete-wall-button" disabled={saving} onClick={() => onDeleteWall(selectedWall.id)}>Remove interior wall</button>}
        </form>
      ) : (
        <>
          <div className="wall-creation-tool">
            <button type="button" className={`draw-wall-button ${drawingWall ? 'active' : ''}`} onClick={() => onDrawingWall(!drawingWall)}>{drawingWall ? '× Cancel wall drawing' : '＋ Add interior wall'}</button>
            {drawingWall && <p className="tool-instruction">Click a start point, then an end point. Walls snap to corners, edges, the grid, horizontal, and vertical lines.</p>}
          </div>
          <form onSubmit={(event) => event.preventDefault()}>
            <fieldset className="apartment-dimensions"><legend>OVERALL DIMENSIONS · METERS</legend><label className="dimension-control"><span>W · WIDTH</span><div><input aria-label="Apartment width slider" type="range" min="2" max="30" step="0.01" value={width} onChange={(event) => changeApartmentValue('width', Number(event.target.value))} onPointerUp={() => { void saveApartmentValues(); }} onKeyUp={() => { void saveApartmentValues(); }} /><input aria-label="Exact apartment width" type="number" min="2" max="30" step="0.01" value={width} onChange={(event) => changeApartmentValue('width', Number(event.target.value))} onKeyDown={blurOnEnter} onBlur={() => { void saveApartmentValues(); }} /></div></label><label className="dimension-control"><span>D · DEPTH</span><div><input aria-label="Apartment depth slider" type="range" min="2" max="30" step="0.01" value={depth} onChange={(event) => changeApartmentValue('depth', Number(event.target.value))} onPointerUp={() => { void saveApartmentValues(); }} onKeyUp={() => { void saveApartmentValues(); }} /><input aria-label="Exact apartment depth" type="number" min="2" max="30" step="0.01" value={depth} onChange={(event) => changeApartmentValue('depth', Number(event.target.value))} onKeyDown={blurOnEnter} onBlur={() => { void saveApartmentValues(); }} /></div></label><label className="dimension-control"><span>H · HEIGHT</span><div><input aria-label="Apartment height slider" type="range" min="1.8" max="6" step="0.01" value={height} onChange={(event) => changeApartmentValue('height', Number(event.target.value))} onPointerUp={() => { void saveApartmentValues(); }} onKeyUp={() => { void saveApartmentValues(); }} /><input aria-label="Exact apartment height" type="number" min="1.8" max="6" step="0.01" value={height} onChange={(event) => changeApartmentValue('height', Number(event.target.value))} onKeyDown={blurOnEnter} onBlur={() => { void saveApartmentValues(); }} /></div></label></fieldset>
            <div className="footprint-preview"><div className="apartment-preview-stage"><div className="apartment-preview-box" style={previewStyle} /></div><span>{width.toFixed(2)} × {depth.toFixed(2)} × {height.toFixed(2)} m · {(width * depth).toFixed(1)} m²</span></div>
          </form>
        </>
      )}
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
            <span className="furniture-icon-frame compact" style={{ display: 'grid', flex: '0 0 38px', width: 38, height: 32, placeItems: 'center' }}><FurnitureGlyph category={item.category} name={item.name} compact /></span><span className="furniture-copy"><strong>{item.name}</strong><small>{formatDimensions(item.dimensions)}</small></span><span className="drag-dots">⠿</span>
          </button>
        ))}
      </div>
      <div className="library-note"><span className="verified">✓</span><div><strong>Dimensions verified</strong><p>All furniture uses your exact measurements.</p></div></div>
    </aside>
  );
}

function FurnitureGlyph({ category, name, compact = false }: { category: string; name: string; compact?: boolean }) {
  const kind = getFurnitureKind(category, name);
  const mainStyle = { fill: 'rgba(82,116,136,.07)', stroke: '#527488', strokeWidth: 1.6, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  const detailStyle = { fill: 'none', stroke: '#527488', strokeWidth: 1.05, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  const softStyle = { ...detailStyle, strokeWidth: .75, strokeDasharray: '1.4 1.4', opacity: .58 };
  const accentStyle = { fill: '#527488', stroke: 'none' };
  return (
    <svg className={`furniture-glyph glyph-${kind}`} width={compact ? 34 : 48} height={compact ? 28 : 42} viewBox="0 0 48 36" fill="none" style={{ display: 'block', flex: 'none', overflow: 'visible' }} aria-hidden="true">
      {kind === 'bed' && <><rect style={mainStyle} x="11" y="5" width="26" height="27" rx="1" /><path style={detailStyle} d="M11 14h26M24 14v18M13.5 8h9v4h-9zM25.5 8h9v4h-9z" /><path style={softStyle} d="M14 18v11M18 18v11M30 18v11M34 18v11" /></>}
      {kind === 'sofa' && <><rect style={mainStyle} x="7" y="9" width="34" height="20" rx="5" /><rect style={detailStyle} x="12" y="12" width="24" height="13" rx="3" /><path style={mainStyle} d="M12 12v13M36 12v13M24 12v13" /><path style={softStyle} d="M9 30h30" /></>}
      {kind === 'desk' && <><rect style={mainStyle} x="7" y="7" width="34" height="15" rx="1" /><path style={detailStyle} d="M11 18h26M18 11h12v7H18z" /><rect style={mainStyle} x="18" y="25" width="12" height="7" rx="3" /><path style={softStyle} d="M24 22v3" /></>}
      {kind === 'dining' && <><ellipse style={mainStyle} cx="24" cy="18" rx="15" ry="10.5" /><ellipse style={detailStyle} cx="24" cy="18" rx="11" ry="7" /><path style={detailStyle} d="M24 8v20M9 18h30" /><rect style={mainStyle} x="19.5" y="1.5" width="9" height="5" rx="2.5" /><rect style={mainStyle} x="19.5" y="29.5" width="9" height="5" rx="2.5" /><rect style={mainStyle} x="2.5" y="13.5" width="5" height="9" rx="2.5" /><rect style={mainStyle} x="40.5" y="13.5" width="5" height="9" rx="2.5" /></>}
      {kind === 'coffee' && <><ellipse style={mainStyle} cx="24" cy="18" rx="16" ry="10" /><ellipse style={detailStyle} cx="24" cy="18" rx="11" ry="6" /><circle style={accentStyle} cx="24" cy="18" r="1.8" /></>}
      {kind === 'chair' && <><rect style={mainStyle} x="13" y="8" width="22" height="22" rx="6" /><rect style={detailStyle} x="17" y="12" width="14" height="13" rx="4" /><path style={mainStyle} d="M13 13H9v12h4M35 13h4v12h-4M17 30v3M31 30v3" /></>}
      {kind === 'bookcase' && <><rect style={mainStyle} x="10" y="2" width="28" height="32" rx="1" /><path style={mainStyle} d="M10 12.5h28M10 23h28" /><path style={detailStyle} d="M14 5v6M19 4v7M25 14v7M31 14v7M14 25v6M21 26v5M29 25v6M34 26v5" /><path style={softStyle} d="M12 32h24" /></>}
      {kind === 'nightstand' && <><rect style={mainStyle} x="14" y="6" width="20" height="25" rx="1" /><path style={mainStyle} d="M14 14h20M14 22h20" /><circle style={accentStyle} cx="24" cy="10" r="1" /><circle style={accentStyle} cx="24" cy="18" r="1" /><circle style={accentStyle} cx="24" cy="26" r="1" /></>}
      {kind === 'storage' && <><rect style={mainStyle} x="10" y="7" width="28" height="23" rx="1" /><path style={mainStyle} d="M10 14.5h28M10 22h28M24 7v23" /><circle style={accentStyle} cx="21" cy="11" r="1" /><circle style={accentStyle} cx="27" cy="11" r="1" /><circle style={accentStyle} cx="21" cy="18" r="1" /><circle style={accentStyle} cx="27" cy="18" r="1" /></>}
      {kind === 'stove' && <><rect style={mainStyle} x="11" y="4" width="26" height="28" rx="2" /><rect style={detailStyle} x="14" y="7" width="20" height="9" rx="1" /><circle style={detailStyle} cx="18" cy="23" r="3" /><circle style={detailStyle} cx="30" cy="23" r="3" /><path style={softStyle} d="M15 27h18" /></>}
      {kind === 'sink' && <><rect style={mainStyle} x="7" y="8" width="34" height="21" rx="2" /><rect style={detailStyle} x="13" y="12" width="22" height="13" rx="5" /><path style={detailStyle} d="M24 12V5M24 5c0-3 6-3 6 0v3" /><circle style={accentStyle} cx="24" cy="18" r="1.5" /></>}
      {kind === 'fridge' && <><rect style={mainStyle} x="14" y="2" width="20" height="32" rx="2" /><path style={mainStyle} d="M14 13h20" /><path style={detailStyle} d="M30 5v5M30 16v13" /><circle style={accentStyle} cx="24" cy="9" r="1" /></>}
      {kind === 'toilet' && <><rect style={mainStyle} x="15" y="3" width="18" height="12" rx="2" /><ellipse style={mainStyle} cx="24" cy="24" rx="13" ry="9" /><ellipse style={detailStyle} cx="24" cy="24" rx="7" ry="4" /><path style={detailStyle} d="M14 16h20" /></>}
      {kind === 'shower' && <><rect style={mainStyle} x="9" y="2" width="30" height="32" rx="7" /><rect style={detailStyle} x="12" y="5" width="24" height="26" rx="5" /><path style={detailStyle} d="M31 8V6c0-2-3-2-3 0v4" /><path style={detailStyle} d="M28 10h-5" /><circle style={accentStyle} cx="23" cy="10" r="2.1" /><path style={softStyle} d="M21 14l-2 5m6-5l-2 5m6-5l-2 5" /><circle style={accentStyle} cx="24" cy="27" r="1.35" /></>}
      {kind === 'bathtub' && <><rect style={mainStyle} x="5" y="11" width="38" height="17" rx="8" /><rect style={detailStyle} x="10" y="14" width="28" height="10" rx="5" /><path style={detailStyle} d="M12 10V5c0-3 7-3 7 0v3" /><path style={softStyle} d="M9 29v3m30-3v3" /></>}
      {kind === 'washer-dryer' && <><rect style={mainStyle} x="12" y="3" width="24" height="31" rx="2" /><rect style={detailStyle} x="15" y="7" width="18" height="6" rx="1" /><circle style={detailStyle} cx="24" cy="24" r="7" /><circle style={accentStyle} cx="19" cy="10" r="1" /><circle style={accentStyle} cx="23" cy="10" r="1" /></>}
      {!['bed', 'sofa', 'desk', 'dining', 'coffee', 'chair', 'bookcase', 'nightstand', 'storage', 'stove', 'sink', 'fridge', 'toilet', 'shower', 'bathtub', 'washer-dryer'].includes(kind) && <><path style={mainStyle} d="M12 8h24l5 10-5 10H12L7 18z" /><circle style={accentStyle} cx="24" cy="18" r="4" /><path style={detailStyle} d="M24 9v5M24 22v5M15 18h5M28 18h5" /></>}
    </svg>
  );
}

function PlanCompass({ northAngle, onOrientation }: { northAngle: number; onOrientation: (direction: CardinalDirection) => Promise<string | null> }) {
  const [saving, setSaving] = useState(false);
  const directions = [
    { key: 'N' as const, name: 'north' },
    { key: 'E' as const, name: 'east' },
    { key: 'S' as const, name: 'south' },
    { key: 'W' as const, name: 'west' },
  ];
  const selected = planFacingFromNorthAngle(northAngle);
  const selectedIndex = directions.findIndex((direction) => direction.key === selected);
  const dialDirections = directions.map((_, offset) => directions[(selectedIndex + offset) % directions.length].key);
  const northNeedleAngle = dialDirections.indexOf('N') * 90;
  const choose = async (direction: CardinalDirection) => {
    if (saving || direction === selected) return;
    setSaving(true);
    await onOrientation(direction);
    setSaving(false);
  };
  return (
    <section className="plan-compass" aria-label="Floor plan orientation">
      <span className="compass-title">PLAN ORIENTATION</span>
      <div className="compass-dial" aria-hidden="true">
        <span className="compass-ticks">{[30, 60, 120, 150, 210, 240, 300, 330].map((angle) => <span key={angle} style={{ transform: `translate(-50%, -50%) rotate(${angle}deg)` }} />)}</span>
        <span className="compass-heading-marker" />
        <i className={`compass-n${dialDirections[0] === 'N' ? ' is-north' : ''}`}>{dialDirections[0]}</i><i className={`compass-e${dialDirections[1] === 'N' ? ' is-north' : ''}`}>{dialDirections[1]}</i><i className={`compass-s${dialDirections[2] === 'N' ? ' is-north' : ''}`}>{dialDirections[2]}</i><i className={`compass-w${dialDirections[3] === 'N' ? ' is-north' : ''}`}>{dialDirections[3]}</i>
        <b className="compass-needle" style={{ transform: `translate(-50%, -50%) rotate(${northNeedleAngle}deg)` }} />
        <em />
      </div>
      <span className="compass-question">TOP OF PLAN FACES</span>
      <div className="compass-options" role="group" aria-label="Direction faced by the top of the floor plan">
        {directions.map((direction) => <button type="button" key={direction.key} className={selected === direction.key ? 'active' : ''} aria-pressed={selected === direction.key} aria-label={`Set top of floor plan to face ${direction.name}`} disabled={saving} onClick={() => choose(direction.key)}>{direction.key}</button>)}
      </div>
    </section>
  );
}

function PlanView({ northAngle, onOrientation, editMode, architecture, selectedWallId, selectedOpeningId, selectedRoomId, drawingWall, selected, onSelect, onDeselect, onSelectWall, onSelectOpening, onSelectRoom, layout, zoom, objects, collisionMessage, statusError, onMove, onCommitMove, onRotate, onDelete, onAddWall, onUpdateWall, onUpdateOpening }: { northAngle: number; onOrientation: (direction: CardinalDirection) => Promise<string | null>; editMode: EditMode; architecture: ArchitecturalElement[]; selectedWallId: string; selectedOpeningId: string; selectedRoomId: string; drawingWall: boolean; selected: string; onSelect: (item: string) => void; onDeselect: () => void; onSelectWall: (id: string) => void; onSelectOpening: (id: string, wallId: string) => void; onSelectRoom: (id: string) => void; layout: LayoutKey; zoom: number; objects: SceneObject[]; collisionMessage: string; statusError: boolean; onMove: (id: string, placement: ObjectPlacement) => boolean; onCommitMove: (id: string, placement: ObjectPlacement, before: SceneObject) => void; onRotate: (id: string, degrees: number) => void; onDelete: (id: string) => void; onAddWall: (start: Point2, end: Point2) => Promise<unknown>; onUpdateWall: (id: string, patch: Partial<Pick<WallElement, 'start' | 'end'>>) => Promise<unknown>; onUpdateOpening: (id: string, patch: Partial<Pick<OpeningElement, 'offset'>>) => Promise<unknown> }) {
  const selectedObject = objects.find((item) => item.id === selected);
  const bounds = getArchitectureBounds(architecture);
  const frame = planFrameSize(bounds.width, bounds.depth);
  const shared = { selected, onSelect, onMove, onCommitMove, architecture, bounds };
  return (
    <section className={`plan-workspace edit-${editMode}`} aria-label="2D floor plan editor">
      {editMode === 'furnish' && selectedObject && <div className="object-toolbar" aria-label={`Edit ${selectedObject.name}`}><strong>{selectedObject.name}</strong><button onClick={() => onRotate(selectedObject.id, -90)} aria-label="Rotate left">↶ 90°</button><button onClick={() => onRotate(selectedObject.id, 90)} aria-label="Rotate right">↷ 90°</button><button className="delete-object" onClick={() => onDelete(selectedObject.id)} aria-label={`Remove ${selectedObject.name}`}>Remove</button></div>}
      <PlanCompass northAngle={northAngle} onOrientation={onOrientation} />
      <div className={`floor-plan-wrap layout-${layout.toLowerCase()}`} style={{ transform: `translate(-50%, -49%) scale(${zoom / 100})` }} onClick={(event) => { if (!(event.target instanceof Element) || !event.target.closest('.plan-object')) onDeselect(); }}>
        <div className="geometry-measure top" style={{ width: frame.width }}>{bounds.width.toFixed(2)} m</div><div className="geometry-measure left" style={{ height: frame.height }}>{bounds.depth.toFixed(2)} m</div>
        <div className="floor-plan geometry-plan" style={{ width: frame.width, height: frame.height }}>
          <ArchitecturePlanLayer key={drawingWall ? 'drawing' : 'selecting'} architecture={architecture} bounds={bounds} editMode={editMode} selectedWallId={selectedWallId} selectedOpeningId={selectedOpeningId} selectedRoomId={selectedRoomId} drawingWall={drawingWall} onSelectWall={onSelectWall} onSelectOpening={onSelectOpening} onSelectRoom={onSelectRoom} onAddWall={onAddWall} onUpdateWall={onUpdateWall} onUpdateOpening={onUpdateOpening} />
          {editMode === 'furnish' && objects.map((item) => <PlanFurniture key={item.id} item={item} {...shared} />)}
        </div>
      </div>
      <div className={`plan-status ${statusError ? 'has-collision' : ''} ${editMode === 'furnish' ? 'is-compact' : ''}`} role="status"><span className={statusError ? 'status-collision' : 'status-good'}>{collisionMessage ? `${statusError ? '⚠' : '✓'} ${collisionMessage}` : editMode === 'architecture' ? '✓ Architecture is valid' : '✓ No furniture collisions'}</span>{editMode === 'architecture' && <span>{drawingWall ? 'Click two points to add a wall · Escape cancels' : 'Drag wall corners, exterior edges, or doors directly in the plan'}</span>}</div>
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
type DoorDragState = { openingId: string; pointerId: number; pointerStart: Point2; originOffset: number; offset: number };
const openingDragThreshold = 0.02;

function ArchitecturePlanLayer({ architecture, bounds, editMode, selectedWallId, selectedOpeningId, selectedRoomId, drawingWall, onSelectWall, onSelectOpening, onSelectRoom, onAddWall, onUpdateWall, onUpdateOpening }: { architecture: ArchitecturalElement[]; bounds: ReturnType<typeof getArchitectureBounds>; editMode: EditMode; selectedWallId: string; selectedOpeningId: string; selectedRoomId: string; drawingWall: boolean; onSelectWall: (id: string) => void; onSelectOpening: (id: string, wallId: string) => void; onSelectRoom: (id: string) => void; onAddWall: (start: Point2, end: Point2) => Promise<unknown>; onUpdateWall: (id: string, patch: Partial<Pick<WallElement, 'start' | 'end'>>) => Promise<unknown>; onUpdateOpening: (id: string, patch: Partial<Pick<OpeningElement, 'offset'>>) => Promise<unknown> }) {
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
    const exterior = isExteriorWall(wall, bounds, architecture);
    if (current.mode === 'edge') {
      let delta = { x: Math.round((raw.x - current.pointerStart.x) * 10) / 10, y: Math.round((raw.y - current.pointerStart.y) * 10) / 10 };
      if (!exterior) {
        delta = {
          x: Math.max(bounds.minX - Math.min(current.originStart.x, current.originEnd.x), Math.min(bounds.maxX - Math.max(current.originStart.x, current.originEnd.x), delta.x)),
          y: Math.max(bounds.minY - Math.min(current.originStart.y, current.originEnd.y), Math.min(bounds.maxY - Math.max(current.originStart.y, current.originEnd.y), delta.y)),
        };
      }
      return { ...current, start: { x: current.originStart.x + delta.x, y: current.originStart.y + delta.y }, end: { x: current.originEnd.x + delta.x, y: current.originEnd.y + delta.y } };
    }
    const endpoint = current.endpoint ?? 'end';
    const fixedPoint = endpoint === 'start' ? current.originEnd : current.originStart;
    const movingOrigin = endpoint === 'start' ? current.originStart : current.originEnd;
    const excludedWallIds = new Set(walls.filter((candidate) => candidate.id === wall.id || (exterior && [candidate.start, candidate.end].some((point) => samePoint(point, movingOrigin)))).map((candidate) => candidate.id));
    const snappingArchitecture = architecture.filter((element) => !excludedWallIds.has(element.id));
    const point = snapWallEnd(fixedPoint, raw, snappingArchitecture, bounds, !exterior);
    return { ...current, [endpoint]: point };
  };

  const doorOffsetAtPoint = (opening: OpeningElement, drag: DoorDragState, raw: Point2) => {
    const wall = walls.find((candidate) => candidate.id === opening.wallId);
    if (!wall) return opening.offset;
    const dx = wall.end.x - wall.start.x;
    const dy = wall.end.y - wall.start.y;
    const length = wallLength(wall);
    const projectedDistance = ((raw.x - drag.pointerStart.x) * dx + (raw.y - drag.pointerStart.y) * dy) / length;
    const offset = Math.round((drag.originOffset + projectedDistance) * 20) / 20;
    return Math.max(0, Math.min(length - opening.width, offset));
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
      if (opening) setDoorDrag((current) => {
        if (!current) return current;
        const offset = doorOffsetAtPoint(opening, current, point);
        return { ...current, offset: Math.abs(offset - current.originOffset) < openingDragThreshold ? current.originOffset : offset };
      });
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
    if (drawingWall || selectedWallId !== wall.id) return;
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
    const pointerStart = pointFromEvent(event);
    if (pointerStart) setDoorDrag({ openingId: opening.id, pointerId: event.pointerId, pointerStart, originOffset: opening.offset, offset: opening.offset });
  };

  const beginDoorHandleDrag = (event: PointerEvent<SVGCircleElement>, opening: OpeningElement) => {
    event.preventDefault();
    event.stopPropagation();
    if (selectedOpeningId !== opening.id) onSelectOpening(opening.id, opening.wallId);
    event.currentTarget.setPointerCapture(event.pointerId);
    const pointerStart = pointFromEvent(event);
    if (pointerStart) setDoorDrag({ openingId: opening.id, pointerId: event.pointerId, pointerStart, originOffset: opening.offset, offset: opening.offset });
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
        const proposedOffset = doorOffsetAtPoint(opening, doorDrag, point);
        const offset = Math.abs(proposedOffset - doorDrag.originOffset) < openingDragThreshold ? doorDrag.originOffset : proposedOffset;
        setDoorDrag({ ...doorDrag, offset });
        if (Math.abs(offset - opening.offset) > 0.001) await onUpdateOpening(opening.id, { offset });
      }
      setDoorDrag(null);
    }
  };

  const fontSize = Math.max(bounds.width, bounds.depth) / 48;
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
        return <g key={wall.id} className={`architecture-wall ${selectedWall ? 'selected' : ''} ${wallDrag?.wallId === wall.id ? 'dragging' : ''}`} onPointerDown={(event) => { if (!drawingWall && editMode === 'architecture') { event.stopPropagation(); onSelectWall(wall.id); } }}><line className="wall-visible" x1={wall.start.x} y1={wall.start.y} x2={wall.end.x} y2={wall.end.y} strokeWidth={wall.thickness} /><line className={`wall-hit-target ${selectedWall ? 'edge-draggable' : ''}`} x1={wall.start.x} y1={wall.start.y} x2={wall.end.x} y2={wall.end.y} strokeWidth={Math.max(wall.thickness * 4, 0.28)} onPointerDown={(event) => beginWallEdgeDrag(event, originalWall)} />{selectedWall && <><circle role="button" aria-label="Drag wall start point" className="wall-endpoint-hit" cx={wall.start.x} cy={wall.start.y} r={fontSize} onPointerDown={(event) => beginWallEndpointDrag(event, originalWall, 'start')} /><circle className="wall-endpoint-handle start" pointerEvents="none" cx={wall.start.x} cy={wall.start.y} r={fontSize * 0.5} /><circle role="button" aria-label="Drag wall end point" className="wall-endpoint-hit" cx={wall.end.x} cy={wall.end.y} r={fontSize} onPointerDown={(event) => beginWallEndpointDrag(event, originalWall, 'end')} /><circle className="wall-endpoint-handle end" pointerEvents="none" cx={wall.end.x} cy={wall.end.y} r={fontSize * 0.5} /><text className="wall-length-label" x={(wall.start.x + wall.end.x) / 2} y={(wall.start.y + wall.end.y) / 2 - fontSize * 0.65} fontSize={fontSize * 0.9} textAnchor="middle">{wallLength(wall).toFixed(2)} m · H {wall.height.toFixed(2)} m · {wallDrag?.wallId === wall.id ? 'DRAGGING' : exterior ? 'DRAG CORNERS OR EDGE' : 'DRAG WALL OR EITHER END'}</text></>}</g>;
      })}
      {renderedOpenings.map((opening) => {
        const wall = renderedWalls.find((candidate) => candidate.id === opening.wallId);
        if (!wall) return null;
        const length = wallLength(wall);
        const along = (offset: number) => ({ x: wall.start.x + ((wall.end.x - wall.start.x) * offset) / length, y: wall.start.y + ((wall.end.y - wall.start.y) * offset) / length });
        const start = along(opening.offset);
        const end = along(opening.offset + opening.width);
        const center = along(opening.offset + opening.width / 2);
        if (opening.openingType === 'window') {
          const selectedWindow = selectedOpeningId === opening.id;
          const normal = { x: -((end.y - start.y) / opening.width) * wall.thickness * 0.22, y: ((end.x - start.x) / opening.width) * wall.thickness * 0.22 };
          return <g key={opening.id} className={`architecture-window ${selectedWindow ? 'selected' : ''} ${doorDrag?.openingId === opening.id ? 'dragging' : ''}`}><line className="window-gap" x1={start.x} y1={start.y} x2={end.x} y2={end.y} strokeWidth={Math.max(wall.thickness * 1.8, 0.13)} /><line className="window-frame" x1={start.x + normal.x} y1={start.y + normal.y} x2={end.x + normal.x} y2={end.y + normal.y} /><line className="window-frame" x1={start.x - normal.x} y1={start.y - normal.y} x2={end.x - normal.x} y2={end.y - normal.y} /><line role="button" aria-label="Drag window along wall" className="window-hit-target" x1={start.x} y1={start.y} x2={end.x} y2={end.y} strokeWidth={Math.max(wall.thickness * 5, 0.4)} onPointerDown={(event) => beginDoorDrag(event, opening)} /><circle role="button" aria-label="Select and drag window" className="window-grab-handle" cx={center.x} cy={center.y} r={fontSize * 0.48} onPointerDown={(event) => beginDoorHandleDrag(event, opening)} /></g>;
        }
        const selectedDoor = selectedOpeningId === opening.id;
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
  const kind = getFurnitureKind(item.category, item.name);
  return <DraggablePlanObject item={item} className={`furniture-plan-object plan-${kind}`} {...props}><PlanFurnitureDrawing kind={kind} /></DraggablePlanObject>;
}

function PlanFurnitureDrawing({ kind }: { kind: string }) {
  const line = { fill: 'none', stroke: '#527488', strokeWidth: 1.7, vectorEffect: 'non-scaling-stroke' as const, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  const body = { ...line, fill: '#dce3df' };
  const light = { ...line, fill: '#f4f3e9' };
  const detail = { ...line, strokeWidth: 1.05 };
  return (
    <svg className="plan-furniture-drawing" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
      {kind === 'bed' && <>
        <rect {...body} x="3" y="3" width="94" height="94" rx="2" />
        <path {...detail} d="M4 32H96" />
        <rect {...light} x="8" y="8" width="39" height="19" rx="3" />
        <rect {...light} x="53" y="8" width="39" height="19" rx="3" />
        <rect {...light} x="8" y="37" width="84" height="55" rx="1" />
        <path {...detail} d="M20 38V91M32 38V91M44 38V91M56 38V91M68 38V91M80 38V91" opacity=".42" />
        <path {...detail} d="M8 48Q50 57 92 48" opacity=".65" />
      </>}
      {kind === 'sofa' && <>
        <g transform="rotate(180 50 50)">
          <rect {...body} x="3" y="7" width="94" height="86" rx="12" />
          <rect {...light} x="12" y="14" width="76" height="72" rx="8" />
          <path {...detail} d="M37.3 15V85M62.7 15V85M12 68H88" />
          <path {...line} d="M12 21H6V79H12M88 21H94V79H88" />
          <path {...detail} d="M17 91H27M73 91H83" />
        </g>
      </>}
      {kind === 'desk' && <>
        <rect {...body} x="3" y="6" width="94" height="70" rx="2" />
        <path {...detail} d="M4 65H96M12 14V61M88 14V61" />
        <rect {...light} x="30" y="15" width="40" height="27" rx="2" />
        <path {...line} d="M50 42V50M39 50H61" />
        <rect {...light} x="34" y="55" width="32" height="6" rx="2" />
        <path {...detail} d="M10 83H90" opacity=".5" />
        <ellipse {...light} cx="50" cy="87" rx="18" ry="10" />
      </>}
      {kind === 'dining' && <>
        <ellipse {...body} cx="50" cy="50" rx="35" ry="33" />
        <ellipse {...detail} cx="50" cy="50" rx="27" ry="24" />
        <path {...detail} d="M50 17V83M15 50H85" />
        <rect {...light} x="37" y="2" width="26" height="14" rx="7" />
        <rect {...light} x="37" y="84" width="26" height="14" rx="7" />
        <rect {...light} x="2" y="37" width="14" height="26" rx="7" />
        <rect {...light} x="84" y="37" width="14" height="26" rx="7" />
        <circle cx="50" cy="50" r="3" fill="#527488" />
      </>}
      {kind === 'coffee' && <>
        <ellipse {...body} cx="50" cy="50" rx="46" ry="42" />
        <ellipse {...light} cx="50" cy="50" rx="37" ry="32" />
        <path {...detail} d="M20 50H80M50 20V80" opacity=".52" />
        <circle cx="50" cy="50" r="4" fill="#527488" />
      </>}
      {kind === 'chair' && <>
        <rect {...body} x="10" y="8" width="80" height="84" rx="18" />
        <rect {...light} x="21" y="16" width="58" height="65" rx="14" />
        <path {...detail} d="M22 65Q50 76 78 65M21 31Q50 23 79 31" />
        <path {...line} d="M11 30H3V72H11M89 30H97V72H89" />
        <path {...detail} d="M24 91V97M76 91V97" />
      </>}
      {kind === 'nightstand' && <>
        <rect {...body} x="9" y="4" width="82" height="92" rx="3" />
        <path {...line} d="M9 34H91M9 64H91" />
        <path {...detail} d="M35 19H65M35 49H65M35 79H65" />
        <circle cx="50" cy="19" r="3" fill="#527488" />
        <circle cx="50" cy="49" r="3" fill="#527488" />
        <circle cx="50" cy="79" r="3" fill="#527488" />
      </>}
      {kind === 'bookcase' && <>
        <rect {...body} x="2" y="2" width="96" height="96" rx="3" />
        <path {...line} d="M2 34H98M2 67H98" />
        <path {...detail} d="M10 7V30M20 7V30M33 7V30M47 39V63M59 39V63M74 39V63M88 39V63M11 72V94M25 72V94M41 72V94M58 72V94M70 72V94M87 72V94" opacity=".9" />
        <path {...detail} d="M38 7L44 30M80 72L85 94" />
      </>}
      {kind === 'storage' && <>
        <rect {...body} x="3" y="5" width="94" height="90" rx="2" />
        <path {...line} d="M3 35H97M3 65H97M34 5V95M66 5V95" />
        <circle cx="18" cy="20" r="3" fill="#527488" /><circle cx="50" cy="20" r="3" fill="#527488" /><circle cx="82" cy="20" r="3" fill="#527488" />
        <circle cx="18" cy="50" r="3" fill="#527488" /><circle cx="50" cy="50" r="3" fill="#527488" /><circle cx="82" cy="50" r="3" fill="#527488" />
        <circle cx="18" cy="80" r="3" fill="#527488" /><circle cx="50" cy="80" r="3" fill="#527488" /><circle cx="82" cy="80" r="3" fill="#527488" />
      </>}
      {kind === 'stove' && <><rect {...body} x="5" y="4" width="90" height="92" rx="3" /><rect {...light} x="12" y="11" width="76" height="25" rx="2" /><circle {...detail} cx="28" cy="58" r="13" /><circle {...detail} cx="72" cy="58" r="13" /><path {...detail} d="M12 83H88" /></>}
      {kind === 'sink' && <><rect {...body} x="3" y="9" width="94" height="82" rx="3" /><rect {...light} x="16" y="26" width="68" height="45" rx="18" /><path {...line} d="M50 26V11C50 2 72 2 72 11v11" /><circle cx="50" cy="49" r="4" fill="#527488" /></>}
      {kind === 'fridge' && <><rect {...body} x="13" y="2" width="74" height="96" rx="3" /><path {...line} d="M13 36H87" /><path {...detail} d="M76 9v19M76 44v45" /><circle cx="50" cy="19" r="4" fill="#527488" /></>}
      {kind === 'toilet' && <><rect {...body} x="27" y="3" width="46" height="31" rx="4" /><path {...body} d="M18 42Q18 31 50 31Q82 31 82 42V69Q82 94 50 94Q18 94 18 69Z" /><ellipse {...light} cx="50" cy="58" rx="19" ry="13" /><ellipse {...detail} cx="50" cy="58" rx="11" ry="7" /></>}
      {kind === 'shower' && <><rect {...body} x="8" y="2" width="84" height="96" rx="18" /><rect {...light} x="15" y="9" width="70" height="82" rx="13" /><path {...line} d="M72 20v-7c0-6-10-6-10 0v13" /><path {...detail} d="M62 26H48" /><circle cx="45" cy="26" r="6" fill="#527488" /><path {...detail} d="M39 38l-6 14m17-14l-6 14m17-14l-6 14" opacity=".58" /><circle cx="50" cy="77" r="4" fill="#527488" /></>}
      {kind === 'bathtub' && <><rect {...body} x="4" y="20" width="92" height="60" rx="27" /><rect {...light} x="13" y="29" width="74" height="42" rx="20" /><path {...line} d="M18 20V9C18 0 41 0 41 9v8" /><circle cx="50" cy="50" r="4" fill="#527488" /></>}
      {kind === 'washer-dryer' && <><rect {...body} x="8" y="2" width="84" height="96" rx="4" /><rect {...light} x="16" y="10" width="68" height="18" rx="2" /><circle {...detail} cx="50" cy="63" r="24" /><circle {...light} cx="50" cy="63" r="15" /><circle cx="28" cy="19" r="4" fill="#527488" /><circle cx="43" cy="19" r="4" fill="#527488" /></>}
      {!['bed', 'sofa', 'desk', 'dining', 'coffee', 'chair', 'nightstand', 'bookcase', 'storage', 'stove', 'sink', 'fridge', 'toilet', 'shower', 'bathtub', 'washer-dryer'].includes(kind) && <>
        <path {...body} d="M8 25Q8 8 25 8H75Q92 8 92 25V75Q92 92 75 92H25Q8 92 8 75Z" />
        <path {...detail} d="M20 50H80M50 20V80" /><circle {...light} cx="50" cy="50" r="17" />
      </>}
    </svg>
  );
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
    width: `${(item.dimensions.width / bounds.width) * 100}%`,
    height: `${(item.dimensions.depth / bounds.depth) * 100}%`,
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
      style={{ ...planObjectStyle(item, bounds), zIndex: selected === item.id ? 20 : 10 }}
      onPointerDown={pointerDown}
      onPointerMove={pointerMove}
      onPointerUp={finishDrag}
      onPointerCancel={finishDrag}
      onKeyDown={keyDown}
      aria-label={`${item.name}. Drag or use arrow keys to move. Use the edit toolbar to rotate or remove.`}
      title="Select and drag · Arrow keys for precise movement"
    >
      <span className="plan-object-hit-area" aria-hidden="true" />
      {children}
      <em className="object-height-label" style={{ transform: `rotate(${-item.transform.rotation.y}deg)` }}>
        H {item.dimensions.height.toFixed(2)} m
      </em>
    </button>
  );
}

const objectPresets: Array<AddObjectInput & { shortLabel: string }> = [
  { shortLabel: 'Queen bed', name: 'Queen bed', category: 'bed', roomId: 'bedroom', dimensions: { width: 1.52, depth: 2.03, height: 0.61 } },
  { shortLabel: 'Nightstand', name: 'Nightstand', category: 'storage', roomId: 'bedroom', dimensions: { width: 0.56, depth: 0.46, height: 0.61 } },
  { shortLabel: 'Dresser', name: 'Dresser', category: 'storage', roomId: 'bedroom', dimensions: { width: 1.52, depth: 0.51, height: 0.84 } },
  { shortLabel: 'Bookcase', name: 'Bookcase', category: 'storage', roomId: 'living', dimensions: { width: 0.91, depth: 0.35, height: 1.83 } },
  { shortLabel: 'Sofa', name: 'Sofa', category: 'sofa', roomId: 'living', dimensions: { width: 2.18, depth: 0.91, height: 0.84 } },
  { shortLabel: 'Coffee table', name: 'Coffee table', category: 'table', roomId: 'living', dimensions: { width: 1.07, depth: 0.61, height: 0.43 } },
  { shortLabel: 'Desk', name: 'Desk', category: 'desk', roomId: 'living', dimensions: { width: 1.22, depth: 0.61, height: 0.76 } },
  { shortLabel: 'Chair', name: 'Accent chair', category: 'other', roomId: 'living', dimensions: { width: 0.76, depth: 0.81, height: 0.86 } },
  { shortLabel: 'Dining table', name: 'Dining table', category: 'table', roomId: 'living', dimensions: { width: 1.8, depth: 1.1, height: 0.76 } },
  { shortLabel: 'Stove', name: 'Stove', category: 'fixture', roomId: 'living', dimensions: { width: 0.76, depth: 0.61, height: 0.91 } },
  { shortLabel: 'Sink', name: 'Sink', category: 'fixture', roomId: 'living', dimensions: { width: 0.76, depth: 0.61, height: 1.05 } },
  { shortLabel: 'Fridge', name: 'Fridge', category: 'fixture', roomId: 'living', dimensions: { width: 0.91, depth: 0.76, height: 1.78 } },
  { shortLabel: 'Toilet', name: 'Toilet', category: 'fixture', roomId: 'living', dimensions: { width: 0.4, depth: 0.7, height: 0.78 } },
  { shortLabel: 'Shower', name: 'Shower', category: 'fixture', roomId: 'living', dimensions: { width: 0.91, depth: 0.91, height: 2 } },
  { shortLabel: 'Bathtub', name: 'Bathtub', category: 'fixture', roomId: 'living', dimensions: { width: 1.7, depth: 0.75, height: 0.58 } },
  { shortLabel: 'Washer / dryer', name: 'Washer / dryer', category: 'fixture', roomId: 'living', dimensions: { width: 0.6, depth: 0.65, height: 0.85 } },
  { shortLabel: 'Object', name: 'Custom object', category: 'other', roomId: 'living', dimensions: { width: 0.8, depth: 0.8, height: 0.8 } },
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

function AddObjectPanel({ rooms, loading, onAdd, selectedObject, onDeselect, onResize, onCommitResize }: { rooms: RoomElement[]; loading: boolean; onAdd: (input: AddObjectInput) => Promise<string | null>; selectedObject?: SceneObject; onDeselect: () => void; onResize: (id: string, dimensions: SceneObject['dimensions']) => boolean; onCommitResize: (id: string, dimensions: SceneObject['dimensions'], before: SceneObject['dimensions']) => void }) {
  const [presetIndex, setPresetIndex] = useState(0);
  const [name, setName] = useState(objectPresets[0].name);
  const [roomId, setRoomId] = useState<RoomId>('living');
  const [dimensions, setDimensions] = useState(objectPresets[0].dimensions);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const resizeStart = useRef<SceneObject['dimensions'] | null>(null);

  const resetDraftToPreset = (index: number) => {
    const preset = objectPresets[index];
    setPresetIndex(index);
    setName(preset.name);
    setRoomId(rooms.some((room) => room.id === preset.roomId) ? preset.roomId : rooms[0]?.id ?? preset.roomId);
    setDimensions({ ...preset.dimensions });
  };

  const choosePreset = (index: number) => {
    onDeselect();
    resetDraftToPreset(index);
    setError('');
    setSuccess('');
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setError('');
    setSuccess('');
    const selectedPreset = selectedObject ? objectPresets.find((preset) => getFurnitureKind(preset.category, preset.name) === getFurnitureKind(selectedObject.category, selectedObject.name)) : undefined;
    const draftResetIndex = selectedPreset ? objectPresets.indexOf(selectedPreset) : presetIndex;
    const selectedCategory = selectedObject ? objectPresets.find((preset) => preset.category === selectedObject.category)?.category : undefined;
    const objectName = selectedObject?.name ?? name.trim();
    const requestedRoomId = selectedObject?.roomId ?? roomId;
    const destinationRoomId = rooms.some((room) => room.id === requestedRoomId) ? requestedRoomId : rooms[0]?.id ?? requestedRoomId;
    const message = await onAdd({ name: objectName, category: selectedPreset?.category ?? selectedCategory ?? objectPresets[presetIndex].category, roomId: destinationRoomId, dimensions: selectedObject?.dimensions ?? dimensions });
    setSaving(false);
    if (message) setError(message);
    else {
      resetDraftToPreset(draftResetIndex);
      setSuccess(`${objectName} placed in ${rooms.find((room) => room.id === destinationRoomId)?.name ?? 'the selected room'}.`);
    }
  };

  const activeDimensions = selectedObject?.dimensions ?? dimensions;
  const activeName = selectedObject?.name ?? name;
  const activeRoomId = selectedObject?.roomId ?? roomId;
  const activePresetIndex = selectedObject ? objectPresets.findIndex((preset) => getFurnitureKind(preset.category, preset.name) === getFurnitureKind(selectedObject.category, selectedObject.name)) : presetIndex;
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
        <fieldset><legend>OBJECT TYPE</legend><div className="preset-grid">{objectPresets.map((preset, index) => <button type="button" key={preset.shortLabel} className={activePresetIndex === index ? 'active' : ''} onClick={() => choosePreset(index)}><span className="furniture-icon-frame" style={{ display: 'grid', flex: '0 0 42px', width: 48, height: 42, placeItems: 'center' }}><FurnitureGlyph category={preset.category} name={preset.name} /></span>{preset.shortLabel}</button>)}</div></fieldset>
        <label className="field-label">NAME<input required readOnly={Boolean(selectedObject)} value={activeName} onChange={(event) => setName(event.target.value)} /></label>
        <label className="field-label">PLACE IN<select disabled={Boolean(selectedObject)} value={rooms.some((room) => room.id === activeRoomId) ? activeRoomId : rooms[0]?.id ?? ''} onChange={(event) => setRoomId(event.target.value)}>{rooms.map((room) => <option key={room.id} value={room.id}>{room.name}</option>)}</select></label>
        <DimensionPreview name={selectedObject?.name ?? name} dimensions={activeDimensions} />
        <fieldset className="rhs-dimension-sliders"><legend>{selectedObject ? `EDIT ${selectedObject.name.toUpperCase()} · METERS` : 'DIMENSIONS · METERS'}</legend>{(['width', 'depth', 'height'] as const).map((key) => <label key={key}><span>{key[0].toUpperCase()} · {key.toUpperCase()}</span><input type="range" min="0.1" max={key === 'height' ? 3 : 4} step="0.01" value={activeDimensions[key]} onPointerDown={() => { resizeStart.current = selectedObject ? { ...selectedObject.dimensions } : null; }} onKeyDown={() => { if (!resizeStart.current && selectedObject) resizeStart.current = { ...selectedObject.dimensions }; }} onChange={(event) => setDimension(key, Number(event.target.value))} onPointerUp={(event) => commitDimension(key, Number(event.currentTarget.value))} onKeyUp={(event) => commitDimension(key, Number(event.currentTarget.value))} /><output>{activeDimensions[key].toFixed(2)}</output></label>)}</fieldset>
        <button className="place-object" disabled={loading || saving || !activeName.trim()}>{saving ? 'Placing…' : loading ? 'Loading project…' : '＋ Place in room'}</button>
        {error && <p className="object-form-message error" role="alert">{error}</p>}
        {success && <p className="object-form-message success" role="status">✓ {success}</p>}
      </form>
    </aside>
  );
}

function formatDimensions(dimensions: SceneObject['dimensions']) {
  return `${dimensions.width.toFixed(2)} × ${dimensions.depth.toFixed(2)} m`;
}

function PreviewControls({ hour, northAngle, architecture, measurements, onHour, onReset, onMeasurements }: { hour: number; northAngle: number; architecture: ArchitecturalElement[]; measurements: boolean; onHour: (n: number) => void; onReset: () => void; onMeasurements: (value: boolean) => void }) {
  const hasWindows = architecture.some((element) => element.kind === 'opening' && element.openingType === 'window');
  const exposure = getWindowExposureSummary(architecture, northAngle);
  return (
    <aside className="library-panel preview-controls">
      <div className="panel-heading"><div><span className="eyebrow">3D MODEL</span><h2>View controls</h2></div><span className="live-badge"><i /> LIVE</span></div>
      <button className="wide-control" onClick={onReset}>Reset perspective</button>
      <div className="control-section daylight-control"><label>SUNLIGHT PREVIEW <span>{timeLabel(hour)}</span></label><div className="sun-readout"><span className="sun-icon">{hasWindows ? '☀' : '●'}</span><div><strong>{hasWindows ? (hour < 12 ? 'Morning light' : hour < 16 ? 'Afternoon light' : 'Evening light') : 'Light · ON'}</strong><small>{hasWindows ? exposure : 'Artificial fill · no direct sunlight'}</small></div></div><div className="visual-estimate" role="note">Visual estimate · based on apartment orientation</div><input aria-label={`Sunlight preview time, ${timeLabel(hour)}`} type="range" min="7" max="20" step="0.25" value={hour} onChange={(e) => onHour(Number(e.target.value))} /><div className="range-labels"><span>7 AM</span><span>NOON</span><span>8 PM</span></div></div>
      <div className="control-section"><label>DISPLAY</label><label className="toggle-row">Furniture measurements <input type="checkbox" checked={measurements} onChange={(event) => onMeasurements(event.target.checked)} /><i /></label></div>
    </aside>
  );
}

function ThreeDView({ projectId, hour, northAngle, camera, cameraReset, measurements, objects, architecture, materialOverrides, onMaterialChange }: { projectId: string; hour: number; northAngle: number; camera: number; cameraReset: number; measurements: boolean; objects: SceneObject[]; architecture: ArchitecturalElement[]; materialOverrides: Record<string, string>; onMaterialChange: (targetKey: string, color: string | null) => Promise<string | null> }) {
  return (
    <section className="preview-workspace" aria-label="3D apartment preview">
      <div className="preview-topline"><div><span className="eyebrow">3D APARTMENT · SUNLIGHT PREVIEW</span><strong>{timeLabel(hour)}</strong></div></div>
      <ApartmentScene projectId={projectId} hour={hour} northAngle={northAngle} cameraStep={camera} cameraReset={cameraReset} measurements={measurements} objects={objects} architecture={architecture} materialOverrides={materialOverrides} onMaterialChange={onMaterialChange} />
      {measurements && <div className="sr-only" role="status">Furniture dimensions: {objects.map((item) => `${item.name}, width ${item.dimensions.width.toFixed(2)} meters, depth ${item.dimensions.depth.toFixed(2)} meters, height ${item.dimensions.height.toFixed(2)} meters`).join('; ')}</div>}
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
            <div className="confidence-card"><div><span>MODEL CONFIDENCE</span><strong>Geometry verified</strong></div><p>Furniture dimensions and saved window orientation are reflected in the visual preview.</p></div>
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
