'use client';

import { ContactShadows, Html, Line, OrbitControls, RoundedBox } from '@react-three/drei';
import { Canvas, type ThreeEvent, useFrame, useThree } from '@react-three/fiber';
import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ArchitecturalElement, OpeningElement, RoomElement, WallElement } from '@/lib/domain/scene';
import { buildFinishTargets, finishTargetsForFurniture, harmonizeColor, MATERIAL_PALETTE, materialKey, type FinishMood, type FinishTarget, type MaterialRole } from '@/lib/domain/materials';
import { getArchitectureBounds, wallLength } from '@/lib/domain/architecture';
import { getSunDirection } from '@/lib/domain/sunlight';
import { getFurnitureKind } from '@/lib/domain/furniture';
import * as THREE from 'three';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';

type SceneObject = {
  id: string;
  catalogItemId: string;
  name: string;
  category: string;
  dimensions: { width: number; depth: number; height: number };
  transform: { position: { x: number; y: number; z: number }; rotation: { y: number } };
};

type ApartmentSceneProps = {
  projectId: string;
  hour: number;
  northAngle: number;
  cameraStep: number;
  cameraReset: number;
  measurements: boolean;
  objects: SceneObject[];
  architecture: ArchitecturalElement[];
  materialOverrides: Record<string, string>;
  onMaterialChange: (targetKey: string, color: string | null) => Promise<string | null>;
};

type FinishSelection = {
  targetKey: string;
  owner: string;
  part: string;
  role: MaterialRole;
  defaultColor: string;
};

type FinishContextValue = {
  colors: Record<string, string>;
  select: (selection: FinishSelection) => void;
  hoveredTargetKey: string | null;
  setHoveredTargetKey: (targetKey: string | null | ((current: string | null) => string | null)) => void;
  openFurniturePartPicker: (targetId: string) => void;
};

const FinishContext = createContext<FinishContextValue>({ colors: {}, select: () => undefined, hoveredTargetKey: null, setHoveredTargetKey: () => undefined, openFurniturePartPicker: () => undefined });

type CameraViewState = {
  position: [number, number, number];
  target: [number, number, number];
  footprint: { width: number; depth: number };
};

type CameraPose = Pick<CameraViewState, 'position' | 'target'>;

const palette = MATERIAL_PALETTE;

// These are the exact unscaled outer envelopes of the detailed models below.
// Every model is scaled from this envelope to the saved meter dimensions, so
// the 2D footprint, collision geometry, measurements, and 3D result stay equal.
const furnitureModelEnvelopes = {
  sofa: { width: 2.18, depth: 0.91, height: 1 },
  desk: { width: 1.22, depth: 0.61, height: 1.25 },
  coffee: { width: 1.07, depth: 0.61, height: 0.425 },
  dining: { width: 1.22, depth: 0.91, height: 0.8 },
  bed: { width: 1.52, depth: 2.03, height: 1.295 },
  chair: { width: 0.76, depth: 0.81, height: 0.98 },
  nightstand: { width: 0.56, depth: 0.46, height: 0.665 },
  bookcase: { width: 0.91, depth: 0.35, height: 1.83 },
  storage: { width: 1.52, depth: 0.51, height: 0.945 },
  stove: { width: 0.76, depth: 0.61, height: 0.91 },
  sink: { width: 0.76, depth: 0.61, height: 1.05 },
  fridge: { width: 0.91, depth: 0.76, height: 1.78 },
  toilet: { width: 0.4, depth: 0.7, height: 0.78 },
  shower: { width: 0.91, depth: 0.91, height: 2 },
  bathtub: { width: 1.76, depth: 0.75, height: 0.58 },
  'washer-dryer': { width: 0.6, depth: 0.65, height: 0.85 },
  other: { width: 0.8, depth: 0.8, height: 0.8 },
} as const;

const CAMERA_CONTROL_POLAR_ANGLE = THREE.MathUtils.degToRad(0.5);

function isVectorTuple(value: unknown): value is [number, number, number] {
  return Array.isArray(value) && value.length === 3 && value.every((coordinate) => typeof coordinate === 'number' && Number.isFinite(coordinate));
}

const cameraStorageKey = (projectId: string) => `dwellwise:3d-camera:${projectId}`;

function cameraFootprint(architecture: ArchitecturalElement[]) {
  const bounds = getArchitectureBounds(architecture);
  return { width: bounds.width, depth: bounds.depth };
}

function readSessionCamera(storageKey: string, footprint: CameraViewState['footprint']): CameraViewState | null {
  if (typeof window === 'undefined') return null;
  try {
    const value = JSON.parse(window.sessionStorage.getItem(storageKey) ?? 'null') as Partial<CameraViewState> | null;
    const savedFootprint = value?.footprint;
    const matchesFootprint = savedFootprint
      && Number.isFinite(savedFootprint.width)
      && Number.isFinite(savedFootprint.depth)
      && Math.abs(savedFootprint.width - footprint.width) < 0.01
      && Math.abs(savedFootprint.depth - footprint.depth) < 0.01;
    return value && isVectorTuple(value.position) && isVectorTuple(value.target) && matchesFootprint
      ? { position: value.position, target: value.target, footprint: savedFootprint }
      : null;
  } catch {
    return null;
  }
}

function writeSessionCamera(storageKey: string, state: CameraViewState) {
  try {
    window.sessionStorage.setItem(storageKey, JSON.stringify(state));
  } catch {
    // The camera remains usable when browser storage is unavailable.
  }
}

export function clearSavedApartmentCamera(projectId: string) {
  if (typeof window === 'undefined') return;
  const storageKey = cameraStorageKey(projectId);
  const clear = () => window.sessionStorage.removeItem(storageKey);
  clear();
  // A mounted 3D scene flushes its last pending camera during unmount.
  // Clear once more after React commits the reset back to the plan view.
  window.setTimeout(clear, 0);
}

function getTopDownCamera(architecture: ArchitecturalElement[], step: number) {
  const bounds = getArchitectureBounds(architecture);
  const angle = THREE.MathUtils.degToRad(90 + step * 12);
  const distance = Math.max(8, Math.max(bounds.width, bounds.depth) * 1.55);
  const polarAngle = step === 0 ? 0 : CAMERA_CONTROL_POLAR_ANGLE;
  const horizontalOffset = Math.sin(polarAngle) * distance;
  const target = new THREE.Vector3((bounds.minX + bounds.maxX) / 2, 0.85, (bounds.minY + bounds.maxY) / 2);

  return {
    target,
    position: new THREE.Vector3(
      target.x + Math.cos(angle) * horizontalOffset,
      target.y + Math.cos(polarAngle) * distance,
      target.z + Math.sin(angle) * horizontalOffset,
    ),
  };
}

function CameraController({ step, reset, architecture, initialState, onCameraChange }: { step: number; reset: number; architecture: ArchitecturalElement[]; initialState: CameraViewState | null; onCameraChange: (state: CameraPose) => void }) {
  const controls = useRef<OrbitControlsImpl>(null);
  const initialized = useRef(false);
  const previousPreset = useRef({ step, reset });
  const { camera } = useThree();
  const bounds = useMemo(() => getArchitectureBounds(architecture), [architecture]);

  useEffect(() => {
    const resetChanged = reset !== previousPreset.current.reset;
    const stepChanged = step !== previousPreset.current.step;
    if (initialized.current && !resetChanged && !stepChanged) return;

    const preset = !initialized.current && initialState
      ? { position: new THREE.Vector3(...initialState.position), target: new THREE.Vector3(...initialState.target) }
      : getTopDownCamera(architecture, resetChanged ? 0 : step);
    camera.position.copy(preset.position);
    camera.lookAt(preset.target);
    controls.current?.target.copy(preset.target);
    controls.current?.update();
    previousPreset.current = { step, reset };
    initialized.current = true;
  }, [architecture, camera, initialState, reset, step]);

  const target = initialState?.target ?? [(bounds.minX + bounds.maxX) / 2, 0.85, (bounds.minY + bounds.maxY) / 2];

  return (
    <OrbitControls
      ref={controls}
      makeDefault
      enableDamping
      dampingFactor={0.07}
      minDistance={Math.max(3, Math.min(bounds.width, bounds.depth) * 0.6)}
      maxDistance={Math.max(17, Math.max(bounds.width, bounds.depth) * 2.4)}
      minPolarAngle={0}
      maxPolarAngle={Math.PI / 2.08}
      screenSpacePanning={false}
      target={target}
      onChange={() => {
        if (!controls.current) return;
        onCameraChange({
          position: camera.position.toArray(),
          target: controls.current.target.toArray(),
        });
      }}
    />
  );
}

function Box({ position, size, color, rotation, radius = 0.03, castShadow = true, onDoubleClick, onClick, onPointerOver, onPointerOut }: {
  position: [number, number, number];
  size: [number, number, number];
  color: string;
  rotation?: [number, number, number];
  radius?: number;
  castShadow?: boolean;
  onDoubleClick?: (event: ThreeEvent<MouseEvent>) => void;
  onClick?: (event: ThreeEvent<MouseEvent>) => void;
  onPointerOver?: (event: ThreeEvent<PointerEvent>) => void;
  onPointerOut?: (event: ThreeEvent<PointerEvent>) => void;
}) {
  return (
    <RoundedBox position={position} args={size} rotation={rotation} radius={radius} smoothness={3} castShadow={castShadow} receiveShadow onDoubleClick={onDoubleClick} onClick={onClick} onPointerOver={onPointerOver} onPointerOut={onPointerOut}>
      <meshStandardMaterial color={color} roughness={0.72} />
    </RoundedBox>
  );
}

