import type { ArchitecturalElement, RoomElement, SceneDocument } from '@/lib/domain/scene';
import { polygonArea, wallLength } from '@/lib/domain/architecture';
import { toolFailure, toolSuccess } from './result';
import type { WebMcpResult, WebMcpTool } from './types';

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
};

export type AddFurnitureToolInput = {
  name: string;
  category: 'bed' | 'sofa' | 'desk' | 'table' | 'storage' | 'other';
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

export type EditorToolDependencies = {
  getSnapshot: () => EditorToolSnapshot | null;
  renameProject: (name: string, signal: AbortSignal) => Promise<WebMcpResult>;
  addFurniture: (input: AddFurnitureToolInput, signal: AbortSignal) => Promise<WebMcpResult>;
  updateFurniture: (input: UpdateFurnitureToolInput, signal: AbortSignal) => Promise<WebMcpResult>;
  removeFurniture: (furnitureId: string, signal: AbortSignal) => Promise<WebMcpResult>;
  resizeApartment: (width: number, depth: number, height: number, signal: AbortSignal) => Promise<WebMcpResult>;
  setEditorView: (view: 'plan' | 'three' | 'evaluation', editMode?: 'architecture' | 'furnish') => WebMcpResult;
  setSunlightPreview: (hour?: number, camera?: number, measurements?: boolean) => WebMcpResult;
  selectEntity: (kind: 'room' | 'wall' | 'opening' | 'furniture', entityId: string) => WebMcpResult;
};

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const finiteNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const validId = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 128;
const categories = new Set(['bed', 'sofa', 'desk', 'table', 'storage', 'other']);
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
    rooms: rooms.map((room) => ({ id: room.id.slice(0, 128), name: room.name.slice(0, 80), area: Number(polygonArea(room.boundary).toFixed(2)), ceilingHeight: room.ceilingHeight })),
    counts: {
      rooms: architecture.filter((element) => element.kind === 'room').length,
      walls: architecture.filter((element) => element.kind === 'wall').length,
      doors: architecture.filter((element) => element.kind === 'opening' && element.openingType === 'door').length,
      windows: architecture.filter((element) => element.kind === 'opening' && element.openingType === 'window').length,
      furniture: snapshot.objects.length,
    },
  };
}

export function furnitureSummary(snapshot: EditorToolSnapshot) {
  return snapshot.objects.slice(0, 200).map((item) => ({
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
  return architecture.slice(0, 300).map((element) => {
    if (element.kind === 'room') return { id: element.id.slice(0, 128), kind: element.kind, name: element.name.slice(0, 80), boundary: element.boundary.slice(0, 50), area: Number(polygonArea(element.boundary).toFixed(2)), ceilingHeight: element.ceilingHeight };
    if (element.kind === 'wall') return { id: element.id.slice(0, 128), kind: element.kind, start: element.start, end: element.end, length: Number(wallLength(element).toFixed(3)), thickness: element.thickness, height: element.height };
    return { id: element.id.slice(0, 128), kind: element.kind, openingType: element.openingType, wallId: element.wallId.slice(0, 128), offset: element.offset, width: element.width, height: element.height, sillHeight: element.sillHeight, swing: element.swing, swingSide: element.swingSide };
  });
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
      description: 'Return bounded furniture details for the active layout, including IDs, room IDs, dimensions and positions in meters, and rotations in degrees. This is read-only.',
      inputSchema: emptyInputSchema, annotations: readAnnotations,
      execute: () => {
        const snapshot = snapshotOrFailure(dependencies);
        if ('ok' in snapshot) return snapshot;
        return toolSuccess('Loaded furniture in the active layout.', { projectId: snapshot.project.id, revision: snapshot.project.revision, data: { furniture: furnitureSummary(snapshot) } });
      },
    },
    {
      name: 'dwellwise.list_architecture', title: 'List architecture in the current apartment',
      description: 'Return a bounded list of rooms, walls, doors, and windows with stable IDs and measurements in meters. This is read-only.',
      inputSchema: emptyInputSchema, annotations: readAnnotations,
      execute: () => {
        const snapshot = snapshotOrFailure(dependencies);
        if ('ok' in snapshot) return snapshot;
        return toolSuccess('Loaded architecture in the current apartment.', { projectId: snapshot.project.id, revision: snapshot.project.revision, data: { architecture: architectureSummary(snapshot.project.scene.architecture) } });
      },
    },
    {
      name: 'dwellwise.rename_project', title: 'Rename the current Dwellwise apartment',
      description: 'Rename and save the current apartment. The name must contain 1 to 80 characters.',
      inputSchema: { type: 'object', additionalProperties: false, properties: { name: { type: 'string', minLength: 1, maxLength: 80 } }, required: ['name'] },
      annotations: writeAnnotations,
      execute: (input, { signal }) => {
        if (!isRecord(input) || typeof input.name !== 'string' || !input.name.trim() || input.name.trim().length > 80) return toolFailure('INVALID_INPUT', 'name must be between 1 and 80 characters.');
        return dependencies.renameProject(input.name.trim(), signal);
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
      name: 'dwellwise.resize_apartment', title: 'Resize the current apartment',
      description: 'Resize and save the apartment footprint width and depth in meters and its wall and ceiling height in meters.',
      inputSchema: { type: 'object', additionalProperties: false, properties: { width: { type: 'number', minimum: 2, maximum: 30 }, depth: { type: 'number', minimum: 2, maximum: 30 }, height: { type: 'number', minimum: 1.8, maximum: 6 } }, required: ['width', 'depth', 'height'] },
      annotations: writeAnnotations,
      execute: (input, { signal }) => !isRecord(input) || !finiteNumber(input.width) || input.width < 2 || input.width > 30 || !finiteNumber(input.depth) || input.depth < 2 || input.depth > 30 || !finiteNumber(input.height) || input.height < 1.8 || input.height > 6
        ? toolFailure('INVALID_INPUT', 'width and depth must be between 2 and 30 meters; height must be between 1.8 and 6 meters.')
        : dependencies.resizeApartment(input.width, input.depth, input.height, signal),
    },
    {
      name: 'dwellwise.set_editor_view', title: 'Change the current Dwellwise editor view',
      description: 'Change the visible editor to the plan, 3D preview, or evaluation. An optional plan edit mode can be selected. This current-page change is not saved.',
      inputSchema: { type: 'object', additionalProperties: false, properties: { view: { type: 'string', enum: ['plan', 'three', 'evaluation'] }, editMode: { type: 'string', enum: ['architecture', 'furnish'] } }, required: ['view'] },
      annotations: { readOnlyHint: false, untrustedContentHint: false },
      execute: (input) => !isRecord(input) || !['plan', 'three', 'evaluation'].includes(String(input.view)) || (input.editMode !== undefined && !['architecture', 'furnish'].includes(String(input.editMode)))
        ? toolFailure('INVALID_INPUT', 'view must be plan, three, or evaluation; editMode must be architecture or furnish.')
        : dependencies.setEditorView(input.view as 'plan' | 'three' | 'evaluation', input.editMode as 'architecture' | 'furnish' | undefined),
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
  ];
}

