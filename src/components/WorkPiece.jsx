import React, { useRef, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import { RoundedBox } from '@react-three/drei';
import { MathUtils } from 'three';
import { useFactoryStore, PHASES, STATIONS } from '../store/useFactoryStore';
import { getBeltPosition, TOTAL_LEN } from '../utils/beltCurve';

// Phase visual configs
const PHASE_CONFIGS = [
  { color: '#888888', emissive: '#111111', parts: [] },
  { color: '#555566', emissive: '#111122', parts: ['top'] },
  { color: '#3a5a7a', emissive: '#112233', parts: ['top', 'side'] },
  { color: '#c0392b', emissive: '#330000', parts: ['top', 'side', 'detail'] },
  { color: '#e74c3c', emissive: '#440000', parts: ['top', 'side', 'detail', 'glow'] },
  { color: '#27ae60', emissive: '#004422', parts: ['top', 'side', 'detail', 'glow', 'badge'] },
];

export function WorkPiece({ pieceId }) {
  const ref = useRef(null);
  const posRef = useRef(null);
  const phasePrev = useRef(0);
  const phaseBlend = useRef(0);

  const pieces = useFactoryStore((s) => s.pieces);
  const robots  = useFactoryStore((s) => s.robots);
  const beltSpeed = useFactoryStore((s) => s.beltSpeed);
  const running = useFactoryStore((s) => s.running);
  const updatePiece = useFactoryStore((s) => s.updatePiece);

  const piece = pieces[pieceId];

  useFrame((_, delta) => {
    if (!piece) return;

    // If piece is held by a robot, freeze its t (robot takes over position)
    if (piece.heldByRobot !== null) {
      // Position is controlled by the robot's working position
      const stationIdx = piece.heldByRobot;
      const station = STATIONS[stationIdx];
      const robot = useFactoryStore.getState().robots[stationIdx];

      let targetPos = [...station.workPos];
      if (robot.state === 'REACHING' || robot.state === 'GRIPPING') {
        targetPos = [...station.pickupPos];
      } else if (robot.state === 'LIFTING') {
        // Interpolate from pickup to work
        const prog = useFactoryStore.getState().robots[stationIdx].stateTimer / 1.4;
        const clamped = Math.min(prog, 1);
        targetPos = station.pickupPos.map((v, i) =>
          MathUtils.lerp(v, station.workPos[i], clamped)
        );
      } else if (robot.state === 'LOWERING') {
        // Interpolate from work to pickup
        const stateTimer = Date.now(); // fallback
        targetPos = [...station.pickupPos];
      }

      if (ref.current) {
        ref.current.position.x = MathUtils.lerp(ref.current.position.x, targetPos[0], delta * 6);
        ref.current.position.y = MathUtils.lerp(ref.current.position.y, targetPos[1] + 0.5, delta * 6);
        ref.current.position.z = MathUtils.lerp(ref.current.position.z, targetPos[2], delta * 6);
      }
      return;
    }

    // Advance piece along belt
    if (running) {
      const newT = (piece.t + (delta * beltSpeed) / TOTAL_LEN) % 1;
      const newPos = getBeltPosition(newT);
      updatePiece(pieceId, { t: newT, worldPos: newPos });

      if (ref.current) {
        ref.current.position.x = MathUtils.lerp(ref.current.position.x, newPos[0], delta * 10);
        ref.current.position.y = MathUtils.lerp(ref.current.position.y, newPos[1], delta * 10);
        ref.current.position.z = MathUtils.lerp(ref.current.position.z, newPos[2], delta * 10);
      }
    }
  });

  if (!piece) return null;

  const cfg = PHASE_CONFIGS[piece.phase] ?? PHASE_CONFIGS[0];
  const { parts } = cfg;

  return (
    <group ref={ref} position={piece.worldPos}>
      {/* Core body */}
      <RoundedBox args={[0.9, 0.55, 0.9]} radius={0.12} smoothness={4} castShadow receiveShadow>
        <meshStandardMaterial color={cfg.color} emissive={cfg.emissive} metalness={0.5} roughness={0.45} />
      </RoundedBox>

      {/* Phase 1+: top structure */}
      {parts.includes('top') && (
        <RoundedBox args={[0.7, 0.35, 0.5]} radius={0.08} smoothness={3}
          position={[0, 0.45, 0]} castShadow>
          <meshStandardMaterial color={cfg.color} emissive={cfg.emissive} metalness={0.6} roughness={0.35} />
        </RoundedBox>
      )}

      {/* Phase 2+: side components */}
      {parts.includes('side') && (
        <>
          <RoundedBox args={[0.18, 0.25, 0.6]} radius={0.04} smoothness={3}
            position={[0.54, 0.15, 0]} castShadow>
            <meshStandardMaterial color="#1a3a5a" metalness={0.8} roughness={0.2} />
          </RoundedBox>
          <RoundedBox args={[0.18, 0.25, 0.6]} radius={0.04} smoothness={3}
            position={[-0.54, 0.15, 0]} castShadow>
            <meshStandardMaterial color="#1a3a5a" metalness={0.8} roughness={0.2} />
          </RoundedBox>
        </>
      )}

      {/* Phase 3+: detail bumps (paint)  */}
      {parts.includes('detail') && (
        <>
          <mesh position={[0.2, 0.57, 0.2]} castShadow>
            <sphereGeometry args={[0.08, 8, 8]} />
            <meshStandardMaterial color="#ff6633" emissive="#331100" />
          </mesh>
          <mesh position={[-0.2, 0.57, 0.2]} castShadow>
            <sphereGeometry args={[0.08, 8, 8]} />
            <meshStandardMaterial color="#ff6633" emissive="#331100" />
          </mesh>
        </>
      )}

      {/* Phase 4+: glow effect */}
      {parts.includes('glow') && (
        <mesh position={[0, 0, 0]}>
          <sphereGeometry args={[0.65, 12, 12]} />
          <meshStandardMaterial color={cfg.color} emissive={cfg.color} emissiveIntensity={0.3} transparent opacity={0.12} />
        </mesh>
      )}

      {/* Phase 5: green badge / inspection mark */}
      {parts.includes('badge') && (
        <mesh position={[0, 0.65, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <circleGeometry args={[0.2, 16]} />
          <meshStandardMaterial color="#00ff88" emissive="#00ff88" emissiveIntensity={2} />
        </mesh>
      )}
    </group>
  );
}
