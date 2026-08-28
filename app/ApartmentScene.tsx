'use client';

import { ContactShadows, Html, Line, OrbitControls, RoundedBox } from '@react-three/drei';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import type { ArchitecturalElement, OpeningElement, RoomElement, WallElement } from '@/lib/domain/scene';
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
  hour: number;
  northAngle: number;
  cameraStep: number;
  cameraReset: number;
  measurements: boolean;
  objects: SceneObject[];
  architecture: ArchitecturalElement[];
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

function CameraController({ step, reset, architecture }: { step: number; reset: number; architecture: ArchitecturalElement[] }) {
  const controls = useRef<OrbitControlsImpl>(null);
  const initialized = useRef(false);
  const previousPreset = useRef({ step, reset });
  const { camera } = useThree();
  const bounds = useMemo(() => getArchitectureBounds(architecture), [architecture]);

  useEffect(() => {
    const resetChanged = reset !== previousPreset.current.reset;
    const stepChanged = step !== previousPreset.current.step;
    if (initialized.current && !resetChanged && !stepChanged) return;

    const preset = getTopDownCamera(architecture, resetChanged ? 0 : step);
    camera.position.copy(preset.position);
    camera.lookAt(preset.target);
    controls.current?.target.copy(preset.target);
    controls.current?.update();
    previousPreset.current = { step, reset };
    initialized.current = true;
  }, [architecture, camera, reset, step]);

  const target = [(bounds.minX + bounds.maxX) / 2, 0.85, (bounds.minY + bounds.maxY) / 2] as [number, number, number];

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
      <Box position={[0, -frame / 2, 0]} size={[leafWidth, leafHeight, 0.055]} color="#a97855" radius={0.018} />
      {[-0.27, 0.27].map((y) => <Box key={y} position={[0, y * leafHeight, 0.034]} size={[leafWidth * 0.74, leafHeight * 0.34, 0.024]} color="#b98a65" radius={0.02} />)}
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
  return <mesh geometry={geometry} position={[0, room.floorElevation + 0.012, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow><meshStandardMaterial color={colors[index % colors.length]} roughness={0.84} side={THREE.DoubleSide} /></mesh>;
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
    return <Wall key={key} position={[center.x, bottom + height / 2, center.y]} size={[width, height, wall.thickness]} rotation={[0, -angle, 0]} />;
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

function Sofa({ position, rotation = 0 }: { position: [number, number, number]; rotation?: number }) {
  return (
    <group position={position} rotation={[0, rotation, 0]}>
      <Box position={[0, 0.28, 0]} size={[2.18, 0.34, 0.88]} color={palette.sage} radius={0.12} />
      <Box position={[-0.46, 0.55, 0.08]} size={[0.87, 0.2, 0.62]} color="#879b91" radius={0.07} />
      <Box position={[0.46, 0.55, 0.08]} size={[0.87, 0.2, 0.62]} color="#879b91" radius={0.07} />
      <Box position={[0, 0.73, -0.35]} size={[2.18, 0.54, 0.18]} color="#687b73" radius={0.1} />
      <Box position={[-0.46, 0.81, -0.15]} size={[0.87, 0.32, 0.18]} color={palette.sageLight} radius={0.08} />
      <Box position={[0.46, 0.81, -0.15]} size={[0.87, 0.32, 0.18]} color={palette.sageLight} radius={0.08} />
      {[-0.99, 0.99].map((x) => <Box key={`${x}-arm`} position={[x, 0.51, 0.02]} size={[0.16, 0.42, 0.74]} color="#6b8177" radius={0.08} />)}
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
      <Box position={[0.12, 1.08, -0.024]} size={[0.48, 0.27, 0.014]} color="#6fa0aa" radius={0.012} castShadow={false} />
      <Box position={[0.12, 0.89, -0.05]} size={[0.045, 0.18, 0.045]} color={palette.charcoal} />
      <Box position={[0.12, 0.825, 0.12]} size={[0.42, 0.025, 0.16]} color="#d7d1c3" radius={0.015} />
      <Box position={[-0.4, 0.91, 0.02]} size={[0.12, 0.22, 0.12]} color={palette.trim} radius={0.04} />
    </group>
  );
}

function DiningSet({ position, rotation = 0 }: { position: [number, number, number]; rotation?: number }) {
  const chairs = [
    { position: [-0.47, 0, 0] as [number, number, number], rotation: Math.PI / 2 },
    { position: [0.47, 0, 0] as [number, number, number], rotation: -Math.PI / 2 },
    { position: [0, 0, -0.31] as [number, number, number], rotation: 0 },
    { position: [0, 0, 0.31] as [number, number, number], rotation: Math.PI },
  ];
  return (
    <group position={position} rotation={[0, rotation, 0]}>
      <Box position={[0, 0.72, 0]} size={[0.72, 0.08, 0.5]} color={palette.wood} radius={0.07} />
      {[-0.27, 0.27].flatMap((x) => [-0.16, 0.16].map((z) => <Box key={`${x}-${z}`} position={[x, 0.35, z]} size={[0.05, 0.7, 0.05]} color={palette.darkWood} radius={0.015} />))}
      {chairs.map((chair, index) => (
        <group key={index} position={chair.position} rotation={[0, chair.rotation, 0]}>
          <Box position={[0, 0.42, 0]} size={[0.27, 0.075, 0.25]} color={palette.sage} radius={0.045} />
          <Box position={[0, 0.63, -0.095]} size={[0.27, 0.34, 0.055]} color={palette.sage} radius={0.045} rotation={[-0.08, 0, 0]} />
          {[-0.09, 0.09].flatMap((legX) => [-0.075, 0.075].map((legZ) => <Box key={`${legX}-${legZ}`} position={[legX, 0.2, legZ]} size={[0.032, 0.4, 0.032]} color={palette.charcoal} radius={0.01} />))}
        </group>
      ))}
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
      <Box position={[0, 0.91, -0.01]} size={[1.52, 0.07, 0.51]} color="#c8b08f" radius={0.025} />
      {[-0.23, 0.05, 0.33].map((y) => <Box key={y} position={[0, 0.47 + y, 0.263]} size={[1.38, 0.02, 0.018]} color={palette.darkWood} radius={0.005} />)}
      {[-0.36, 0.36].map((x) => <mesh key={x} position={[x, 0.52, 0.285]} castShadow><sphereGeometry args={[0.035, 12, 12]} /><meshStandardMaterial color={palette.brass} metalness={0.45} roughness={0.3} /></mesh>)}
      {[-0.62, 0.62].map((x) => <Box key={`${x}-foot`} position={[x, 0.08, 0]} size={[0.08, 0.16, 0.08]} color={palette.darkWood} radius={0.02} />)}
    </group>
  );
}

function CoffeeTable({ position }: { position: [number, number, number] }) {
  return (
    <group position={position}>
      <mesh position={[0, 0.38, 0]} scale={[0.52, 0.045, 0.28]} castShadow receiveShadow>
        <sphereGeometry args={[1, 36, 18]} />
        <meshStandardMaterial color={palette.darkWood} roughness={0.65} />
      </mesh>
      <mesh position={[0, 0.2, 0]} castShadow><cylinderGeometry args={[0.06, 0.14, 0.36, 18]} /><meshStandardMaterial color={palette.charcoal} roughness={0.6} /></mesh>
      <mesh position={[0, 0.06, 0]} scale={[0.26, 0.035, 0.17]} castShadow receiveShadow><sphereGeometry args={[1, 24, 12]} /><meshStandardMaterial color={palette.brass} metalness={0.42} roughness={0.38} /></mesh>
    </group>
  );
}

function AccentChair({ position }: { position: [number, number, number] }) {
  return (
    <group position={position}>
      <Box position={[0, 0.43, 0.04]} size={[0.68, 0.2, 0.68]} color={palette.rust} radius={0.13} />
      <Box position={[0, 0.72, -0.27]} size={[0.68, 0.52, 0.16]} color="#b56f50" radius={0.12} rotation={[-0.09, 0, 0]} />
      <Box position={[0, 0.54, 0.03]} size={[0.56, 0.12, 0.54]} color="#d09776" radius={0.1} />
      {[-0.32, 0.32].map((x) => <Box key={`${x}-arm`} position={[x, 0.58, 0]} size={[0.08, 0.28, 0.58]} color="#9f5f47" radius={0.045} />)}
      {[-0.25, 0.25].flatMap((x) => [-0.23, 0.23].map((z) => <Box key={`${x}-${z}`} position={[x, 0.18, z]} size={[0.055, 0.36, 0.055]} color={palette.darkWood} radius={0.018} rotation={[z > 0 ? 0.06 : -0.06, 0, x > 0 ? -0.05 : 0.05]} />))}
    </group>
  );
}

function Nightstand({ position }: { position: [number, number, number] }) {
  return (
    <group position={position}>
      <Box position={[0, 0.36, 0]} size={[0.56, 0.48, 0.46]} color={palette.wood} radius={0.04} />
      <Box position={[0, 0.63, 0]} size={[0.56, 0.07, 0.46]} color="#cfb998" radius={0.025} />
      {[-0.09, 0.11].map((y) => <Box key={y} position={[0, 0.36 + y, 0.238]} size={[0.48, 0.025, 0.025]} color={palette.darkWood} radius={0.006} />)}
      {[-0.09, 0.11].map((y) => <mesh key={`${y}-knob`} position={[0, 0.36 + y, 0.265]} castShadow><sphereGeometry args={[0.025, 12, 8]} /><meshStandardMaterial color={palette.brass} metalness={0.7} roughness={0.25} /></mesh>)}
      {[-0.21, 0.21].flatMap((x) => [-0.15, 0.15].map((z) => <Box key={`${x}-${z}`} position={[x, 0.08, z]} size={[0.045, 0.16, 0.045]} color={palette.darkWood} radius={0.014} />))}
    </group>
  );
}

function Bookcase({ position }: { position: [number, number, number] }) {
  const shelves = [0.08, 0.5, 0.92, 1.34, 1.76];
  return (
    <group position={position}>
      <Box position={[0, 0.915, -0.13]} size={[0.91, 1.82, 0.08]} color={palette.darkWood} radius={0.025} />
      {[-0.43, 0.43].map((x) => <Box key={x} position={[x, 0.92, 0]} size={[0.07, 1.83, 0.35]} color={palette.wood} radius={0.022} />)}
      {shelves.map((y) => <Box key={y} position={[0, y, 0]} size={[0.88, 0.065, 0.35]} color="#b58b65" radius={0.018} />)}
      {[[-0.29, 0.27, '#73877e'], [-0.12, 0.29, '#c47e58'], [0.07, 0.26, '#d8cdbb'], [0.26, 0.3, '#596f78']].flatMap(([x, width, color], row) => [0.12, 0.54, 0.96, 1.38].map((y) => <Box key={`${row}-${y}`} position={[Number(x), y + 0.12, 0.085]} size={[Number(width) * 0.55, 0.24 + row * 0.015, 0.14]} color={String(color)} radius={0.012} />))}
    </group>
  );
}

function GenericObject({ position }: { position: [number, number, number] }) {
  return (
    <group position={position}>
      <Box position={[0, 0.4, 0]} size={[0.8, 0.8, 0.8]} color={palette.sage} radius={0.035} />
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
        const kind = getFurnitureKind(item.category, item.name);
        if (kind === 'sofa') return <ScaledFurniture key={item.id} item={item} base={{ width: 2.18, depth: 0.91, height: 1 }}><Sofa position={[0, 0, 0]} /></ScaledFurniture>;
        if (kind === 'desk') return <ScaledFurniture key={item.id} item={item} base={{ width: 1.22, depth: 0.61, height: 1.25 }}><Desk position={[0, 0, 0]} /></ScaledFurniture>;
        if (kind === 'coffee') return <ScaledFurniture key={item.id} item={item} base={{ width: 1.07, depth: 0.61, height: 0.425 }}><CoffeeTable position={[0, 0, 0]} /></ScaledFurniture>;
        if (kind === 'dining') return <ScaledFurniture key={item.id} item={item} base={{ width: 1.22, depth: 0.91, height: 0.87 }}><DiningSet position={[0, 0, 0]} /></ScaledFurniture>;
        if (kind === 'bed') return <ScaledFurniture key={item.id} item={item} base={{ width: 1.52, depth: 2.03, height: 1.295 }}><Bed position={[0, 0, 0]} /></ScaledFurniture>;
        if (kind === 'chair') return <ScaledFurniture key={item.id} item={item} base={{ width: 0.76, depth: 0.81, height: 0.98 }}><AccentChair position={[0, 0, 0]} /></ScaledFurniture>;
        if (kind === 'nightstand') return <ScaledFurniture key={item.id} item={item} base={{ width: 0.56, depth: 0.46, height: 0.665 }}><Nightstand position={[0, 0, 0]} /></ScaledFurniture>;
        if (kind === 'bookcase') return <ScaledFurniture key={item.id} item={item} base={{ width: 0.91, depth: 0.35, height: 1.825 }}><Bookcase position={[0, 0, 0]} /></ScaledFurniture>;
        if (kind === 'storage') return <ScaledFurniture key={item.id} item={item} base={{ width: 1.52, depth: 0.51, height: 0.945 }}><Dresser position={[0, 0, 0]} /></ScaledFurniture>;
        if (kind === 'other') return <ScaledFurniture key={item.id} item={item} base={{ width: 0.8, depth: 0.8, height: 0.8 }}><GenericObject position={[0, 0, 0]} /></ScaledFurniture>;
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

function Scene({ hour, northAngle, measurements, objects, architecture }: Omit<ApartmentSceneProps, 'cameraStep' | 'cameraReset'>) {
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

export default function ApartmentScene(props: ApartmentSceneProps) {
  const defaultCamera = getTopDownCamera(props.architecture, 0);
  const initialCamera = {
    position: defaultCamera.position.toArray(),
    target: defaultCamera.target.toArray(),
  };

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
        <CameraController step={props.cameraStep} reset={props.cameraReset} architecture={props.architecture} />
      </Canvas>
      <div className="canvas-help"><span>DRAG</span> orbit <i /> <span>SCROLL</span> zoom <i /> <span>RIGHT-DRAG</span> pan <i /> walls auto-hide</div>
    </div>
  );
}
