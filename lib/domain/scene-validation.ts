import {
  SCENE_SCHEMA_VERSION,
  type FurnitureElement,
  type Point2,
  type SceneDocument,
  type Transform3,
  type TransformPatch,
} from './scene';

export class SceneValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SceneValidationError';
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const finite = (value: unknown, label: string): number => {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new SceneValidationError(`${label} must be a finite number`);
  }
  return value;
};

const positive = (value: unknown, label: string): number => {
  const parsed = finite(value, label);
  if (parsed <= 0) throw new SceneValidationError(`${label} must be greater than zero`);
  return parsed;
};

const point2 = (value: unknown, label: string): Point2 => {
  if (!isRecord(value)) throw new SceneValidationError(`${label} must be a point`);
  return { x: finite(value.x, `${label}.x`), y: finite(value.y, `${label}.y`) };
};

const requireId = (value: unknown, label: string): string => {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new SceneValidationError(`${label} must be a non-empty string`);
  }
  return value;
};

export function parseScene(value: unknown): SceneDocument {
  if (!isRecord(value)) throw new SceneValidationError('scene must be an object');
  if (value.schemaVersion !== SCENE_SCHEMA_VERSION) {
    throw new SceneValidationError(`scene.schemaVersion must be ${SCENE_SCHEMA_VERSION}`);
  }
  if (value.coordinateSystem !== 'right-handed-y-up' || value.units !== 'meters') {
    throw new SceneValidationError('scene must use meters and a right-handed Y-up coordinate system');
  }
  if (!Array.isArray(value.catalog) || !Array.isArray(value.architecture) || !Array.isArray(value.layouts)) {
    throw new SceneValidationError('scene catalog, architecture, and layouts must be arrays');
  }

  const catalogIds = new Set<string>();
  for (const [index, item] of value.catalog.entries()) {
    if (!isRecord(item)) throw new SceneValidationError(`catalog[${index}] must be an object`);
    const id = requireId(item.id, `catalog[${index}].id`);
    if (catalogIds.has(id)) throw new SceneValidationError(`duplicate catalog id: ${id}`);
    catalogIds.add(id);
    if (!isRecord(item.dimensions)) throw new SceneValidationError(`catalog item ${id} needs dimensions`);
    positive(item.dimensions.width, `catalog item ${id} width`);
    positive(item.dimensions.depth, `catalog item ${id} depth`);
    positive(item.dimensions.height, `catalog item ${id} height`);
  }

  const architectureIds = new Set<string>();
  const roomIds = new Set<string>();
  const wallIds = new Set<string>();
  for (const [index, element] of value.architecture.entries()) {
    if (!isRecord(element)) throw new SceneValidationError(`architecture[${index}] must be an object`);
    const id = requireId(element.id, `architecture[${index}].id`);
    if (architectureIds.has(id)) throw new SceneValidationError(`duplicate architecture id: ${id}`);
    architectureIds.add(id);
    if (element.kind === 'room') {
      roomIds.add(id);
      if (!Array.isArray(element.boundary) || element.boundary.length < 3) {
        throw new SceneValidationError(`room ${id} must have at least three boundary points`);
      }
      element.boundary.forEach((point, pointIndex) => point2(point, `room ${id} boundary[${pointIndex}]`));
      positive(element.ceilingHeight, `room ${id} ceilingHeight`);
    } else if (element.kind === 'wall') {
      wallIds.add(id);
      point2(element.start, `wall ${id} start`);
      point2(element.end, `wall ${id} end`);
      positive(element.thickness, `wall ${id} thickness`);
      positive(element.height, `wall ${id} height`);
    } else if (element.kind !== 'opening') {
      throw new SceneValidationError(`architecture ${id} has an unsupported kind`);
    }
  }

  for (const element of value.architecture) {
    if (isRecord(element) && element.kind === 'opening') {
      const id = requireId(element.id, 'opening.id');
      const wallId = requireId(element.wallId, `opening ${id} wallId`);
      if (!wallIds.has(wallId)) throw new SceneValidationError(`opening ${id} references missing wall ${wallId}`);
      finite(element.offset, `opening ${id} offset`);
      positive(element.width, `opening ${id} width`);
      positive(element.height, `opening ${id} height`);
      finite(element.sillHeight, `opening ${id} sillHeight`);
    }
  }

  const layoutIds = new Set<string>();
  for (const [index, layout] of value.layouts.entries()) {
    if (!isRecord(layout)) throw new SceneValidationError(`layouts[${index}] must be an object`);
    const layoutId = requireId(layout.id, `layouts[${index}].id`);
    if (layoutIds.has(layoutId)) throw new SceneValidationError(`duplicate layout id: ${layoutId}`);
    layoutIds.add(layoutId);
    if (!Array.isArray(layout.elements)) throw new SceneValidationError(`layout ${layoutId} elements must be an array`);
    const elementIds = new Set<string>();
    for (const rawElement of layout.elements) {
      if (!isRecord(rawElement) || rawElement.kind !== 'furniture') {
        throw new SceneValidationError(`layout ${layoutId} may only contain furniture elements`);
      }
      const element = rawElement as unknown as FurnitureElement;
      const id = requireId(element.id, `layout ${layoutId} furniture.id`);
      if (elementIds.has(id)) throw new SceneValidationError(`duplicate element id ${id} in layout ${layoutId}`);
      elementIds.add(id);
      if (!catalogIds.has(element.catalogItemId)) {
        throw new SceneValidationError(`furniture ${id} references missing catalog item ${element.catalogItemId}`);
      }
      if (!roomIds.has(element.roomId)) {
        throw new SceneValidationError(`furniture ${id} references missing room ${element.roomId}`);
      }
      parseTransform(element.transform, `furniture ${id} transform`);
      finite(element.clearance, `furniture ${id} clearance`);
      if (element.clearance < 0) throw new SceneValidationError(`furniture ${id} clearance cannot be negative`);
    }
  }

  finite(value.northAngle, 'scene.northAngle');
  return value as unknown as SceneDocument;
}

function parseTransform(value: unknown, label: string): Transform3 {
  if (!isRecord(value) || !isRecord(value.position) || !isRecord(value.rotation)) {
    throw new SceneValidationError(`${label} must contain position and rotation`);
  }
  return {
    position: {
      x: finite(value.position.x, `${label}.position.x`),
      y: finite(value.position.y, `${label}.position.y`),
      z: finite(value.position.z, `${label}.position.z`),
    },
    rotation: {
      x: finite(value.rotation.x, `${label}.rotation.x`),
      y: finite(value.rotation.y, `${label}.rotation.y`),
      z: finite(value.rotation.z, `${label}.rotation.z`),
    },
  };
}

export function applyTransformPatch(current: Transform3, value: unknown): Transform3 {
  if (!isRecord(value)) throw new SceneValidationError('transform must be an object');
  const patch = value as TransformPatch;
  const merged: Transform3 = {
    position: { ...current.position, ...(isRecord(patch.position) ? patch.position : {}) },
    rotation: { ...current.rotation, ...(isRecord(patch.rotation) ? patch.rotation : {}) },
  };
  return parseTransform(merged, 'transform');
}
