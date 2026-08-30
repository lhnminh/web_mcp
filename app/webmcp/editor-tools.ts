import type { ArchitecturalElement, RoomElement, SceneDocument } from '@/lib/domain/scene';
import { polygonArea, wallLength } from '@/lib/domain/architecture';
import { pageInputSchemaProperties, paginate, parsePageInput } from './pagination';
import { toolFailure, toolSuccess } from './result';
import { renameProjectInputSchema } from './schemas';
import type { WebMcpResult, WebMcpTool } from './types';
import { finishTargetStates, harmonizeColor, isMaterialKey, normalizeHexColor, type FinishMood, type FinishTarget } from '@/lib/domain/materials';

export const CURRENT_EDITOR_TOOL_NAMES = [
  'dwellwise.get_project_summary',
  'dwellwise.list_furniture',
  'dwellwise.list_architecture',
  'dwellwise.list_finish_targets',
  'dwellwise.rename_project',
  'dwellwise.add_furniture',
  'dwellwise.update_furniture',
  'dwellwise.update_finish',
  'dwellwise.remove_furniture',
  'dwellwise.resize_apartment',
  'dwellwise.rename_room',
  'dwellwise.add_wall',
  'dwellwise.update_wall',
  'dwellwise.remove_wall',
  'dwellwise.add_exterior_corner',
  'dwellwise.remove_exterior_corner',
  'dwellwise.add_opening',
  'dwellwise.update_opening',
  'dwellwise.remove_opening',
  'dwellwise.set_editor_view',
  'dwellwise.set_sunlight_preview',
  'dwellwise.select_entity',
  'dwellwise.undo',
  'dwellwise.redo',
  'dwellwise.set_plan_zoom',
  'dwellwise.reset_3d_camera',
  'dwellwise.go_to_dashboard',
  'dwellwise.prepare_reset_project',
] as const;

export type EditorToolObject = {
  id: string;
  name: string;
  category: string;
  roomId: string;
  dimensions: { width: number; depth: number; height: number };
  transform: { position: { x: number; y: number; z: number }; rotation: { x: number; y: number; z: number } };
};

export type EditorToolSnapshot = {
  project: { id: string; name: string; revision: number; scene: SceneDocument };
  objects: EditorToolObject[];
  view: 'plan' | 'three' | 'evaluation';
  editMode: 'architecture' | 'furnish';
  hour: number;
  camera: number;
  measurements: boolean;
  zoom: number;
  selection: { kind: 'room' | 'wall' | 'opening' | 'furniture'; entityId: string } | null;
  canUndo: boolean;
  canRedo: boolean;
  architecturePreviewActive: boolean;
  confirmationActive: boolean;
  availableTools: string[];
};

export type AddFurnitureToolInput = {
  name: string;
  category: 'bed' | 'sofa' | 'desk' | 'table' | 'storage' | 'fixture' | 'other';
  roomId: string;
  dimensions: { width: number; depth: number; height: number };
};

export type UpdateFurnitureToolInput = {
  furnitureId: string;
  roomId?: string;
  position?: { x: number; z: number };
  rotationY?: number;
  dimensions?: { width: number; depth: number; height: number };
};

export type AddWallToolInput = { start: { x: number; y: number }; end: { x: number; y: number }; thickness?: number; height?: number };
export type UpdateWallToolInput = { wallId: string; start?: { x: number; y: number }; end?: { x: number; y: number }; length?: number; thickness?: number; height?: number };
export type AddOpeningToolInput = { openingType: 'door' | 'window'; wallId: string; offset?: number; width?: number; height?: number; sillHeight?: number; swing?: 'left' | 'right'; swingSide?: 'in' | 'out' };
export type UpdateOpeningToolInput = { openingId: string; offset?: number; width?: number; height?: number; sillHeight?: number; swing?: 'left' | 'right'; swingSide?: 'in' | 'out' };

export type EditorToolDependencies = {
  getSnapshot: () => EditorToolSnapshot | null;
  renameProject: (projectId: string | undefined, name: string, signal: AbortSignal) => Promise<WebMcpResult>;
  addFurniture: (input: AddFurnitureToolInput, signal: AbortSignal) => Promise<WebMcpResult>;
  updateFurniture: (input: UpdateFurnitureToolInput, signal: AbortSignal) => Promise<WebMcpResult>;
  updateFinish: (target: FinishTarget, color: string | null, signal: AbortSignal) => Promise<WebMcpResult>;
  removeFurniture: (furnitureId: string, signal: AbortSignal) => Promise<WebMcpResult>;
  resizeApartment: (width: number, depth: number, height: number, signal: AbortSignal) => Promise<WebMcpResult>;
  renameRoom: (roomId: string, name: string, signal: AbortSignal) => Promise<WebMcpResult>;
  addWall: (input: AddWallToolInput, signal: AbortSignal) => Promise<WebMcpResult>;
  updateWall: (input: UpdateWallToolInput, signal: AbortSignal) => Promise<WebMcpResult>;
  removeWall: (wallId: string, signal: AbortSignal) => Promise<WebMcpResult>;
  addExteriorCorner: (wallId: string, offsetMeters: number | undefined, signal: AbortSignal) => Promise<WebMcpResult>;
  removeExteriorCorner: (wallId: string, endpoint: 'start' | 'end', signal: AbortSignal) => Promise<WebMcpResult>;
  addOpening: (input: AddOpeningToolInput, signal: AbortSignal) => Promise<WebMcpResult>;
  updateOpening: (input: UpdateOpeningToolInput, signal: AbortSignal) => Promise<WebMcpResult>;
  removeOpening: (openingId: string, signal: AbortSignal) => Promise<WebMcpResult>;
  setEditorView: (view: 'plan' | 'three', editMode?: 'architecture' | 'furnish') => WebMcpResult;
  setSunlightPreview: (hour?: number, camera?: number, measurements?: boolean) => WebMcpResult;
  selectEntity: (kind: 'room' | 'wall' | 'opening' | 'furniture', entityId: string) => WebMcpResult;
  undo: (signal: AbortSignal) => Promise<WebMcpResult>;
  redo: (signal: AbortSignal) => Promise<WebMcpResult>;
  setPlanZoom: (zoom: number) => WebMcpResult;
  reset3dCamera: () => WebMcpResult;
  goToDashboard: () => WebMcpResult;
  prepareResetProject: () => WebMcpResult;
};

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const finiteNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const validId = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 128;
const categories = new Set(['bed', 'sofa', 'desk', 'table', 'storage', 'fixture', 'other']);
const dimensionsSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    width: { type: 'number', minimum: 0.1, maximum: 5 },
    depth: { type: 'number', minimum: 0.1, maximum: 5 },
    height: { type: 'number', minimum: 0.1, maximum: 5 },
  },
  required: ['width', 'depth', 'height'],
} as const;

