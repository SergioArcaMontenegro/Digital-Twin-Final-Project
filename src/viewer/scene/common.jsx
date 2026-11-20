// Piezas visuales comunes del visor 3D.
import { useLayoutEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { HALL } from '../../../shared/config.js';
import { labelTexture } from '../../utils/labelTexture';

export const steel = { color: '#5d6670', metalness: 0.8, roughness: 0.35 };

export function FloorLabel({ text, position, height = 1.1, color = '#ffffff', rotation = [-Math.PI / 2, 0, 0] }) {
  const { texture, aspect } = useMemo(() => labelTexture(text, { color, font: '800 96px "Segoe UI", Roboto, Arial, sans-serif' }), [text, color]);
  return (
    <mesh position={position} rotation={rotation}>
      <planeGeometry args={[height * aspect, height]} />
      <meshBasicMaterial map={texture} transparent depthWrite={false} toneMapped={false} />
    </mesh>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// Edificio
// ═════════════════════════════════════════════════════════════════════════════
export function Building() {
  const W = HALL.x1 - HALL.x0, D = HALL.z1 - HALL.z0, cx = (HALL.x0 + HALL.x1) / 2;
  const cols = useRef(null), roof = useRef(null);
  useFrame(({ camera }) => { if (roof.current) roof.current.visible = camera.position.y < HALL.h - 0.5; });
  const colXs = useMemo(() => Array.from({ length: Math.floor(W / 12) + 1 }, (_, i) => HALL.x0 + i * 12), [W]);
  useLayoutEffect(() => {
    const m = new THREE.Matrix4();
    let k = 0;
    for (const x of colXs) for (const z of [HALL.z0 + 0.3, HALL.z1 - 0.3]) { m.makeTranslation(x, HALL.h / 2, z); cols.current.setMatrixAt(k++, m); }
    cols.current.instanceMatrix.needsUpdate = true;
  }, [colXs]);
  // Paredes con la cara hacia dentro: desde fuera no se dibujan y se ve la planta
  const wall = { color: '#e9e6df', roughness: 0.9, side: THREE.FrontSide };
  return (
    <group>
      <mesh receiveShadow position={[cx, -0.05, 0]}><boxGeometry args={[W, 0.1, D]} /><meshStandardMaterial color="#c4c2bc" roughness={0.95} /></mesh>
      <mesh position={[cx, HALL.h / 2, HALL.z0]}><planeGeometry args={[W, HALL.h]} /><meshStandardMaterial {...wall} /></mesh>
      <mesh position={[cx, HALL.h / 2, HALL.z1]} rotation={[0, Math.PI, 0]}><planeGeometry args={[W, HALL.h]} /><meshStandardMaterial {...wall} /></mesh>
      <mesh position={[HALL.x0, HALL.h / 2, 0]} rotation={[0, Math.PI / 2, 0]}><planeGeometry args={[D, HALL.h]} /><meshStandardMaterial {...wall} /></mesh>
      <mesh position={[HALL.x1, HALL.h / 2, 0]} rotation={[0, -Math.PI / 2, 0]}><planeGeometry args={[D, HALL.h]} /><meshStandardMaterial {...wall} /></mesh>
      {[HALL.z0 + 0.02, HALL.z1 - 0.02].map((z, i) => (
        <group key={z}>
          <mesh position={[cx, 1.1, z]} rotation={[0, i ? Math.PI : 0, 0]}><planeGeometry args={[W, 2.2]} /><meshStandardMaterial color="#5f6b75" /></mesh>
          <mesh position={[cx, 9.6, z]} rotation={[0, i ? Math.PI : 0, 0]}><planeGeometry args={[W, 1.6]} /><meshStandardMaterial color="#cfe6f5" emissive="#bcdcf0" emissiveIntensity={0.35} /></mesh>
        </group>
      ))}
      <instancedMesh ref={cols} args={[null, null, colXs.length * 2]} castShadow receiveShadow>
        <boxGeometry args={[0.5, HALL.h, 0.5]} />
        <meshStandardMaterial color="#3c4249" metalness={0.6} roughness={0.45} />
      </instancedMesh>
      <group ref={roof}>
        {colXs.map((x) => (
          <group key={x} position={[x, HALL.h, 0]}>
            <mesh castShadow><boxGeometry args={[0.3, 0.45, D]} /><meshStandardMaterial color="#4a5058" metalness={0.7} roughness={0.4} /></mesh>
            <mesh position={[0, 1.1, 0]}><boxGeometry args={[0.2, 0.2, D]} /><meshStandardMaterial color="#4a5058" metalness={0.7} roughness={0.4} /></mesh>
          </group>
        ))}
        {[-18, -6, 6, 18].map((z) => (
          <mesh key={z} position={[cx, HALL.h + 0.3, z]}><boxGeometry args={[W, 0.25, 0.2]} /><meshStandardMaterial color="#4a5058" metalness={0.7} roughness={0.4} /></mesh>
        ))}
      </group>
    </group>
  );
}

export function Luminaires() {
  const grp = useRef(null), housing = useRef(null), diffuser = useRef(null);
  useFrame(({ camera }) => { if (grp.current) grp.current.visible = camera.position.y < 9; });
  const pos = useMemo(() => {
    const out = [];
    for (let x = HALL.x0 + 4; x < HALL.x1 - 2; x += 4) for (const z of [-22, -12, -3.5, 3.5, 12, 22]) out.push([x, 9.2, z]);
    return out;
  }, []);
  useLayoutEffect(() => {
    const m = new THREE.Matrix4();
    pos.forEach(([x, y, z], i) => {
      m.makeTranslation(x, y, z); housing.current.setMatrixAt(i, m);
      m.makeTranslation(x, y - 0.046, z); diffuser.current.setMatrixAt(i, m);
    });
    housing.current.instanceMatrix.needsUpdate = true;
    diffuser.current.instanceMatrix.needsUpdate = true;
  }, [pos]);
  return (
    <group ref={grp}>
      {/* INDUSTRIA 1 · 1548 × 72 × 89 mm · 11 800 lm */}
      <instancedMesh ref={housing} args={[null, null, pos.length]}>
        <boxGeometry args={[1.548, 0.089, 0.072]} /><meshStandardMaterial color="#b9bec4" metalness={0.8} roughness={0.35} />
      </instancedMesh>
      <instancedMesh ref={diffuser} args={[null, null, pos.length]}>
        <boxGeometry args={[1.5, 0.006, 0.06]} /><meshStandardMaterial color="#ffffff" emissive="#fff8ec" emissiveIntensity={3} toneMapped={false} />
      </instancedMesh>
    </group>
  );
}

/**
 * Vallado rectangular. `gaps` = lista de [lado, desde, hasta] con lado ∈ n|s|w|e
 * (n = −z, s = +z) y coordenadas relativas al centro del lado.
 */
export function Fence({ cx, cz, lx, lz, gaps = [], tint = '#5b6670', curtains = [] }) {
  const posts = useRef(null), panels = useRef(null);
  const { postM, panelM } = useMemo(() => {
    const postM = [], panelM = [];
    const q = new THREE.Quaternion(), s = new THREE.Vector3();
    const hx = lx / 2, hz = lz / 2, step = 1.5;
    const side = (name, ax, az, bx, bz) => {
      const len = Math.hypot(bx - ax, bz - az), n = Math.max(1, Math.round(len / step));
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), -Math.atan2(bz - az, bx - ax));
      const my = gaps.filter((g) => g[0] === name);
      for (let i = 0; i <= n; i++) {
        const t = i / n;
        const x = ax + (bx - ax) * t, z = az + (bz - az) * t;
        const u = name === 'n' || name === 's' ? x : z;
        if (!my.some(([, a, b]) => u > a + 0.05 && u < b - 0.05)) postM.push(new THREE.Matrix4().makeTranslation(cx + x, 1.1, cz + z));
        if (i < n) {
          const mx = ax + (bx - ax) * (t + 0.5 / n), mz = az + (bz - az) * (t + 0.5 / n);
          const mu = name === 'n' || name === 's' ? mx : mz;
          if (my.some(([, a, b]) => mu > a && mu < b)) continue;
          panelM.push(new THREE.Matrix4().compose(new THREE.Vector3(cx + mx, 1.15, cz + mz), q, s.set(len / n - 0.08, 1, 1)));
        }
      }
    };
    side('n', -hx, -hz, hx, -hz);
    side('s', -hx, hz, hx, hz);
    side('w', -hx, -hz, -hx, hz);
    side('e', hx, -hz, hx, hz);
    return { postM, panelM };
  }, [cx, cz, lx, lz, gaps]);
  useLayoutEffect(() => {
    postM.forEach((m, i) => posts.current.setMatrixAt(i, m));
    panelM.forEach((m, i) => panels.current.setMatrixAt(i, m));
    posts.current.instanceMatrix.needsUpdate = true;
    panels.current.instanceMatrix.needsUpdate = true;
  }, [postM, panelM]);
  return (
    <group>
      <instancedMesh ref={posts} args={[null, null, postM.length]} castShadow>
        <boxGeometry args={[0.07, 2.2, 0.07]} /><meshStandardMaterial color="#f2c230" metalness={0.3} roughness={0.5} />
      </instancedMesh>
      <instancedMesh ref={panels} args={[null, null, panelM.length]}>
        <boxGeometry args={[1, 1.9, 0.02]} />
        <meshStandardMaterial color={tint} transparent opacity={0.32} metalness={0.4} roughness={0.6} side={THREE.DoubleSide} depthWrite={false} />
      </instancedMesh>
      {/* Cortinas fotoeléctricas en los accesos automáticos */}
      {curtains.map(([x, z], i) => (
        <group key={i}>
          {[-1, 1].map((k) => (
            <mesh key={k} position={[cx + x + k * 0.95, 1.0, cz + z]}><boxGeometry args={[0.08, 2.0, 0.08]} /><meshStandardMaterial color="#f2c230" emissive="#6a4b00" /></mesh>
          ))}
          <mesh position={[cx + x, 1.0, cz + z]}><boxGeometry args={[1.82, 1.9, 0.005]} /><meshBasicMaterial color="#ff3b30" transparent opacity={0.08} depthWrite={false} /></mesh>
        </group>
      ))}
    </group>
  );
}

/** Suelo pintado de una zona (coordenadas locales de la zona). */
export function ZoneFloor({ lx, lz, color, label, labelZ, opacity = 0.16 }) {
  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.004, 0]} receiveShadow>
        <planeGeometry args={[lx, lz]} />
        <meshStandardMaterial color={color} transparent opacity={opacity} roughness={0.9} depthWrite={false} />
      </mesh>
      {[[0, lz / 2 - 0.12, lx, 0.12], [0, -lz / 2 + 0.12, lx, 0.12], [lx / 2 - 0.12, 0, 0.12, lz], [-lx / 2 + 0.12, 0, 0.12, lz]].map(([dx, dz, w, d], i) => (
        <mesh key={i} rotation={[-Math.PI / 2, 0, 0]} position={[dx, 0.007, dz]}><planeGeometry args={[w, d]} /><meshStandardMaterial color="#f2c230" /></mesh>
      ))}
      {label && <FloorLabel text={label} position={[0, 0.012, labelZ ?? lz / 2 - 0.9]} height={0.62} color={color} />}
    </group>
  );
}

export function HangingSign({ text, position, rotation = [0, 0, 0] }) {
  return (
    <group position={position} rotation={rotation}>
      <mesh><boxGeometry args={[6.2, 1.1, 0.08]} /><meshStandardMaterial color="#1e252c" /></mesh>
      <FloorLabel text={text} position={[0, 0, 0.05]} height={0.58} rotation={[0, 0, 0]} />
      <FloorLabel text={text} position={[0, 0, -0.05]} height={0.58} rotation={[0, Math.PI, 0]} />
      {[-2.6, 2.6].map((x) => (
        <mesh key={x} position={[x, 2.4, 0]}><cylinderGeometry args={[0.015, 0.015, 3.8, 6]} /><meshStandardMaterial color="#222" /></mesh>
      ))}
    </group>
  );
}

export function Duct({ a, b, r = 0.32 }) {
  const v = new THREE.Vector3(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
  const len = v.length();
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), v.clone().normalize());
  return (
    <mesh position={[(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2]} quaternion={q} castShadow>
      <cylinderGeometry args={[r, r, len, 16]} /><meshStandardMaterial color="#b8bec5" metalness={0.75} roughness={0.32} />
    </mesh>
  );
}
