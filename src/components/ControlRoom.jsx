import React, { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { RoundedBox, Text } from '@react-three/drei';
import { useFactoryStore, STATIONS } from '../store/useFactoryStore';

// Animated monitor screen
function Monitor({ position, rotation = [0, 0, 0], robotId }) {
  const textRef = useRef(null);
  const robots = useFactoryStore((s) => s.robots);
  const r = robots[robotId];
  const t = r?.temperatures ?? [25, 25, 25, 25, 25, 25];
  const avgTemp = t.reduce((a, b) => a + b, 0) / t.length;

  return (
    <group position={position} rotation={rotation}>
      {/* Monitor housing */}
      <RoundedBox args={[2.4, 1.6, 0.12]} radius={0.06} smoothness={3} castShadow>
        <meshStandardMaterial color="#111" metalness={0.9} roughness={0.2} />
      </RoundedBox>
      {/* Screen */}
      <mesh position={[0, 0, 0.07]}>
        <planeGeometry args={[2.1, 1.3]} />
        <meshStandardMaterial color="#001122" emissive="#001122" emissiveIntensity={1} />
      </mesh>
      {/* Screen content via Text */}
      <Text position={[0, 0.35, 0.1]} fontSize={0.13} color="#00ff88" anchorX="center">
        {`ROBOT ${robotId + 1} — ${STATIONS[robotId]?.name ?? ''}`}
      </Text>
      <Text position={[0, 0.1, 0.1]} fontSize={0.11} color="#88ffcc" anchorX="center">
        {`Estado: ${r?.state ?? 'IDLE'}`}
      </Text>
      <Text position={[0, -0.12, 0.1]} fontSize={0.1} color={avgTemp > 70 ? '#ff4400' : '#ffcc00'} anchorX="center">
        {`T. Media: ${avgTemp.toFixed(1)} °C`}
      </Text>
      <Text position={[0, -0.35, 0.1]} fontSize={0.09} color="#4488ff" anchorX="center">
        {`Ciclos: ${r?.cyclesCompleted ?? 0}`}
      </Text>
      {/* Point light from screen */}
      <pointLight position={[0, 0, 0.3]} color="#0066ff" intensity={3} distance={3} />
    </group>
  );
}

// Operator figure (simple low-poly human)
function Operator({ position, rotation = [0, 0, 0] }) {
  return (
    <group position={position} rotation={rotation}>
      {/* Body */}
      <RoundedBox args={[0.35, 0.6, 0.25]} radius={0.06} smoothness={3} position={[0, 0.75, 0]} castShadow>
        <meshStandardMaterial color="#1a3a6a" />
      </RoundedBox>
      {/* Head */}
      <mesh position={[0, 1.25, 0]} castShadow>
        <sphereGeometry args={[0.2, 10, 10]} />
        <meshStandardMaterial color="#e0b888" />
      </mesh>
      {/* Legs */}
      <RoundedBox args={[0.14, 0.55, 0.18]} radius={0.04} smoothness={2} position={[-0.1, 0.28, 0]} castShadow>
        <meshStandardMaterial color="#2a2a5a" />
      </RoundedBox>
      <RoundedBox args={[0.14, 0.55, 0.18]} radius={0.04} smoothness={2} position={[0.1, 0.28, 0]} castShadow>
        <meshStandardMaterial color="#2a2a5a" />
      </RoundedBox>
      {/* Arms */}
      <RoundedBox args={[0.12, 0.5, 0.12]} radius={0.04} smoothness={2} position={[0.26, 0.75, 0]} rotation={[0, 0, 0.3]} castShadow>
        <meshStandardMaterial color="#1a3a6a" />
      </RoundedBox>
      <RoundedBox args={[0.12, 0.5, 0.12]} radius={0.04} smoothness={2} position={[-0.26, 0.75, 0]} rotation={[0, 0, -0.3]} castShadow>
        <meshStandardMaterial color="#1a3a6a" />
      </RoundedBox>
    </group>
  );
}

export function ControlRoom() {
  return (
    <group position={[27, 0, -1]}>
      {/* Raised floor */}
      <mesh receiveShadow castShadow position={[0.3, 0.25, 0]}>
        <boxGeometry args={[4, 0.5, 8]} />
        <meshStandardMaterial color="#2a3a2a" roughness={0.8} />
      </mesh>

      {/* Main console desk */}
      <RoundedBox args={[3, 0.8, 1.2]} radius={0.08} smoothness={3}
        position={[0, 0.9, 0]} castShadow receiveShadow>
        <meshStandardMaterial color="#1a2a1a" metalness={0.7} roughness={0.4} />
      </RoundedBox>

      {/* Monitors (3 per console) — showing robot 0, 1, 2 */}
      <Monitor position={[-0.9, 2.1, 0.45]} rotation={[0, 0, 0]} robotId={0} />
      <Monitor position={[0, 2.1, 0.5]}     rotation={[0, 0, 0]} robotId={1} />
      <Monitor position={[0.9, 2.1, 0.45]}  rotation={[0, 0, 0]} robotId={2} />

      {/* Second row monitors — robots 3, 4, 5 */}
      <Monitor position={[-0.9, 3.9, 0.45]} rotation={[0, 0, 0]} robotId={3} />
      <Monitor position={[0, 3.9, 0.5]}     rotation={[0, 0, 0]} robotId={4} />
      <Monitor position={[0.9, 3.9, 0.45]}  rotation={[0, 0, 0]} robotId={5} />

      {/* Monitor wall stand */}
      <mesh position={[0, 3.0, 0.3]} castShadow>
        <boxGeometry args={[3.2, 0.12, 0.08]} />
        <meshStandardMaterial color="#333" metalness={0.9} roughness={0.2} />
      </mesh>
      <mesh position={[0, 2.5, 0.3]} castShadow>
        <boxGeometry args={[0.08, 3.0, 0.08]} />
        <meshStandardMaterial color="#333" metalness={0.9} roughness={0.2} />
      </mesh>

      {/* Keyboard / input pads on desk */}
      {[-0.7, 0, 0.7].map((x, i) => (
        <RoundedBox key={i} args={[0.5, 0.04, 0.35]} radius={0.03} smoothness={2}
          position={[x, 1.32, 0.15]} castShadow>
          <meshStandardMaterial color="#111" roughness={0.5} />
        </RoundedBox>
      ))}

      {/* Two operators */}
      <Operator position={[-0.8, 0.5, -0.3]} rotation={[0, 0, 0]} />
      <Operator position={[ 0.8, 0.5, -0.3]} rotation={[0, 0, 0]} />

      {/* Overhead label */}
      <Text position={[0, 6.5, 0.4]} fontSize={0.3} color="#00aaff" anchorX="center">
        SALA DE CONTROL
      </Text>
    </group>
  );
}