type FinishBoxProps = Omit<Parameters<typeof Box>[0], 'color' | 'onDoubleClick'> & {
  scope: 'furniture' | 'room' | 'wall' | 'opening';
  targetId: string;
  owner: string;
  part: string;
  label: string;
  role: MaterialRole;
  defaultColor: string;
};

function FinishBox({ scope, targetId, owner, part, label, role, defaultColor, ...boxProps }: FinishBoxProps) {
  const finishes = useContext(FinishContext);
  const targetKey = materialKey(scope, targetId, part);
  const hovered = finishes.hoveredTargetKey === targetKey;
  const select = (event: ThreeEvent<MouseEvent>) => {
    event.stopPropagation();
    finishes.select({ targetKey, owner, part: label, role, defaultColor });
  };
  const showPicker = (event: ThreeEvent<MouseEvent>) => {
    event.stopPropagation();
    if (scope === 'furniture') finishes.openFurniturePartPicker(targetId);
  };
  return <>
    <Box {...boxProps} color={finishes.colors[targetKey] ?? defaultColor} onClick={showPicker} onDoubleClick={select} onPointerOver={(event) => { event.stopPropagation(); finishes.setHoveredTargetKey(targetKey); }} onPointerOut={(event) => { event.stopPropagation(); finishes.setHoveredTargetKey((current) => current === targetKey ? null : current); }} />
    {hovered && <RoundedBox position={boxProps.position} args={boxProps.size} rotation={boxProps.rotation} radius={(boxProps.radius ?? 0.03) + 0.008} smoothness={3} scale={[1.018, 1.018, 1.018]} renderOrder={2} raycast={() => null}><meshBasicMaterial color="#e8896d" wireframe transparent opacity={0.92} /></RoundedBox>}
  </>;
}

function Wall({ wall, position, size, rotation }: { wall: WallElement; position: [number, number, number]; size: [number, number, number]; rotation?: [number, number, number] }) {
  return <FinishBox scope="wall" targetId={wall.id} owner="Wall" part="surface" label="Wall surface" role="wall" defaultColor={palette.wall} position={position} size={size} rotation={rotation} radius={0.015} />;
}

function WindowInsert({ opening, wall, angle, center }: { opening: OpeningElement; wall: WallElement; angle: number; center: { x: number; y: number } }) {
  const frame = Math.min(0.07, opening.width / 5, opening.height / 5);
  const innerWidth = Math.max(0.02, opening.width - frame * 2);
  const innerHeight = Math.max(0.02, opening.height - frame * 2);
  const depth = wall.thickness + 0.035;
  return (
    <group position={[center.x, opening.sillHeight + opening.height / 2, center.y]} rotation={[0, -angle, 0]}>
      <FinishBox scope="opening" targetId={opening.id} owner="Window" part="frame" label="Window frame" role="surface" defaultColor={palette.trim} position={[-opening.width / 2 + frame / 2, 0, 0]} size={[frame, opening.height, depth]} radius={0.008} />
      <FinishBox scope="opening" targetId={opening.id} owner="Window" part="frame" label="Window frame" role="surface" defaultColor={palette.trim} position={[opening.width / 2 - frame / 2, 0, 0]} size={[frame, opening.height, depth]} radius={0.008} />
      <FinishBox scope="opening" targetId={opening.id} owner="Window" part="frame" label="Window frame" role="surface" defaultColor={palette.trim} position={[0, opening.height / 2 - frame / 2, 0]} size={[innerWidth, frame, depth]} radius={0.008} />
      <FinishBox scope="opening" targetId={opening.id} owner="Window" part="frame" label="Window frame" role="surface" defaultColor={palette.trim} position={[0, -opening.height / 2 + frame / 2, 0]} size={[innerWidth, frame, depth]} radius={0.008} />
      {innerWidth > 0.35 && <Box position={[0, 0, 0.018]} size={[Math.min(0.038, frame * 0.65), innerHeight, depth * 0.72]} color="#dce4df" radius={0.005} />}
      {innerHeight > 0.48 && <Box position={[0, 0, 0.02]} size={[innerWidth, Math.min(0.034, frame * 0.6), depth * 0.72]} color="#dce4df" radius={0.005} />}
      <Box position={[0, -opening.height / 2 - 0.035, 0.035]} size={[opening.width + 0.1, 0.055, wall.thickness + 0.15]} color="#e8e2d5" radius={0.012} />
      <mesh position={[0, 0, 0]} castShadow={false} receiveShadow>
        <boxGeometry args={[innerWidth, innerHeight, 0.012]} />
        <meshPhysicalMaterial color="#a9d3df" transparent opacity={0.3} roughness={0.08} transmission={0.32} metalness={0.04} side={THREE.DoubleSide} />
      </mesh>
    </group>
  );
}

function DoorInsert({ opening, wall, angle, center }: { opening: OpeningElement; wall: WallElement; angle: number; center: { x: number; y: number } }) {
  const frame = Math.min(0.075, opening.width / 6);
  const leafWidth = Math.max(0.12, opening.width - frame * 2);
  const leafHeight = Math.max(0.12, opening.height - frame);
  const handleX = (opening.swing === 'right' ? -1 : 1) * leafWidth * 0.36;
  const depth = wall.thickness + 0.045;
  return (
    <group position={[center.x, opening.sillHeight + opening.height / 2, center.y]} rotation={[0, -angle, 0]}>
      <Box position={[-opening.width / 2 + frame / 2, 0, 0]} size={[frame, opening.height, depth]} color={palette.trim} radius={0.008} />
      <Box position={[opening.width / 2 - frame / 2, 0, 0]} size={[frame, opening.height, depth]} color={palette.trim} radius={0.008} />
      <Box position={[0, opening.height / 2 - frame / 2, 0]} size={[leafWidth, frame, depth]} color={palette.trim} radius={0.008} />
      <FinishBox scope="opening" targetId={opening.id} owner="Door" part="panel" label="Door panel" role="wood" defaultColor="#a97855" position={[0, -frame / 2, 0]} size={[leafWidth, leafHeight, 0.055]} radius={0.018} />
      {[-0.27, 0.27].map((y) => <FinishBox key={y} scope="opening" targetId={opening.id} owner="Door" part="panel" label="Door panel" role="wood" defaultColor="#a97855" position={[0, y * leafHeight, 0.034]} size={[leafWidth * 0.74, leafHeight * 0.34, 0.024]} radius={0.02} />)}
      <mesh position={[handleX, -0.02, 0.075]} castShadow>
        <sphereGeometry args={[0.045, 18, 12]} />
        <meshStandardMaterial color={palette.brass} metalness={0.78} roughness={0.2} />
      </mesh>
      <Box position={[handleX * 0.91, -0.02, 0.055]} size={[0.16, 0.035, 0.04]} color={palette.brass} radius={0.015} />
    </group>
  );
}

