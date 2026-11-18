import React from 'react';
import { RoundedBox } from '@react-three/drei';

// Industrial window — side=2 (BackSide) so only visible from inside
function IndustrialWindow({ position, width = 3, height = 2, rotation = [0, 0, 0] }) {
  return (
    <group position={position} rotation={rotation}>
      {/* Frame */}
      <mesh side={2}>
        <boxGeometry args={[width + 0.2, height + 0.2, 0.15]} />
        <meshStandardMaterial color="#cccccc" metalness={0.4} roughness={0.5} side={2} />
      </mesh>
      {/* Glass */}
      <mesh position={[0, 0, 0.05]}>
        <boxGeometry args={[width, height, 0.06]} />
        <meshStandardMaterial color="#aaddff" transparent opacity={0.18} side={2} />
      </mesh>
      {/* Cross bars */}
      <mesh position={[0, 0, 0.12]}>
        <boxGeometry args={[width + 0.1, 0.07, 0.07]} />
        <meshStandardMaterial color="#999" side={2} />
      </mesh>
      <mesh position={[0, 0, 0.12]}>
        <boxGeometry args={[0.07, height + 0.1, 0.07]} />
        <meshStandardMaterial color="#999" side={2} />
      </mesh>
    </group>
  );
}

// Wall panel — side=2 → only visible from inside the factory
function WallPanel({ position, size, rotation = [0, 0, 0] }) {
  return (
    <group position={position} rotation={rotation}>
      {/* Main wall surface */}
      <mesh receiveShadow>
        <boxGeometry args={[size[0], size[1], 0.28]} />
        <meshStandardMaterial color="#f2f0ea" metalness={0.05} roughness={0.85} side={2} />
      </mesh>
      {/* Horizontal ribs (structural bands) */}
      {[-size[1] * 0.33, 0, size[1] * 0.33].map((y, i) => (
        <mesh key={i} position={[0, y, 0.15]}>
          <boxGeometry args={[size[0] - 0.3, 0.06, 0.05]} />
          <meshStandardMaterial color="#d8d4cc" side={2} />
        </mesh>
      ))}
    </group>
  );
}

const WALL_H = 14;
const FLOOR_W = 60;
const FLOOR_D = 36;

export function FactoryBuilding() {
  // Roof structural beams — visible as open skeleton
  const roofBeams = [];
  for (let i = -5; i <= 5; i++) {
    roofBeams.push(
      <mesh key={`rb-${i}`} position={[i * 5.5, WALL_H - 0.3, 0]} castShadow>
        <boxGeometry args={[0.28, 0.28, FLOOR_D + 2]} />
        <meshStandardMaterial color="#444" metalness={0.9} roughness={0.2} />
      </mesh>
    );
  }
  for (let z = -2; z <= 2; z++) {
    roofBeams.push(
      <mesh key={`lb-${z}`} position={[0, WALL_H - 0.15, z * 8]} castShadow>
        <boxGeometry args={[FLOOR_W + 2, 0.35, 0.28]} />
        <meshStandardMaterial color="#333" metalness={0.9} roughness={0.2} />
      </mesh>
    );
  }
  // Diagonal trusses
  for (let i = -4; i <= 4; i += 2) {
    roofBeams.push(
      <mesh key={`diag-${i}`} position={[i * 5.5, WALL_H - 0.5, 0]}
        rotation={[Math.PI / 2, 0, 0.35]} castShadow>
        <boxGeometry args={[0.1, FLOOR_D * 0.6, 0.1]} />
        <meshStandardMaterial color="#555" metalness={0.8} roughness={0.3} />
      </mesh>
    );
  }

  return (
    <group>
      {/* ── FLOOR (light beige/white) ── */}
      <mesh receiveShadow position={[0, -0.1, 0]}>
        <boxGeometry args={[FLOOR_W, 0.2, FLOOR_D]} />
        <meshStandardMaterial color="#e8e6e0" roughness={0.95} />
      </mesh>
      {/* Floor grid */}
      <gridHelper args={[FLOOR_W, 60, '#cccccc', '#dddddd']} position={[0, 0.01, 0]}
        material-opacity={0.5} material-transparent />

      {/* ── BACK WALL (z = -FLOOR_D/2) ── */}
      <WallPanel position={[-10, WALL_H / 2, -FLOOR_D / 2]} size={[22, WALL_H]} />
      <WallPanel position={[16, WALL_H / 2, -FLOOR_D / 2]} size={[20, WALL_H]} />
      {[-14, -6, 2, 10].map((x, i) => (
        <IndustrialWindow key={`bw-${i}`} position={[x, 8, -FLOOR_D / 2 + 0.18]} width={3} height={2.2} />
      ))}

      {/* ── FRONT WALL (z = +FLOOR_D/2) ── */}
      <WallPanel position={[0, WALL_H / 2, FLOOR_D / 2]} size={[FLOOR_W, WALL_H]} />
      {[-18, -9, 0, 9, 18].map((x, i) => (
        <IndustrialWindow key={`fw-${i}`} position={[x, 8, FLOOR_D / 2 - 0.18]} width={4} height={2.8} />
      ))}

      {/* ── LEFT WALL ── */}
      <WallPanel position={[-FLOOR_W / 2, WALL_H / 2, 0]} size={[FLOOR_D, WALL_H]} rotation={[0, Math.PI / 2, 0]} />
      {[-10, -2, 6].map((z, i) => (
        <IndustrialWindow key={`lw-${i}`} position={[-FLOOR_W / 2 + 0.18, 8, z]} width={3.5} height={2.2} rotation={[0, Math.PI / 2, 0]} />
      ))}

      {/* ── RIGHT WALL (with glass control room section) ── */}
      <WallPanel position={[FLOOR_W / 2, WALL_H / 2, -10]} size={[FLOOR_D / 2 - 4, WALL_H]} rotation={[0, Math.PI / 2, 0]} />
      {/* Glass strip */}
      <group position={[FLOOR_W / 2 - 0.15, 0, 2]}>
        <mesh receiveShadow castShadow position={[0, WALL_H / 2, 0]}>
          <boxGeometry args={[0.15, WALL_H, 14]} />
          <meshStandardMaterial color="#aaddff" transparent opacity={0.15} side={2} />
        </mesh>
        {[-5, -1.5, 2, 5.5].map((z, i) => (
          <mesh key={`cf-${i}`} position={[0, WALL_H / 2, z]} castShadow>
            <boxGeometry args={[0.22, WALL_H, 0.12]} />
            <meshStandardMaterial color="#666" metalness={0.9} roughness={0.2} side={2} />
          </mesh>
        ))}
      </group>

      {/* ── ROOF BEAMS ── */}
      {roofBeams}

      {/* ── VERTICAL PILLARS (dark, visible from both sides as structural elements) ── */}
      {[-25, -15, -5, 5, 15, 25].map((x) =>
        [-16, 16].map((z, j) => (
          <mesh key={`pil-${x}-${j}`} position={[x, WALL_H / 2, z]} castShadow receiveShadow>
            <boxGeometry args={[0.55, WALL_H, 0.55]} />
            <meshStandardMaterial color="#222" metalness={0.85} roughness={0.3} />
          </mesh>
        ))
      )}

      {/* Yellow safety stripe markings */}
      {[-12.5, 12.5].map((z, i) => (
        <mesh key={`stripe-${i}`} receiveShadow position={[0, 0.02, z]} rotation={[-Math.PI / 2, 0, 0]}>
          <planeGeometry args={[50, 0.25]} />
          <meshStandardMaterial color="#f5c842" />
        </mesh>
      ))}
    </group>
  );
}
