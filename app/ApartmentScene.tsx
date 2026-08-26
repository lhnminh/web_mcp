'use client';

import { ContactShadows, OrbitControls, RoundedBox } from '@react-three/drei';
import { Canvas, useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';

type SceneObject = {
  id: string;
  catalogItemId: string;
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

function CameraController({ step, reset }: { step: number; reset: number }) {
  const controls = useRef<OrbitControlsImpl>(null);
  const { camera } = useThree();

  useEffect(() => {
    const angle = THREE.MathUtils.degToRad(-38 + step * 12);
    const radius = 10.8;
    const target = new THREE.Vector3(3.65, 0.85, 3.3);
    camera.position.set(target.x + Math.cos(angle) * radius, 6.2, target.z + Math.sin(angle) * radius);
    camera.lookAt(target);
    controls.current?.target.copy(target);
    controls.current?.update();
  }, [camera, reset, step]);

  return (
    <OrbitControls
      ref={controls}
      makeDefault
      enableDamping
      dampingFactor={0.07}
      minDistance={4.2}
      maxDistance={17}
      minPolarAngle={0.3}
      maxPolarAngle={Math.PI / 2.08}
      screenSpacePanning={false}
      target={[3.65, 0.85, 3.3]}
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

function Window({ x, z, rotate = false }: { x: number; z: number; rotate?: boolean }) {
  const rotation: [number, number, number] = [0, rotate ? Math.PI / 2 : 0, 0];
  return (
    <group position={[x, 1.52, z]} rotation={rotation}>
      <mesh receiveShadow>
        <boxGeometry args={[1.36, 1.5, 0.035]} />
        <meshPhysicalMaterial color="#bcd5d6" transmission={0.45} transparent opacity={0.42} roughness={0.16} />
      </mesh>
      <Box position={[0, 0.78, 0]} size={[1.52, 0.08, 0.09]} color={palette.trim} />
      <Box position={[0, -0.78, 0]} size={[1.52, 0.08, 0.09]} color={palette.trim} />
      <Box position={[-0.72, 0, 0]} size={[0.08, 1.64, 0.09]} color={palette.trim} />
      <Box position={[0.72, 0, 0]} size={[0.08, 1.64, 0.09]} color={palette.trim} />
      <Box position={[0, 0, 0]} size={[0.055, 1.52, 0.08]} color={palette.trim} />
      <Box position={[0, 0, 0]} size={[1.44, 0.055, 0.08]} color={palette.trim} />
    </group>
  );
}

function Wall({ position, size }: { position: [number, number, number]; size: [number, number, number] }) {
  return <Box position={position} size={size} color={palette.wall} radius={0.015} />;
}

function Architecture({ measurements }: { measurements: boolean }) {
  return (
    <group>
      <mesh position={[3.935, -0.06, 4.215]} receiveShadow>
        <boxGeometry args={[7.87, 0.12, 8.43]} />
        <meshStandardMaterial color="#b99a77" roughness={0.88} />
      </mesh>
      <mesh position={[2.16, 0.012, 2.82]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[4.25, 5.56]} />
        <meshStandardMaterial color="#c5aa86" roughness={0.8} />
      </mesh>
      <mesh position={[6.095, 0.014, 1.88]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[3.45, 3.68]} />
        <meshStandardMaterial color="#d2bfa6" roughness={0.85} />
      </mesh>

      {/* North wall is split around two real openings so sunlight enters the room. */}
      <Wall position={[0.325, 1.37, 0]} size={[0.65, 2.74, 0.15]} />
      <Wall position={[2.32, 1.37, 0]} size={[0.6, 2.74, 0.15]} />
      <Wall position={[5.93, 1.37, 0]} size={[3.88, 2.74, 0.15]} />
      <Wall position={[2.32, 0.38, 0]} size={[3.34, 0.76, 0.15]} />
      <Wall position={[2.32, 2.66, 0]} size={[3.34, 0.16, 0.15]} />
      <Window x={1.335} z={0.01} />
      <Window x={3.305} z={0.01} />

      <Wall position={[0, 1.37, 4.215]} size={[0.15, 2.74, 8.43]} />
      <Wall position={[7.87, 1.37, 0.37]} size={[0.15, 2.74, 0.74]} />
      <Wall position={[7.87, 1.37, 2.09]} size={[0.15, 2.74, 1.04]} />
      <Wall position={[7.87, 1.37, 5.69]} size={[0.15, 2.74, 5.48]} />
      <Wall position={[7.87, 0.38, 1.35]} size={[0.15, 0.76, 1.48]} />
      <Wall position={[7.87, 2.66, 1.35]} size={[0.15, 0.16, 1.48]} />
      <Window x={7.86} z={1.35} rotate />

      <Wall position={[2.16, 1.37, 8.43]} size={[4.32, 2.74, 0.15]} />
      <Wall position={[4.32, 1.37, 1.45]} size={[0.12, 2.74, 2.9]} />
      <Wall position={[4.32, 1.37, 4.93]} size={[0.12, 2.74, 1.42]} />

      <Box position={[0.38, 1.2, 4.8]} size={[0.08, 1.45, 1.25]} color="#d9d0be" rotation={[0, Math.PI / 2, 0]} />
      <Box position={[0.43, 1.2, 4.8]} size={[0.05, 1.28, 1.08]} color="#a2a58f" rotation={[0, Math.PI / 2, 0]} />

      {measurements && (
        <gridHelper args={[12, 24, '#5f7d8f', '#adc0c8']} position={[3.9, 0.022, 4.1]} />
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

function Plant({ position }: { position: [number, number, number] }) {
  return (
    <group position={position}>
      <mesh position={[0, 0.25, 0]} castShadow><cylinderGeometry args={[0.22, 0.17, 0.5, 18]} /><meshStandardMaterial color="#a66f50" roughness={0.8} /></mesh>
      <Box position={[0, 0.78, 0]} size={[0.045, 0.85, 0.045]} color="#496454" />
      {[-0.55, -0.25, 0.1, 0.42].map((y, index) => (
        <mesh key={y} position={[index % 2 ? 0.17 : -0.17, 0.88 + y * 0.38, 0]} rotation={[0, 0, index % 2 ? -0.65 : 0.65]} castShadow>
          <sphereGeometry args={[0.12, 12, 8]} />
          <meshStandardMaterial color={index % 2 ? '#6c8b72' : '#7e9b7f'} roughness={0.9} />
        </mesh>
      ))}
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

function Furniture({ objects }: { objects: SceneObject[] }) {
  const sofa = objects.find((item) => item.catalogItemId === 'sofa');
  const sofaRotation = THREE.MathUtils.degToRad(sofa?.transform.rotation.y ?? 0);
  return (
    <group>
      {objects.map((item) => {
        const position: [number, number, number] = [item.transform.position.x, item.transform.position.y, item.transform.position.z];
        const rotation = THREE.MathUtils.degToRad(item.transform.rotation.y);
        if (item.catalogItemId === 'sofa') return <Sofa key={item.id} position={position} rotation={rotation} />;
        if (item.catalogItemId === 'desk') return <Desk key={item.id} position={position} rotation={rotation} />;
        if (item.catalogItemId === 'table') return <DiningSet key={item.id} position={position} rotation={rotation} />;
        if (item.catalogItemId === 'queen-bed') return <Bed key={item.id} position={position} rotation={rotation} />;
        if (item.catalogItemId === 'dresser') return <Dresser key={item.id} position={position} rotation={rotation} />;
        return <AddedFurniture key={item.id} item={item} />;
      })}
      {sofa && <CoffeeTable position={[
        sofa.transform.position.x + Math.sin(sofaRotation) * 1.1,
        0,
        sofa.transform.position.z + Math.cos(sofaRotation) * 1.1,
      ]} />}
      <Plant position={[0.55, 0, 0.65]} />
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

function Scene({ hour, shadows, lightPaths, measurements, objects }: Omit<ApartmentSceneProps, 'cameraStep' | 'cameraReset'>) {
  return (
    <>
      <color attach="background" args={['#d8dedb']} />
      <fog attach="fog" args={['#d8dedb', 13, 24]} />
      <hemisphereLight args={['#e6f0f2', '#9a765d', 0.72]} />
      <Sunlight hour={hour} shadows={shadows} lightPaths={lightPaths} />
      <Architecture measurements={measurements} />
      <Furniture objects={objects} />
      {shadows && <ContactShadows position={[3.9, 0.02, 4]} scale={11} opacity={0.32} blur={2.2} far={4} />}
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
        />
        <CameraController step={props.cameraStep} reset={props.cameraReset} />
      </Canvas>
      <div className="canvas-help"><span>DRAG</span> orbit <i /> <span>SCROLL</span> zoom <i /> <span>RIGHT-DRAG</span> pan</div>
    </div>
  );
}