const parseDimensions = (value: unknown) => {
  if (!isRecord(value)) return null;
  const { width, depth, height } = value;
  if (![width, depth, height].every((item) => finiteNumber(item) && item >= 0.1 && item <= 5)) return null;
  return { width: width as number, depth: depth as number, height: height as number };
};

const pointSchema = { type: 'object', additionalProperties: false, properties: { x: { type: 'number', minimum: -100, maximum: 100 }, y: { type: 'number', minimum: -100, maximum: 100 } }, required: ['x', 'y'] } as const;
const parsePoint = (value: unknown) => isRecord(value) && finiteNumber(value.x) && finiteNumber(value.y) && Math.abs(value.x) <= 100 && Math.abs(value.y) <= 100 ? { x: value.x, y: value.y } : null;
const wallProperties = {
  wallId: { type: 'string', minLength: 1, maxLength: 128 },
  start: pointSchema,
  end: pointSchema,
  length: { type: 'number', minimum: 0.1, maximum: 100 },
  thickness: { type: 'number', minimum: 0.05, maximum: 1 },
  height: { type: 'number', minimum: 1.8, maximum: 6 },
} as const;
const openingProperties = {
  openingId: { type: 'string', minLength: 1, maxLength: 128 },
  offset: { type: 'number', minimum: 0, maximum: 100 },
  width: { type: 'number', minimum: 0.5, maximum: 30 },
  height: { type: 'number', minimum: 0.3, maximum: 6 },
  sillHeight: { type: 'number', minimum: 0, maximum: 6 },
  swing: { type: 'string', enum: ['left', 'right'] },
  swingSide: { type: 'string', enum: ['in', 'out'] },
} as const;

export function projectSummary(snapshot: EditorToolSnapshot) {
  const architecture = snapshot.project.scene.architecture;
  const rooms = architecture.filter((element): element is RoomElement => element.kind === 'room').slice(0, 100);
  return {
    id: snapshot.project.id,
    name: snapshot.project.name.slice(0, 80),
    revision: snapshot.project.revision,
    units: snapshot.project.scene.units,
    coordinateSystem: snapshot.project.scene.coordinateSystem,
    northAngle: snapshot.project.scene.northAngle,
    activeLayoutId: 'layout-a',
    currentView: snapshot.view,
    editMode: snapshot.editMode,
    selection: snapshot.selection,
    canUndo: snapshot.canUndo,
    canRedo: snapshot.canRedo,
    planZoom: snapshot.zoom,
    preview: { hour: snapshot.hour, camera: snapshot.camera, measurements: snapshot.measurements },
    architecturePreviewActive: snapshot.architecturePreviewActive,
    confirmationActive: snapshot.confirmationActive,
    availableTools: snapshot.availableTools.slice(0, 100),
    rooms: rooms.map((room) => ({ id: room.id.slice(0, 128), name: room.name.slice(0, 80), area: Number(polygonArea(room.boundary).toFixed(2)), ceilingHeight: room.ceilingHeight })),
    counts: {
      rooms: architecture.filter((element) => element.kind === 'room').length,
      walls: architecture.filter((element) => element.kind === 'wall').length,
      doors: architecture.filter((element) => element.kind === 'opening' && element.openingType === 'door').length,
      windows: architecture.filter((element) => element.kind === 'opening' && element.openingType === 'window').length,
      furniture: snapshot.objects.length,
    },
    finishes: Object.entries(snapshot.project.scene.materialOverrides ?? {}).slice(0, 100).map(([targetKey, color]) => ({ targetKey, color })),
  };
}

export function furnitureSummary(snapshot: EditorToolSnapshot) {
  return snapshot.objects.map((item) => ({
    id: item.id.slice(0, 128),
    name: item.name.slice(0, 80),
    category: item.category.slice(0, 40),
    roomId: item.roomId.slice(0, 128),
    dimensions: item.dimensions,
    position: { x: item.transform.position.x, z: item.transform.position.z },
    rotationY: item.transform.rotation.y,
  }));
}

