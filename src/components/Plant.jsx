import { useLayoutEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import {
  HALL, STATIONS, CELLS, CELL_LEN, CELL_W, LINE_Z, LINE_Y, PIECE_Y, robotsOf, SIDE_RACK, BAR_BEAM_Y, KILN,
  PALLETIZER, NODES, ROUTES, RACK, DOCK, SILO, CONTROL_ROOM, SAW, LOG_YARD,
} from '../sim/layout';
import { engine, fmtClock, shiftName } from '../sim/engine';
import { logistics } from '../sim/logistics';
import { labelTexture } from '../utils/labelTexture';

const steel = { color: '#5d6670', metalness: 0.8, roughness: 0.35 };

function FloorLabel({ text, position, height = 1.1, color = '#ffffff', rotation = [-Math.PI / 2, 0, 0] }) {
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
function Building() {
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
      {/* Pasillos peatonales */}
      {[[cx, 8.4, W - 6, 0.14], [cx, -8.4, W - 40, 0.14]].map(([x, z, w, d], i) => (
        <mesh key={i} rotation={[-Math.PI / 2, 0, 0]} position={[x + (i ? 12 : 0), 0.006, z]}><planeGeometry args={[w, d]} /><meshStandardMaterial color="#f2c230" /></mesh>
      ))}
    </group>
  );
}

function Luminaires() {
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

// ═════════════════════════════════════════════════════════════════════════════
// Zona de seguridad: suelo pintado + vallado perimetral con huecos
// ═════════════════════════════════════════════════════════════════════════════
/**
 * Vallado rectangular. `gaps` = lista de [lado, desde, hasta] con lado ∈ n|s|w|e
 * (n = −z, s = +z) y coordenadas relativas al centro del lado.
 */
function Fence({ cx, cz, lx, lz, gaps = [], tint = '#5b6670', curtains = [] }) {
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

function SafetyZone({ x, z, lx, lz, color, label }) {
  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[x, 0.004, z]} receiveShadow>
        <planeGeometry args={[lx, lz]} />
        <meshStandardMaterial color={color} transparent opacity={0.16} roughness={0.9} depthWrite={false} />
      </mesh>
      {[[0, lz / 2 - 0.3, lx - 0.4, 0.2], [0, -lz / 2 + 0.3, lx - 0.4, 0.2]].map(([dx, dz, w, d], i) => (
        <mesh key={i} rotation={[-Math.PI / 2, 0, 0]} position={[x + dx, 0.007, z + dz]}><planeGeometry args={[w, d]} /><meshStandardMaterial color="#f2c230" /></mesh>
      ))}
      {label && <FloorLabel text={label} position={[x, 0.012, z + lz / 2 - 1.15]} height={0.75} color={color} />}
    </group>
  );
}

function HangingSign({ text, position, rotation = [0, 0, 0] }) {
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

// ═════════════════════════════════════════════════════════════════════════════
// Equipos de la línea
// ═════════════════════════════════════════════════════════════════════════════
function Planer({ x }) {
  return (
    <group position={[x, 0, LINE_Z]}>
      <mesh position={[0, 1.0, 0]} castShadow receiveShadow><boxGeometry args={[4.2, 2.0, 2.2]} /><meshStandardMaterial color="#2f6b4f" metalness={0.3} roughness={0.55} /></mesh>
      <mesh position={[0, 2.15, 0]} castShadow><boxGeometry args={[3.6, 0.3, 1.8]} /><meshStandardMaterial {...steel} /></mesh>
      <mesh position={[0, LINE_Y + 0.1, 1.11]}><boxGeometry args={[3.6, 0.35, 0.02]} /><meshStandardMaterial color="#111" /></mesh>
      <mesh position={[-2.15, LINE_Y + 0.12, 0]}><boxGeometry args={[0.1, 0.24, 1.2]} /><meshStandardMaterial color="#0d0d0d" /></mesh>
      <mesh position={[2.15, LINE_Y + 0.12, 0]}><boxGeometry args={[0.1, 0.24, 1.2]} /><meshStandardMaterial color="#0d0d0d" /></mesh>
      <mesh position={[1.4, 1.4, 1.2]}><boxGeometry args={[0.6, 0.45, 0.12]} /><meshStandardMaterial color="#0a1520" emissive="#0b3550" emissiveIntensity={0.9} /></mesh>
      <mesh position={[0, 2.3 + 1.6, 0]}><cylinderGeometry args={[0.3, 0.3, 3.2, 16]} /><meshStandardMaterial color="#b8bec5" metalness={0.7} roughness={0.35} /></mesh>
      {[-1.4, 1.4].map((dz) => (
        <mesh key={dz} position={[0, 0.4, dz]}><boxGeometry args={[4.4, 0.8, 0.08]} /><meshStandardMaterial color="#f2c230" transparent opacity={0.6} /></mesh>
      ))}
    </group>
  );
}

function CellEquipment({ cell }) {
  const cx = cell.x;
  if (cell.id === 'CNC') {
    // Pórtico de sujeción con pisadores neumáticos + campana de aspiración
    return (
      <group position={[cx, 0, LINE_Z]}>
        {[-1.05, 1.05].map((dx) => (
          <mesh key={dx} position={[dx, 1.25, -0.75]} castShadow><boxGeometry args={[0.14, 1.0, 0.14]} /><meshStandardMaterial color="#3b3f45" /></mesh>
        ))}
        <mesh position={[0, 1.78, -0.75]} castShadow><boxGeometry args={[2.3, 0.14, 0.18]} /><meshStandardMaterial color="#3b3f45" /></mesh>
        {[-0.6, 0.6].map((dx) => (
          <mesh key={dx} position={[dx, PIECE_Y + 0.12, -0.32]} castShadow><boxGeometry args={[0.12, 0.08, 0.2]} /><meshStandardMaterial color="#d23b2a" /></mesh>
        ))}
        <mesh position={[0, 3.6, 0]} castShadow><boxGeometry args={[2.4, 0.5, 1.6]} /><meshStandardMaterial color="#b8bec5" metalness={0.6} roughness={0.4} /></mesh>
        <mesh position={[0, 6.0, 0]}><cylinderGeometry args={[0.22, 0.22, 4.4, 14]} /><meshStandardMaterial color="#b8bec5" metalness={0.7} roughness={0.35} /></mesh>
        {/* Almacén de herramientas (fresas) */}
        <group position={[-5.4, 0, 3.4]}>
          <mesh position={[0, 0.6, 0]} castShadow><boxGeometry args={[1.1, 1.2, 0.5]} /><meshStandardMaterial color="#3b3f45" /></mesh>
          {[-0.35, -0.12, 0.12, 0.35].map((x) => (
            <mesh key={x} position={[x, 1.32, 0]}><cylinderGeometry args={[0.04, 0.04, 0.2, 10]} /><meshStandardMaterial color="#c9a245" metalness={1} /></mesh>
          ))}
        </group>
      </group>
    );
  }
  if (cell.id === 'LIJ') {
    return (
      <group position={[cx, 0, LINE_Z]}>
        <mesh position={[0, 3.4, 0]} castShadow><boxGeometry args={[3.2, 0.6, 2.2]} /><meshStandardMaterial color="#b8bec5" metalness={0.6} roughness={0.4} /></mesh>
        <mesh position={[0, 3.08, 0]}><boxGeometry args={[3.0, 0.04, 2.0]} /><meshStandardMaterial color="#4a4f57" /></mesh>
        <mesh position={[0, 5.9, 0]}><cylinderGeometry args={[0.24, 0.24, 4.4, 14]} /><meshStandardMaterial color="#b8bec5" metalness={0.7} roughness={0.35} /></mesh>
        {/* Cambiador de discos de lija */}
        <group position={[5.2, 0, -3.6]}>
          <mesh position={[0, 0.55, 0]} castShadow><boxGeometry args={[0.8, 1.1, 0.8]} /><meshStandardMaterial color="#3b3f45" /></mesh>
          {[0, 1, 2, 3].map((i) => <mesh key={i} position={[0, 1.12 + i * 0.03, 0]}><cylinderGeometry args={[0.12, 0.12, 0.02, 20]} /><meshStandardMaterial color="#8a5a32" /></mesh>)}
        </group>
      </group>
    );
  }
  if (cell.id === 'ENS') {
    // Racks de laterales/traseras junto a cada robot + atornilladora de alimentación
    return (
      <group>
        {robotsOf('ENS').map((r) => {
          const rx = r.pos[0] + (r.index === 2 ? 0.8 : 0), rz = r.pos[2] + r.side * SIDE_RACK.dz;
          return (
            <group key={r.id} position={[rx, 0, rz]}>
              <mesh position={[0, SIDE_RACK.y / 2, 0]} castShadow><boxGeometry args={[0.9, SIDE_RACK.y, 0.8]} /><meshStandardMaterial color="#2f6db0" metalness={0.4} roughness={0.5} /></mesh>
              {[0, 1, 2, 3, 4].map((i) => (
                <mesh key={i} position={[0, SIDE_RACK.y + 0.012 + i * 0.022, 0]} castShadow><boxGeometry args={[0.52, 0.018, 0.74]} /><meshStandardMaterial color="#e2c497" roughness={0.7} /></mesh>
              ))}
            </group>
          );
        })}
        <group position={[cell.x + 5.2, 0, LINE_Z + 3.6]}>
          <mesh position={[0, 0.7, 0]} castShadow><boxGeometry args={[0.7, 1.4, 0.7]} /><meshStandardMaterial color="#d9d6cf" /></mesh>
          <mesh position={[0, 1.55, 0]}><cylinderGeometry args={[0.28, 0.12, 0.35, 16]} /><meshStandardMaterial color="#9aa3ab" metalness={0.7} /></mesh>
        </group>
      </group>
    );
  }
  if (cell.id === 'BAR') return <VarnishBooth x={cx} />;
  return null;
}

function VarnishBooth({ x }) {
  const L = CELL_LEN - 1, W = 8.8, H = 4.8;
  const glass = { color: '#a9d4ec', transparent: true, opacity: 0.13, metalness: 0.2, roughness: 0.1, depthWrite: false, side: THREE.DoubleSide };
  const frame = { color: '#e7e9eb', metalness: 0.5, roughness: 0.4 };
  const z = LINE_Z;
  const edges = [];
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) edges.push([sx * L / 2, H / 2, sz * W / 2, 0.12, H, 0.12]);
  for (const sz of [-1, 1]) edges.push([0, H, sz * W / 2, L, 0.14, 0.14]);
  for (const sx of [-1, 1]) edges.push([sx * L / 2, H, 0, 0.14, 0.14, W]);
  for (let i = -2; i <= 2; i++) for (const sz of [-1, 1]) edges.push([i * L / 6, H / 2, sz * W / 2, 0.08, H, 0.08]);
  return (
    <group position={[x, 0, z]}>
      <mesh position={[0, H / 2, W / 2]}><planeGeometry args={[L, H]} /><meshStandardMaterial {...glass} /></mesh>
      <mesh position={[0, H / 2, -W / 2]}><planeGeometry args={[L, H]} /><meshStandardMaterial {...glass} /></mesh>
      {[-1, 1].map((sx) => (
        <group key={sx}>
          {[-1, 1].map((sz) => (
            <mesh key={sz} position={[sx * L / 2, H / 2, sz * (W / 4 + 0.8)]} rotation={[0, Math.PI / 2, 0]}><planeGeometry args={[W / 2 - 1.6, H]} /><meshStandardMaterial {...glass} /></mesh>
          ))}
          <mesh position={[sx * L / 2, H - 0.75, 0]} rotation={[0, Math.PI / 2, 0]}><planeGeometry args={[3.2, 1.5]} /><meshStandardMaterial {...glass} /></mesh>
        </group>
      ))}
      {edges.map(([ex, ey, ez, w, h, d], i) => (
        <mesh key={i} position={[ex, ey, ez]} castShadow><boxGeometry args={[w, h, d]} /><meshStandardMaterial {...frame} /></mesh>
      ))}
      <mesh position={[0, H + 0.45, 0]} castShadow><boxGeometry args={[L, 0.8, W]} /><meshStandardMaterial color="#f4f5f6" roughness={0.7} /></mesh>
      <mesh position={[0, H - 0.01, 0]} rotation={[Math.PI / 2, 0, 0]}><planeGeometry args={[L - 0.3, W - 0.3]} /><meshStandardMaterial color="#ffffff" emissive="#eef6ff" emissiveIntensity={0.6} side={THREE.DoubleSide} /></mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.009, 0]}><planeGeometry args={[L - 0.4, W - 0.4]} /><meshStandardMaterial color="#9aa3ab" metalness={0.6} roughness={0.5} /></mesh>
      {/* Vigas aéreas de las que cuelgan los robots de barnizado */}
      {robotsOf('BAR').map((r) => (
        <group key={r.id}>
          <mesh position={[0, BAR_BEAM_Y + 0.18, r.pos[2] - z]} castShadow><boxGeometry args={[L - 0.4, 0.3, 0.42]} /><meshStandardMaterial color="#7d848c" metalness={0.6} roughness={0.4} /></mesh>
          <mesh position={[r.pos[0] - x, BAR_BEAM_Y + 0.02, r.pos[2] - z]}><boxGeometry args={[0.9, 0.06, 0.9]} /><meshStandardMaterial color="#5d6670" metalness={0.7} /></mesh>
          {[-1, 1].map((sx) => (
            <mesh key={sx} position={[sx * (L / 2 - 0.4), (BAR_BEAM_Y + H) / 2 + 0.1, r.pos[2] - z]}><boxGeometry args={[0.2, H - BAR_BEAM_Y + 0.2, 0.2]} /><meshStandardMaterial color="#7d848c" /></mesh>
          ))}
        </group>
      ))}
      {/* Cuarto de mezclas de barniz */}
      <mesh position={[4.2, 1.2, -W / 2 - 1.5]} castShadow><boxGeometry args={[3, 2.4, 2]} /><meshStandardMaterial color="#c9d3db" /></mesh>
    </group>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// Secadero (puertas animadas por la llegada de los AGVs)
// ═════════════════════════════════════════════════════════════════════════════
function KilnPanel() {
  const { canvas, texture } = useMemo(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 512; canvas.height = 256;
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    return { canvas, texture };
  }, []);
  const last = useRef(0);
  useFrame(({ clock }) => {
    if (clock.elapsedTime - last.current < 1) return;
    last.current = clock.elapsedTime;
    const k = logistics.kiln;
    const c = canvas.getContext('2d');
    c.fillStyle = '#06121b'; c.fillRect(0, 0, 512, 256);
    c.fillStyle = '#39c0ff'; c.font = '700 34px Segoe UI, Arial'; c.fillText('SECADERO', 20, 46);
    c.fillStyle = '#e8eef3'; c.font = '600 28px Segoe UI, Arial';
    c.fillText(`T 72 °C · HR ${(42 + 6 * Math.sin(clock.elapsedTime / 20)).toFixed(0)} %`, 20, 100);
    c.fillText(`Cámara: ${k.loads.length}/4 pilas`, 20, 150);
    c.fillStyle = k.out ? '#3ddc84' : '#9fb6c8';
    c.fillText(`Listas en salida: ${k.out}`, 20, 200);
    texture.needsUpdate = true;
  });
  return <mesh><planeGeometry args={[1.6, 0.8]} /><meshBasicMaterial map={texture} toneMapped={false} /></mesh>;
}

