export const SCENE_SCHEMA_VERSION = 1 as const;

export type Id = string;

/** All distances are stored in meters and all angles in degrees. */
export interface Point2 {
  x: number;
  y: number;
}

export interface Point3 extends Point2 {
  z: number;
}

export interface Size3 {
  width: number;
  depth: number;
  height: number;
}

/** A single transform works in both the plan editor and the 3D renderer. */
export interface Transform3 {
  position: Point3;
  rotation: {
    x: number;
    y: number;
    z: number;
  };
}

export interface CatalogItem {
  id: Id;
  name: string;
  category: 'bed' | 'sofa' | 'desk' | 'table' | 'storage' | 'fixture' | 'other';
  dimensions: Size3;
  modelUrl?: string;
  thumbnailUrl?: string;
  metadata?: Record<string, string | number | boolean>;
}

export interface RoomElement {
  id: Id;
  kind: 'room';
  name: string;
  boundary: Point2[];
  floorElevation: number;
  ceilingHeight: number;
}

export interface WallElement {
  id: Id;
  kind: 'wall';
  start: Point2;
  end: Point2;
  thickness: number;
  height: number;
}

export interface OpeningElement {
  id: Id;
  kind: 'opening';
  openingType: 'door' | 'window';
  wallId: Id;
  /** Distance along the parent wall from its start point. */
  offset: number;
  width: number;
  height: number;
  sillHeight: number;
  swing?: 'left' | 'right' | 'none';
  swingSide?: 'in' | 'out';
}

export interface FurnitureElement {
  id: Id;
  kind: 'furniture';
  catalogItemId: Id;
  roomId: Id;
  transform: Transform3;
  /** Desired empty space around the footprint, in meters. */
  clearance: number;
  locked?: boolean;
}

export type ArchitecturalElement = RoomElement | WallElement | OpeningElement;
export type LayoutElement = FurnitureElement;

export interface Layout {
  id: Id;
  name: string;
  elements: LayoutElement[];
}

export interface SceneDocument {
  schemaVersion: typeof SCENE_SCHEMA_VERSION;
  coordinateSystem: 'right-handed-y-up';
  units: 'meters';
  northAngle: number;
  catalog: CatalogItem[];
  architecture: ArchitecturalElement[];
  layouts: Layout[];
}

export interface ProjectRecord {
  id: Id;
  ownerProfileId: Id | null;
  name: string;
  revision: number;
  scene: SceneDocument;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectSummary {
  id: Id;
  name: string;
  revision: number;
  createdAt: string;
  updatedAt: string;
}

export type TransformPatch = {
  position?: Partial<Point3>;
  rotation?: Partial<Transform3['rotation']>;
};