export function architectureSummary(architecture: ArchitecturalElement[]) {
  return architecture.map((element) => {
    if (element.kind === 'room') return { id: element.id.slice(0, 128), kind: element.kind, name: element.name.slice(0, 80), boundary: element.boundary.slice(0, 50), area: Number(polygonArea(element.boundary).toFixed(2)), ceilingHeight: element.ceilingHeight };
    if (element.kind === 'wall') return { id: element.id.slice(0, 128), kind: element.kind, start: element.start, end: element.end, length: Number(wallLength(element).toFixed(3)), thickness: element.thickness, height: element.height };
    return { id: element.id.slice(0, 128), kind: element.kind, openingType: element.openingType, wallId: element.wallId.slice(0, 128), offset: element.offset, width: element.width, height: element.height, sillHeight: element.sillHeight, swing: element.swing, swingSide: element.swingSide };
  });
}

export function finishTargetSummary(snapshot: EditorToolSnapshot) {
  return finishTargetStates(snapshot.project.scene.architecture, snapshot.objects, snapshot.project.scene.materialOverrides ?? {});
}

const snapshotOrFailure = (dependencies: EditorToolDependencies) => dependencies.getSnapshot() ?? toolFailure('NOT_READY', 'The apartment is still loading.', { retryable: true });

