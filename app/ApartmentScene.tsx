'use client';

import { ContactShadows, Html, Line, OrbitControls, RoundedBox } from '@react-three/drei';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ArchitecturalElement, OpeningElement, RoomElement, WallElement } from '@/lib/domain/scene';
import { getArchitectureBounds, wallLength } from '@/lib/domain/architecture';
import { getSunDirection } from '@/lib/domain/sunlight';
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
};

type CameraViewState = {
  position: [number, number, number];
  target: [number, number, number];
};

const palette = {
  wall: '#eee9dd',
  trim: '#f8f5eb',
  wood: '#b98f68',
  darkWood: '#765b45',
  sage: '#73877e',
  sageLight: '#94a59c',
  rust: '#c47e58',
  linen: '#d8cdbb',
  charcoal: '#35413e',
  brass: '#b88a4f',
};

const CAMERA_CONTROL_POLAR_ANGLE = THREE.MathUtils.degToRad(0.5);

function isVectorTuple(value: unknown): value is [number, number, number] {
  return Array.isArray(value) && value.length === 3 && value.every((coordinate) => typeof coordinate === 'number' && Number.isFinite(coordinate));
}

function readSessionCamera(storageKey: string): CameraViewState | null {
  if (typeof window === 'undefined') return null;
  try {
    const value = JSON.parse(window.sessionStorage.getItem(storageKey) ?? 'null') as Partial<CameraViewState> | null;
    return value && isVectorTuple(value.position) && isVectorTuple(value.target) ? { position: value.position, target: value.target } : null;
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

function CameraController({ step, reset, architecture, initialState, onCameraChange }: { step: number; reset: number; architecture: ArchitecturalElement[]; initialState: CameraViewState | null; onCameraChange: (state: CameraViewState) => void }) {
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

function Box({ position, size, color, rotation, radius = 0.03, castShadow = true }: {
  position: [number, number, number];
  size: [number, number, number];
  color: string;
  rotation?: [number, number, number];
  radius?: number;
  castShadow?: boolean;
}) {
  return (
    <RoundedBox position={position} args={size} rotation={rotation} radius={radius} smoothness={3} castShadow={castShadow} receiveShadow>
      <meshStandardMaterial color={color} roughness={0.72} />
    </RoundedBox>
  );
}

function Wall({ position, size, rotation }: { position: [number, number, number]; size: [number, number, number]; rotation?: [number, number, number] }) {
  return <Box position={position} size={size} rotation={rotation} color={palette.wall} radius={0.015} />;
}

function WindowInsert({ opening, wall, angle, center }: { opening: OpeningElement; wall: WallElement; angle: number; center: { x: number; y: number } }) {
  const frame = Math.min(0.07, opening.width / 5, opening.height / 5);
  const innerWidth = Math.max(0.02, opening.width - frame * 2);
  const innerHeight = Math.max(0.02, opening.height - frame * 2);
  const depth = wall.thickness + 0.035;
  return (
    <group position={[center.x, opening.sillHeight + opening.height / 2, center.y]} rotation={[0, -angle, 0]}>
      <Box position={[-opening.width / 2 + frame / 2, 0, 0]} size={[frame, opening.height, depth]} color={palette.trim} radius={0.008} />
      <Box position={[opening.width / 2 - frame / 2, 0, 0]} size={[frame, opening.height, depth]} color={palette.trim} radius={0.008} />
      <Box position={[0, opening.height / 2 - frame / 2, 0]} size={[innerWidth, frame, depth]} color={palette.trim} radius={0.008} />
      <Box position={[0, -opening.height / 2 + frame / 2, 0]} size={[innerWidth, frame, depth]} color={palette.trim} radius={0.008} />
      <mesh position={[0, 0, 0]} castShadow={false} receiveShadow>
        <boxGeometry args={[innerWidth, innerHeight, 0.012]} />
        <meshPhysicalMaterial color="#a9ced8" transparent opacity={0.38} roughness={0.12} transmission={0.18} side={THREE.DoubleSide} />
      </mesh>
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
  return <mesh geometry={geometry} position={[0, room.floorElevation + 0.012, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow><meshStandardMaterial color={colors[index % colors.length]} roughness={0.84} side={THREE.DoubleSide} /></mesh>;
}

function SceneWall({ wall, openings }: { wall: WallElement; openings: OpeningElement[] }) {
  const length = wallLength(wall);
  const angle = Math.atan2(wall.end.y - wall.start.y, wall.end.x - wall.start.x);
  const pointAt = (offset: number) => ({
    x: wall.start.x + ((wall.end.x - wall.start.x) * offset) / length,
    y: wall.start.y + ((wall.end.y - wall.start.y) * offset) / length,
  });
  const part = (key: string, offset: number, width: number, bottom: number, height: number) => {
    if (width < 0.01 || height < 0.01) return null;
    const center = pointAt(offset + width / 2);
    return <Wall key={key} position={[center.x, bottom + height / 2, center.y]} size={[width, height, wall.thickness]} rotation={[0, -angle, 0]} />;
  };
  const sorted = openings
    .filter((opening) => opening.offset >= 0 && opening.offset + opening.width <= length + 0.001)
    .sort((a, b) => a.offset - b.offset);
  if (sorted.length === 0) return part('full', 0, length, 0, wall.height);
  const pieces: ReactNode[] = [];
  let cursor = 0;
  sorted.forEach((opening) => {
    pieces.push(part(`${opening.id}-before`, cursor, opening.offset - cursor, 0, wall.height));
    pieces.push(part(`${opening.id}-below`, opening.offset, opening.width, 0, opening.sillHeight));
    const openingTop = opening.sillHeight + opening.height;
    pieces.push(part(`${opening.id}-above`, opening.offset, opening.width, openingTop, wall.height - openingTop));
    cursor = opening.offset + opening.width;
  });
  pieces.push(part('after', cursor, length - cursor, 0, wall.height));
  return <group>{pieces}{sorted.filter((opening) => opening.openingType === 'window').map((opening) => <WindowInsert key={`${opening.id}-insert`} opening={opening} wall={wall} angle={angle} center={pointAt(opening.offset + opening.width / 2)} />)}</group>;
}

function Architecture({ measurements, architecture }: { measurements: boolean; architecture: ArchitecturalElement[] }) {
  const rooms = architecture.filter((element): element is RoomElement => element.kind === 'room');
  const walls = architecture.filter((element): element is WallElement => element.kind === 'wall');
  const openings = architecture.filter((element): element is OpeningElement => element.kind === 'opening');
  const bounds = getArchitectureBounds(architecture);
  return (
    <group>
      {rooms.map((room, index) => <RoomFloor key={room.id} room={room} index={index} />)}
      {walls.map((wall) => <SceneWall key={wall.id} wall={wall} openings={openings.filter((opening) => opening.wallId === wall.id)} />)}

      {measurements && (
        <gridHelper args={[Math.max(bounds.width, bounds.depth) * 1.4, Math.max(12, Math.ceil(Math.max(bounds.width, bounds.depth) * 2)), '#5f7d8f', '#adc0c8']} position={[(bounds.minX + bounds.maxX) / 2, 0.022, (bounds.minY + bounds.maxY) / 2]} />
      )}
    </group>
  );
}

function Sofa({ position, rotation = 0 }: { position: [number, number, number]; rotation?: number }) {
  return (
    <group position={position} rotation={[0, rotation, 0]}>
      <Box position={[0, 0.38, 0]} size={[2.18, 0.48, 0.88]} color={palette.sage} radius={0.12} />
      <Box position={[0, 0.75, -0.34]} size={[2.18, 0.5, 0.2]} color="#687b73" radius={0.1} />
      <Box position={[-0.56, 0.67, -0.14]} size={[0.91, 0.38, 0.18]} color={palette.sageLight} radius={0.08} rotation={[-0.12, 0, 0]} />
      <Box position={[0.48, 0.67, -0.14]} size={[0.91, 0.38, 0.18]} color={palette.sageLight} radius={0.08} rotation={[-0.12, 0, 0]} />
      <Box position={[0.82, 0.7, -0.24]} size={[0.42, 0.42, 0.14]} color={palette.rust} radius={0.06} rotation={[-0.1, 0, 0.13]} />
      {[-0.87, 0.87].map((x) => <Box key={x} position={[x, 0.1, 0.3]} size={[0.08, 0.2, 0.08]} color={palette.darkWood} />)}
    </group>
  );
}

function Desk({ position, rotation = 0 }: { position: [number, number, number]; rotation?: number }) {
  return (
    <group position={position} rotation={[0, rotation, 0]}>
      <Box position={[0, 0.76, 0]} size={[1.22, 0.09, 0.61]} color={palette.wood} radius={0.025} />
      {[-0.49, 0.49].flatMap((x) => [-0.22, 0.22].map((z) => <Box key={`${x}-${z}`} position={[x, 0.38, z]} size={[0.055, 0.72, 0.055]} color={palette.charcoal} />))}
      <Box position={[0.12, 1.08, -0.05]} size={[0.55, 0.34, 0.045]} color="#273230" radius={0.025} />
      <Box position={[0.12, 0.89, -0.05]} size={[0.045, 0.18, 0.045]} color={palette.charcoal} />
      <Box position={[-0.4, 0.91, 0.02]} size={[0.12, 0.22, 0.12]} color={palette.trim} radius={0.04} />
    </group>
  );
}

function DiningSet({ position, rotation = 0 }: { position: [number, number, number]; rotation?: number }) {
  return (
    <group position={position} rotation={[0, rotation, 0]}>
      <Box position={[0, 0.75, 0]} size={[1.22, 0.09, 0.91]} color={palette.wood} radius={0.08} />
      {[-0.46, 0.46].flatMap((x) => [-0.31, 0.31].map((z) => <Box key={`${x}-${z}`} position={[x, 0.37, z]} size={[0.06, 0.72, 0.06]} color={palette.darkWood} />))}
      {[[-0.8, 0], [0.8, 0], [0, -0.68], [0, 0.68]].map(([x, z], index) => (
        <group key={index} position={[x, 0, z]} rotation={[0, index < 2 ? Math.PI / 2 : 0, 0]}>
          <Box position={[0, 0.46, 0]} size={[0.4, 0.08, 0.42]} color={palette.sage} radius={0.04} />
          <Box position={[0, 0.74, -0.17]} size={[0.4, 0.48, 0.07]} color={palette.sage} radius={0.04} />
          {[-0.15, 0.15].map((leg) => <Box key={leg} position={[leg, 0.22, 0]} size={[0.045, 0.44, 0.045]} color={palette.charcoal} />)}
        </group>
      ))}
      <mesh position={[0, 0.87, 0]} castShadow>
        <cylinderGeometry args={[0.12, 0.09, 0.19, 16]} />
        <meshStandardMaterial color={palette.brass} roughness={0.55} />
      </mesh>
    </group>
  );
}

function Bed({ position, rotation = 0 }: { position: [number, number, number]; rotation?: number }) {
  return (
    <group position={position} rotation={[0, rotation, 0]}>
      <Box position={[0, 0.26, 0]} size={[1.52, 0.34, 2.03]} color={palette.darkWood} radius={0.08} />
      <Box position={[0, 0.5, 0]} size={[1.44, 0.26, 1.92]} color={palette.linen} radius={0.1} />
      <Box position={[0, 0.82, -0.93]} size={[1.52, 0.95, 0.12]} color={palette.sage} radius={0.08} />
      <Box position={[-0.38, 0.71, -0.65]} size={[0.58, 0.16, 0.43]} color={palette.trim} radius={0.09} />
      <Box position={[0.38, 0.71, -0.65]} size={[0.58, 0.16, 0.43]} color={palette.trim} radius={0.09} />
      <Box position={[0, 0.66, 0.3]} size={[1.43, 0.06, 0.8]} color="#ad7258" radius={0.03} />
    </group>
  );
}

function Dresser({ position, rotation = 0 }: { position: [number, number, number]; rotation?: number }) {
  return (
    <group position={position} rotation={[0, rotation, 0]}>
      <Box position={[0, 0.47, 0]} size={[1.52, 0.84, 0.51]} color={palette.wood} radius={0.04} />
      {[-0.23, 0.05, 0.33].map((y) => <Box key={y} position={[0, 0.47 + y, 0.263]} size={[1.38, 0.02, 0.018]} color={palette.darkWood} radius={0.005} />)}
      {[-0.36, 0.36].map((x) => <mesh key={x} position={[x, 0.52, 0.285]} castShadow><sphereGeometry args={[0.035, 12, 12]} /><meshStandardMaterial color={palette.brass} metalness={0.45} roughness={0.3} /></mesh>)}
    </group>
  );
}

function CoffeeTable({ position }: { position: [number, number, number] }) {
  return (
    <group position={position}>
      <mesh position={[0, 0.4, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[0.62, 0.62, 0.09, 32]} />
        <meshStandardMaterial color={palette.darkWood} roughness={0.65} />
      </mesh>
      <mesh position={[0, 0.2, 0]} castShadow><cylinderGeometry args={[0.08, 0.19, 0.4, 16]} /><meshStandardMaterial color={palette.charcoal} roughness={0.6} /></mesh>
    </group>
  );
}

function AddedFurniture({ item }: { item: SceneObject }) {
  const { width, depth, height } = item.dimensions;
  const color = item.category === 'storage' ? palette.wood : item.category === 'table' ? palette.darkWood : '#86968e';
  return (
    <group position={[item.transform.position.x, 0, item.transform.position.z]} rotation={[0, THREE.MathUtils.degToRad(item.transform.rotation.y), 0]}>
      <Box position={[0, height / 2, 0]} size={[width, height, depth]} color={color} radius={0.07} />
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
        const name = item.name.toLowerCase();
        if (item.category === 'sofa' || name.includes('sofa')) return <ScaledFurniture key={item.id} item={item} base={{ width: 2.18, depth: 0.91, height: 0.84 }}><Sofa position={[0, 0, 0]} /></ScaledFurniture>;
        if (item.category === 'desk' || name.includes('desk')) return <ScaledFurniture key={item.id} item={item} base={{ width: 1.22, depth: 0.61, height: 0.76 }}><Desk position={[0, 0, 0]} /></ScaledFurniture>;
        if (name.includes('coffee table')) return <ScaledFurniture key={item.id} item={item} base={{ width: 1.07, depth: 0.61, height: 0.43 }}><CoffeeTable position={[0, 0, 0]} /></ScaledFurniture>;
        if (item.category === 'table' || name.includes('dining')) return <ScaledFurniture key={item.id} item={item} base={{ width: 1.22, depth: 0.91, height: 0.76 }}><DiningSet position={[0, 0, 0]} /></ScaledFurniture>;
        if (item.category === 'bed' || name.includes('bed')) return <ScaledFurniture key={item.id} item={item} base={{ width: 1.52, depth: 2.03, height: 0.61 }}><Bed position={[0, 0, 0]} /></ScaledFurniture>;
        if (item.category === 'storage' || name.includes('dresser') || name.includes('bookcase') || name.includes('nightstand')) return <ScaledFurniture key={item.id} item={item} base={{ width: 1.52, depth: 0.51, height: 0.84 }}><Dresser position={[0, 0, 0]} /></ScaledFurniture>;
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

function Sunlight({ hour, northAngle, center }: { hour: number; northAngle: number; center: [number, number, number] }) {
  const sun = useMemo(() => {
    const offset = getSunDirection(hour, northAngle).position;
    return [center[0] + offset[0], center[1] + offset[1], center[2] + offset[2]] as [number, number, number];
  }, [center, hour, northAngle]);
  const warmth = hour < 9.5 || hour > 17 ? '#ffd1a0' : '#fff1d0';
  const intensity = Math.max(1.4, Math.sin(((hour - 7) / 13) * Math.PI) * 3.8);

  return (
    <>
      <directionalLight
        position={sun}
        intensity={intensity}
        color={warmth}
        castShadow
        shadow-mapSize-width={2048}
        shadow-mapSize-height={2048}
        shadow-camera-left={-8}
        shadow-camera-right={8}
        shadow-camera-top={8}
        shadow-camera-bottom={-8}
        shadow-bias={-0.00025}
      >
        <object3D attach="target" position={center} />
      </directionalLight>
      <ambientLight intensity={0.42} color="#dce5e4" />
    </>
  );
}

function Scene({ hour, northAngle, measurements, objects, architecture }: Omit<ApartmentSceneProps, 'projectId' | 'cameraStep' | 'cameraReset'>) {
  const bounds = getArchitectureBounds(architecture);
  const sunlightCenter = useMemo(() => [(bounds.minX + bounds.maxX) / 2, 0.8, (bounds.minY + bounds.maxY) / 2] as [number, number, number], [bounds.maxX, bounds.maxY, bounds.minX, bounds.minY]);
  return (
    <>
      <color attach="background" args={['#d8dedb']} />
      <fog attach="fog" args={['#d8dedb', 13, 24]} />
      <hemisphereLight args={['#e6f0f2', '#9a765d', 0.72]} />
      <Sunlight hour={hour} northAngle={northAngle} center={sunlightCenter} />
      <Architecture measurements={measurements} architecture={architecture} />
      <Furniture objects={objects} />
      {measurements && <FurnitureMeasurements objects={objects} />}
      <ContactShadows position={[(bounds.minX + bounds.maxX) / 2, 0.02, (bounds.minY + bounds.maxY) / 2]} scale={Math.max(bounds.width, bounds.depth) * 1.35} opacity={0.32} blur={2.2} far={4} />
    </>
  );
}

export default function ApartmentScene(props: ApartmentSceneProps) {
  const storageKey = `dwellwise:3d-camera:${props.projectId}`;
  const [savedCamera] = useState<CameraViewState | null>(() => readSessionCamera(storageKey));
  const defaultCamera = getTopDownCamera(props.architecture, 0);
  const initialCamera = savedCamera ?? {
    position: defaultCamera.position.toArray(),
    target: defaultCamera.target.toArray(),
  };
  const pendingCamera = useRef<CameraViewState | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveCamera = useCallback((state: CameraViewState) => {
    pendingCamera.current = state;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      writeSessionCamera(storageKey, state);
      pendingCamera.current = null;
      saveTimer.current = null;
    }, 120);
  }, [storageKey]);

  useEffect(() => () => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    if (pendingCamera.current) writeSessionCamera(storageKey, pendingCamera.current);
  }, [storageKey]);

  return (
    <div className="three-canvas" role="img" aria-label="Interactive three-dimensional apartment model. Drag to orbit, scroll to zoom, and right-drag to pan.">
      <Canvas
        shadows
        dpr={[1, 1.75]}
        camera={{ position: initialCamera.position, fov: 42, near: 0.1, far: 100 }}
        gl={{ antialias: true, alpha: false, powerPreference: 'high-performance' }}
        onCreated={({ camera, gl }) => {
          camera.lookAt(new THREE.Vector3(...initialCamera.target));
          gl.toneMapping = THREE.ACESFilmicToneMapping;
          gl.toneMappingExposure = 1.05;
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
      </Canvas>
      <div className="canvas-help"><span>DRAG</span> orbit <i /> <span>SCROLL</span> zoom <i /> <span>RIGHT-DRAG</span> pan</div>
    </div>
  );
}