function Kiln() {
  const { x0, x1, z0, z1 } = KILN;
  const H = 7, cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
  const dIn = useRef(null), dOut = useRef(null);
  useFrame(() => {
    const k = logistics.kiln;
    // Puerta enrollable: se recoge hacia arriba
    const set = (r, v) => { if (r.current) { const h = 3.2 * Math.max(0.03, 1 - v); r.current.scale.y = h / 3.2; r.current.position.y = 3.2 - h / 2; } };
    set(dIn, k.doorIn); set(dOut, k.doorOut);
  });
  return (
    <group>
      <mesh position={[cx, H / 2, cz]} castShadow receiveShadow><boxGeometry args={[x1 - x0, H, z1 - z0]} /><meshStandardMaterial color="#dfe3e6" metalness={0.3} roughness={0.6} /></mesh>
      {Array.from({ length: 9 }, (_, i) => (
        <mesh key={i} position={[x0 + 1 + i * 1.75, H / 2, z1 + 0.03]}><boxGeometry args={[0.06, H, 0.06]} /><meshStandardMaterial color="#b9bfc4" /></mesh>
      ))}
      {[KILN.inX, KILN.outX].map((dx, i) => (
        <group key={dx} position={[dx, 0, z1 + 0.05]}>
          <mesh position={[0, 3.45, 0]}><boxGeometry args={[3.2, 0.3, 0.3]} /><meshStandardMaterial color="#3b3f45" /></mesh>
          {[-1.5, 1.5].map((k) => <mesh key={k} position={[k, 1.7, 0]}><boxGeometry args={[0.15, 3.4, 0.2]} /><meshStandardMaterial color="#f2c230" /></mesh>)}
          <mesh ref={i ? dOut : dIn} position={[0, 1.6, 0.02]} castShadow><boxGeometry args={[2.8, 3.2, 0.08]} /><meshStandardMaterial color="#9aa3ab" metalness={0.5} roughness={0.5} /></mesh>
          <mesh position={[0, 0.003, 1.5]} rotation={[-Math.PI / 2, 0, 0]}><planeGeometry args={[3, 2.5]} /><meshBasicMaterial color={i ? '#3ddc84' : '#ffb020'} transparent opacity={0.25} /></mesh>
          <FloorLabel text={i ? 'SALIDA' : 'ENTRADA'} position={[0, 3.9, 0.1]} height={0.4} rotation={[0, 0, 0]} />
        </group>
      ))}
      {[-60, -55.5].map((x) => [-24, -16].map((z) => (
        <group key={`${x}${z}`} position={[x, H, z]}>
          <mesh position={[0, 0.4, 0]} castShadow><cylinderGeometry args={[0.9, 0.9, 0.8, 24]} /><meshStandardMaterial color="#9aa3ab" metalness={0.6} roughness={0.4} /></mesh>
          <mesh position={[0, 0.82, 0]}><cylinderGeometry args={[0.8, 0.8, 0.04, 24]} /><meshStandardMaterial color="#333" /></mesh>
        </group>
      )))}
      <group position={[-58, 2.2, z1 + 0.1]}><KilnPanel /></group>
    </group>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// Aspiración: silo exterior, ciclón y conductos
// ═════════════════════════════════════════════════════════════════════════════
function Duct({ a, b, r = 0.32 }) {
  const v = new THREE.Vector3(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
  const len = v.length();
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), v.clone().normalize());
  return (
    <mesh position={[(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2]} quaternion={q} castShadow>
      <cylinderGeometry args={[r, r, len, 16]} /><meshStandardMaterial color="#b8bec5" metalness={0.75} roughness={0.32} />
    </mesh>
  );
}
function DustSystem() {
  const yD = 9.2, zBack = -27.5;
  const drops = [['CEP', -40], ['CNC', -24], ['LIJ', -8]];
  return (
    <group>
      <group position={[SILO.x, 0, SILO.z]}>
        <mesh position={[0, SILO.h / 2 + 3, 0]} castShadow><cylinderGeometry args={[SILO.r, SILO.r, SILO.h - 2, 32]} /><meshStandardMaterial color="#cfd4d8" metalness={0.5} roughness={0.4} /></mesh>
        <mesh position={[0, 3, 0]} castShadow><coneGeometry args={[SILO.r, 2.5, 32]} /><meshStandardMaterial color="#cfd4d8" metalness={0.5} roughness={0.4} /></mesh>
        <mesh position={[0, SILO.h + 2.2, 0]}><coneGeometry args={[SILO.r + 0.1, 1.2, 32]} /><meshStandardMaterial color="#9aa3ab" /></mesh>
        {[[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([a, b]) => (
          <mesh key={`${a}${b}`} position={[a * SILO.r * 0.75, 2.0, b * SILO.r * 0.75]} castShadow><boxGeometry args={[0.25, 4, 0.25]} /><meshStandardMaterial {...steel} /></mesh>
        ))}
        {/* Ciclón */}
        <group position={[0, SILO.h + 4.6, 0]}>
          <mesh castShadow><cylinderGeometry args={[1.0, 1.0, 1.6, 24]} /><meshStandardMaterial color="#b8bec5" metalness={0.7} /></mesh>
          <mesh position={[0, -1.6, 0]}><coneGeometry args={[1.0, 1.6, 24]} /><meshStandardMaterial color="#b8bec5" metalness={0.7} /></mesh>
        </group>
        <FloorLabel text="SILO DE SERRÍN" position={[0, 6, SILO.r + 0.05]} height={0.7} rotation={[0, 0, 0]} />
      </group>
      {/* Conducto principal por el fondo de la nave y bajantes a cada máquina */}
      <Duct a={[HALL.x0 - 0.5, yD, zBack]} b={[-6, yD, zBack]} r={0.45} />
      {drops.map(([id, x]) => (
        <group key={id}>
          <Duct a={[x, yD, zBack]} b={[x, yD, LINE_Z]} r={0.26} />
          <Duct a={[x, yD, LINE_Z]} b={[x, 4.2, LINE_Z]} r={0.24} />
        </group>
      ))}
      {/* Conducto del aserradero */}
      <Duct a={[HALL.x0 - 0.5, yD, 24]} b={[SAW.headX, yD, 24]} r={0.38} />
      <Duct a={[SAW.headX, yD, 24]} b={[SAW.headX, 5.2, 24]} r={0.3} />
      <Duct a={[HALL.x0 - 0.5, yD, zBack]} b={[SILO.x, SILO.h + 4.8, SILO.z - 1]} r={0.45} />
      <Duct a={[HALL.x0 - 0.5, yD, 24]} b={[SILO.x, SILO.h + 4.8, SILO.z + 1]} r={0.38} />
    </group>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// Carriles de AGV pintados (con flechas de sentido)
// ═════════════════════════════════════════════════════════════════════════════
function AgvLanes() {
  const { edges, arrows } = useMemo(() => {
    const dir = new Map();
    const add = (route) => route.forEach((n, i) => {
      if (i === 0) return;
      const key = `${route[i - 1]}>${n}`;
      dir.set(key, (dir.get(key) || 0) + 1);
    });
    for (const r of Object.values(ROUTES)) {
      if (Array.isArray(r)) add(r);
      else for (const x of RACK.xs) add(r(x));
    }
    const edges = [], arrows = [], seen = new Set();
    for (const key of dir.keys()) {
      const [a, b] = key.split('>');
      const und = [a, b].sort().join('|');
      if (seen.has(und)) continue;
      seen.add(und);
      const oneWay = !dir.has(`${b}>${a}`);
      const A = NODES[a], B = NODES[b];
      const len = Math.hypot(B[0] - A[0], B[1] - A[1]);
      if (len < 0.01) continue;
      const ang = Math.atan2(B[1] - A[1], B[0] - A[0]);
      edges.push({ x: (A[0] + B[0]) / 2, z: (A[1] + B[1]) / 2, len, ang });
      if (oneWay) for (let d = 2; d < len - 1; d += 4) arrows.push({ x: A[0] + Math.cos(ang) * d, z: A[1] + Math.sin(ang) * d, ang });
    }
    return { edges, arrows };
  }, []);
  const arrowGeo = useMemo(() => {
    const s = new THREE.Shape();
    s.moveTo(0.35, 0); s.lineTo(-0.25, 0.28); s.lineTo(-0.1, 0); s.lineTo(-0.25, -0.28); s.lineTo(0.35, 0);
    return new THREE.ShapeGeometry(s);
  }, []);
  return (
    <group>
      {edges.map((e, i) => (
        <mesh key={i} position={[e.x, 0.008, e.z]} rotation={[-Math.PI / 2, 0, -e.ang]}>
          <planeGeometry args={[e.len + 0.3, 0.14]} /><meshBasicMaterial color="#ffffff" transparent opacity={0.85} />
        </mesh>
      ))}
      {arrows.map((a, i) => (
        <mesh key={i} geometry={arrowGeo} position={[a.x, 0.01, a.z]} rotation={[-Math.PI / 2, 0, -a.ang]}>
          <meshBasicMaterial color="#2f8cff" />
        </mesh>
      ))}
      {Object.entries(NODES).map(([id, [x, z]]) => (
        <mesh key={id} position={[x, 0.009, z]} rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[0.12, 0.2, 16]} /><meshBasicMaterial color="#2f8cff" />
        </mesh>
      ))}
    </group>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// Muelle y sala de control
// ═════════════════════════════════════════════════════════════════════════════
function Dock() {
  return (
    <group position={[HALL.x1, 0, DOCK.z]}>
      <mesh position={[0.05, 1.8, 0]}><boxGeometry args={[0.2, 3.6, 3.4]} /><meshStandardMaterial color="#1a1d21" /></mesh>
      {[-1.8, 1.8].map((z) => <mesh key={z} position={[0, 2.0, z]}><boxGeometry args={[0.3, 4.0, 0.25]} /><meshStandardMaterial color="#f2c230" /></mesh>)}
      <mesh position={[-1.2, 0.02, 0]} rotation={[-Math.PI / 2, 0, 0]}><planeGeometry args={[2.4, 3.2]} /><meshStandardMaterial color="#5d6670" metalness={0.6} /></mesh>
      <mesh position={[0.5, 4.2, 1.6]}><sphereGeometry args={[0.12, 12, 10]} /><meshStandardMaterial color="#3ddc84" emissive="#3ddc84" emissiveIntensity={1.5} /></mesh>
      <FloorLabel text="MUELLE 1" position={[-0.2, 4.4, 0]} height={0.45} rotation={[0, -Math.PI / 2, 0]} />
    </group>
  );
}

function VideoWall() {
  const { canvas, texture } = useMemo(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 1024; canvas.height = 512;
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    return { canvas, texture };
  }, []);
  const last = useRef(0);
  useFrame(({ clock }) => {
    if (clock.elapsedTime - last.current < 0.5) return;
    last.current = clock.elapsedTime;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#07131d'; ctx.fillRect(0, 0, 1024, 512);
    ctx.fillStyle = '#39c0ff'; ctx.font = '700 38px Segoe UI, Arial'; ctx.fillText('GEMELO DIGITAL · PLANTA DE MADERA', 32, 58);
    ctx.fillStyle = '#9fb6c8'; ctx.font = '500 24px Segoe UI, Arial';
    ctx.fillText(`${fmtClock(engine.simTime)} · ${shiftName(engine.simTime)}`, 32, 94);
    const k = engine.kpi, L = logistics.counters;
    const tiles = [
      ['TAKT', `${engine.takt.toFixed(1)} s`, engine.takt <= 60.01 ? '#3ddc84' : '#ff5a4a'],
      ['MÓDULOS', `${Math.floor(k.produced)}`, '#e8eef3'],
      ['PARADAS NO PROG.', `${k.unplanned}`, k.unplanned ? '#ff5a4a' : '#3ddc84'],
      ['PALÉS EXPEDIDOS', `${L.shipped}`, '#e8eef3'],
    ];
    tiles.forEach(([t, v, c], i) => {
      const x = 32 + i * 245;
      ctx.fillStyle = '#0f2231'; ctx.fillRect(x, 120, 225, 110);
      ctx.fillStyle = '#7f98ab'; ctx.font = '600 19px Segoe UI, Arial'; ctx.fillText(t, x + 14, 150);
      ctx.fillStyle = c; ctx.font = '700 44px Segoe UI, Arial'; ctx.fillText(v, x + 14, 210);
    });
    Object.values(engine.robots).forEach((r, i) => {
      const x = 32 + (i % 5) * 196, y = 250 + Math.floor(i / 5) * 84;
      const c = r.status === 'FAULT' ? '#ff5a4a' : r.status === 'MAINT' ? '#3d8bff' : r.temp > 85 ? '#ffb020' : '#3ddc84';
      ctx.fillStyle = '#0f2231'; ctx.fillRect(x, y, 180, 74);
      ctx.fillStyle = c; ctx.fillRect(x, y, 6, 74);
      ctx.fillStyle = '#e8eef3'; ctx.font = '700 22px Segoe UI, Arial'; ctx.fillText(r.id, x + 16, y + 28);
      ctx.fillStyle = '#9fb6c8'; ctx.font = '500 18px Segoe UI, Arial';
      ctx.fillText(`${r.temp.toFixed(0)} °C · RUL ${r.rul > 9999 ? '>9999' : r.rul.toFixed(0)} h`, x + 16, y + 56);
    });
    logistics.agvs.forEach((a, i) => {
      const x = 32 + i * 245, y = 430;
      ctx.fillStyle = '#0f2231'; ctx.fillRect(x, y, 225, 64);
      ctx.fillStyle = a.state === 'WAIT' ? '#ffb020' : a.state === 'IDLE' ? '#7fdcff' : '#3ddc84';
      ctx.fillRect(x, y, 6, 64);
      ctx.fillStyle = '#e8eef3'; ctx.font = '700 20px Segoe UI, Arial'; ctx.fillText(`${a.id} · ${a.battery.toFixed(0)} %`, x + 16, y + 26);
      ctx.fillStyle = '#9fb6c8'; ctx.font = '500 16px Segoe UI, Arial'; ctx.fillText(a.mission.slice(0, 24), x + 16, y + 50);
    });
    texture.needsUpdate = true;
  });
  return <mesh position={[0, 0, 0.06]}><planeGeometry args={[6.4, 3.2]} /><meshBasicMaterial map={texture} toneMapped={false} /></mesh>;
}

function ControlRoom() {
  const { x, z } = CONTROL_ROOM, h = 3.2;
  return (
    <group position={[x, 0, z]}>
      <mesh position={[0, h / 2, 0]} castShadow receiveShadow><boxGeometry args={[9, h, 7]} /><meshStandardMaterial color="#59626b" metalness={0.3} roughness={0.7} /></mesh>
      <mesh position={[0, h + 1.5, 0]}><boxGeometry args={[9, 3, 7]} /><meshStandardMaterial color="#9cc7e0" transparent opacity={0.22} metalness={0.3} roughness={0.1} depthWrite={false} /></mesh>
      <mesh position={[0, h + 3.05, 0]} castShadow><boxGeometry args={[9.2, 0.12, 7.2]} /><meshStandardMaterial color="#e6e8ea" /></mesh>
      {[[-4.5, -3.5], [4.5, -3.5], [-4.5, 3.5], [4.5, 3.5]].map(([a, b]) => (
        <mesh key={`${a}${b}`} position={[a, h + 1.5, b]}><boxGeometry args={[0.12, 3, 0.12]} /><meshStandardMaterial color="#e6e8ea" /></mesh>
      ))}
      <mesh position={[0, h + 0.45, -1.6]} castShadow><boxGeometry args={[5, 0.9, 1]} /><meshStandardMaterial color="#20262c" /></mesh>
      {[-1.6, 0, 1.6].map((dx) => (
        <mesh key={dx} position={[dx, h + 1.25, -1.9]} rotation={[0.2, 0, 0]}><boxGeometry args={[1.2, 0.7, 0.05]} /><meshStandardMaterial color="#0a1520" emissive="#0b3550" emissiveIntensity={0.9} /></mesh>
      ))}
      {[-1, 1].map((dx) => (
        <group key={dx} position={[dx, h, -0.7]}>
          <mesh position={[0, 0.85, 0]} castShadow><capsuleGeometry args={[0.2, 0.6, 4, 10]} /><meshStandardMaterial color="#2a4a7a" /></mesh>
          <mesh position={[0, 1.45, 0]} castShadow><sphereGeometry args={[0.16, 14, 12]} /><meshStandardMaterial color="#e2b48a" /></mesh>
        </group>
      ))}
      {Array.from({ length: 10 }, (_, i) => (
        <mesh key={i} position={[5.2, 0.16 + i * 0.32, -3.2 + i * 0.32]} castShadow><boxGeometry args={[1.2, 0.08, 0.34]} /><meshStandardMaterial color="#8a939c" metalness={0.6} /></mesh>
      ))}
      <group position={[0, h + 4.6, -3.6]} rotation={[0, Math.PI, 0]}>
        <mesh><boxGeometry args={[6.7, 3.5, 0.1]} /><meshStandardMaterial color="#111" /></mesh>
        <VideoWall />
      </group>
      <FloorLabel text="SALA DE CONTROL" position={[0, h + 3.3, -3.62]} height={0.38} rotation={[0, Math.PI, 0]} />
    </group>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
export function Plant() {
  const cep = STATIONS[0];
  const [px] = PALLETIZER.pallet;
  const palCx = 40.6, palLx = 12, palGapZ = -11.25;
  return (
    <group>
      <Building />
      <Luminaires />
      <AgvLanes />
      {/* Celdas robóticas con vallado de seguridad (BAR: la cabina hace de cerramiento) */}
      {CELLS.map((c) => (
        <group key={c.id}>
          <SafetyZone x={c.x} z={LINE_Z} lx={CELL_LEN} lz={CELL_W} color={c.color} label={c.name.toUpperCase()} />
          {c.id !== 'BAR' && (
            <Fence cx={c.x} cz={LINE_Z} lx={CELL_LEN} lz={CELL_W} tint={c.id === 'CNC' ? '#d0743a' : '#5b6670'}
              gaps={[['w', -1.3, 1.3], ['e', -1.3, 1.3], ['s', 3.5, 5.5]]} />
          )}
          <CellEquipment cell={c} />
          <HangingSign text={`${c.id} · ${c.name}`} position={[c.x, 7.4, LINE_Z + CELL_W / 2]} />
        </group>
      ))}
      {/* Cepillado (máquina carenada, sin robots) */}
      <SafetyZone x={cep.x - 1.5} z={LINE_Z} lx={12} lz={CELL_W} color={cep.color} label="CEPILLADO Y MOLDURADO" />
      <Planer x={cep.x} />
      <HangingSign text="CEP · Cepillado y moldurado" position={[cep.x - 1.5, 7.4, LINE_Z + CELL_W / 2]} />
      {/* Paletizado: vallado con cortina fotoeléctrica para la carretilla AGV */}
      <SafetyZone x={palCx} z={LINE_Z} lx={palLx} lz={CELL_W} color="#c4793a" label="PALETIZADO" />
      <Fence cx={palCx} cz={LINE_Z} lx={palLx} lz={CELL_W} gaps={[['w', -1.3, 1.3], ['s', px - palCx - 1, px - palCx + 1], ['s', 3.4, 5.4]]}
        curtains={[[px - palCx, CELL_W / 2]]} />
      <HangingSign text="PAL · Paletizado y enfardado" position={[palCx, 7.4, palGapZ]} />
      <Kiln />
      <DustSystem />
      <Dock />
      <ControlRoom />
      {/* Rótulos de suelo de las zonas logísticas */}
      <FloorLabel text="PATIO DE TRONCOS" position={[(LOG_YARD.x0 + LOG_YARD.x1) / 2, 0.012, 13.2]} height={0.9} color="#5a4330" />
      <FloorLabel text="ASERRADERO" position={[-33, 0.012, 23.4]} height={0.9} color="#5a4330" />
      <FloorLabel text="ALMACÉN DE PRODUCTO TERMINADO" position={[36, 0.012, 22.2]} height={0.8} color="#2f6db0" />
      <FloorLabel text="PASILLO AGV · SENTIDO ÚNICO" position={[0, 0.012, 0]} height={0.7} color="#2f8cff" />
    </group>
  );
}
