import { SCENE_SCHEMA_VERSION, type Layout, type SceneDocument, type Transform3 } from './scene';

const at = (x: number, z: number, yaw = 0): Transform3 => ({
  position: { x, y: 0, z },
  rotation: { x: 0, y: yaw, z: 0 },
});

const layout = (id: 'layout-a' | 'layout-b', name: string, variant: 'a' | 'b'): Layout => ({
  id,
  name,
  elements: [
    { id: 'sofa-1', kind: 'furniture', catalogItemId: 'sofa', roomId: 'living', transform: variant === 'a' ? at(1.5, 2.35, 0) : at(2.4, 1.05, 90), clearance: 0.25 },
    { id: 'desk-1', kind: 'furniture', catalogItemId: 'desk', roomId: 'living', transform: variant === 'a' ? at(3.7, 1.0, 0) : at(1.1, 3.55, 90), clearance: 0.91 },
    { id: 'table-1', kind: 'furniture', catalogItemId: 'table', roomId: 'living', transform: variant === 'a' ? at(3.7, 3.65, 0) : at(3.8, 3.2, 90), clearance: 0.76 },
    { id: 'bed-1', kind: 'furniture', catalogItemId: 'queen-bed', roomId: 'bedroom', transform: variant === 'a' ? at(6.35, 1.65, 90) : at(6.55, 2.2, 0), clearance: 0.61 },
    { id: 'dresser-1', kind: 'furniture', catalogItemId: 'dresser', roomId: 'bedroom', transform: variant === 'a' ? at(7.25, 3.45, 0) : at(5.45, 3.85, 90), clearance: 0.46 },
  ],
});

export const demoScene: SceneDocument = {
  schemaVersion: SCENE_SCHEMA_VERSION,
  coordinateSystem: 'right-handed-y-up',
  units: 'meters',
  northAngle: 0,
  catalog: [
    { id: 'queen-bed', name: 'Queen bed', category: 'bed', dimensions: { width: 1.52, depth: 2.03, height: 0.61 } },
    { id: 'sofa', name: 'Sofa', category: 'sofa', dimensions: { width: 2.18, depth: 0.91, height: 0.84 } },
    { id: 'desk', name: 'Desk', category: 'desk', dimensions: { width: 1.22, depth: 0.61, height: 0.76 } },
    { id: 'table', name: 'Dining table', category: 'table', dimensions: { width: 1.8, depth: 1.1, height: 0.76 } },
    { id: 'dresser', name: 'Dresser', category: 'storage', dimensions: { width: 1.52, depth: 0.51, height: 0.84 } },
  ],
  architecture: [
    { id: 'living', kind: 'room', name: 'Living + Dining', boundary: [{ x: 0, y: 0 }, { x: 4.32, y: 0 }, { x: 4.32, y: 5.64 }, { x: 0, y: 5.64 }], floorElevation: 0, ceilingHeight: 2.74 },
    { id: 'bedroom', kind: 'room', name: 'Bedroom', boundary: [{ x: 4.32, y: 0 }, { x: 7.87, y: 0 }, { x: 7.87, y: 3.76 }, { x: 4.32, y: 3.76 }], floorElevation: 0, ceilingHeight: 2.74 },
    { id: 'kitchen', kind: 'room', name: 'Kitchen', boundary: [{ x: 0, y: 5.64 }, { x: 2.59, y: 5.64 }, { x: 2.59, y: 8.43 }, { x: 0, y: 8.43 }], floorElevation: 0, ceilingHeight: 2.74 },
    { id: 'bath', kind: 'room', name: 'Bath', boundary: [{ x: 2.59, y: 5.64 }, { x: 4.32, y: 5.64 }, { x: 4.32, y: 8.1 }, { x: 2.59, y: 8.1 }], floorElevation: 0, ceilingHeight: 2.74 },
    { id: 'wall-north', kind: 'wall', start: { x: 0, y: 0 }, end: { x: 7.87, y: 0 }, thickness: 0.15, height: 2.74 },
    { id: 'wall-east', kind: 'wall', start: { x: 7.87, y: 0 }, end: { x: 7.87, y: 8.43 }, thickness: 0.15, height: 2.74 },
    { id: 'wall-south', kind: 'wall', start: { x: 7.87, y: 8.43 }, end: { x: 0, y: 8.43 }, thickness: 0.15, height: 2.74 },
    { id: 'wall-west', kind: 'wall', start: { x: 0, y: 8.43 }, end: { x: 0, y: 0 }, thickness: 0.15, height: 2.74 },
    { id: 'wall-bedroom', kind: 'wall', start: { x: 4.32, y: 0 }, end: { x: 4.32, y: 5.64 }, thickness: 0.12, height: 2.74 },
    { id: 'window-east-1', kind: 'opening', openingType: 'window', wallId: 'wall-north', offset: 0.65, width: 1.37, height: 1.52, sillHeight: 0.76 },
    { id: 'window-east-2', kind: 'opening', openingType: 'window', wallId: 'wall-north', offset: 2.62, width: 1.37, height: 1.52, sillHeight: 0.76 },
    { id: 'window-south-1', kind: 'opening', openingType: 'window', wallId: 'wall-east', offset: 0.74, width: 1.22, height: 1.52, sillHeight: 0.76 },
  ],
  layouts: [layout('layout-a', 'Layout A', 'a'), layout('layout-b', 'Layout B', 'b')],
};

/** Neutral one-room shell used by the build-your-own planner. */
export const blankApartmentScene: SceneDocument = {
  schemaVersion: SCENE_SCHEMA_VERSION,
  coordinateSystem: 'right-handed-y-up',
  units: 'meters',
  northAngle: 0,
  catalog: demoScene.catalog,
  architecture: [
    { id: 'main-space', kind: 'room', name: 'Main space', boundary: [{ x: 0, y: 0 }, { x: 7.87, y: 0 }, { x: 7.87, y: 8.43 }, { x: 0, y: 8.43 }], floorElevation: 0, ceilingHeight: 2.74 },
    { id: 'wall-north', kind: 'wall', start: { x: 0, y: 0 }, end: { x: 7.87, y: 0 }, thickness: 0.15, height: 2.74 },
    { id: 'wall-east', kind: 'wall', start: { x: 7.87, y: 0 }, end: { x: 7.87, y: 8.43 }, thickness: 0.15, height: 2.74 },
    { id: 'wall-south', kind: 'wall', start: { x: 7.87, y: 8.43 }, end: { x: 0, y: 8.43 }, thickness: 0.15, height: 2.74 },
    { id: 'wall-west', kind: 'wall', start: { x: 0, y: 8.43 }, end: { x: 0, y: 0 }, thickness: 0.15, height: 2.74 },
  ],
  layouts: demoScene.layouts.map((item) => ({ ...item, elements: [] })),
};
