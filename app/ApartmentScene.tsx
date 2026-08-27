'use client';

import { ContactShadows, OrbitControls, RoundedBox } from '@react-three/drei';
import { Canvas, useThree } from '@react-three/fiber';
import { type ReactNode, useEffect, useMemo, useRef } from 'react';
import type { ArchitecturalElement, RoomElement, WallElement } from '@/lib/domain/scene';
import { getArchitectureBounds, wallLength } from '@/lib/domain/architecture';
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
  cameraStep: number;
  cameraReset: number;
  shadows: boolean;
  lightPaths: boolean;
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

function CameraController({ step, reset, architecture }: { step: number; reset: number; architecture: ArchitecturalElement[] }) {
  const controls = useRef<OrbitControlsImpl>(null);
  const { camera } = useThree();
  const bounds = useMemo(() => getArchitectureBounds(architecture), [architecture]);

  useEffect(() => {
    const angle = THREE.MathUtils.degToRad(-38 + step * 12);
    const radius = Math.max(8, Math.max(bounds.width, bounds.depth) * 1.35);
    const target = new THREE.Vector3((bounds.minX + bounds.maxX) / 2, 0.85, (bounds.minY + bounds.maxY) / 2);
    camera.position.set(target.x + Math.cos(angle) * radius, Math.max(5.5, radius * 0.58), target.z + Math.sin(angle) * radius);
    camera.lookAt(target);
    controls.current?.target.copy(target);
    controls.current?.update();
  }, [bounds, camera, reset, step]);

  return (
    <OrbitControls
      ref={controls}
      makeDefault
      enableDamping
      dampingFactor={0.07}
      minDistance={Math.max(3, Math.min(bounds.width, bounds.depth) * 0.6)}
      maxDistance={Math.max(17, Math.max(bounds.width, bounds.depth) * 2.4)}
      minPolarAngle={0.3}
      maxPolarAngle={Math.PI / 2.08}
      screenSpacePanning={false}
      target={[(bounds.minX + bounds.maxX) / 2, 0.85, (bounds.minY + bounds.maxY) / 2]}
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

function SceneWall({ wall }: { wall: WallElement }) {
  const length = wallLength(wall);
  const angle = Math.atan2(wall.end.y - wall.start.y, wall.end.x - wall.start.x);
  return <Wall position={[(wall.start.x + wall.end.x) / 2, wall.height / 2, (wall.start.y + wall.end.y) / 2]} size={[length, wall.height, wall.thickness]} rotation={[0, -angle, 0]} />;
}

function Architecture({ measurements, architecture }: { measurements: boolean; architecture: ArchitecturalElement[] }) {
  const rooms = architecture.filter((element): element is RoomElement => element.kind === 'room');
  const walls = architecture.filter((element): element is WallElement => element.kind === 'wall');
  const bounds = getArchitectureBounds(architecture);
  return (
    <group>
      {rooms.map((room, index) => <RoomFloor key={room.id} room={room} index={index} />)}
      {walls.map((wall) => <SceneWall key={wall.id} wall={wall} />)}

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

function Sunlight({ hour, shadows, lightPaths }: { hour: number; shadows: boolean; lightPaths: boolean }) {
  const sun = useMemo(() => {
    const progress = (hour - 7) / 13;
    const angle = THREE.MathUtils.lerp(-0.85, 0.82, progress);
    const elevation = Math.sin(progress * Math.PI) * 7 + 2;
    return [3.7 + Math.sin(angle) * 10, elevation, -7 + Math.cos(angle) * 2] as [number, number, number];
  }, [hour]);
  const warmth = hour < 9.5 || hour > 17 ? '#ffd1a0' : '#fff1d0';
  const intensity = Math.max(1.4, Math.sin(((hour - 7) / 13) * Math.PI) * 3.8);

  return (
    <>
      <directionalLight
        position={sun}
        intensity={intensity}
        color={warmth}
        castShadow={shadows}
        shadow-mapSize-width={2048}
        shadow-mapSize-height={2048}
        shadow-camera-left={-8}
        shadow-camera-right={8}
        shadow-camera-top={8}
        shadow-camera-bottom={-8}
        shadow-bias={-0.00025}
      />
      <ambientLight intensity={0.42} color="#dce5e4" />
      {lightPaths && (
        <group position={[2.2 + (hour - 13) * 0.08, 0.025, 1.78]} rotation={[-Math.PI / 2, 0, -0.18]}>
          <mesh>
            <planeGeometry args={[2.9, 1.45]} />
            <meshBasicMaterial color="#ffc477" transparent opacity={0.13} depthWrite={false} blending={THREE.AdditiveBlending} />
          </mesh>
        </group>
      )}
    </>
  );
}

function Scene({ hour, shadows, lightPaths, measurements, objects, architecture }: Omit<ApartmentSceneProps, 'cameraStep' | 'cameraReset'>) {
  const bounds = getArchitectureBounds(architecture);
  return (
    <>
      <color attach="background" args={['#d8dedb']} />
      <fog attach="fog" args={['#d8dedb', 13, 24]} />
      <hemisphereLight args={['#e6f0f2', '#9a765d', 0.72]} />
      <Sunlight hour={hour} shadows={shadows} lightPaths={lightPaths} />
      <Architecture measurements={measurements} architecture={architecture} />
      <Furniture objects={objects} />
      {shadows && <ContactShadows position={[(bounds.minX + bounds.maxX) / 2, 0.02, (bounds.minY + bounds.maxY) / 2]} scale={Math.max(bounds.width, bounds.depth) * 1.35} opacity={0.32} blur={2.2} far={4} />}
    </>
  );
}

export default function ApartmentScene(props: ApartmentSceneProps) {
  return (
    <div className="three-canvas" role="img" aria-label="Interactive three-dimensional apartment model. Drag to orbit, scroll to zoom, and right-drag to pan.">
      <Canvas
        shadows={props.shadows}
        dpr={[1, 1.75]}
        camera={{ position: [10.8, 6.2, 9.2], fov: 42, near: 0.1, far: 100 }}
        gl={{ antialias: true, alpha: false, powerPreference: 'high-performance' }}
        onCreated={({ gl }) => {
          gl.toneMapping = THREE.ACESFilmicToneMapping;
          gl.toneMappingExposure = 1.05;
          gl.outputColorSpace = THREE.SRGBColorSpace;
        }}
      >
        <Scene
          hour={props.hour}
          shadows={props.shadows}
          lightPaths={props.lightPaths}
          measurements={props.measurements}
          objects={props.objects}
          architecture={props.architecture}
        />
        <CameraController step={props.cameraStep} reset={props.cameraReset} architecture={props.architecture} />
      </Canvas>
      <div className="canvas-help"><span>DRAG</span> orbit <i /> <span>SCROLL</span> zoom <i /> <span>RIGHT-DRAG</span> pan</div>
    </div>
  );
}
