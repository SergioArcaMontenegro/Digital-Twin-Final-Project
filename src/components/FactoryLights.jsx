import React, { useRef } from 'react';
import { useFrame } from '@react-three/fiber';

// Hanging industrial lamp fixture — NO castShadow on pointLight to prevent MAX_TEXTURE_IMAGE_UNITS crash
function HangingLight({ position, color = '#fffaf0', intensity = 25, distance = 16 }) {
  return (
    <group position={position}>
      {/* Black suspension rod */}
      <mesh position={[0, 0.6, 0]}>
        <cylinderGeometry args={[0.02, 0.02, 1.2, 6]} />
        <meshStandardMaterial color="#1a1a1a" />
      </mesh>
      {/* White / beige lamp shade */}
      <mesh position={[0, 0, 0]}>
        <coneGeometry args={[0.48, 0.5, 16, 1, true]} />
        <meshStandardMaterial color="#faf8f5" metalness={0.2} roughness={0.3} />
      </mesh>
      {/* High-intensity glowing bulb */}
      <mesh position={[0, -0.1, 0]}>
        <sphereGeometry args={[0.12, 12, 12]} />
        <meshStandardMaterial color="#ffffff" emissive="#fffae8" emissiveIntensity={5} />
      </mesh>
      {/* Non-shadow casting illumination for performance and WebGL stability */}
      <pointLight color={color} intensity={intensity} distance={distance} />
    </group>
  );
}

// Corner emergency flashing strobe
function EmergencyLight({ position }) {
  const matRef = useRef(null);
  useFrame(({ clock }) => {
    if (matRef.current) {
      const on = Math.sin(clock.getElapsedTime() * 7) > 0;
      matRef.current.emissiveIntensity = on ? 6 : 0.1;
    }
  });

  return (
    <group position={position}>
      <mesh>
        <cylinderGeometry args={[0.14, 0.14, 0.25, 12]} />
        <meshStandardMaterial color="#1a1a1a" metalness={0.8} roughness={0.2} />
      </mesh>
      <mesh position={[0, 0.18, 0]}>
        <sphereGeometry args={[0.16, 10, 10]} />
        <meshStandardMaterial ref={matRef} color="#ff3333" emissive="#ff1111" emissiveIntensity={1} transparent opacity={0.95} />
      </mesh>
      <pointLight color="#ff2200" intensity={3} distance={5} />
    </group>
  );
}

export function FactoryLights() {
  const overheadPositions = [
    // Upper belt row
    [-18, 11, 5], [-12, 11, 5], [-6, 11, 5], [0, 11, 5], [6, 11, 5], [12, 11, 5], [18, 11, 5],
    // Lower belt row
    [-18, 11, -5],[-12, 11, -5],[-6, 11, -5],[0, 11, -5],[6, 11, -5],[12, 11, -5],[18, 11, -5],
    // Curve
    [20, 11, 0], [23, 11, 0],
    // Center & aisles
    [-18, 11, 0], [0, 11, 11], [0, 11, -11],
  ];

  return (
    <group>
      {/* ── Very bright, pure daylight ambient ── */}
      <ambientLight intensity={1.8} color="#ffffff" />

      {/* ── Main Sun Directional Light (Only light with shadow to stay within WebGL limits) ── */}
      <directionalLight
        castShadow
        position={[15, 38, 20]}
        intensity={2.6}
        color="#fffcf5"
        shadow-mapSize={[2048, 2048]}
        shadow-camera-near={0.5}
        shadow-camera-far={100}
        shadow-camera-left={-35}
        shadow-camera-right={35}
        shadow-camera-top={25}
        shadow-camera-bottom={-25}
        shadow-bias={-0.0002}
      />

      {/* ── Fill Light (Soft light from opposite side, no dark shadows) ── */}
      <directionalLight position={[-20, 25, -20]} intensity={1.2} color="#f0f4ff" />

      {/* ── Pure vertical skylight ── */}
      <directionalLight position={[0, 40, 0]} intensity={1.0} color="#ffffff" />

      {/* ── Overhead Industrial Lamps ── */}
      {overheadPositions.map((pos, i) => (
        <HangingLight key={`hl-${i}`} position={pos} intensity={35} distance={18} />
      ))}

      {/* ── Emergency corner strobes ── */}
      <EmergencyLight position={[-28, 11, -17]} />
      <EmergencyLight position={[ 28, 11, -17]} />
      <EmergencyLight position={[-28, 11,  17]} />
      <EmergencyLight position={[ 28, 11,  17]} />

      {/* ── Control room accent light ── */}
      <pointLight position={[26, 6, 0]} color="#00aaff" intensity={20} distance={12} />
    </group>
  );
}
