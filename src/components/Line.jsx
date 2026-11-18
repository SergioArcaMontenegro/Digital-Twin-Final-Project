import { useLayoutEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { STATIONS, LINE_Y, LINE_Z, LINE_X0, LINE_X1, ENTRY_X, OUT_X, TRAY_H, PANEL, CABINET, TRANSFER_TIME } from '../sim/layout';
import { engine } from '../sim/engine';

const smooth = (t) => t * t * (3 - 2 * t);
const stationX = (i) => (i < 0 ? ENTRY_X : i >= STATIONS.length ? OUT_X : STATIONS[i].x);

export const WOOD = { rough: '#7d5c3e', planed: '#d6b585', sanded: '#e9d1a4', raw: '#e2c497' };

// ═════════════════════════════════════════════════════════════════════════════
// Transportador de rodillos motorizados
// ═════════════════════════════════════════════════════════════════════════════
const PITCH = 0.45;

export function RollerConveyor() {
  const rollers = useRef(null);
  const legs = useRef(null);
  const len = LINE_X1 - LINE_X0;
  const nR = Math.floor(len / PITCH);
  const legXs = useMemo(() => Array.from({ length: Math.floor(len / 2.5) + 1 }, (_, i) => LINE_X0 + i * 2.5), [len]);

  useLayoutEffect(() => {
    const m = new THREE.Matrix4();
    const rot = new THREE.Matrix4().makeRotationX(Math.PI / 2);
    for (let i = 0; i < nR; i++) {
      m.makeTranslation(LINE_X0 + (i + 0.5) * PITCH, LINE_Y - 0.045, LINE_Z).multiply(rot);
      rollers.current.setMatrixAt(i, m);
    }
    rollers.current.instanceMatrix.needsUpdate = true;
    let k = 0;
    for (const x of legXs) for (const dz of [-0.5, 0.5]) {
      m.makeTranslation(x, (LINE_Y - 0.1) / 2, LINE_Z + dz);
      legs.current.setMatrixAt(k++, m);
    }
    legs.current.instanceMatrix.needsUpdate = true;
  }, [nR, legXs]);

  return (
    <group>
      <instancedMesh ref={rollers} args={[null, null, nR]} castShadow receiveShadow>
        <cylinderGeometry args={[0.045, 0.045, 0.98, 14]} />
        <meshStandardMaterial color="#9aa1a8" metalness={0.9} roughness={0.3} />
      </instancedMesh>
      <instancedMesh ref={legs} args={[null, null, legXs.length * 2]} castShadow>
        <boxGeometry args={[0.07, LINE_Y - 0.1, 0.07]} />
        <meshStandardMaterial color="#3b3f45" metalness={0.6} roughness={0.5} />
      </instancedMesh>
      {[-0.54, 0.54].map((dz) => (
        <mesh key={dz} position={[(LINE_X0 + LINE_X1) / 2, LINE_Y - 0.06, LINE_Z + dz]} castShadow receiveShadow>
          <boxGeometry args={[len, 0.14, 0.06]} />
          <meshStandardMaterial color="#2f6db0" metalness={0.4} roughness={0.5} />
        </mesh>
      ))}
      {/* Topes de estación y lectores RFID de bandeja */}
      {STATIONS.map((s) => (
        <group key={s.id} position={[s.x - 1.05, LINE_Y, LINE_Z]}>
          <mesh position={[0, 0.03, 0]} castShadow><boxGeometry args={[0.06, 0.08, 0.4]} /><meshStandardMaterial color="#d22" /></mesh>
          <mesh position={[0.3, -0.02, 0.58]}><boxGeometry args={[0.12, 0.1, 0.06]} /><meshStandardMaterial color="#222" emissive="#0a4" emissiveIntensity={0.6} /></mesh>
        </group>
      ))}
    </group>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// Módulo de mueble (también lo usan el paletizador, el almacén y el camión)
// ═════════════════════════════════════════════════════════════════════════════
export function Cabinet({ color = WOOD.raw, gloss = false, material = null }) {
  const { lx, ly, lz } = CABINET;
  const own = useMemo(() => new THREE.MeshStandardMaterial({ color, roughness: gloss ? 0.25 : 0.7, metalness: gloss ? 0.12 : 0 }), [color, gloss]);
  const mat = material ?? own;
  return (
    <group>
      <mesh position={[0, ly / 2, 0]} material={mat} castShadow receiveShadow>
        <boxGeometry args={[lx, ly, lz]} />
      </mesh>
      <mesh position={[0, ly / 2, lz / 2 + 0.003]}>
        <planeGeometry args={[lx - 0.05, ly - 0.05]} />
        <meshStandardMaterial color="#000" transparent opacity={0.08} />
      </mesh>
      <mesh position={[0, ly / 2, lz / 2 + 0.006]}><boxGeometry args={[0.004, ly - 0.08, 0.002]} /><meshBasicMaterial color="#2a1a10" /></mesh>
      {[-0.05, 0.05].map((x) => (
        <mesh key={x} position={[x, ly * 0.55, lz / 2 + 0.02]}><cylinderGeometry args={[0.012, 0.012, 0.03, 10]} /><meshStandardMaterial color="#c9ced3" metalness={1} roughness={0.3} /></mesh>
      ))}
    </group>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// Pieza en la línea (bandeja + tablero/módulo según la fase)
// ═════════════════════════════════════════════════════════════════════════════
function Tray() {
  return (
    <group>
      <mesh position={[0, TRAY_H / 2, 0]} castShadow receiveShadow>
        <boxGeometry args={[1.85, TRAY_H, 0.92]} />
        <meshStandardMaterial color="#5a6169" metalness={0.6} roughness={0.45} />
      </mesh>
      {[-0.7, 0.7].map((x) => (
        <mesh key={x} position={[x, TRAY_H + 0.012, 0]}><boxGeometry args={[0.06, 0.024, 0.8]} /><meshStandardMaterial color="#1c1c1c" roughness={0.9} /></mesh>
      ))}
    </group>
  );
}

function PieceSlot({ slot }) {
  const group = useRef(null);
  const panelMat = useMemo(() => new THREE.MeshStandardMaterial({ color: WOOD.rough, roughness: 0.95 }), []);
  const cabMat = useMemo(() => new THREE.MeshStandardMaterial({ color: WOOD.raw, roughness: 0.7 }), []);
  const P = useRef({});
  const tmp = useMemo(() => ({ a: new THREE.Color(), b: new THREE.Color() }), []);

  useFrame(() => {
    const ps = [...engine.pieces].sort((a, b) => a.uid - b.uid);
    const piece = ps[slot];
    const g = group.current;
    if (!piece) { g.visible = false; return; }
    g.visible = true;
    const L = engine.line;
    const x = L.phase === 'TRANSFER'
      ? stationX(piece.from) + (stationX(piece.from + 1) - stationX(piece.from)) * smooth(Math.min(1, L.t / TRANSFER_TIME))
      : stationX(piece.station);
    g.position.set(x, LINE_Y, LINE_Z);

    const working = L.phase === 'WORK' && piece.station >= 0 && piece.station < STATIONS.length;
    const at = working ? piece.station : -9;
    const p = working ? engine.cellProgress(STATIONS[piece.station].id) : 0;
    const st = piece.stage;
    const parts = P.current;

    // Tablero: en bruto → cepillado → lijado
    let c;
    if (st < 0 && at !== 0) c = tmp.a.set(WOOD.rough);
    else if (at === 0) c = tmp.a.set(WOOD.rough).lerp(tmp.b.set(WOOD.planed), smooth(p));
    else if (st < 2 && at !== 2) c = tmp.a.set(WOOD.planed);
    else if (at === 2) c = tmp.a.set(WOOD.planed).lerp(tmp.b.set(WOOD.sanded), smooth(p));
    else c = tmp.a.set(WOOD.sanded);
    panelMat.color.copy(c);
    panelMat.roughness = st >= 2 || (at === 2 && p > 0.5) ? 0.55 : st >= 0 || (at === 0 && p > 0.5) ? 0.75 : 0.98;

    // Mecanizado CNC: ranura del perfil y taladros aparecen con el progreso
    const cnc = st >= 1 ? 1 : at === 1 ? p : 0;
    parts.groove.forEach((m, i) => { m.visible = cnc > (i + 0.5) / parts.groove.length; });
    parts.holes.forEach((m, i) => { m.visible = cnc > 0.55 + i * 0.1; });

    // Ensamblaje: el tablero pasa a ser la base del módulo y se montan laterales, trasera y techo
    const asm = st >= 3 ? 1 : at === 3 ? p : 0;
    const assembled = asm >= 0.98;
    parts.panel.visible = asm < 0.98;
    parts.cabParts.forEach((m, i) => { m.visible = !assembled && asm > (i + 0.4) / parts.cabParts.length; });
    parts.cabinet.visible = assembled;

    // Barnizado: tono del lote y brillo
    if (st >= 4) { cabMat.color.set(piece.color); cabMat.roughness = 0.25; }
    else if (at === 4) { cabMat.color.copy(tmp.a.set(WOOD.sanded).lerp(tmp.b.set(piece.color), smooth(p))); cabMat.roughness = 0.7 - 0.45 * p; }
    else { cabMat.color.set(WOOD.sanded); cabMat.roughness = 0.7; }
  });

  const { lx, ly, lz } = PANEL;
  const C = CABINET;
  const reg = (key) => (r) => { if (r) P.current[key] = r; };
  const regList = (key) => (r) => { P.current[key] = r ? r.children : []; };
  return (
    <group ref={group}>
      <Tray />
      <group position={[0, TRAY_H, 0]}>
        <group ref={reg('panel')}>
          <mesh position={[0, ly / 2, 0]} material={panelMat} castShadow receiveShadow>
            <boxGeometry args={[lx, ly, lz]} />
          </mesh>
          <group ref={regList('groove')}>
            {[[0, lz / 2 - 0.06, lx - 0.12, 0.012], [0, -lz / 2 + 0.06, lx - 0.12, 0.012], [lx / 2 - 0.06, 0, 0.012, lz - 0.12], [-lx / 2 + 0.06, 0, 0.012, lz - 0.12]].map(([x, z, w, d], i) => (
              <mesh key={i} position={[x, ly + 0.001, z]}><boxGeometry args={[w, 0.003, d]} /><meshBasicMaterial color="#6b4a2e" /></mesh>
            ))}
          </group>
          <group ref={regList('holes')}>
            {[-0.55, -0.25, 0.25, 0.55].map((x) => (
              <mesh key={x} position={[x, ly + 0.001, 0.2]} rotation={[-Math.PI / 2, 0, 0]}><circleGeometry args={[0.018, 14]} /><meshBasicMaterial color="#3a2616" /></mesh>
            ))}
          </group>
        </group>
        {/* Piezas del módulo apareciendo durante el ensamblaje */}
        <group ref={regList('cabParts')}>
          <mesh position={[0, 0.009, 0]} castShadow><boxGeometry args={[C.lx, 0.018, C.lz]} /><meshStandardMaterial color={WOOD.sanded} roughness={0.6} /></mesh>
          <mesh position={[-C.lx / 2 + 0.009, C.ly / 2, 0]} castShadow><boxGeometry args={[0.018, C.ly, C.lz]} /><meshStandardMaterial color={WOOD.sanded} roughness={0.6} /></mesh>
          <mesh position={[C.lx / 2 - 0.009, C.ly / 2, 0]} castShadow><boxGeometry args={[0.018, C.ly, C.lz]} /><meshStandardMaterial color={WOOD.sanded} roughness={0.6} /></mesh>
          <mesh position={[0, C.ly / 2, -C.lz / 2 + 0.006]} castShadow><boxGeometry args={[C.lx, C.ly, 0.012]} /><meshStandardMaterial color={WOOD.sanded} roughness={0.6} /></mesh>
          <mesh position={[0, C.ly - 0.009, 0]} castShadow><boxGeometry args={[C.lx, 0.018, C.lz]} /><meshStandardMaterial color={WOOD.sanded} roughness={0.6} /></mesh>
        </group>
        <group ref={reg('cabinet')}>
          <Cabinet material={cabMat} />
        </group>
      </group>
    </group>
  );
}

export function LinePieces() {
  return Array.from({ length: STATIONS.length + 2 }, (_, i) => <PieceSlot key={i} slot={i} />);
}