function RoomFloor({ room, index }: { room: RoomElement; index: number }) {
  const geometry = useMemo(() => {
    const shape = new THREE.Shape();
    room.boundary.forEach((point, pointIndex) => {
      if (pointIndex === 0) shape.moveTo(point.x, -point.y);
      else shape.lineTo(point.x, -point.y);
    });
    shape.closePath();
    return new THREE.ShapeGeometry(shape);
  }, [room]);
  const colors = ['#c5aa86', '#d2bfa6', '#bda582', '#cfbda4'];
  const finishes = useContext(FinishContext);
  const targetKey = materialKey('room', room.id, 'floor');
  const defaultColor = colors[index % colors.length];
  return <mesh geometry={geometry} position={[0, room.floorElevation + 0.012, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow onDoubleClick={(event) => {
    event.stopPropagation();
    finishes.select({ targetKey, owner: room.name, part: 'Floor', role: 'floor', defaultColor });
  }}><meshStandardMaterial color={finishes.colors[targetKey] ?? defaultColor} roughness={0.84} side={THREE.DoubleSide} /></mesh>;
}

function RoomCeilingShadow({ room }: { room: RoomElement }) {
  const geometry = useMemo(() => {
    const center = room.boundary.reduce(
      (sum, point) => ({ x: sum.x + point.x / room.boundary.length, y: sum.y + point.y / room.boundary.length }),
      { x: 0, y: 0 },
    );
    // A tiny overhang closes floating-point seams where the ceiling meets the walls.
    const ceilingBoundary = room.boundary.map((point) => {
      const dx = point.x - center.x;
      const dy = point.y - center.y;
      const distance = Math.hypot(dx, dy) || 1;
      return { x: point.x + (dx / distance) * 0.06, y: point.y + (dy / distance) * 0.06 };
    });
    const shape = new THREE.Shape();
    ceilingBoundary.forEach((point, pointIndex) => {
      if (pointIndex === 0) shape.moveTo(point.x, -point.y);
      else shape.lineTo(point.x, -point.y);
    });
    shape.closePath();
    return new THREE.ShapeGeometry(shape);
  }, [room]);
  return (
    <mesh geometry={geometry} position={[0, room.floorElevation + room.ceilingHeight, 0]} rotation={[-Math.PI / 2, 0, 0]} castShadow>
      <meshStandardMaterial colorWrite={false} depthWrite={false} side={THREE.DoubleSide} />
    </mesh>
  );
}

function WindowDaylight({ opening, wall, apartmentCenter, hour }: { opening: OpeningElement; wall: WallElement; apartmentCenter: { x: number; y: number }; hour: number }) {
  const length = wallLength(wall);
  const ratio = (opening.offset + opening.width / 2) / length;
  const center = {
    x: wall.start.x + (wall.end.x - wall.start.x) * ratio,
    y: wall.start.y + (wall.end.y - wall.start.y) * ratio,
  };
  const towardRoom = new THREE.Vector2(apartmentCenter.x - center.x, apartmentCenter.y - center.y).normalize();
  const position: [number, number, number] = [center.x + towardRoom.x * 0.1, opening.sillHeight + opening.height / 2, center.y + towardRoom.y * 0.1];
  const rotation: [number, number, number] = [0, Math.atan2(-towardRoom.x, -towardRoom.y), 0];
  const daylightProgress = Math.max(0, Math.min(1, (hour - 7) / 13));
  const intensity = 7 + Math.sin(daylightProgress * Math.PI) * 7;

  return <rectAreaLight position={position} rotation={rotation} width={opening.width * 0.92} height={opening.height * 0.92} intensity={intensity} color={hour < 9 || hour > 18 ? '#ffd8ad' : '#e6f4ff'} />;
}

function VirtualWindowFill({ rooms }: { rooms: RoomElement[] }) {
  // Windowless inspection lighting is intentionally fixed to the approved 7 AM look.
  const intensity = 7 * 0.55;
  const color = '#ffd8ad';

  return (
    <group>
      {rooms.flatMap((room) => {
        const center = room.boundary.reduce(
          (sum, point) => ({ x: sum.x + point.x / room.boundary.length, y: sum.y + point.y / room.boundary.length }),
          { x: 0, y: 0 },
        );
        return room.boundary.map((point, index) => {
          const next = room.boundary[(index + 1) % room.boundary.length];
          const midpoint = { x: (point.x + next.x) / 2, y: (point.y + next.y) / 2 };
          const towardRoom = new THREE.Vector2(center.x - midpoint.x, center.y - midpoint.y).normalize();
          const position: [number, number, number] = [
            midpoint.x + towardRoom.x * 0.1,
            room.floorElevation + room.ceilingHeight * 0.52,
            midpoint.y + towardRoom.y * 0.1,
          ];
          const rotation: [number, number, number] = [0, Math.atan2(-towardRoom.x, -towardRoom.y), 0];
          return (
            <rectAreaLight
              key={`${room.id}-virtual-window-${index}`}
              position={position}
              rotation={rotation}
              width={Math.hypot(next.x - point.x, next.y - point.y) * 0.94}
              height={room.ceilingHeight * 0.78}
              intensity={intensity}
              color={color}
            />
          );
        });
      })}
    </group>
  );
}

function pointToWallDistance(point: { x: number; y: number }, wall: WallElement) {
  const dx = wall.end.x - wall.start.x;
  const dy = wall.end.y - wall.start.y;
  const lengthSquared = dx * dx + dy * dy;
  const ratio = lengthSquared === 0 ? 0 : Math.max(0, Math.min(1, ((point.x - wall.start.x) * dx + (point.y - wall.start.y) * dy) / lengthSquared));
  return Math.hypot(point.x - (wall.start.x + dx * ratio), point.y - (wall.start.y + dy * ratio));
}

function viewLineCrossesWall(camera: { x: number; y: number }, target: { x: number; y: number }, wall: WallElement) {
  const rayX = target.x - camera.x;
  const rayY = target.y - camera.y;
  const wallX = wall.end.x - wall.start.x;
  const wallY = wall.end.y - wall.start.y;
  const denominator = rayX * wallY - rayY * wallX;
  if (Math.abs(denominator) < 0.00001) return false;
  const startX = wall.start.x - camera.x;
  const startY = wall.start.y - camera.y;
  const rayRatio = (startX * wallY - startY * wallX) / denominator;
  const wallRatio = (startX * rayY - startY * rayX) / denominator;
  return rayRatio > 0.015 && rayRatio < 0.985 && wallRatio > -0.02 && wallRatio < 1.02;
}

function SceneWall({ wall, openings, fallbackTarget }: { wall: WallElement; openings: OpeningElement[]; fallbackTarget: { x: number; y: number } }) {
  const group = useRef<THREE.Group>(null);
  const camera = useThree((state) => state.camera);
  const controls = useThree((state) => state.controls as OrbitControlsImpl | null);
  const length = wallLength(wall);
  const angle = Math.atan2(wall.end.y - wall.start.y, wall.end.x - wall.start.x);
  const pointAt = (offset: number) => ({
    x: wall.start.x + ((wall.end.x - wall.start.x) * offset) / length,
    y: wall.start.y + ((wall.end.y - wall.start.y) * offset) / length,
  });
  const part = (key: string, offset: number, width: number, bottom: number, height: number) => {
    if (width < 0.01 || height < 0.01) return null;
    const center = pointAt(offset + width / 2);
    return <Wall key={key} wall={wall} position={[center.x, bottom + height / 2, center.y]} size={[width, height, wall.thickness]} rotation={[0, -angle, 0]} />;
  };
  const sorted = openings
    .filter((opening) => opening.offset >= 0 && opening.offset + opening.width <= length + 0.001)
    .sort((a, b) => a.offset - b.offset);
  const pieces: ReactNode[] = [];
  if (sorted.length === 0) pieces.push(part('full', 0, length, 0, wall.height));
  else {
    let cursor = 0;
    sorted.forEach((opening) => {
      pieces.push(part(`${opening.id}-before`, cursor, opening.offset - cursor, 0, wall.height));
      pieces.push(part(`${opening.id}-below`, opening.offset, opening.width, 0, opening.sillHeight));
      const openingTop = opening.sillHeight + opening.height;
      pieces.push(part(`${opening.id}-above`, opening.offset, opening.width, openingTop, wall.height - openingTop));
      cursor = opening.offset + opening.width;
    });
    pieces.push(part('after', cursor, length - cursor, 0, wall.height));
  }

  useFrame((_, delta) => {
    if (!group.current) return;
    const cameraPlan = { x: camera.position.x, y: camera.position.z };
    const targetPlan = controls?.target ? { x: controls.target.x, y: controls.target.z } : fallbackTarget;
    const lowView = camera.position.y < wall.height + 0.55;
    const cameraNearWall = pointToWallDistance(cameraPlan, wall) < wall.thickness * 1.75 + 0.16;
    const occluded = lowView && (cameraNearWall || viewLineCrossesWall(cameraPlan, targetPlan, wall));

    group.current.traverse((child) => {
      if (!(child instanceof THREE.Mesh)) return;
      const materials = Array.isArray(child.material) ? child.material : [child.material];
      materials.forEach((material) => {
        const state = material.userData.cutawayState as { opacity: number; transparent: boolean; depthWrite: boolean } | undefined;
        const base = state ?? { opacity: material.opacity, transparent: material.transparent, depthWrite: material.depthWrite };
        if (!state) material.userData.cutawayState = base;
        const opacity = THREE.MathUtils.damp(material.opacity, occluded ? 0 : base.opacity, occluded ? 18 : 12, delta);
        const fading = occluded || opacity < base.opacity - 0.002;
        const transparent = base.transparent || fading;
        const depthWrite = fading ? false : base.depthWrite;
        if (material.transparent !== transparent || material.depthWrite !== depthWrite) {
          material.transparent = transparent;
          material.depthWrite = depthWrite;
          material.needsUpdate = true;
        }
        material.opacity = opacity;
      });
    });
  });

  return <group ref={group}>{pieces}{sorted.map((opening) => opening.openingType === 'window'
    ? <WindowInsert key={`${opening.id}-insert`} opening={opening} wall={wall} angle={angle} center={pointAt(opening.offset + opening.width / 2)} />
    : <DoorInsert key={`${opening.id}-insert`} opening={opening} wall={wall} angle={angle} center={pointAt(opening.offset + opening.width / 2)} />)}</group>;
}

function Architecture({ measurements, architecture }: { measurements: boolean; architecture: ArchitecturalElement[] }) {
  const rooms = architecture.filter((element): element is RoomElement => element.kind === 'room');
  const walls = architecture.filter((element): element is WallElement => element.kind === 'wall');
  const openings = architecture.filter((element): element is OpeningElement => element.kind === 'opening');
  const bounds = getArchitectureBounds(architecture);
  const fallbackTarget = { x: (bounds.minX + bounds.maxX) / 2, y: (bounds.minY + bounds.maxY) / 2 };
  return (
    <group>
      {rooms.map((room, index) => <RoomFloor key={room.id} room={room} index={index} />)}
      {rooms.map((room) => <RoomCeilingShadow key={`${room.id}-ceiling-shadow`} room={room} />)}
      {walls.map((wall) => <SceneWall key={wall.id} wall={wall} openings={openings.filter((opening) => opening.wallId === wall.id)} fallbackTarget={fallbackTarget} />)}

      {measurements && (
        <gridHelper args={[Math.max(bounds.width, bounds.depth) * 1.4, Math.max(12, Math.ceil(Math.max(bounds.width, bounds.depth) * 2)), '#5f7d8f', '#adc0c8']} position={[(bounds.minX + bounds.maxX) / 2, 0.022, (bounds.minY + bounds.maxY) / 2]} />
      )}
    </group>
  );
}

function Sofa({ item, position, rotation = 0 }: { item: SceneObject; position: [number, number, number]; rotation?: number }) {
  return (
    <group position={position} rotation={[0, rotation, 0]}>
      <FinishBox scope="furniture" targetId={item.id} owner={item.name} part="base" label="Base" role="textile" defaultColor={palette.sage} position={[0, 0.28, 0]} size={[2.18, 0.34, 0.91]} radius={0.12} />
      {[-0.46, 0.46].map((x) => <FinishBox key={`${x}-seat`} scope="furniture" targetId={item.id} owner={item.name} part="seat" label="Seat cushions" role="textile" defaultColor="#879b91" position={[x, 0.55, 0.08]} size={[0.87, 0.2, 0.62]} radius={0.07} />)}
      <FinishBox scope="furniture" targetId={item.id} owner={item.name} part="back" label="Back" role="textile" defaultColor="#687b73" position={[0, 0.73, -0.35]} size={[2.18, 0.54, 0.18]} radius={0.1} />
      {[-0.46, 0.46].map((x) => <FinishBox key={`${x}-pillow`} scope="furniture" targetId={item.id} owner={item.name} part="pillows" label="Back cushions" role="textile" defaultColor={palette.sageLight} position={[x, 0.81, -0.15]} size={[0.87, 0.32, 0.18]} radius={0.08} />)}
      {[-0.99, 0.99].map((x) => <FinishBox key={`${x}-arm`} scope="furniture" targetId={item.id} owner={item.name} part="arms" label="Arms" role="textile" defaultColor="#6b8177" position={[x, 0.51, 0.02]} size={[0.16, 0.42, 0.74]} radius={0.08} />)}
      {[-0.87, 0.87].map((x) => <FinishBox key={x} scope="furniture" targetId={item.id} owner={item.name} part="legs" label="Legs" role="wood" defaultColor={palette.darkWood} position={[x, 0.1, 0.3]} size={[0.08, 0.2, 0.08]} />)}
    </group>
  );
}

function Desk({ item, position, rotation = 0 }: { item: SceneObject; position: [number, number, number]; rotation?: number }) {
  return (
    <group position={position} rotation={[0, rotation, 0]}>
      <FinishBox scope="furniture" targetId={item.id} owner={item.name} part="desktop" label="Desktop" role="wood" defaultColor={palette.wood} position={[0, 0.76, 0]} size={[1.22, 0.09, 0.61]} radius={0.025} />
      {[-0.49, 0.49].flatMap((x) => [-0.22, 0.22].map((z) => <FinishBox key={`${x}-${z}`} scope="furniture" targetId={item.id} owner={item.name} part="legs" label="Legs" role="metal" defaultColor={palette.charcoal} position={[x, 0.38, z]} size={[0.055, 0.72, 0.055]} />))}
      <FinishBox scope="furniture" targetId={item.id} owner={item.name} part="monitor" label="Monitor" role="metal" defaultColor="#273230" position={[0, 1.08, -0.05]} size={[0.55, 0.34, 0.045]} radius={0.025} />
      <Box position={[0, 1.08, -0.024]} size={[0.48, 0.27, 0.014]} color="#6fa0aa" radius={0.012} castShadow={false} />
      <Box position={[0, 0.89, -0.05]} size={[0.045, 0.18, 0.045]} color={palette.charcoal} />
      <FinishBox scope="furniture" targetId={item.id} owner={item.name} part="keyboard" label="Keyboard" role="surface" defaultColor="#d7d1c3" position={[0, 0.825, 0.12]} size={[0.42, 0.025, 0.16]} radius={0.015} />
    </group>
  );
}

function DiningSet({ item, position, rotation = 0 }: { item: SceneObject; position: [number, number, number]; rotation?: number }) {
  const chairs = [
    { position: [-0.485, 0, 0] as [number, number, number], rotation: Math.PI / 2 },
    { position: [0.485, 0, 0] as [number, number, number], rotation: -Math.PI / 2 },
    { position: [0, 0, -0.33] as [number, number, number], rotation: 0 },
    { position: [0, 0, 0.33] as [number, number, number], rotation: Math.PI },
  ];
  return (
    <group position={position} rotation={[0, rotation, 0]}>
      <FinishBox scope="furniture" targetId={item.id} owner={item.name} part="tabletop" label="Tabletop" role="wood" defaultColor={palette.wood} position={[0, 0.72, 0]} size={[0.72, 0.08, 0.5]} radius={0.07} />
      {[-0.27, 0.27].flatMap((x) => [-0.16, 0.16].map((z) => <FinishBox key={`${x}-${z}`} scope="furniture" targetId={item.id} owner={item.name} part="table-legs" label="Table legs" role="wood" defaultColor={palette.darkWood} position={[x, 0.35, z]} size={[0.05, 0.7, 0.05]} radius={0.015} />))}
      {chairs.map((chair, index) => (
        <group key={index} position={chair.position} rotation={[0, chair.rotation, 0]}>
          <FinishBox scope="furniture" targetId={item.id} owner={item.name} part="chairs" label="Chairs" role="surface" defaultColor={palette.sage} position={[0, 0.42, 0]} size={[0.27, 0.075, 0.25]} radius={0.045} />
          <FinishBox scope="furniture" targetId={item.id} owner={item.name} part="chairs" label="Chairs" role="surface" defaultColor={palette.sage} position={[0, 0.63, -0.095]} size={[0.27, 0.34, 0.055]} radius={0.045} />
          {[-0.09, 0.09].flatMap((legX) => [-0.075, 0.075].map((legZ) => <Box key={`${legX}-${legZ}`} position={[legX, 0.2, legZ]} size={[0.032, 0.4, 0.032]} color={palette.charcoal} radius={0.01} />))}
        </group>
      ))}
    </group>
  );
}

function Bed({ item, position, rotation = 0 }: { item: SceneObject; position: [number, number, number]; rotation?: number }) {
  return (
    <group position={position} rotation={[0, rotation, 0]}>
      <FinishBox scope="furniture" targetId={item.id} owner={item.name} part="base" label="Bed base" role="wood" defaultColor={palette.darkWood} position={[0, 0.325, 0]} size={[1.52, 0.65, 2.03]} radius={0.08} />
      <FinishBox scope="furniture" targetId={item.id} owner={item.name} part="mattress" label="Mattress" role="textile" defaultColor={palette.linen} position={[0, 0.76, 0]} size={[1.44, 0.22, 1.92]} radius={0.1} />
      <FinishBox scope="furniture" targetId={item.id} owner={item.name} part="headboard" label="Headboard" role="textile" defaultColor={palette.sage} position={[0, 0.9725, -0.93]} size={[1.52, 0.645, 0.12]} radius={0.08} />
      {[-0.38, 0.38].map((x) => <FinishBox key={x} scope="furniture" targetId={item.id} owner={item.name} part="pillows" label="Pillows" role="textile" defaultColor={palette.trim} position={[x, 0.91, -0.65]} size={[0.58, 0.16, 0.43]} radius={0.09} />)}
      <FinishBox scope="furniture" targetId={item.id} owner={item.name} part="blanket" label="Blanket" role="accent" defaultColor="#ad7258" position={[0, 0.88, 0.3]} size={[1.43, 0.06, 0.8]} radius={0.03} />
    </group>
  );
}

function Dresser({ item, position, rotation = 0 }: { item: SceneObject; position: [number, number, number]; rotation?: number }) {
  return (
    <group position={position} rotation={[0, rotation, 0]}>
      <FinishBox scope="furniture" targetId={item.id} owner={item.name} part="body" label="Dresser body" role="wood" defaultColor={palette.wood} position={[0, 0.47, 0]} size={[1.52, 0.84, 0.42]} radius={0.04} />
      <FinishBox scope="furniture" targetId={item.id} owner={item.name} part="top" label="Dresser top" role="wood" defaultColor="#c8b08f" position={[0, 0.91, 0]} size={[1.52, 0.07, 0.51]} radius={0.025} />
      {[0.25, 0.5, 0.75].flatMap((y) => [-0.36, 0.36].map((x) => <FinishBox key={`${x}-${y}-drawer`} scope="furniture" targetId={item.id} owner={item.name} part="drawers" label="Drawer fronts" role="wood" defaultColor={palette.wood} position={[x, y, 0.218]} size={[0.65, 0.2, 0.018]} radius={0.018} />))}
      {[0.25, 0.5, 0.75].flatMap((y) => [-0.36, 0.36].map((x) => <mesh key={`${x}-${y}-knob`} position={[x, y, 0.235]} castShadow><sphereGeometry args={[0.018, 12, 12]} /><meshStandardMaterial color={palette.brass} metalness={0.45} roughness={0.3} /></mesh>))}
      {[-0.62, 0.62].map((x) => <Box key={`${x}-foot`} position={[x, 0.08, 0]} size={[0.08, 0.16, 0.08]} color={palette.darkWood} radius={0.02} />)}
    </group>
  );
}

function CoffeeTable({ item, position }: { item: SceneObject; position: [number, number, number] }) {
  const finishes = useContext(FinishContext);
  const topKey = materialKey('furniture', item.id, 'tabletop');
  const baseKey = materialKey('furniture', item.id, 'base');
  const showPicker = (event: ThreeEvent<MouseEvent>) => { event.stopPropagation(); finishes.openFurniturePartPicker(item.id); };
  const finishHandlers = (targetKey: string) => ({
    onClick: showPicker,
    onPointerOver: (event: ThreeEvent<PointerEvent>) => { event.stopPropagation(); finishes.setHoveredTargetKey(targetKey); },
    onPointerOut: (event: ThreeEvent<PointerEvent>) => { event.stopPropagation(); finishes.setHoveredTargetKey((current) => current === targetKey ? null : current); },
  });
  return (
    <group position={position}>
      <mesh position={[0, 0.38, 0]} scale={[0.535, 0.045, 0.305]} castShadow receiveShadow {...finishHandlers(topKey)} onDoubleClick={(event) => { event.stopPropagation(); finishes.select({ targetKey: topKey, owner: item.name, part: 'Tabletop', role: 'wood', defaultColor: palette.darkWood }); }}>
        <sphereGeometry args={[1, 36, 18]} />
        <meshStandardMaterial color={finishes.colors[topKey] ?? palette.darkWood} roughness={0.65} />
      </mesh>
      {finishes.hoveredTargetKey === topKey && <mesh position={[0, 0.38, 0]} scale={[0.548, 0.049, 0.313]} raycast={() => null} renderOrder={2}><sphereGeometry args={[1, 36, 18]} /><meshBasicMaterial color="#e8896d" wireframe transparent opacity={0.92} /></mesh>}
      <mesh position={[0, 0.2, 0]} castShadow><cylinderGeometry args={[0.06, 0.14, 0.36, 18]} /><meshStandardMaterial color={palette.charcoal} roughness={0.6} /></mesh>
      <mesh position={[0, 0.06, 0]} scale={[0.26, 0.035, 0.17]} castShadow receiveShadow {...finishHandlers(baseKey)} onDoubleClick={(event) => { event.stopPropagation(); finishes.select({ targetKey: baseKey, owner: item.name, part: 'Base', role: 'metal', defaultColor: palette.brass }); }}><sphereGeometry args={[1, 24, 12]} /><meshStandardMaterial color={finishes.colors[baseKey] ?? palette.brass} metalness={0.42} roughness={0.38} /></mesh>
      {finishes.hoveredTargetKey === baseKey && <mesh position={[0, 0.06, 0]} scale={[0.267, 0.039, 0.177]} raycast={() => null} renderOrder={2}><sphereGeometry args={[1, 24, 12]} /><meshBasicMaterial color="#e8896d" wireframe transparent opacity={0.92} /></mesh>}
    </group>
  );
}

function AccentChair({ item, position }: { item: SceneObject; position: [number, number, number] }) {
  return (
    <group position={position}>
      <FinishBox scope="furniture" targetId={item.id} owner={item.name} part="seat" label="Seat" role="textile" defaultColor={palette.rust} position={[0, 0.43, 0]} size={[0.76, 0.2, 0.81]} radius={0.13} />
      <FinishBox scope="furniture" targetId={item.id} owner={item.name} part="back" label="Back" role="textile" defaultColor="#b56f50" position={[0, 0.72, -0.27]} size={[0.68, 0.52, 0.16]} radius={0.12} />
      {[-0.34, 0.34].map((x) => <FinishBox key={`${x}-arm`} scope="furniture" targetId={item.id} owner={item.name} part="arms" label="Arms" role="textile" defaultColor="#9f5f47" position={[x, 0.58, 0]} size={[0.08, 0.28, 0.58]} radius={0.045} />)}
      {[-0.25, 0.25].flatMap((x) => [-0.23, 0.23].map((z) => <Box key={`${x}-${z}`} position={[x, 0.18, z]} size={[0.055, 0.36, 0.055]} color={palette.darkWood} radius={0.018} rotation={[z > 0 ? 0.06 : -0.06, 0, x > 0 ? -0.05 : 0.05]} />))}
    </group>
  );
}

function Nightstand({ item, position }: { item: SceneObject; position: [number, number, number] }) {
  return (
    <group position={position}>
      <FinishBox scope="furniture" targetId={item.id} owner={item.name} part="body" label="Nightstand body" role="wood" defaultColor={palette.wood} position={[0, 0.36, 0]} size={[0.56, 0.48, 0.46]} radius={0.04} />
      <FinishBox scope="furniture" targetId={item.id} owner={item.name} part="top" label="Nightstand top" role="wood" defaultColor="#cfb998" position={[0, 0.63, 0]} size={[0.56, 0.07, 0.46]} radius={0.025} />
      {[-0.09, 0.11].map((y) => <Box key={y} position={[0, 0.36 + y, 0.238]} size={[0.48, 0.025, 0.025]} color={palette.darkWood} radius={0.006} />)}
      {[-0.09, 0.11].map((y) => <mesh key={`${y}-knob`} position={[0, 0.36 + y, 0.265]} castShadow><sphereGeometry args={[0.025, 12, 8]} /><meshStandardMaterial color={palette.brass} metalness={0.7} roughness={0.25} /></mesh>)}
      {[-0.21, 0.21].flatMap((x) => [-0.15, 0.15].map((z) => <Box key={`${x}-${z}`} position={[x, 0.08, z]} size={[0.045, 0.16, 0.045]} color={palette.darkWood} radius={0.014} />))}
    </group>
  );
}

function Bookcase({ item, position }: { item: SceneObject; position: [number, number, number] }) {
  const shelves = [0.08, 0.5, 0.92, 1.34, 1.76];
  return (
    <group position={position}>
      <FinishBox scope="furniture" targetId={item.id} owner={item.name} part="back" label="Bookcase back" role="wood" defaultColor={palette.darkWood} position={[0, 0.915, -0.13]} size={[0.91, 1.83, 0.08]} radius={0.025} />
      {[-0.42, 0.42].map((x) => <FinishBox key={x} scope="furniture" targetId={item.id} owner={item.name} part="frame" label="Bookcase frame" role="wood" defaultColor={palette.wood} position={[x, 0.915, 0]} size={[0.07, 1.83, 0.35]} radius={0.022} />)}
      {shelves.map((y) => <FinishBox key={y} scope="furniture" targetId={item.id} owner={item.name} part="shelves" label="Shelves" role="wood" defaultColor="#b58b65" position={[0, y, 0]} size={[0.88, 0.065, 0.35]} radius={0.018} />)}
      {[[-0.29, 0.27, '#73877e'], [-0.12, 0.29, '#c47e58'], [0.07, 0.26, '#d8cdbb'], [0.26, 0.3, '#596f78']].flatMap(([x, width, color], row) => [0.12, 0.54, 0.96, 1.38].map((y) => <Box key={`${row}-${y}`} position={[Number(x), y + 0.12, 0.085]} size={[Number(width) * 0.55, 0.24 + row * 0.015, 0.14]} color={String(color)} radius={0.012} />))}
    </group>
  );
}

function Stove({ item }: { item: SceneObject }) {
  return <group>
    <FinishBox scope="furniture" targetId={item.id} owner={item.name} part="body" label="Stove body" role="metal" defaultColor="#4e5e61" position={[0, 0.43, 0]} size={[0.76, 0.86, 0.61]} radius={0.035} />
    <FinishBox scope="furniture" targetId={item.id} owner={item.name} part="cooktop" label="Cooktop" role="metal" defaultColor="#273230" position={[0, 0.87, 0]} size={[0.7, 0.035, 0.56]} radius={0.018} />
    {[-0.18, 0.18].flatMap((x) => [-0.15, 0.15].map((z) => <mesh key={`${x}-${z}`} position={[x, 0.895, z]} rotation={[-Math.PI / 2, 0, 0]}><torusGeometry args={[0.075, 0.012, 10, 22]} /><meshStandardMaterial color={palette.brass} metalness={.72} roughness={.25} /></mesh>))}
    <FinishBox scope="furniture" targetId={item.id} owner={item.name} part="oven" label="Oven door" role="surface" defaultColor="#dce4df" position={[0, 0.42, 0.293]} size={[0.56, 0.46, 0.022]} radius={0.018} />
  </group>;
}

function Sink({ item }: { item: SceneObject }) {
  return <group>
    <FinishBox scope="furniture" targetId={item.id} owner={item.name} part="cabinet" label="Sink cabinet" role="wood" defaultColor={palette.wood} position={[0, 0.4, 0]} size={[0.76, 0.8, 0.61]} radius={0.03} />
    <FinishBox scope="furniture" targetId={item.id} owner={item.name} part="basin" label="Sink basin" role="surface" defaultColor="#dce4df" position={[0, 0.83, 0]} size={[0.65, 0.06, 0.5]} radius={0.04} />
    <mesh position={[0, 0.865, 0]} rotation={[-Math.PI / 2, 0, 0]}><torusGeometry args={[0.15, 0.018, 12, 28]} /><meshStandardMaterial color="#5b747c" metalness={.55} roughness={.28} /></mesh>
    <mesh position={[0, 0.955, -0.17]}><cylinderGeometry args={[0.025, 0.025, 0.19, 14]} /><meshStandardMaterial color={palette.brass} metalness={.72} roughness={.22} /></mesh>
    <Box position={[0.075, 1.037, -0.17]} size={[0.15, 0.025, 0.025]} color={palette.brass} radius={0.01} />
  </group>;
}

function Fridge({ item }: { item: SceneObject }) {
  return <group>
    <FinishBox scope="furniture" targetId={item.id} owner={item.name} part="body" label="Fridge body" role="metal" defaultColor="#dce4df" position={[0, 0.5925, 0]} size={[0.91, 1.185, 0.76]} radius={0.045} />
    <FinishBox scope="furniture" targetId={item.id} owner={item.name} part="body" label="Freezer body" role="metal" defaultColor="#dce4df" position={[0, 1.4975, 0]} size={[0.91, 0.555, 0.76]} radius={0.045} />
    <FinishBox scope="furniture" targetId={item.id} owner={item.name} part="doors" label="Fridge door" role="surface" defaultColor="#eef1e9" position={[0, 0.5925, 0.365]} size={[0.82, 1.12, 0.02]} radius={0.025} />
    <FinishBox scope="furniture" targetId={item.id} owner={item.name} part="doors" label="Freezer door" role="surface" defaultColor="#eef1e9" position={[0, 1.4975, 0.365]} size={[0.82, 0.49, 0.02]} radius={0.025} />
    <Box position={[0, 0.89, 0.37]} size={[0.82, 0.02, 0.018]} color="#78929a" radius={0.006} />
    <Box position={[0.28, 0.49, 0.37]} size={[0.026, 0.46, 0.018]} color={palette.charcoal} radius={0.01} />
    <Box position={[0.28, 1.47, 0.37]} size={[0.026, 0.22, 0.018]} color={palette.charcoal} radius={0.01} />
  </group>;
}

function Toilet({ item }: { item: SceneObject }) {
  return <group>
    <FinishBox scope="furniture" targetId={item.id} owner={item.name} part="tank" label="Toilet tank" role="surface" defaultColor="#edf0e8" position={[0, 0.59, -0.22]} size={[0.4, 0.38, 0.22]} radius={0.06} />
    <FinishBox scope="furniture" targetId={item.id} owner={item.name} part="base" label="Toilet base" role="surface" defaultColor="#edf0e8" position={[0, 0.3, 0.1]} size={[0.35, 0.56, 0.48]} radius={0.16} />
    <mesh position={[0, 0.59, 0.11]} rotation={[-Math.PI / 2, 0, 0]}><torusGeometry args={[0.115, 0.014, 14, 28]} /><meshStandardMaterial color="#bcc9c4" roughness={.45} /></mesh>
  </group>;
}

function Shower({ item }: { item: SceneObject }) {
  return <group>
    <FinishBox scope="furniture" targetId={item.id} owner={item.name} part="tray" label="Shower tray" role="surface" defaultColor="#dce4df" position={[0, 0.045, 0]} size={[0.91, 0.09, 0.91]} radius={0.06} />
    {[-0.42, 0.42].map((x) => <FinishBox key={x} scope="furniture" targetId={item.id} owner={item.name} part="glass" label="Shower glass" role="surface" defaultColor="#a9d3df" position={[x, 1.03, 0]} size={[0.025, 1.94, 0.91]} radius={0.012} />)}
    <FinishBox scope="furniture" targetId={item.id} owner={item.name} part="glass" label="Shower glass" role="surface" defaultColor="#a9d3df" position={[0, 1.03, -0.42]} size={[0.91, 1.94, 0.025]} radius={0.012} />
    <Box position={[0.27, 1.65, -0.36]} size={[0.04, 0.5, 0.04]} color={palette.brass} radius={0.012} /><mesh position={[0.27, 1.84, -0.26]} rotation={[Math.PI / 2, 0, 0]}><cylinderGeometry args={[0.1, 0.1, 0.035, 18]} /><meshStandardMaterial color={palette.brass} metalness={.65} roughness={.25} /></mesh>
  </group>;
}

function Bathtub({ item }: { item: SceneObject }) {
  return <group>
    <FinishBox scope="furniture" targetId={item.id} owner={item.name} part="shell" label="Bathtub base" role="surface" defaultColor="#dce4df" position={[0, 0.06, 0]} size={[1.6, 0.12, 0.5]} radius={0.12} />
    <FinishBox scope="furniture" targetId={item.id} owner={item.name} part="shell" label="Bathtub rail" role="surface" defaultColor="#dce4df" position={[0, 0.25, -0.31]} size={[1.6, 0.38, 0.13]} radius={0.12} />
    <FinishBox scope="furniture" targetId={item.id} owner={item.name} part="shell" label="Bathtub rail" role="surface" defaultColor="#dce4df" position={[0, 0.25, 0.31]} size={[1.6, 0.38, 0.13]} radius={0.12} />
    <FinishBox scope="furniture" targetId={item.id} owner={item.name} part="basin" label="Bathtub basin" role="surface" defaultColor="#f7f6ec" position={[0, 0.135, 0]} size={[1.76, 0.035, 0.48]} radius={0.11} />
    <Box position={[0, 0.42, -0.3]} size={[0.035, 0.25, 0.035]} color={palette.brass} radius={0.01} />
    <Box position={[0, 0.53, -0.21]} size={[0.035, 0.035, 0.2]} color={palette.brass} radius={0.01} />
  </group>;
}

function WasherDryer({ item }: { item: SceneObject }) {
  return <group>
    <FinishBox scope="furniture" targetId={item.id} owner={item.name} part="body" label="Washer dryer body" role="metal" defaultColor="#dce4df" position={[0, 0.425, 0]} size={[0.6, 0.85, 0.65]} radius={0.04} />
    <FinishBox scope="furniture" targetId={item.id} owner={item.name} part="panel" label="Control panel" role="surface" defaultColor="#eef1e9" position={[0, 0.72, 0.307]} size={[0.49, 0.16, 0.02]} radius={0.015} />
    <mesh position={[0, 0.38, 0.302]} rotation={[Math.PI / 2, 0, 0]}><torusGeometry args={[0.17, 0.02, 12, 28]} /><meshStandardMaterial color="#5f7c86" metalness={.35} roughness={.35} /></mesh>
  </group>;
}

function GenericObject({ item, position }: { item: SceneObject; position: [number, number, number] }) {
  return (
    <group position={position}>
      <FinishBox scope="furniture" targetId={item.id} owner={item.name} part="body" label="Body" role="surface" defaultColor={palette.sage} position={[0, 0.4, 0]} size={[0.8, 0.8, 0.8]} radius={0.035} />
    </group>
  );
}

function AddedFurniture({ item }: { item: SceneObject }) {
  const { width, depth, height } = item.dimensions;
  const color = item.category === 'storage' ? palette.wood : item.category === 'table' ? palette.darkWood : '#86968e';
  return (
    <group position={[item.transform.position.x, 0, item.transform.position.z]} rotation={[0, THREE.MathUtils.degToRad(item.transform.rotation.y), 0]}>
      <FinishBox scope="furniture" targetId={item.id} owner={item.name} part="body" label="Body" role="surface" defaultColor={color} position={[0, height / 2, 0]} size={[width, height, depth]} radius={0.07} />
    </group>
  );
}

function ScaledFurniture({ item, base, children }: { item: SceneObject; base: SceneObject['dimensions']; children: ReactNode }) {
  return (
    <group
      position={[item.transform.position.x, item.transform.position.y, item.transform.position.z]}
      rotation={[0, THREE.MathUtils.degToRad(item.transform.rotation.y), 0]}
      scale={[item.dimensions.width / base.width, item.dimensions.height / base.height, item.dimensions.depth / base.depth]}
    >
      {children}
    </group>
  );
}

function Furniture({ objects }: { objects: SceneObject[] }) {
  return (
    <group>
      {objects.map((item) => {
        const kind = getFurnitureKind(item.category, item.name);
        if (kind === 'sofa') return <ScaledFurniture key={item.id} item={item} base={furnitureModelEnvelopes.sofa}><Sofa item={item} position={[0, 0, 0]} /></ScaledFurniture>;
        if (kind === 'desk') return <ScaledFurniture key={item.id} item={item} base={furnitureModelEnvelopes.desk}><Desk item={item} position={[0, 0, 0]} /></ScaledFurniture>;
        if (kind === 'coffee') return <ScaledFurniture key={item.id} item={item} base={furnitureModelEnvelopes.coffee}><CoffeeTable item={item} position={[0, 0, 0]} /></ScaledFurniture>;
        if (kind === 'dining') return <ScaledFurniture key={item.id} item={item} base={furnitureModelEnvelopes.dining}><DiningSet item={item} position={[0, 0, 0]} /></ScaledFurniture>;
        if (kind === 'bed') return <ScaledFurniture key={item.id} item={item} base={furnitureModelEnvelopes.bed}><Bed item={item} position={[0, 0, 0]} /></ScaledFurniture>;
        if (kind === 'chair') return <ScaledFurniture key={item.id} item={item} base={furnitureModelEnvelopes.chair}><AccentChair item={item} position={[0, 0, 0]} /></ScaledFurniture>;
        if (kind === 'nightstand') return <ScaledFurniture key={item.id} item={item} base={furnitureModelEnvelopes.nightstand}><Nightstand item={item} position={[0, 0, 0]} /></ScaledFurniture>;
        if (kind === 'bookcase') return <ScaledFurniture key={item.id} item={item} base={furnitureModelEnvelopes.bookcase}><Bookcase item={item} position={[0, 0, 0]} /></ScaledFurniture>;
        if (kind === 'storage') return <ScaledFurniture key={item.id} item={item} base={furnitureModelEnvelopes.storage}><Dresser item={item} position={[0, 0, 0]} /></ScaledFurniture>;
        if (kind === 'stove') return <ScaledFurniture key={item.id} item={item} base={furnitureModelEnvelopes.stove}><Stove item={item} /></ScaledFurniture>;
        if (kind === 'sink') return <ScaledFurniture key={item.id} item={item} base={furnitureModelEnvelopes.sink}><Sink item={item} /></ScaledFurniture>;
        if (kind === 'fridge') return <ScaledFurniture key={item.id} item={item} base={furnitureModelEnvelopes.fridge}><Fridge item={item} /></ScaledFurniture>;
        if (kind === 'toilet') return <ScaledFurniture key={item.id} item={item} base={furnitureModelEnvelopes.toilet}><Toilet item={item} /></ScaledFurniture>;
        if (kind === 'shower') return <ScaledFurniture key={item.id} item={item} base={furnitureModelEnvelopes.shower}><Shower item={item} /></ScaledFurniture>;
        if (kind === 'bathtub') return <ScaledFurniture key={item.id} item={item} base={furnitureModelEnvelopes.bathtub}><Bathtub item={item} /></ScaledFurniture>;
        if (kind === 'washer-dryer') return <ScaledFurniture key={item.id} item={item} base={furnitureModelEnvelopes['washer-dryer']}><WasherDryer item={item} /></ScaledFurniture>;
        if (kind === 'other') return <ScaledFurniture key={item.id} item={item} base={furnitureModelEnvelopes.other}><GenericObject item={item} position={[0, 0, 0]} /></ScaledFurniture>;
        return <AddedFurniture key={item.id} item={item} />;
      })}
    </group>
  );
}

function FurnitureMeasurements({ objects }: { objects: SceneObject[] }) {
  const camera = useThree((state) => state.camera);
  const [showHeight, setShowHeight] = useState(false);
  const cameraDirection = useRef(new THREE.Vector3());
  const color = '#b64c3c';
  const tick = 0.06;

  useFrame(() => {
    camera.getWorldDirection(cameraDirection.current);
    const nextShowHeight = Math.abs(cameraDirection.current.y) < 0.92;
    setShowHeight((current) => current === nextShowHeight ? current : nextShowHeight);
  });

  return (
    <group>
      {objects.map((item) => {
        const { width, depth, height } = item.dimensions;
        const widthOffset = depth / 2 + 0.14;
        const depthOffset = width / 2 + 0.14;
        const heightX = width / 2 + 0.14;
        const heightZ = -depth / 2 - 0.14;
        return (
          <group key={`${item.id}-measurements`} position={[item.transform.position.x, item.transform.position.y + 0.025, item.transform.position.z]} rotation={[0, THREE.MathUtils.degToRad(item.transform.rotation.y), 0]}>
            <Line points={[[-width / 2, 0, widthOffset], [width / 2, 0, widthOffset]]} color={color} lineWidth={1} depthTest={false} />
            <Line points={[[-width / 2, 0, widthOffset - tick], [-width / 2, 0, widthOffset + tick], [width / 2, 0, widthOffset + tick], [width / 2, 0, widthOffset - tick]]} color={color} lineWidth={1} depthTest={false} />
            <Html center sprite position={[0, 0.08, widthOffset]} className="furniture-measurement-label">W {width.toFixed(2)} m</Html>

            <Line points={[[depthOffset, 0, -depth / 2], [depthOffset, 0, depth / 2]]} color={color} lineWidth={1} depthTest={false} />
            <Line points={[[depthOffset - tick, 0, -depth / 2], [depthOffset + tick, 0, -depth / 2], [depthOffset + tick, 0, depth / 2], [depthOffset - tick, 0, depth / 2]]} color={color} lineWidth={1} depthTest={false} />
            <Html center sprite position={[depthOffset, 0.08, 0]} className="furniture-measurement-label">D {depth.toFixed(2)} m</Html>

            {showHeight && <>
              <Line points={[[heightX, 0, heightZ], [heightX, height, heightZ]]} color={color} lineWidth={1} depthTest={false} />
              <Line points={[[heightX - tick, 0, heightZ], [heightX + tick, 0, heightZ], [heightX + tick, height, heightZ], [heightX - tick, height, heightZ]]} color={color} lineWidth={1} depthTest={false} />
              <Html center sprite position={[heightX, height / 2, heightZ]} className="furniture-measurement-label">H {height.toFixed(2)} m</Html>
            </>}
          </group>
        );
      })}
    </group>
  );
}

function Sunlight({ hour, northAngle, center, sceneSpan, maximumHeight }: { hour: number; northAngle: number; center: [number, number, number]; sceneSpan: number; maximumHeight: number }) {
  const sunDistance = Math.max(12, sceneSpan * 2 + maximumHeight * 2);
  const shadowExtent = Math.max(4, sceneSpan / 2 + maximumHeight * 1.5 + 1);
  const shadowFar = sunDistance * 2 + sceneSpan + maximumHeight;
  const shadowMapSize = sceneSpan > 16 ? 4096 : 2048;
  const sun = useMemo(() => {
    const offset = getSunDirection(hour, northAngle, sunDistance).position;
    return [center[0] + offset[0], center[1] + offset[1], center[2] + offset[2]] as [number, number, number];
  }, [center, hour, northAngle, sunDistance]);
  const warmth = hour < 9.5 || hour > 17 ? '#ffd1a0' : '#fff1d0';
  const solarProgress = Math.max(0, Math.min(1, (hour - 7) / 13));
  const intensity = 0.75 + Math.sin(solarProgress * Math.PI) * 4.5;

  return (
    <>
      <directionalLight
        position={sun}
        intensity={intensity}
        color={warmth}
        castShadow
        shadow-mapSize-width={shadowMapSize}
        shadow-mapSize-height={shadowMapSize}
        shadow-camera-near={0.1}
        shadow-camera-far={shadowFar}
        shadow-camera-left={-shadowExtent}
        shadow-camera-right={shadowExtent}
        shadow-camera-top={shadowExtent}
        shadow-camera-bottom={-shadowExtent}
        shadow-bias={-0.00025}
        shadow-normalBias={0.018}
        shadow-radius={2.5}
      >
        <object3D attach="target" position={center} />
      </directionalLight>
    </>
  );
}

function Scene({ hour, northAngle, measurements, objects, architecture }: Pick<ApartmentSceneProps, 'hour' | 'northAngle' | 'measurements' | 'objects' | 'architecture'>) {
  const bounds = getArchitectureBounds(architecture);
  const rooms = architecture.filter((element): element is RoomElement => element.kind === 'room');
  const walls = new Map(architecture.flatMap((element) => element.kind === 'wall' ? [[element.id, element] as const] : []));
  const windows = architecture.filter((element): element is OpeningElement => element.kind === 'opening' && element.openingType === 'window');
  const sceneSpan = Math.hypot(bounds.width, bounds.depth);
  const maximumHeight = Math.max(2.4, ...architecture.flatMap((element) => element.kind === 'wall' ? [element.height] : element.kind === 'room' ? [element.ceilingHeight] : []));
  const hasWindows = windows.length > 0;
  const hemisphereIntensity = 0.48;
  const ambientIntensity = 0.28;
  const hemisphereGroundColor = hasWindows ? '#9a765d' : '#8d9694';
  const centerX = (bounds.minX + bounds.maxX) / 2;
  const centerZ = (bounds.minY + bounds.maxY) / 2;
  const apartmentCenter = { x: centerX, y: centerZ };
  const sunlightCenter: [number, number, number] = [centerX, 0.8, centerZ];
  return (
    <>
      <color attach="background" args={['#d8dedb']} />
      <hemisphereLight args={['#e6f0f2', hemisphereGroundColor, hemisphereIntensity]} />
      <ambientLight intensity={ambientIntensity} color="#dce5e4" />
      {hasWindows && <Sunlight hour={hour} northAngle={northAngle} center={sunlightCenter} sceneSpan={sceneSpan} maximumHeight={maximumHeight} />}
      {windows.map((opening) => {
        const wall = walls.get(opening.wallId);
        return wall ? <WindowDaylight key={`${opening.id}-daylight`} opening={opening} wall={wall} apartmentCenter={apartmentCenter} hour={hour} /> : null;
      })}
      {!hasWindows && <VirtualWindowFill rooms={rooms} />}
      <Architecture measurements={measurements} architecture={architecture} />
      <Furniture objects={objects} />
      {measurements && <FurnitureMeasurements objects={objects} />}
      <ContactShadows position={[(bounds.minX + bounds.maxX) / 2, 0.02, (bounds.minY + bounds.maxY) / 2]} scale={Math.max(bounds.width, bounds.depth) * 1.35} opacity={0.32} blur={2.2} far={4} />
    </>
  );
}

const finishPresets = ['#73877e', '#b98f68', '#c47e58', '#596f78', '#d8cdbb', '#765b45', '#9b6a88', '#4f7c78'];

function finishOptionsForFurniture(item: SceneObject): FinishSelection[] {
  return finishTargetsForFurniture(item).map(finishSelectionForTarget);
}

const finishSelectionForTarget = (target: FinishTarget): FinishSelection => ({ targetKey: target.targetKey, owner: target.ownerLabel, part: target.partLabel, role: target.role, defaultColor: target.defaultColor });

function FinishPartPicker({ owner, options, onSelect, onClose }: { owner: string; options: FinishSelection[]; onSelect: (option: FinishSelection) => void; onClose: () => void }) {
  return <aside className="finish-part-picker" aria-label={`Choose a part of ${owner} to recolor`}>
    <div className="finish-part-picker-heading"><div><span>3D FINISH STUDIO</span><strong>{owner}</strong></div><button type="button" onClick={onClose} aria-label="Close part picker">×</button></div>
    <p>Choose the exact furniture surface to recolor.</p>
    <div className="finish-part-options">{options.map((option) => <button type="button" key={option.targetKey} onClick={() => onSelect(option)}>{option.part}</button>)}</div>
  </aside>;
}

function FinishPanel({ selection, rawColor, mood, previewColor, dirty, saving, message, onRawColor, onMood, onApply, onReset, onClose }: {
  selection: FinishSelection;
  rawColor: string;
  mood: FinishMood;
  previewColor: string;
  dirty: boolean;
  saving: boolean;
  message: string;
  onRawColor: (color: string) => void;
  onMood: (mood: FinishMood) => void;
  onApply: () => void;
  onReset: () => void;
  onClose: () => void;
}) {
  return (
    <aside className="finish-panel" aria-label={`Edit ${selection.part} finish`}>
      <div className="finish-panel-heading"><div><span>3D FINISH STUDIO</span><strong>{selection.owner} · {selection.part}</strong></div><button type="button" onClick={onClose} aria-label="Close finish studio">×</button></div>
      <p>Choose any hue. Dwellwise refines it for this material so the room stays cohesive.</p>
      <div className="finish-color-readout"><label style={{ backgroundColor: rawColor }}><input type="color" value={rawColor} onChange={(event) => onRawColor(event.target.value)} aria-label="Choose a finish color" /></label><span>YOUR COLOR</span><i>→</i><b style={{ backgroundColor: previewColor }} /><span>REFINED</span></div>
      <div className="finish-swatches" aria-label="Curated colors">{finishPresets.map((color) => <button key={color} type="button" aria-label={`Choose ${color}`} style={{ backgroundColor: color }} onClick={() => onRawColor(color)} />)}</div>
      <div className="finish-moods" aria-label="Finish character">{(['soft', 'balanced', 'bold'] as const).map((option) => <button className={mood === option ? 'active' : ''} key={option} type="button" onClick={() => onMood(option)}>{option}</button>)}</div>
      <div className="finish-actions"><button type="button" onClick={onReset} disabled={saving}>Reset</button><button type="button" onClick={onApply} disabled={saving || !dirty}>{saving ? 'Saving…' : 'Apply finish'}</button></div>
      {message && <small role="status">{message}</small>}
    </aside>
  );
}

export default function ApartmentScene(props: ApartmentSceneProps) {
  const storageKey = cameraStorageKey(props.projectId);
  const footprint = useMemo(() => cameraFootprint(props.architecture), [props.architecture]);
  const [savedCamera] = useState<CameraViewState | null>(() => readSessionCamera(storageKey, footprint));
  const defaultCamera = getTopDownCamera(props.architecture, 0);
  const initialCamera = savedCamera ?? {
    position: defaultCamera.position.toArray(),
    target: defaultCamera.target.toArray(),
  };
  const pendingCamera = useRef<CameraViewState | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [selection, setSelection] = useState<FinishSelection | null>(null);
  const [rawColor, setRawColor] = useState('#73877e');
  const [mood, setMood] = useState<FinishMood>('balanced');
  const [finishDirty, setFinishDirty] = useState(false);
  const [savingFinish, setSavingFinish] = useState(false);
  const [finishMessage, setFinishMessage] = useState('');
  const [hoveredTargetKey, setHoveredTargetKey] = useState<string | null>(null);
  const [partPicker, setPartPicker] = useState<{ owner: string; options: FinishSelection[] } | null>(null);
  const finishTargetsByKey = useMemo(() => new Map(buildFinishTargets(props.architecture, props.objects).map((target) => [target.targetKey, target])), [props.architecture, props.objects]);
  const previewColor = selection && finishDirty ? harmonizeColor(rawColor, selection.role, mood) : rawColor;
  const displayedColors = useMemo(() => selection ? { ...props.materialOverrides, [selection.targetKey]: previewColor } : props.materialOverrides, [previewColor, props.materialOverrides, selection]);
  const selectFinish = useCallback((candidate: FinishSelection) => {
    const target = finishTargetsByKey.get(candidate.targetKey);
    if (!target) return;
    const next = finishSelectionForTarget(target);
    setPartPicker(null);
    setSelection(next);
    setRawColor(props.materialOverrides[next.targetKey] ?? next.defaultColor);
    setMood('balanced');
    setFinishDirty(false);
    setFinishMessage('Choose a color or finish character to preview');
  }, [finishTargetsByKey, props.materialOverrides]);
  const openFurniturePartPicker = useCallback((targetId: string) => {
    const item = props.objects.find((candidate) => candidate.id === targetId);
    if (item) setPartPicker({ owner: item.name, options: finishOptionsForFurniture(item) });
  }, [props.objects]);
  const saveCamera = useCallback((state: CameraPose) => {
    const savedState = { ...state, footprint };
    pendingCamera.current = savedState;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      writeSessionCamera(storageKey, savedState);
      pendingCamera.current = null;
      saveTimer.current = null;
    }, 120);
  }, [footprint, storageKey]);

  useEffect(() => () => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    if (pendingCamera.current) writeSessionCamera(storageKey, pendingCamera.current);
  }, [storageKey]);

  return (
    <div className="three-canvas" role="region" aria-label="Interactive three-dimensional apartment model. Drag to orbit, scroll to zoom, right-drag to pan, or double-click a surface to change its finish.">
      <FinishContext.Provider value={{ colors: displayedColors, select: selectFinish, hoveredTargetKey, setHoveredTargetKey, openFurniturePartPicker }}><Canvas
        shadows
        dpr={[1, 1.75]}
        camera={{ position: initialCamera.position, fov: 42, near: 0.1, far: 100 }}
        gl={{ antialias: true, alpha: false, powerPreference: 'high-performance' }}
        onPointerMissed={() => { setHoveredTargetKey(null); setPartPicker(null); }}
        onCreated={({ camera, gl }) => {
          camera.lookAt(new THREE.Vector3(...initialCamera.target));
          gl.toneMapping = THREE.ACESFilmicToneMapping;
          gl.toneMappingExposure = 1.18;
          gl.shadowMap.type = THREE.PCFSoftShadowMap;
          gl.outputColorSpace = THREE.SRGBColorSpace;
        }}
      >
        <Scene
          hour={props.hour}
          northAngle={props.northAngle}
          measurements={props.measurements}
          objects={props.objects}
          architecture={props.architecture}
        />
        <CameraController step={props.cameraStep} reset={props.cameraReset} architecture={props.architecture} initialState={savedCamera} onCameraChange={saveCamera} />
      </Canvas></FinishContext.Provider>
      {partPicker && !selection && <FinishPartPicker owner={partPicker.owner} options={partPicker.options} onSelect={selectFinish} onClose={() => setPartPicker(null)} />}
      {selection && <FinishPanel selection={selection} rawColor={rawColor} mood={mood} previewColor={previewColor} dirty={finishDirty} saving={savingFinish} message={finishMessage} onRawColor={(color) => { setRawColor(color); setFinishDirty(true); setFinishMessage('Previewing live · apply to save'); }} onMood={(nextMood) => { setMood(nextMood); setFinishDirty(true); setFinishMessage('Previewing live · apply to save'); }} onApply={() => {
        setSavingFinish(true);
        setFinishMessage('Saving finish…');
        void props.onMaterialChange(selection.targetKey, previewColor).then((error) => {
          if (error) setFinishMessage(error);
          else {
            setRawColor(previewColor);
            setFinishDirty(false);
            setFinishMessage('Finish saved · undo is available');
          }
        }).finally(() => setSavingFinish(false));
      }} onReset={() => {
        setSavingFinish(true);
        void props.onMaterialChange(selection.targetKey, null).then((error) => {
          if (error) setFinishMessage(error);
          else setSelection(null);
        }).finally(() => setSavingFinish(false));
      }} onClose={() => setSelection(null)} />}
      <div className="canvas-help"><span>DOUBLE-CLICK</span> a surface to recolor <i /> <span>DRAG</span> orbit <i /> <span>SCROLL</span> zoom <i /> walls auto-hide</div>
    </div>
  );
}