export function buildEditorTools(dependencies: EditorToolDependencies): WebMcpTool[] {
  const readAnnotations = { readOnlyHint: true, untrustedContentHint: true };
  const writeAnnotations = { readOnlyHint: false, untrustedContentHint: true };
  const emptyInputSchema = { type: 'object', additionalProperties: false, properties: {} };
  return [
    {
      name: 'dwellwise.get_project_summary', title: 'Inspect the current Dwellwise apartment',
      description: 'Return a bounded summary of the current saved apartment, including revision, units, rooms, entity counts, and current editor view. This is read-only.',
      inputSchema: emptyInputSchema, annotations: readAnnotations,
      execute: () => {
        const snapshot = snapshotOrFailure(dependencies);
        if ('ok' in snapshot) return snapshot;
        return toolSuccess('Loaded the current apartment summary.', { projectId: snapshot.project.id, revision: snapshot.project.revision, data: { project: projectSummary(snapshot) } });
      },
    },
    {
      name: 'dwellwise.list_furniture', title: 'List furniture in the current apartment',
      description: 'Return one bounded page of furniture for the active layout, including IDs, room IDs, dimensions and positions in meters, and rotations in degrees. This is read-only.',
      inputSchema: { type: 'object', additionalProperties: false, properties: { ...pageInputSchemaProperties, roomId: { type: 'string', minLength: 1, maxLength: 128 } } }, annotations: readAnnotations,
      execute: (input) => {
        if (!isRecord(input) || (input.roomId !== undefined && !validId(input.roomId))) return toolFailure('INVALID_INPUT', 'Input must contain only a valid limit, cursor, or roomId.');
        const snapshot = snapshotOrFailure(dependencies);
        if ('ok' in snapshot) return snapshot;
        const roomId = input.roomId as string | undefined;
        const consistency = `${snapshot.project.id}:${snapshot.project.revision}`;
        const query = `roomId=${roomId ?? ''}`;
        const page = parsePageInput(input, { scope: 'furniture', consistency, query });
        if ('ok' in page) return page;
        const allFurniture = furnitureSummary(snapshot).filter((item) => !roomId || item.roomId === roomId);
        const result = paginate(allFurniture, page, { scope: 'furniture', consistency, query });
        return toolSuccess('Loaded furniture in the active layout.', { projectId: snapshot.project.id, revision: snapshot.project.revision, data: { furniture: result.items, ...(result.nextCursor ? { nextCursor: result.nextCursor } : {}) } });
      },
    },
    {
      name: 'dwellwise.list_architecture', title: 'List architecture in the current apartment',
      description: 'Return one bounded page of rooms, walls, doors, and windows with stable IDs and measurements in meters. Filter by kind or parent wall. This is read-only.',
      inputSchema: { type: 'object', additionalProperties: false, properties: { ...pageInputSchemaProperties, kind: { type: 'string', enum: ['room', 'wall', 'opening', 'door', 'window'] }, wallId: { type: 'string', minLength: 1, maxLength: 128 } } }, annotations: readAnnotations,
      execute: (input) => {
        if (!isRecord(input) || (input.kind !== undefined && !['room', 'wall', 'opening', 'door', 'window'].includes(String(input.kind))) || (input.wallId !== undefined && !validId(input.wallId))) return toolFailure('INVALID_INPUT', 'Input must contain only a valid limit, cursor, kind, or wallId.');
        const snapshot = snapshotOrFailure(dependencies);
        if ('ok' in snapshot) return snapshot;
        const kind = input.kind as 'room' | 'wall' | 'opening' | 'door' | 'window' | undefined;
        const wallId = input.wallId as string | undefined;
        const consistency = `${snapshot.project.id}:${snapshot.project.revision}`;
        const query = `kind=${kind ?? ''}&wallId=${wallId ?? ''}`;
        const filtered = snapshot.project.scene.architecture.filter((element) => {
          const kindMatches = !kind || element.kind === kind || (element.kind === 'opening' && (kind === element.openingType));
          const wallMatches = !wallId || (element.kind === 'opening' && element.wallId === wallId);
          return kindMatches && wallMatches;
        });
        const page = parsePageInput(input, { scope: 'architecture', consistency, query });
        if ('ok' in page) return page;
        const result = paginate(architectureSummary(filtered), page, { scope: 'architecture', consistency, query });
        return toolSuccess('Loaded architecture in the current apartment.', { projectId: snapshot.project.id, revision: snapshot.project.revision, data: { architecture: result.items, ...(result.nextCursor ? { nextCursor: result.nextCursor } : {}) } });
      },
    },
    {
      name: 'dwellwise.list_finish_targets', title: 'List editable 3D material finishes',
      description: 'Return valid furniture parts, floors, walls, door panels, and window frames that can be recolored. Read this catalog before calling update_finish.',
      inputSchema: { type: 'object', additionalProperties: false, properties: { ...pageInputSchemaProperties, scope: { type: 'string', enum: ['furniture', 'room', 'wall', 'opening'] }, entityId: { type: 'string', minLength: 1, maxLength: 128 }, overridden: { type: 'boolean' } } },
      annotations: readAnnotations,
      execute: (input) => {
        if (!isRecord(input) || (input.scope !== undefined && !['furniture', 'room', 'wall', 'opening'].includes(String(input.scope))) || (input.entityId !== undefined && !validId(input.entityId)) || (input.overridden !== undefined && typeof input.overridden !== 'boolean')) return toolFailure('INVALID_INPUT', 'Input must contain only a valid limit, cursor, scope, entityId, or overridden filter.');
        const snapshot = snapshotOrFailure(dependencies);
        if ('ok' in snapshot) return snapshot;
        const scope = input.scope as 'furniture' | 'room' | 'wall' | 'opening' | undefined;
        const entityId = input.entityId as string | undefined;
        const overridden = input.overridden as boolean | undefined;
        const consistency = `${snapshot.project.id}:${snapshot.project.revision}`;
        const query = `scope=${scope ?? ''}&entityId=${entityId ?? ''}&overridden=${overridden ?? ''}`;
        const page = parsePageInput(input, { scope: 'finish-targets', consistency, query });
        if ('ok' in page) return page;
        const targets = finishTargetSummary(snapshot).filter((target) => (!scope || target.scope === scope) && (!entityId || target.entityId === entityId) && (overridden === undefined || target.overridden === overridden));
        const result = paginate(targets, page, { scope: 'finish-targets', consistency, query });
        return toolSuccess('Loaded editable 3D finish targets.', { projectId: snapshot.project.id, revision: snapshot.project.revision, data: { targets: result.items, ...(result.nextCursor ? { nextCursor: result.nextCursor } : {}) } });
      },
    },
    {
      name: 'dwellwise.rename_project', title: 'Rename the current Dwellwise apartment',
      description: 'Rename and save the current apartment. The name must contain 1 to 80 characters.',
      inputSchema: renameProjectInputSchema,
      annotations: writeAnnotations,
      execute: (input, { signal }) => {
        if (!isRecord(input) || (input.projectId !== undefined && !validId(input.projectId)) || typeof input.name !== 'string' || !input.name.trim() || input.name.trim().length > 80) return toolFailure('INVALID_INPUT', 'name must be between 1 and 80 characters; projectId must be a valid ID when provided.');
        return dependencies.renameProject(input.projectId as string | undefined, input.name.trim(), signal);
      },
    },
    {
      name: 'dwellwise.add_furniture', title: 'Add furniture to the current apartment',
      description: 'Add and save one furniture item in an existing room. Dimensions are in meters. Use a room ID returned by a Dwellwise read tool.',
      inputSchema: { type: 'object', additionalProperties: false, properties: { name: { type: 'string', minLength: 1, maxLength: 80 }, category: { type: 'string', enum: [...categories] }, roomId: { type: 'string', minLength: 1, maxLength: 128 }, dimensions: dimensionsSchema }, required: ['name', 'category', 'roomId', 'dimensions'] },
      annotations: writeAnnotations,
      execute: (input, { signal }) => {
        const dimensions = isRecord(input) ? parseDimensions(input.dimensions) : null;
        if (!isRecord(input) || typeof input.name !== 'string' || !input.name.trim() || input.name.trim().length > 80 || typeof input.category !== 'string' || !categories.has(input.category) || !validId(input.roomId) || !dimensions) {
          return toolFailure('INVALID_INPUT', 'Provide a name, supported category, existing roomId, and width, depth, and height between 0.1 and 5 meters.');
        }
        return dependencies.addFurniture({ name: input.name.trim(), category: input.category as AddFurnitureToolInput['category'], roomId: input.roomId, dimensions }, signal);
      },
    },
    {
      name: 'dwellwise.update_furniture', title: 'Update furniture in the current apartment',
      description: 'Move, rotate, resize, or reassign one saved furniture item. Positions and dimensions are in meters; rotationY is in degrees.',
      inputSchema: {
        type: 'object', additionalProperties: false,
        properties: {
          furnitureId: { type: 'string', minLength: 1, maxLength: 128 }, roomId: { type: 'string', minLength: 1, maxLength: 128 },
          position: { type: 'object', additionalProperties: false, properties: { x: { type: 'number', minimum: -100, maximum: 100 }, z: { type: 'number', minimum: -100, maximum: 100 } }, required: ['x', 'z'] },
          rotationY: { type: 'number', minimum: -360, maximum: 360 }, dimensions: dimensionsSchema,
        },
        required: ['furnitureId'],
        anyOf: [{ required: ['roomId'] }, { required: ['position'] }, { required: ['rotationY'] }, { required: ['dimensions'] }],
      },
      annotations: writeAnnotations,
      execute: (input, { signal }) => {
        if (!isRecord(input) || !validId(input.furnitureId)) return toolFailure('INVALID_INPUT', 'furnitureId is required.');
        const roomId = input.roomId === undefined ? undefined : validId(input.roomId) ? input.roomId : null;
        const position = input.position === undefined ? undefined : isRecord(input.position) && finiteNumber(input.position.x) && finiteNumber(input.position.z) && Math.abs(input.position.x) <= 100 && Math.abs(input.position.z) <= 100 ? { x: input.position.x, z: input.position.z } : null;
        const rotationY = input.rotationY === undefined ? undefined : finiteNumber(input.rotationY) && Math.abs(input.rotationY) <= 360 ? input.rotationY : null;
        const dimensions = input.dimensions === undefined ? undefined : parseDimensions(input.dimensions);
        if (roomId === null || position === null || rotationY === null || dimensions === null || (roomId === undefined && position === undefined && rotationY === undefined && dimensions === undefined)) return toolFailure('INVALID_INPUT', 'Provide at least one valid roomId, position, rotationY, or dimensions update.');
        return dependencies.updateFurniture({ furnitureId: input.furnitureId, roomId, position, rotationY, dimensions }, signal);
      },
    },
    {
      name: 'dwellwise.remove_furniture', title: 'Remove furniture from the current apartment',
      description: 'Remove one unlocked furniture item from the active layout and save the project. This is destructive but participates in the editor undo history.',
      inputSchema: { type: 'object', additionalProperties: false, properties: { furnitureId: { type: 'string', minLength: 1, maxLength: 128 } }, required: ['furnitureId'] },
      annotations: writeAnnotations,
      execute: (input, { signal }) => !isRecord(input) || !validId(input.furnitureId) ? toolFailure('INVALID_INPUT', 'furnitureId is required.') : dependencies.removeFurniture(input.furnitureId, signal),
    },
    {
      name: 'dwellwise.update_finish', title: 'Update a 3D material finish',
      description: 'Apply a harmonized color to a valid 3D finish target or reset it to the original finish. Read exact target keys from list_finish_targets first.',
      inputSchema: {
        type: 'object', additionalProperties: false,
        properties: { targetKey: { type: 'string', minLength: 3, maxLength: 180 }, operation: { type: 'string', enum: ['apply', 'reset'] }, color: { type: 'string', pattern: '^#[0-9a-fA-F]{6}$' }, mood: { type: 'string', enum: ['soft', 'balanced', 'bold'] } },
        required: ['targetKey', 'operation'],
        oneOf: [
          { properties: { operation: { const: 'apply' } }, required: ['color'] },
          { properties: { operation: { const: 'reset' } }, not: { anyOf: [{ required: ['color'] }, { required: ['mood'] }] } },
        ],
      },
      annotations: writeAnnotations,
      execute: (input, { signal }) => {
        const allowedFields = new Set(['targetKey', 'operation', 'color', 'mood']);
        if (!isRecord(input) || Object.keys(input).some((key) => !allowedFields.has(key)) || typeof input.targetKey !== 'string' || !isMaterialKey(input.targetKey) || !['apply', 'reset'].includes(String(input.operation)) || (input.operation === 'apply' && (typeof input.color !== 'string' || !normalizeHexColor(input.color))) || (input.operation === 'reset' && (input.color !== undefined || input.mood !== undefined)) || (input.mood !== undefined && !['soft', 'balanced', 'bold'].includes(String(input.mood)))) return toolFailure('INVALID_INPUT', 'Provide a listed target and either apply with a six-digit hex color and optional mood, or reset without color fields.');
        const snapshot = snapshotOrFailure(dependencies);
        if ('ok' in snapshot) return snapshot;
        const target = finishTargetSummary(snapshot).find((candidate) => candidate.targetKey === input.targetKey);
        if (!target) return toolFailure('TARGET_NOT_FOUND', 'That finish target is not available in the current apartment. Call list_finish_targets again.', { retryable: true, currentRevision: snapshot.project.revision });
        const color = input.operation === 'reset' ? null : harmonizeColor(input.color as string, target.role, (input.mood ?? 'balanced') as FinishMood);
        const descriptor: FinishTarget = { targetKey: target.targetKey, scope: target.scope, entityId: target.entityId, ownerLabel: target.ownerLabel, part: target.part, partLabel: target.partLabel, role: target.role, defaultColor: target.defaultColor };
        if (input.operation === 'reset' && !target.overridden) return toolSuccess('That 3D finish already uses its original color.', { projectId: snapshot.project.id, revision: snapshot.project.revision, data: { target: descriptor, operation: 'reset', effectiveColor: target.defaultColor, overridden: false } });
        if (input.operation === 'apply' && target.overridden && target.effectiveColor === color) return toolSuccess('That 3D finish already uses the requested refined color.', { projectId: snapshot.project.id, revision: snapshot.project.revision, data: { target: descriptor, operation: 'apply', effectiveColor: color, overridden: true } });
        return dependencies.updateFinish(descriptor, color, signal);
      },
    },
    {
      name: 'dwellwise.resize_apartment', title: 'Resize the current apartment',
      description: 'Resize and save the apartment footprint width and depth in meters and its wall and ceiling height in meters.',
      inputSchema: { type: 'object', additionalProperties: false, properties: { width: { type: 'number', minimum: 2, maximum: 30 }, depth: { type: 'number', minimum: 2, maximum: 30 }, height: { type: 'number', minimum: 1.8, maximum: 6 } }, required: ['width', 'depth', 'height'] },
      annotations: writeAnnotations,
      execute: (input, { signal }) => !isRecord(input) || !finiteNumber(input.width) || input.width < 2 || input.width > 30 || !finiteNumber(input.depth) || input.depth < 2 || input.depth > 30 || !finiteNumber(input.height) || input.height < 1.8 || input.height > 6
        ? toolFailure('INVALID_INPUT', 'width and depth must be between 2 and 30 meters; height must be between 1.8 and 6 meters.')
        : dependencies.resizeApartment(input.width, input.depth, input.height, signal),
    },
    {
      name: 'dwellwise.rename_room', title: 'Rename a room in the current apartment',
      description: 'Rename and save an existing derived room. The room boundary is not directly editable.',
      inputSchema: { type: 'object', additionalProperties: false, properties: { roomId: { type: 'string', minLength: 1, maxLength: 128 }, name: { type: 'string', minLength: 1, maxLength: 40 } }, required: ['roomId', 'name'] },
      annotations: writeAnnotations,
      execute: (input, { signal }) => !isRecord(input) || !validId(input.roomId) || typeof input.name !== 'string' || !input.name.trim() || input.name.trim().length > 40
        ? toolFailure('INVALID_INPUT', 'roomId and a room name between 1 and 40 characters are required.')
        : dependencies.renameRoom(input.roomId, input.name.trim(), signal),
    },
    {
      name: 'dwellwise.add_wall', title: 'Add an interior wall to the current apartment',
      description: 'Add and save one interior wall between two points in meters. Optional thickness and height use the same bounds as the human editor.',
      inputSchema: { type: 'object', additionalProperties: false, properties: { start: pointSchema, end: pointSchema, thickness: wallProperties.thickness, height: wallProperties.height }, required: ['start', 'end'] },
      annotations: writeAnnotations,
      execute: (input, { signal }) => {
        const start = isRecord(input) ? parsePoint(input.start) : null;
        const end = isRecord(input) ? parsePoint(input.end) : null;
        const thickness = isRecord(input) && input.thickness !== undefined ? finiteNumber(input.thickness) && input.thickness >= 0.05 && input.thickness <= 1 ? input.thickness : null : undefined;
        const height = isRecord(input) && input.height !== undefined ? finiteNumber(input.height) && input.height >= 1.8 && input.height <= 6 ? input.height : null : undefined;
        if (!start || !end || thickness === null || height === null) return toolFailure('INVALID_INPUT', 'Provide bounded start and end points, thickness, and height in meters.');
        return dependencies.addWall({ start, end, thickness, height }, signal);
      },
    },
    {
      name: 'dwellwise.update_wall', title: 'Update a wall in the current apartment',
      description: 'Update and save wall endpoints, length, thickness, or height. Exterior endpoint changes preserve the connected perimeter.',
      inputSchema: { type: 'object', additionalProperties: false, properties: wallProperties, required: ['wallId'], anyOf: [{ required: ['start'] }, { required: ['end'] }, { required: ['length'] }, { required: ['thickness'] }, { required: ['height'] }] },
      annotations: writeAnnotations,
      execute: (input, { signal }) => {
        if (!isRecord(input) || !validId(input.wallId)) return toolFailure('INVALID_INPUT', 'wallId is required.');
        const start = input.start === undefined ? undefined : parsePoint(input.start);
        const end = input.end === undefined ? undefined : parsePoint(input.end);
        const length = input.length === undefined ? undefined : finiteNumber(input.length) && input.length >= 0.1 && input.length <= 100 ? input.length : null;
        const thickness = input.thickness === undefined ? undefined : finiteNumber(input.thickness) && input.thickness >= 0.05 && input.thickness <= 1 ? input.thickness : null;
        const height = input.height === undefined ? undefined : finiteNumber(input.height) && input.height >= 1.8 && input.height <= 6 ? input.height : null;
        if (start === null || end === null || length === null || thickness === null || height === null || [start, end, length, thickness, height].every((value) => value === undefined)) return toolFailure('INVALID_INPUT', 'Provide at least one valid wall endpoint, length, thickness, or height update.');
        return dependencies.updateWall({ wallId: input.wallId, start, end, length, thickness, height }, signal);
      },
    },
    {
      name: 'dwellwise.remove_wall', title: 'Remove an interior wall from the current apartment',
      description: 'Remove and save one eligible interior wall. Exterior walls and walls containing openings are rejected with prerequisite guidance.',
      inputSchema: { type: 'object', additionalProperties: false, properties: { wallId: wallProperties.wallId }, required: ['wallId'] },
      annotations: writeAnnotations,
      execute: (input, { signal }) => !isRecord(input) || !validId(input.wallId) ? toolFailure('INVALID_INPUT', 'wallId is required.') : dependencies.removeWall(input.wallId, signal),
    },
    {
      name: 'dwellwise.add_exterior_corner', title: 'Add a corner to the apartment exterior',
      description: 'Split and save an exterior wall at an optional offset in meters from its start. Omission uses the midpoint.',
      inputSchema: { type: 'object', additionalProperties: false, properties: { wallId: wallProperties.wallId, offsetMeters: { type: 'number', minimum: 0.1, maximum: 100 } }, required: ['wallId'] },
      annotations: writeAnnotations,
      execute: (input, { signal }) => !isRecord(input) || !validId(input.wallId) || (input.offsetMeters !== undefined && (!finiteNumber(input.offsetMeters) || input.offsetMeters < 0.1 || input.offsetMeters > 100))
        ? toolFailure('INVALID_INPUT', 'wallId is required and offsetMeters must be between 0.10 and 100 meters when provided.')
        : dependencies.addExteriorCorner(input.wallId, input.offsetMeters as number | undefined, signal),
    },
    {
      name: 'dwellwise.remove_exterior_corner', title: 'Remove a corner from the apartment exterior',
      description: 'Merge the two eligible exterior edges meeting at the selected wall endpoint and save the result.',
      inputSchema: { type: 'object', additionalProperties: false, properties: { wallId: wallProperties.wallId, endpoint: { type: 'string', enum: ['start', 'end'] } }, required: ['wallId', 'endpoint'] },
      annotations: writeAnnotations,
      execute: (input, { signal }) => !isRecord(input) || !validId(input.wallId) || !['start', 'end'].includes(String(input.endpoint))
        ? toolFailure('INVALID_INPUT', 'wallId and endpoint start or end are required.')
        : dependencies.removeExteriorCorner(input.wallId, input.endpoint as 'start' | 'end', signal),
    },
    {
      name: 'dwellwise.add_opening', title: 'Add a door or window to a wall',
      description: 'Add and save a door or window on an eligible wall. Omitted measurements use the human editor’s safe placement defaults.',
      inputSchema: { type: 'object', additionalProperties: false, properties: { openingType: { type: 'string', enum: ['door', 'window'] }, wallId: wallProperties.wallId, ...Object.fromEntries(Object.entries(openingProperties).filter(([key]) => key !== 'openingId')) }, required: ['openingType', 'wallId'] },
      annotations: writeAnnotations,
      execute: (input, { signal }) => {
        if (!isRecord(input) || !['door', 'window'].includes(String(input.openingType)) || !validId(input.wallId)) return toolFailure('INVALID_INPUT', 'openingType and wallId are required.');
        const optionalNumber = (key: 'offset' | 'width' | 'height' | 'sillHeight') => input[key] === undefined ? undefined : finiteNumber(input[key]) ? input[key] : null;
        const offset = optionalNumber('offset'); const width = optionalNumber('width'); const height = optionalNumber('height'); const sillHeight = optionalNumber('sillHeight');
        if ([offset, width, height, sillHeight].includes(null) || (input.swing !== undefined && !['left', 'right'].includes(String(input.swing))) || (input.swingSide !== undefined && !['in', 'out'].includes(String(input.swingSide)))) return toolFailure('INVALID_INPUT', 'Opening measurements and swing properties must use the documented bounded values.');
        if (input.openingType === 'window' && (input.swing !== undefined || input.swingSide !== undefined)) return toolFailure('INVALID_INPUT', 'Door swing properties cannot be applied to a window.');
        if (input.openingType === 'door' && sillHeight !== undefined && sillHeight !== 0) return toolFailure('INVALID_INPUT', 'Doors must have a sill height of zero.');
        return dependencies.addOpening({ openingType: input.openingType as 'door' | 'window', wallId: input.wallId, offset: offset as number | undefined, width: width as number | undefined, height: height as number | undefined, sillHeight: sillHeight as number | undefined, swing: input.swing as 'left' | 'right' | undefined, swingSide: input.swingSide as 'in' | 'out' | undefined }, signal);
      },
    },
    {
      name: 'dwellwise.update_opening', title: 'Update a door or window',
      description: 'Move, resize, or update swing properties for an existing opening and save it.',
      inputSchema: { type: 'object', additionalProperties: false, properties: openingProperties, required: ['openingId'], anyOf: [{ required: ['offset'] }, { required: ['width'] }, { required: ['height'] }, { required: ['sillHeight'] }, { required: ['swing'] }, { required: ['swingSide'] }] },
      annotations: writeAnnotations,
      execute: (input, { signal }) => {
        if (!isRecord(input) || !validId(input.openingId)) return toolFailure('INVALID_INPUT', 'openingId is required.');
        const optionalNumber = (key: 'offset' | 'width' | 'height' | 'sillHeight') => input[key] === undefined ? undefined : finiteNumber(input[key]) ? input[key] : null;
        const offset = optionalNumber('offset'); const width = optionalNumber('width'); const height = optionalNumber('height'); const sillHeight = optionalNumber('sillHeight');
        if ([offset, width, height, sillHeight].includes(null) || (input.swing !== undefined && !['left', 'right'].includes(String(input.swing))) || (input.swingSide !== undefined && !['in', 'out'].includes(String(input.swingSide))) || [offset, width, height, sillHeight, input.swing, input.swingSide].every((value) => value === undefined)) return toolFailure('INVALID_INPUT', 'Provide at least one valid opening update.');
        return dependencies.updateOpening({ openingId: input.openingId, offset: offset as number | undefined, width: width as number | undefined, height: height as number | undefined, sillHeight: sillHeight as number | undefined, swing: input.swing as 'left' | 'right' | undefined, swingSide: input.swingSide as 'in' | 'out' | undefined }, signal);
      },
    },
    {
      name: 'dwellwise.remove_opening', title: 'Remove a door or window',
      description: 'Remove and save one existing door or window. The change remains available to editor undo.',
      inputSchema: { type: 'object', additionalProperties: false, properties: { openingId: openingProperties.openingId }, required: ['openingId'] },
      annotations: writeAnnotations,
      execute: (input, { signal }) => !isRecord(input) || !validId(input.openingId) ? toolFailure('INVALID_INPUT', 'openingId is required.') : dependencies.removeOpening(input.openingId, signal),
    },
    {
      name: 'dwellwise.set_editor_view', title: 'Change the current Dwellwise editor view',
      description: 'Change the visible editor to the plan or 3D preview. An optional plan edit mode can be selected. This current-page change is not saved.',
      inputSchema: { type: 'object', additionalProperties: false, properties: { view: { type: 'string', enum: ['plan', 'three'] }, editMode: { type: 'string', enum: ['architecture', 'furnish'] } }, required: ['view'] },
      annotations: { readOnlyHint: false, untrustedContentHint: false },
      execute: (input) => !isRecord(input) || !['plan', 'three'].includes(String(input.view)) || (input.editMode !== undefined && !['architecture', 'furnish'].includes(String(input.editMode)))
        ? toolFailure('INVALID_INPUT', 'view must be plan or three; editMode must be architecture or furnish.')
        : dependencies.setEditorView(input.view as 'plan' | 'three', input.editMode as 'architecture' | 'furnish' | undefined),
    },
    {
      name: 'dwellwise.set_sunlight_preview', title: 'Change the Dwellwise sunlight preview',
      description: 'Open and adjust the current 3D visual sunlight estimate. Time is an hour from 7 through 20, camera is -2 through 2, and measurements toggles furniture dimensions. These changes are not saved.',
      inputSchema: { type: 'object', additionalProperties: false, properties: { hour: { type: 'number', minimum: 7, maximum: 20 }, camera: { type: 'integer', minimum: -2, maximum: 2 }, measurements: { type: 'boolean' } }, anyOf: [{ required: ['hour'] }, { required: ['camera'] }, { required: ['measurements'] }] },
      annotations: { readOnlyHint: false, untrustedContentHint: false },
      execute: (input) => {
        if (!isRecord(input)) return toolFailure('INVALID_INPUT', 'Input must be an object.');
        const hour = input.hour === undefined ? undefined : finiteNumber(input.hour) && input.hour >= 7 && input.hour <= 20 ? input.hour : null;
        const camera = input.camera === undefined ? undefined : Number.isInteger(input.camera) && Number(input.camera) >= -2 && Number(input.camera) <= 2 ? Number(input.camera) : null;
        const measurements = input.measurements === undefined ? undefined : typeof input.measurements === 'boolean' ? input.measurements : null;
        if (hour === null || camera === null || measurements === null || (hour === undefined && camera === undefined && measurements === undefined)) return toolFailure('INVALID_INPUT', 'Provide a valid hour, camera, or measurements value.');
        return dependencies.setSunlightPreview(hour, camera, measurements);
      },
    },
    {
      name: 'dwellwise.select_entity', title: 'Select an entity in the Dwellwise editor',
      description: 'Select an existing room, wall, opening, or furniture item so it is visible for human inspection. This current-page change is not saved.',
      inputSchema: { type: 'object', additionalProperties: false, properties: { kind: { type: 'string', enum: ['room', 'wall', 'opening', 'furniture'] }, entityId: { type: 'string', minLength: 1, maxLength: 128 } }, required: ['kind', 'entityId'] },
      annotations: { readOnlyHint: false, untrustedContentHint: false },
      execute: (input) => !isRecord(input) || !['room', 'wall', 'opening', 'furniture'].includes(String(input.kind)) || !validId(input.entityId)
        ? toolFailure('INVALID_INPUT', 'kind and entityId are required.')
        : dependencies.selectEntity(input.kind as 'room' | 'wall' | 'opening' | 'furniture', input.entityId),
    },
    {
      name: 'dwellwise.undo', title: 'Undo the last Dwellwise editor change',
      description: 'Undo and save the latest available architecture or furniture history entry. Returns NO_HISTORY when no undo entry is available.',
      inputSchema: emptyInputSchema,
      annotations: writeAnnotations,
      execute: (_input, { signal }) => dependencies.undo(signal),
    },
    {
      name: 'dwellwise.redo', title: 'Redo the last undone Dwellwise editor change',
      description: 'Redo and save the latest available editor history entry. Returns NO_HISTORY when no redo entry is available.',
      inputSchema: emptyInputSchema,
      annotations: writeAnnotations,
      execute: (_input, { signal }) => dependencies.redo(signal),
    },
    {
      name: 'dwellwise.set_plan_zoom', title: 'Set the Dwellwise plan zoom',
      description: 'Set the visible 2D plan zoom to an absolute percentage from 50 through 120. This current-page change is not saved.',
      inputSchema: { type: 'object', additionalProperties: false, properties: { zoom: { type: 'integer', minimum: 50, maximum: 120 } }, required: ['zoom'] },
      annotations: { readOnlyHint: false, untrustedContentHint: false },
      execute: (input) => !isRecord(input) || !Number.isInteger(input.zoom) || Number(input.zoom) < 50 || Number(input.zoom) > 120
        ? toolFailure('INVALID_INPUT', 'zoom must be an integer from 50 through 120.')
        : dependencies.setPlanZoom(Number(input.zoom)),
    },
    {
      name: 'dwellwise.reset_3d_camera', title: 'Reset the Dwellwise 3D camera',
      description: 'Open the 3D preview and reset its perspective and bounded camera step. This current-page change is not saved.',
      inputSchema: emptyInputSchema,
      annotations: { readOnlyHint: false, untrustedContentHint: false },
      execute: () => dependencies.reset3dCamera(),
    },
    {
      name: 'dwellwise.go_to_dashboard', title: 'Return to the Dwellwise dashboard',
      description: 'Navigate from the current editor to the apartment dashboard. This changes the current page.',
      inputSchema: emptyInputSchema,
      annotations: { readOnlyHint: false, untrustedContentHint: false },
      execute: () => dependencies.goToDashboard(),
    },
    {
      name: 'dwellwise.prepare_reset_project', title: 'Prepare a full Dwellwise apartment reset',
      description: 'Display a visible human confirmation for resetting the active apartment. This tool never resets data or accepts agent confirmation.',
      inputSchema: emptyInputSchema,
      annotations: { readOnlyHint: false, untrustedContentHint: false },
      execute: () => dependencies.prepareResetProject(),
    },
  ];
}
