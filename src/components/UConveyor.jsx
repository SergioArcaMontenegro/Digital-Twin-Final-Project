import React, { useRef, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import { RoundedBox } from '@react-three/drei';
import { CanvasTexture, RepeatWrapping } from 'three';
import { getBeltPosition, TOTAL_LEN, SEMI_LEN } from '../utils/beltCurve';

const STRAIGHT_LEN = 24;
const RADIUS = 5;
const BELT_Y_BASE = 0; // floor level
const BELT_H = 1.1;    // height of belt structure

// Number of rollers per straight section
const ROLLER_COUNT = 20;
const CURVE_SEGMENTS = 28;

function Roller({ position, rotation }) {
  return (
    <mesh position={position} rotation={rotation} castShadow>
      <cylinderGeometry args={[0.15, 0.15, 2.0, 12]} />
      <meshStandardMaterial color="#444" metalness={0.9} roughness={0.2} />
    </mesh>
  );
}

function SupportLeg({ position }) {
  return (
    <mesh position={position} castShadow receiveShadow>
      <cylinderGeometry args={[0.12, 0.14, position[1] * 2, 8]} />
      <meshStandardMaterial color="#333" metalness={0.8} roughness={0.3} />
    </mesh>
  );
}

export function UConveyor({ beltSpeed = 1.5 }) {
  const beltMatRef = useRef(null);
  const beltOffset = useRef(0);

  useFrame((_, delta) => {
    if (beltMatRef.current) {
      beltOffset.current += delta * beltSpeed * 0.05;
      beltMatRef.current.map.offset.x = beltOffset.current;
    }
  });

  // Create checkerboard belt texture procedurally
  const beltTexture = useMemo(() => {
    const size = 256;
    const canvas = document.createElement('canvas');
    canvas.width = size; canvas.height = size;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#222';
    ctx.fillRect(0, 0, size, size);
    ctx.fillStyle = '#333';
    for (let i = 0; i < 16; i++) {
      ctx.fillRect(0, i * 16, size, 4);
    }
    const tex = new CanvasTexture(canvas);
    tex.wrapS = tex.wrapT = RepeatWrapping;
    tex.repeat.set(12, 1);
    return tex;
  }, []);

  // Upper straight rollers
  const upperRollers = useMemo(() => {
    const rollers = [];
    for (let i = 0; i <= ROLLER_COUNT; i++) {
      const x = -12 + (i / ROLLER_COUNT) * STRAIGHT_LEN;
      rollers.push(<Roller key={`ur-${i}`} position={[x, BELT_H, 5]} rotation={[Math.PI / 2, 0, 0]} />);
    }
    return rollers;
  }, []);

  // Lower straight rollers
  const lowerRollers = useMemo(() => {
    const rollers = [];
    for (let i = 0; i <= ROLLER_COUNT; i++) {
      const x = 12 - (i / ROLLER_COUNT) * STRAIGHT_LEN;
      rollers.push(<Roller key={`lr-${i}`} position={[x, BELT_H, -5]} rotation={[Math.PI / 2, 0, 0]} />);
    }
    return rollers;
  }, []);

  // Curve rollers
  const curveRollers = useMemo(() => {
    const rollers = [];
    for (let i = 0; i <= CURVE_SEGMENTS; i++) {
      const theta = (i / CURVE_SEGMENTS) * Math.PI;
      const x = 12 + RADIUS * Math.sin(theta);
      const z = RADIUS * Math.cos(theta);
      const angle = Math.PI / 2 + theta;
      rollers.push(
        <Roller key={`cr-${i}`}
          position={[x, BELT_H, z]}
          rotation={[Math.PI / 2, angle, 0]}
        />
      );
    }
    return rollers;
  }, []);

  // Support legs for straight sections
  const legPositions = useMemo(() => {
    const legs = [];
    const legStep = STRAIGHT_LEN / 5;
    for (let i = 0; i <= 5; i++) {
      const xU = -12 + i * legStep;
      legs.push([xU, BELT_H / 2, 5]);
      legs.push([xU, BELT_H / 2, -5]);
    }
    return legs;
  }, []);

  // Side rails geometry for upper straight
  const railColor = '#888';
  const railMetal = { metalness: 0.9, roughness: 0.2, color: railColor };

  return (
    <group>
      {/* ── UPPER STRAIGHT ── */}
      {/* Belt surface */}
      <mesh receiveShadow position={[0, BELT_H + 0.01, 5]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[STRAIGHT_LEN, 1.6, 1, 1]} />
        <meshStandardMaterial ref={beltMatRef} map={beltTexture} roughness={0.8} />
      </mesh>
      {/* Structure */}
      <RoundedBox args={[STRAIGHT_LEN, 1.1, 2]} radius={0.08} smoothness={3}
        position={[0, BELT_H / 2, 5]} castShadow receiveShadow>
        <meshStandardMaterial color="#555" metalness={0.7} roughness={0.4} />
      </RoundedBox>
      {/* Side rails upper */}
      <mesh position={[0, BELT_H + 0.4, 5 + 1.1]} castShadow>
        <boxGeometry args={[STRAIGHT_LEN, 0.06, 0.06]} />
        <meshStandardMaterial {...railMetal} />
      </mesh>
      <mesh position={[0, BELT_H + 0.4, 5 - 1.1]} castShadow>
        <boxGeometry args={[STRAIGHT_LEN, 0.06, 0.06]} />
        <meshStandardMaterial {...railMetal} />
      </mesh>

      {/* ── LOWER STRAIGHT ── */}
      <mesh receiveShadow position={[0, BELT_H + 0.01, -5]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[STRAIGHT_LEN, 1.6, 1, 1]} />
        <meshStandardMaterial map={beltTexture} roughness={0.8} />
      </mesh>
      <RoundedBox args={[STRAIGHT_LEN, 1.1, 2]} radius={0.08} smoothness={3}
        position={[0, BELT_H / 2, -5]} castShadow receiveShadow>
        <meshStandardMaterial color="#555" metalness={0.7} roughness={0.4} />
      </RoundedBox>
      <mesh position={[0, BELT_H + 0.4, -5 + 1.1]} castShadow>
        <boxGeometry args={[STRAIGHT_LEN, 0.06, 0.06]} />
        <meshStandardMaterial {...railMetal} />
      </mesh>
      <mesh position={[0, BELT_H + 0.4, -5 - 1.1]} castShadow>
        <boxGeometry args={[STRAIGHT_LEN, 0.06, 0.06]} />
        <meshStandardMaterial {...railMetal} />
      </mesh>

      {/* ── CURVE SECTION (ring of boxes) ── */}
      {Array.from({ length: CURVE_SEGMENTS }, (_, i) => {
        const t0 = (i / CURVE_SEGMENTS) * Math.PI;
        const t1 = ((i + 1) / CURVE_SEGMENTS) * Math.PI;
        const x = 12 + RADIUS * Math.sin((t0 + t1) / 2);
        const z = RADIUS * Math.cos((t0 + t1) / 2);
        const angle = (t0 + t1) / 2;
        return (
          <RoundedBox key={`cs-${i}`}
            args={[RADIUS * Math.PI / CURVE_SEGMENTS + 0.05, 1.1, 2]}
            radius={0.06} smoothness={2}
            position={[x, BELT_H / 2, z]}
            rotation={[0, -angle, 0]}
            castShadow receiveShadow>
            <meshStandardMaterial color="#555" metalness={0.7} roughness={0.4} />
          </RoundedBox>
        );
      })}

      {/* ── ROLLERS ── */}
      {upperRollers}
      {lowerRollers}
      {curveRollers}

      {/* ── SUPPORT LEGS ── */}
      {legPositions.map((pos, i) => (
        <SupportLeg key={`leg-${i}`} position={pos} />
      ))}
    </group>
  );
}
