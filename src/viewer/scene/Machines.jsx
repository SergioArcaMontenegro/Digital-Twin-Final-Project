// ─────────────────────────────────────────────────────────────────────────────
// Maquinaria y logística de cada zona, en coordenadas LOCALES de la zona.
// Lo dinámico se lee en cada fotograma de la última instantánea (live.tick) y se
// interpola con la anterior para que el movimiento sea suave.
// ─────────────────────────────────────────────────────────────────────────────
import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { ZONES, PIECE_Y } from '../../../shared/zones.js';
import { SPECIES, PRODUCTS, BOARDS_PER_LOG, LAYERS_PER_STACK } from '../../../shared/config.js';
import { PALLET_PATTERN, PALLET_TOP, DIMS, woodColor } from '../../../shared/products.js';
import { pileSlot, truckSlot, PILE_CAP, TRUCK_LOGS } from '../../../shared/sim/logistics.js';
import { live } from '../../net/client.js';
import { tickAlpha, lerp } from '../clock.js';
import { useRobotModel, applyJoints } from '../../components/robotCommon';
import { buildProduct, poseFinished } from './products3d.js';
import { steel, FloorLabel } from './common.jsx';

const LOG_LEN = 4.2, LOG_R = 0.28;
const yellow = { color: '#f2b705', metalness: 0.35, roughness: 0.5 };
const MAT = {
  sticker: new THREE.MeshStandardMaterial({ color: '#6d5338', roughness: 0.9 }),
  pallet: new THREE.MeshStandardMaterial({ color: '#b48a57', roughness: 0.9 }),
  film: new THREE.MeshStandardMaterial({ color: '#dfe9f0', transparent: true, opacity: 0.4, roughness: 0.2, metalness: 0.1, depthWrite: false }),
};
const speciesMat = {};
const sMat = (species, kind) => {
  const k = `${species}|${kind}`;
  if (!speciesMat[k]) {
    const S = SPECIES[species] || SPECIES.pino;
    const color = kind === 'bark' ? S.bark : kind === 'end' ? S.end : kind === 'green' ? woodColor(species, 'rough') : woodColor(species, 'planed');
    speciesMat[k] = new THREE.MeshStandardMaterial({ color, roughness: kind === 'bark' ? 1 : 0.85 });
  }
  return speciesMat[k];
};
const LOG_GEO = new THREE.CylinderGeometry(LOG_R, LOG_R * 1.05, LOG_LEN, 16).rotateZ(Math.PI / 2);
const BOARD_GEO = new THREE.BoxGeometry(LOG_LEN, 0.05, 0.17);
const BOX = new THREE.BoxGeometry(1, 1, 1);

const L = () => live.tick?.logistics;
const LP = () => live.prev?.logistics;
/** Interpola un número de la logística entre la instantánea anterior y la actual. */
function ip(get, def = 0) {
  const a = LP(), b = L();
  if (!b) return def;
  const vb = get(b);
  if (!a) return vb;
  const va = get(a);
  return typeof va === 'number' && typeof vb === 'number' ? lerp(va, vb, tickAlpha()) : vb;
}

// ═════════════════════════════════════════════════════════════════════════════
// Troncos, tablas y pilas
// ═════════════════════════════════════════════════════════════════════════════
function setLogMat(mesh, species) { mesh.material = [sMat(species, 'bark'), sMat(species, 'end'), sMat(species, 'end')]; }
function Log({ species = 'pino', ...props }) {
  return <mesh geometry={LOG_GEO} material={[sMat(species, 'bark'), sMat(species, 'end'), sMat(species, 'end')]} castShadow receiveShadow {...props} />;
}
function BoardLayer({ species = 'pino', dry = false, ...props }) {
  const m = sMat(species, dry ? 'dry' : 'green');
  return (
    <group {...props}>
      {Array.from({ length: BOARDS_PER_LOG }, (_, i) => (
        <mesh key={i} geometry={BOARD_GEO} material={m} position={[0, 0.025, (i - 2.5) * 0.2]} castShadow receiveShadow />
      ))}
    </group>
  );
}

/** Pila de tablas imperativa (capas visibles y especie cambiantes). */
function useStack(layers = LAYERS_PER_STACK) {
  return useMemo(() => {
    const g = new THREE.Group();
    const boards = [];
    for (let l = 0; l < layers; l++) {
      for (const x of [-1.7, 0, 1.7]) { const s = new THREE.Mesh(BOX, MAT.sticker); s.scale.set(0.05, 0.025, 1.25); s.position.set(x, l * 0.13 + 0.0125, 0); g.add(s); s.userData.layer = l; }
      for (let i = 0; i < BOARDS_PER_LOG; i++) {
        const b = new THREE.Mesh(BOARD_GEO, sMat('pino', 'green'));
        b.position.set(0, l * 0.13 + 0.05, (i - 2.5) * 0.2); b.castShadow = true; b.receiveShadow = true;
        b.userData.layer = l; g.add(b); boards.push(b);
      }
    }
    const set = (n, species, dry) => {
      const m = sMat(species || 'pino', dry ? 'dry' : 'green');
      for (const c of g.children) c.visible = c.userData.layer < n;
      for (const b of boards) b.material = m;
    };
    return { group: g, set };
  }, [layers]);
}
function StackStand({ x, z, rot = 0 }) {
  return (
    <group position={[x, 0, z]} rotation={[0, rot, 0]}>
      {[-0.7, 0.7].map((dz) => (
        <group key={dz}>
          <mesh position={[0, 0.41, dz]} castShadow><boxGeometry args={[4.0, 0.08, 0.12]} /><meshStandardMaterial {...steel} /></mesh>
          {[-1.8, 1.8].map((dx) => <mesh key={dx} position={[dx, 0.2, dz]}><boxGeometry args={[0.1, 0.4, 0.1]} /><meshStandardMaterial {...steel} /></mesh>)}
        </group>
      ))}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.006, 0]}><planeGeometry args={[4.4, 1.9]} /><meshBasicMaterial color="#f2c230" transparent opacity={0.35} /></mesh>
    </group>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// ASE · patio de troncos, pórtico de troncos, sierra de cinta y pórtico apilador
// ═════════════════════════════════════════════════════════════════════════════
function LogPiles() {
  const G = ZONES.ASE.geo;
  const root = useRef(null);
  const meshes = useMemo(() => {
    const out = {};
    for (const sp of Object.keys(G.pileZ)) out[sp] = Array.from({ length: PILE_CAP }, (_, i) => pileSlot(sp, i));
    return out;
  }, [G]);
  useFrame(() => {
    const lg = L(); if (!lg || !root.current) return;
    root.current.children.forEach((grp) => {
      const n = Math.min(PILE_CAP, lg.yard[grp.userData.sp] || 0);
      grp.children.forEach((m, i) => { m.visible = i < n; });
    });
  });
  return (
    <group>
      <group ref={root}>
        {Object.entries(meshes).map(([sp, slots]) => (
          <group key={sp} userData={{ sp }}>{slots.map((p, i) => <Log key={i} species={sp} position={p} />)}</group>
        ))}
      </group>
      {Object.entries(G.pileZ).map(([sp, z]) => (
        <group key={sp}>
          <mesh rotation={[-Math.PI / 2, 0, 0]} position={[G.pileX, 0.006, z]}><planeGeometry args={[LOG_LEN + 0.6, 3.0]} /><meshStandardMaterial color="#8c7b62" roughness={1} /></mesh>
          <FloorLabel text={SPECIES[sp].name.toUpperCase()} position={[G.pileX - LOG_LEN / 2 - 1.1, 0.012, z]} height={0.42} color="#5a4330" rotation={[-Math.PI / 2, 0, Math.PI / 2]} />
        </group>
      ))}
    </group>
  );
}

function LogTruck() {
  const G = ZONES.ASE.geo.truck;
  const g = useRef(null), logs = useRef(null);
  useFrame(() => {
    const lg = L(); if (!lg || !g.current) return;
    const T = lg.logTruck;
    g.current.visible = T.state !== 'NONE';
    g.current.position.x = ip((s) => s.logTruck.x);
    logs.current.children.forEach((m, i) => { m.visible = i < T.logs.length; if (m.visible) setLogMat(m, T.logs[i]); });
  });
  const bay = (G.x0 + G.x1) / 2;
  return (
    <group ref={g} position={[bay, 0, G.z]}>
      <group position={[-bay, 0, -G.z]}>
        <group ref={logs}>{Array.from({ length: TRUCK_LOGS }, (_, i) => <Log key={i} position={truckSlot(i)} />)}</group>
      </group>
      <mesh position={[0, 1.15, 0]} castShadow receiveShadow><boxGeometry args={[10.5, 0.2, 2.4]} /><meshStandardMaterial color="#555" /></mesh>
      {[-4, -1.5, 1, 3.5].map((x) => <mesh key={x} position={[x, 1.6, 0]}><boxGeometry args={[0.1, 1.0, 2.5]} /><meshStandardMaterial color="#3b3f45" /></mesh>)}
      {[-3.6, -2.4, 3.2].map((x) => [-1.05, 1.05].map((z) => (
        <mesh key={`${x}${z}`} position={[x, 0.5, z]} rotation={[Math.PI / 2, 0, 0]} castShadow><cylinderGeometry args={[0.5, 0.5, 0.3, 20]} /><meshStandardMaterial color="#151515" /></mesh>
      )))}
      <group position={[6.6, 0, 0]}>
        <mesh position={[0, 1.7, 0]} castShadow><boxGeometry args={[2.4, 2.6, 2.5]} /><meshStandardMaterial color="#2f6b4f" metalness={0.3} roughness={0.4} /></mesh>
        <mesh position={[1.21, 2.3, 0]} rotation={[0, Math.PI / 2, 0]}><planeGeometry args={[2.1, 0.9]} /><meshStandardMaterial color="#9cc7e0" /></mesh>
        {[-1.05, 1.05].map((z) => <mesh key={z} position={[0.3, 0.5, z]} rotation={[Math.PI / 2, 0, 0]}><cylinderGeometry args={[0.5, 0.5, 0.3, 20]} /><meshStandardMaterial color="#151515" /></mesh>)}
      </group>
    </group>
  );
}

function Claw({ side, refCb }) {
  return (
    <group ref={refCb} position={[0, -0.15, side * 0.18]}>
      {[-1.2, 1.2].map((x) => (
        <mesh key={x} position={[x, -0.3, side * 0.12]} castShadow><torusGeometry args={[0.42, 0.045, 8, 16, Math.PI / 2]} /><meshStandardMaterial {...yellow} /></mesh>
      ))}
      <mesh castShadow><boxGeometry args={[2.6, 0.08, 0.08]} /><meshStandardMaterial {...steel} /></mesh>
    </group>
  );
}

function LogGantry() {
  const G = ZONES.ASE.geo.logGantry, z0 = -G.z, z1 = G.z;
  const bridge = useRef(null), trolley = useRef(null), head = useRef(null), cable = useRef(null), log = useRef(null);
  const claws = useRef([]);
  const cols = useMemo(() => { const out = []; for (let x = G.x0; x <= G.x1 + 0.01; x += 5) out.push(x); return out; }, [G]);
  useFrame(() => {
    const lg = L(); if (!lg || !bridge.current) return;
    bridge.current.position.x = ip((s) => s.logGantry.x);
    trolley.current.position.z = ip((s) => s.logGantry.z);
    const y = ip((s) => s.logGantry.y, 6);
    head.current.position.set(0, y - G.railY, 0);
    const len = G.railY - 0.3 - y;
    cable.current.scale.y = Math.max(0.05, len);
    cable.current.position.y = -0.3 - len / 2;
    const open = (1 - ip((s) => s.logGantry.claw)) * 0.75;
    if (claws.current[0]) claws.current[0].rotation.x = -open;
    if (claws.current[1]) claws.current[1].rotation.x = open;
    log.current.visible = !!lg.logGantry.carrying;
    if (lg.logGantry.carrying) setLogMat(log.current, lg.logGantry.carrying);
  });
  return (
    <group>
      {[z0, z1].map((z) => (
        <group key={z}>
          <mesh position={[(G.x0 + G.x1) / 2, G.railY, z]} castShadow><boxGeometry args={[G.x1 - G.x0 + 1, 0.5, 0.4]} /><meshStandardMaterial {...yellow} /></mesh>
          {cols.map((x) => <mesh key={x} position={[x, G.railY / 2, z]} castShadow><boxGeometry args={[0.4, G.railY, 0.4]} /><meshStandardMaterial {...steel} /></mesh>)}
        </group>
      ))}
      <group ref={bridge} position={[-10, G.railY + 0.45, 0]}>
        <mesh castShadow><boxGeometry args={[0.7, 0.8, z1 - z0 + 0.6]} /><meshStandardMaterial {...yellow} /></mesh>
        {[z0, z1].map((z) => <mesh key={z} position={[0, -0.2, z]} castShadow><boxGeometry args={[2.2, 0.4, 0.6]} /><meshStandardMaterial color="#333" /></mesh>)}
        <group ref={trolley} position={[0, -0.45, 0]}>
          <mesh position={[0, 0.55, 0]} castShadow><boxGeometry args={[1.4, 0.6, 1.2]} /><meshStandardMaterial color="#3b3f45" /></mesh>
          <mesh ref={cable}><boxGeometry args={[0.04, 1, 0.5]} /><meshStandardMaterial color="#222" /></mesh>
          <group ref={head}>
            <mesh castShadow><boxGeometry args={[2.8, 0.3, 0.5]} /><meshStandardMaterial {...yellow} /></mesh>
            <Claw side={-1} refCb={(r) => { claws.current[0] = r; }} />
            <Claw side={1} refCb={(r) => { claws.current[1] = r; }} />
            <mesh ref={log} geometry={LOG_GEO} position={[0, -0.45, 0]} castShadow />
          </group>
        </group>
      </group>
    </group>
  );
}

function Sawmill() {
  const S = ZONES.ASE.geo.saw;
  const log = useRef(null), carriage = useRef(null), wheels = useRef([]), boards = useRef(null);
  const boardMat = useRef(null);
  useFrame((_, dt) => {
    const lg = L(); if (!lg || !log.current) return;
    const cut = lg.saw.state === 'CUT';
    const sp = cut ? lg.saw.species : lg.deck;
    log.current.visible = !!sp;
    if (sp) setLogMat(log.current, sp);
    const x = cut ? ip((s) => s.saw.logX) : S.deckX;
    log.current.position.x = x;
    carriage.current.position.x = x;
    wheels.current.forEach((w) => { if (w) w.rotation.z += dt * (cut ? 18 : 2); });
    boards.current.visible = !!lg.outfeed;
    if (lg.outfeed) boards.current.children.forEach((m) => { m.material = sMat(lg.outfeed, 'green'); });
  });
  const y = S.y, z = S.z;
  return (
    <group>
      <mesh position={[S.deckX, y / 2, z]} castShadow receiveShadow><boxGeometry args={[6, y, 2.2]} /><meshStandardMaterial color="#3c4249" metalness={0.5} roughness={0.5} /></mesh>
      {[-0.7, 0, 0.7].map((dz) => <mesh key={dz} position={[S.deckX, y + 0.01, z + dz]}><boxGeometry args={[6, 0.02, 0.08]} /><meshStandardMaterial color="#111" /></mesh>)}
      {[-0.5, 0.5].map((dz) => <mesh key={dz} position={[(S.deckX + S.outX) / 2, 0.06, z + dz]}><boxGeometry args={[S.outX - S.deckX + 6, 0.12, 0.12]} /><meshStandardMaterial {...steel} /></mesh>)}
      <group ref={carriage} position={[S.deckX, 0, z]}>
        <mesh position={[0, y - 0.2, 0]} castShadow><boxGeometry args={[4.6, 0.25, 1.4]} /><meshStandardMaterial color="#2f6db0" metalness={0.4} roughness={0.5} /></mesh>
        {[-1.6, 0, 1.6].map((dx) => <mesh key={dx} position={[dx, y + 0.2, -0.45]} castShadow><boxGeometry args={[0.15, 0.6, 0.12]} /><meshStandardMaterial color="#d23b2a" /></mesh>)}
      </group>
      <mesh ref={log} geometry={LOG_GEO} position={[S.deckX, y + LOG_R, z]} castShadow />
      <group position={[S.headX, 0, z + 1.6]}>
        <mesh position={[0, 2.2, 0.4]} castShadow><boxGeometry args={[0.8, 4.4, 0.6]} /><meshStandardMaterial color="#6b7a3a" metalness={0.3} roughness={0.6} /></mesh>
        {[0.95, 3.6].map((wy, i) => (
          <group key={wy} position={[0, wy, -0.05]}>
            <mesh ref={(r) => { wheels.current[i] = r; }} rotation={[Math.PI / 2, 0, 0]} castShadow><cylinderGeometry args={[0.95, 0.95, 0.18, 32]} /><meshStandardMaterial color="#9aa3ab" metalness={0.8} roughness={0.3} /></mesh>
            <mesh position={[0, 0, -0.1]}><boxGeometry args={[2.1, 0.12, 0.02]} /><meshStandardMaterial color="#333" /></mesh>
          </group>
        ))}
        <mesh position={[0, 2.3, -1.55]}><boxGeometry args={[0.02, 2.7, 0.08]} /><meshStandardMaterial color="#e8eef3" metalness={1} roughness={0.15} /></mesh>
        <mesh position={[0, 2.3, -0.8]} castShadow><boxGeometry args={[2.2, 4.9, 0.12]} /><meshStandardMaterial color="#f2b705" transparent opacity={0.55} /></mesh>
      </group>
      <mesh position={[S.outX, y / 2, z]} castShadow receiveShadow><boxGeometry args={[6, y, 2.2]} /><meshStandardMaterial color="#3c4249" metalness={0.5} roughness={0.5} /></mesh>
      <group ref={boards} position={[S.outX, y, z]}>
        {Array.from({ length: BOARDS_PER_LOG }, (_, i) => <mesh key={i} ref={boardMat} geometry={BOARD_GEO} position={[0, 0.025, (i - 2.5) * 0.2]} castShadow />)}
      </group>
    </group>
  );
}

function StackerGantry() {
  const S = ZONES.ASE.geo.stacker;
  const bridge = useRef(null), trolley = useRef(null), mast = useRef(null), beam = useRef(null), layer = useRef(null);
  useFrame(() => {
    const lg = L(); if (!lg || !bridge.current) return;
    bridge.current.position.x = ip((s) => s.stacker.x);
    trolley.current.position.z = ip((s) => s.stacker.z);
    const y = ip((s) => s.stacker.y, 3.6);
    beam.current.position.y = y - S.railY;
    const len = S.railY - 0.2 - y;
    mast.current.scale.y = Math.max(0.1, len);
    mast.current.position.y = -0.2 - len / 2;
    layer.current.visible = !!lg.stacker.carrying;
    if (lg.stacker.carrying) layer.current.children.forEach((m) => { m.material = sMat(lg.stacker.carrying, 'green'); });
  });
  return (
    <group>
      {[S.z0, S.z1].map((z) => (
        <group key={z}>
          <mesh position={[(S.x0 + S.x1) / 2, S.railY, z]} castShadow><boxGeometry args={[S.x1 - S.x0, 0.35, 0.3]} /><meshStandardMaterial color="#2f6db0" metalness={0.4} roughness={0.5} /></mesh>
          {[S.x0, (S.x0 + S.x1) / 2, S.x1].map((x) => <mesh key={x} position={[x, S.railY / 2, z]} castShadow><boxGeometry args={[0.3, S.railY, 0.3]} /><meshStandardMaterial {...steel} /></mesh>)}
        </group>
      ))}
      <group ref={bridge} position={[12, S.railY + 0.3, 0]}>
        <mesh position={[0, 0, (S.z0 + S.z1) / 2]} castShadow><boxGeometry args={[0.45, 0.45, S.z1 - S.z0 + 0.4]} /><meshStandardMaterial color="#2f6db0" metalness={0.4} roughness={0.5} /></mesh>
        <group ref={trolley} position={[0, -0.3, 0]}>
          <mesh position={[0, 0.3, 0]} castShadow><boxGeometry args={[0.9, 0.4, 0.8]} /><meshStandardMaterial color="#3b3f45" /></mesh>
          <mesh ref={mast} castShadow><boxGeometry args={[0.22, 1, 0.22]} /><meshStandardMaterial {...steel} /></mesh>
          <group ref={beam}>
            <mesh castShadow><boxGeometry args={[4.4, 0.14, 0.2]} /><meshStandardMaterial {...yellow} /></mesh>
            {[-1.8, -0.9, 0, 0.9, 1.8].map((x) => [-0.42, 0.42].map((dz) => (
              <mesh key={`${x}${dz}`} position={[x, -0.1, dz]}><cylinderGeometry args={[0.06, 0.04, 0.06, 14]} /><meshStandardMaterial color="#141414" /></mesh>
            )))}
            <group ref={layer} position={[0, -0.23, 0]}>
              {Array.from({ length: BOARDS_PER_LOG }, (_, i) => <mesh key={i} geometry={BOARD_GEO} position={[0, 0, (i - 2.5) * 0.2]} castShadow />)}
            </group>
          </group>
        </group>
      </group>
    </group>
  );
}

function GreenPad() {
  const [px, pz] = ZONES.ASE.geo.pad;
  const st = useStack();
  useFrame(() => { const lg = L(); if (lg) st.set(lg.greenPad.layers, lg.greenPad.species, false); });
  return (
    <group>
      <StackStand x={px} z={pz} />
      <primitive object={st.group} position={[px, 0.45, pz]} />
    </group>
  );
}

export function SawZone() {
  return (
    <group>
      <LogPiles />
      <LogTruck />
      <LogGantry />
      <Sawmill />
      <StackerGantry />
      <GreenPad />
    </group>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// KILN · secadero con puertas enrollables y pilas dentro (cámara en corte)
// ═════════════════════════════════════════════════════════════════════════════
export function KilnZone() {
  const G = ZONES.KILN.geo;
  const [x0, z0, x1, z1] = G.chamber;
  const H = G.height, cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
  const dIn = useRef(null), dOut = useRef(null);
  // 12 huecos: 6 columnas × 2 filas, pilas orientadas en Z (como entran los AGV)
  const slots = useMemo(() => { const out = []; for (let r = 0; r < 2; r++) for (let c = 0; c < 6; c++) out.push([x0 + 1.5 + c * 2.6, z0 + 2.6 + r * 5]); return out; }, [x0, z0]);
  const stacks = useMemo(() => slots.map(() => {
    const g = new THREE.Group();
    const b = new THREE.Mesh(BOX, sMat('pino', 'green'));
    b.scale.set(LOG_LEN, 0.78, 1.25); b.position.y = 0.45 + 0.39; b.castShadow = true;
    const tag = new THREE.Mesh(BOX, new THREE.MeshBasicMaterial({ color: '#3ddc84' }));
    tag.scale.set(0.5, 0.25, 0.02); tag.position.set(0, 1.45, 0.64);
    g.add(b, tag);
    g.userData = { b, tag };
    return g;
  }), [slots]);
  const panel = useMemo(() => {
    const canvas = document.createElement('canvas'); canvas.width = 512; canvas.height = 256;
    const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
    return { canvas, texture, last: 0 };
  }, []);
  useFrame(({ clock }) => {
    const lg = L(); if (!lg) return;
    const k = lg.kiln;
    const set = (r, v) => { if (r.current) { const h = 3.2 * Math.max(0.03, 1 - v); r.current.scale.y = h / 3.2; r.current.position.y = 3.2 - h / 2; } };
    set(dIn, ip((s) => s.kiln.doorIn)); set(dOut, ip((s) => s.kiln.doorOut));
    stacks.forEach((g, i) => {
      const s = k.stacks[i];
      g.visible = !!s;
      if (!s) return;
      g.userData.b.material = sMat(s.species, s.left > 0 ? 'green' : 'dry');
      g.userData.b.scale.y = 0.13 * Math.max(1, Math.round(s.boards / BOARDS_PER_LOG));
      g.userData.b.position.y = 0.45 + g.userData.b.scale.y / 2;
      g.userData.tag.material.color.set(s.left > 0 ? '#ffb020' : '#3ddc84');
    });
    if (clock.elapsedTime - panel.last > 1) {
      panel.last = clock.elapsedTime;
      const c = panel.canvas.getContext('2d');
      c.fillStyle = '#06121b'; c.fillRect(0, 0, 512, 256);
      c.fillStyle = '#39c0ff'; c.font = '700 34px Segoe UI, Arial'; c.fillText('SECADERO', 20, 46);
      c.fillStyle = '#e8eef3'; c.font = '600 26px Segoe UI, Arial';
      const drying = k.stacks.filter((s) => s.left > 0);
      c.fillText(`T 72 °C · HR ${(42 + 6 * Math.sin(clock.elapsedTime / 20)).toFixed(0)} %`, 20, 96);
      c.fillText(`Secando: ${drying.length} pilas`, 20, 140);
      c.fillStyle = '#3ddc84'; c.fillText(`Secas: ${k.stacks.length - drying.length}`, 20, 184);
      if (drying.length) { c.fillStyle = '#9fb6c8'; c.fillText(`Próxima en ${Math.ceil(Math.min(...drying.map((s) => s.left)) / 60)} min`, 20, 228); }
      panel.texture.needsUpdate = true;
    }
  });
  const glass = { color: '#cfd8de', transparent: true, opacity: 0.28, metalness: 0.2, roughness: 0.3, depthWrite: false, side: THREE.DoubleSide };
  return (
    <group>
      {/* cámara en corte: techo y laterales opacos, frente acristalado para ver las pilas */}
      <mesh position={[cx, H, cz]} castShadow><boxGeometry args={[x1 - x0, 0.2, z1 - z0]} /><meshStandardMaterial color="#dfe3e6" metalness={0.3} roughness={0.6} /></mesh>
      <mesh position={[cx, H / 2, z0]} receiveShadow><boxGeometry args={[x1 - x0, H, 0.2]} /><meshStandardMaterial color="#dfe3e6" metalness={0.3} roughness={0.6} /></mesh>
      {[x0, x1].map((x) => <mesh key={x} position={[x, H / 2, cz]} castShadow><boxGeometry args={[0.2, H, z1 - z0]} /><meshStandardMaterial color="#dfe3e6" metalness={0.3} roughness={0.6} /></mesh>)}
      <mesh position={[cx, H / 2 + 1.75, z1]}><boxGeometry args={[x1 - x0, H - 3.5, 0.1]} /><meshStandardMaterial {...glass} /></mesh>
      {stacks.map((g, i) => <primitive key={i} object={g} position={[slots[i][0], 0, slots[i][1]]} rotation={[0, Math.PI / 2, 0]} />)}
      {slots.map(([x, z], i) => <StackStand key={i} x={x} z={z} rot={Math.PI / 2} />)}
      {G.doors.map((dx, i) => (
        <group key={dx} position={[dx, 0, z1 + 0.05]}>
          <mesh position={[0, 3.45, 0]}><boxGeometry args={[3.2, 0.3, 0.3]} /><meshStandardMaterial color="#3b3f45" /></mesh>
          {[-1.5, 1.5].map((k) => <mesh key={k} position={[k, 1.7, 0]}><boxGeometry args={[0.15, 3.4, 0.2]} /><meshStandardMaterial color="#f2c230" /></mesh>)}
          <mesh ref={i ? dOut : dIn} position={[0, 1.6, 0.02]} castShadow><boxGeometry args={[2.8, 3.2, 0.08]} /><meshStandardMaterial color="#9aa3ab" metalness={0.5} roughness={0.5} /></mesh>
          <mesh position={[0, 0.003, 1.5]} rotation={[-Math.PI / 2, 0, 0]}><planeGeometry args={[3, 2.5]} /><meshBasicMaterial color={i ? '#3ddc84' : '#ffb020'} transparent opacity={0.25} /></mesh>
          <FloorLabel text={i ? 'SALIDA' : 'ENTRADA'} position={[0, 3.9, 0.1]} height={0.4} rotation={[0, 0, 0]} />
        </group>
      ))}
      {[-4, 4].map((x) => (
        <group key={x} position={[x, H, cz]}>
          <mesh position={[0, 0.4, 0]} castShadow><cylinderGeometry args={[0.9, 0.9, 0.8, 24]} /><meshStandardMaterial color="#9aa3ab" metalness={0.6} roughness={0.4} /></mesh>
        </group>
      ))}
      <mesh position={[0, 5.2, z1 + 0.12]}><planeGeometry args={[1.6, 0.8]} /><meshBasicMaterial map={panel.texture} toneMapped={false} /></mesh>
    </group>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// CEP · cepilladora-moldurera y pila seca de entrada
// ═════════════════════════════════════════════════════════════════════════════
export function PlanerZone() {
  const [px, pz] = ZONES.CEP.geo.pad;
  const st = useStack();
  const rollers = useRef([]);
  useFrame((_, dt) => {
    const lg = L(); if (!lg) return;
    st.set(Math.ceil(lg.dryPad.boards / BOARDS_PER_LOG), lg.dryPad.species, true);
    const w = live.tick?.line?.work?.CEP;
    const on = w && w.kind && !w.done;
    rollers.current.forEach((r) => { if (r) r.rotation.z += dt * (on ? 12 : 0); });
  });
  return (
    <group>
      <group>
        <mesh position={[0, 1.0, 0]} castShadow receiveShadow><boxGeometry args={[4.2, 2.0, 2.2]} /><meshStandardMaterial color="#2f6b4f" metalness={0.3} roughness={0.55} /></mesh>
        <mesh position={[0, 2.15, 0]} castShadow><boxGeometry args={[3.6, 0.3, 1.8]} /><meshStandardMaterial {...steel} /></mesh>
        <mesh position={[0, 0.85, 1.11]}><boxGeometry args={[3.6, 0.35, 0.02]} /><meshStandardMaterial color="#111" /></mesh>
        {[-1.4, -0.5, 0.5, 1.4].map((x, i) => (
          <mesh key={x} ref={(r) => { rollers.current[i] = r; }} position={[x, 2.33, 0]} rotation={[Math.PI / 2, 0, 0]}><cylinderGeometry args={[0.09, 0.09, 1.6, 12]} /><meshStandardMaterial color="#c8cdd2" metalness={0.8} /></mesh>
        ))}
        <mesh position={[1.4, 1.4, 1.2]}><boxGeometry args={[0.6, 0.45, 0.12]} /><meshStandardMaterial color="#0a1520" emissive="#0b3550" emissiveIntensity={0.9} /></mesh>
        <mesh position={[0, 2.3 + 1.6, 0]}><cylinderGeometry args={[0.3, 0.3, 3.2, 16]} /><meshStandardMaterial color="#b8bec5" metalness={0.7} roughness={0.35} /></mesh>
        {/* encoladora de tableros a la salida */}
        <mesh position={[3.6, 1.1, -0.9]} castShadow><boxGeometry args={[1.4, 1.2, 0.6]} /><meshStandardMaterial color="#d9d6cf" /></mesh>
        <mesh position={[3.6, 1.9, -0.9]}><cylinderGeometry args={[0.22, 0.22, 0.4, 16]} /><meshStandardMaterial color="#f2c230" /></mesh>
      </group>
      <StackStand x={px} z={pz} />
      <primitive object={st.group} position={[px, 0.45, pz]} />
    </group>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// PAL · paletizador de 4 ejes, dos puestos de palé, enfardadora y palés vacíos
// ═════════════════════════════════════════════════════════════════════════════
function PalletOnStation({ index }) {
  const root = useRef(null);
  const itemsRef = useRef(null);
  const pool = useRef([]);
  const film = useRef(null);
  useFrame(() => {
    const lg = L(); if (!lg || !root.current || !itemsRef.current) return;
    const p = lg.pal.pallets?.[index];
    root.current.visible = !!p?.present;
    if (!p?.present) return;
    const items = p.items || [];
    const holder = itemsRef.current;
    while (pool.current.length > items.length) holder.remove(pool.current.pop().g);
    items.forEach((it, i) => {
      let e = pool.current[i];
      if (!e || e.key !== `${it.product}|${it.species}|${it.tone}`) {
        if (e) holder.remove(e.g);
        const g = buildProduct(it.product);
        poseFinished(g, it.species, it.tone);
        e = { g, key: `${it.product}|${it.species}|${it.tone}` };
        pool.current[i] = e;
        holder.add(g);
      }
      const s = PALLET_PATTERN[it.product][i] || [0, 0, 0];
      e.g.position.set(s[0], PALLET_TOP + s[1], s[2]);
    });
    const prod = items[0]?.product;
    const h = prod ? Math.max(...items.map((_, i) => (PALLET_PATTERN[prod][i]?.[1] || 0))) + DIMS[prod][1] : 0.6;
    film.current.visible = p.wrap > 0.02;
    film.current.scale.set(1.34, Math.max(0.01, p.wrap * h), 1.12);
    film.current.position.y = PALLET_TOP + (p.wrap * h) / 2;
  });
  const [x, z, rot] = ZONES.PAL.geo.pallets[index];
  return (
    <group position={[x, 0, z]} rotation={[0, rot ? -Math.PI / 2 : 0, 0]}>
      <group ref={root}>
        <mesh position={[0, 0.07, 0]} material={MAT.pallet} castShadow receiveShadow><boxGeometry args={[1.2, 0.14, 1.0]} /></mesh>
        <group ref={itemsRef} />
        <mesh ref={film} geometry={BOX} material={MAT.film} />
      </group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.006, 0]}><planeGeometry args={[1.6, 1.4]} /><meshBasicMaterial color="#f2c230" transparent opacity={0.35} /></mesh>
      <FloorLabel text={index ? 'PUESTO B' : 'PUESTO A'} position={[0, 0.012, 0.95]} height={0.3} color="#5a4330" />
    </group>
  );
}

function Wrapper({ index }) {
  const arm = useRef(null);
  useFrame((_, dt) => {
    const p = L()?.pal.pallets?.[index];
    if (arm.current && p && p.wrap > 0 && p.wrap < 1) arm.current.rotation.y += dt * 2.4;
  });
  const [x, z, rot] = ZONES.PAL.geo.pallets[index];
  return (
    <group position={[x, 0, z]} rotation={[0, rot ? -Math.PI / 2 : 0, 0]}>
      <mesh position={[-1.1, 1.5, -0.85]} castShadow><boxGeometry args={[0.2, 3.0, 0.2]} /><meshStandardMaterial color="#2f6db0" /></mesh>
      <mesh position={[-0.55, 2.95, -0.85]} castShadow><boxGeometry args={[1.3, 0.16, 0.2]} /><meshStandardMaterial color="#2f6db0" /></mesh>
      <group ref={arm} position={[0, 2.88, 0]}>
        <mesh position={[0, 0, -0.85]}><boxGeometry args={[0.1, 0.1, 1.7]} /><meshStandardMaterial color="#333" /></mesh>
        <mesh position={[0, -0.9, -0.85]} castShadow><cylinderGeometry args={[0.07, 0.07, 0.55, 14]} /><meshStandardMaterial color="#cfe0ea" /></mesh>
        <mesh position={[0, -0.45, -0.85]}><boxGeometry args={[0.05, 0.9, 0.05]} /><meshStandardMaterial color="#555" /></mesh>
      </group>
    </group>
  );
}

export function PalletizerZone() {
  const model = useRobotModel('palletizer');
  const G = ZONES.PAL.geo;
  const carried = useMemo(() => {
    const holder = new THREE.Group();
    model.tcp.add(holder);
    return { holder, g: null, key: '' };
  }, [model]);
  const qBuf = useMemo(() => new Array(6).fill(0), []);
  useFrame(() => {
    const lg = L(); if (!lg) return;
    const P = lg.pal, P0 = LP()?.pal;
    const k = tickAlpha();
    for (let i = 0; i < 6; i++) qBuf[i] = P0 ? lerp(P0.q[i], P.q[i], k) : P.q[i];
    applyJoints(model, qBuf);
    const gap = 0.36 - P.clamp * 0.055;
    if (model.clamps[0]) model.clamps[0].position.z = -gap;
    if (model.clamps[1]) model.clamps[1].position.z = gap;
    const c = P.carrying;
    const key = c ? `${c.product}|${c.species}|${c.tone}` : '';
    if (key !== carried.key) {
      if (carried.g) carried.holder.remove(carried.g);
      carried.g = null; carried.key = key;
      if (c) {
        const g = buildProduct(c.product);
        poseFinished(g, c.species, c.tone);
        // el eje de la herramienta (+X) apunta hacia abajo: el «arriba» del producto es −X
        g.rotation.z = Math.PI / 2;
        g.position.x = 0.04 + DIMS[c.product][1];
        carried.holder.add(g);
        carried.g = g;
      }
    }
  });
  return (
    <group>
      <primitive object={model.root} position={[G.robot[0], 0, G.robot[1]]} />
      <PalletOnStation index={0} />
      <PalletOnStation index={1} />
      <Wrapper index={0} />
      <Wrapper index={1} />
      <group position={[G.empties[0], 0, G.empties[1]]}>
        {Array.from({ length: 8 }, (_, i) => <mesh key={i} position={[0, 0.07 + i * 0.145, 0]} material={MAT.pallet} castShadow><boxGeometry args={[1.2, 0.14, 1.0]} /></mesh>)}
      </group>
      {/* tope final de la línea */}
      <mesh position={[ZONES.PAL.line.out[0] + 0.1, PIECE_Y + 0.05, 0]}><boxGeometry args={[0.12, 0.2, 1.1]} /><meshStandardMaterial color="#d23b2a" /></mesh>
    </group>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// ALM · estanterías de palés (huecos del almacén) y DOCK · camión de expedición
// ═════════════════════════════════════════════════════════════════════════════
const productColor = (p) => woodColor(p.species, p.product === 'tablon' ? 'sanded' : 'finished', p.tone);

/** Palé enfardado simplificado (bloque con film) para almacén, AGV y camión. */
export function PalletBlock({ pallet }) {
  const ref = useRef(null);
  const mats = useMemo(() => ({ load: new THREE.MeshStandardMaterial({ color: '#c08a5a', roughness: 0.5 }) }), []);
  useFrame(() => {
    const p = typeof pallet === 'function' ? pallet() : pallet;
    if (!ref.current) return;
    ref.current.visible = !!p;
    if (!p) return;
    mats.load.color.set(productColor(p));
    const h = p.product === 'mesa' ? 1.45 : p.product === 'estanteria' ? 0.92 : p.product === 'tablon' ? 0.22 : 0.9;
    const load = ref.current.children[1], film = ref.current.children[2];
    load.scale.set(1.12, h, 0.92); load.position.y = 0.14 + h / 2;
    film.scale.set(1.18, h + 0.04, 0.98); film.position.y = 0.14 + h / 2;
  });
  return (
    <group ref={ref}>
      <mesh position={[0, 0.07, 0]} material={MAT.pallet} castShadow receiveShadow><boxGeometry args={[1.2, 0.14, 1.0]} /></mesh>
      <mesh geometry={BOX} material={mats.load} castShadow />
      <mesh geometry={BOX} material={MAT.film} />
    </group>
  );
}

export function WarehouseZone() {
  const G = ZONES.ALM.geo;
  const len = G.bays[G.bays.length - 1] - G.bays[0] + 3.2;
  return (
    <group>
      {G.rowZ.map((z, row) => (
        <group key={z}>
          {[...G.bays.map((x) => x - 1.5), G.bays[G.bays.length - 1] + 1.5].map((x) => [-0.6, 0.6].map((dz) => (
            <mesh key={`${x}${dz}`} position={[x, 2.4, z + dz]} castShadow><boxGeometry args={[0.1, 4.8, 0.1]} /><meshStandardMaterial color="#2f6db0" /></mesh>
          )))}
          {[1.65, 3.28].map((y) => [-0.6, 0.6].map((dz) => (
            <mesh key={`${y}${dz}`} position={[0, y, z + dz]} castShadow><boxGeometry args={[len, 0.12, 0.08]} /><meshStandardMaterial color="#f28c28" /></mesh>
          )))}
          {G.bays.map((x, bay) => G.levels.map((ly, lvl) => (
            <group key={`${bay}${lvl}`} position={[x, ly - 0.12 + (lvl ? 0.05 : 0.12), z]}>
              <PalletBlock pallet={() => live.scene?.slots?.[`${row}_${bay}_${lvl}`]} />
            </group>
          )))}
          {G.bays.map((x, bay) => (
            <FloorLabel key={bay} text={`${row ? 'B' : 'A'}${bay + 1}`} position={[x, 0.012, z + (row ? 1.0 : -1.0)]} height={0.32} color="#2f6db0" />
          ))}
        </group>
      ))}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.006, 0]}><planeGeometry args={[len, 4.6]} /><meshStandardMaterial color="#5b6670" transparent opacity={0.2} /></mesh>
      <FloorLabel text="PASILLO EXCLUSIVO · 1 AGV" position={[0, 0.012, 0]} height={0.42} color="#2f6db0" />
    </group>
  );
}

export function DockZone() {
  const G = ZONES.DOCK.geo;
  const g = useRef(null), loads = useRef(null);
  useFrame(() => {
    const lg = L(); if (!lg || !g.current) return;
    g.current.position.x = G.truckX + ip((s) => s.truck.x);
    g.current.visible = lg.truck.state !== 'AWAY';
  });
  return (
    <group>
      <mesh position={[3.05, 1.8, 0]}><boxGeometry args={[0.2, 3.6, 3.4]} /><meshStandardMaterial color="#1a1d21" /></mesh>
      {[-1.8, 1.8].map((z) => <mesh key={z} position={[3.0, 2.0, z]}><boxGeometry args={[0.3, 4.0, 0.25]} /><meshStandardMaterial color="#f2c230" /></mesh>)}
      <mesh position={[1.8, 0.02, 0]} rotation={[-Math.PI / 2, 0, 0]}><planeGeometry args={[2.4, 3.2]} /><meshStandardMaterial color="#5d6670" metalness={0.6} /></mesh>
      <FloorLabel text="MUELLE 1" position={[2.8, 4.4, 0]} height={0.45} rotation={[0, -Math.PI / 2, 0]} />
      <group ref={g} position={[G.truckX, 0, 0]}>
        <mesh position={[1.2, 2.45, 0]} castShadow><boxGeometry args={[12, 0.08, 2.5]} /><meshStandardMaterial color="#e6e8ea" /></mesh>
        {[-1.25, 1.25].map((z) => <mesh key={z} position={[1.2, 1.75, z]} castShadow><boxGeometry args={[12, 1.4, 0.05]} /><meshStandardMaterial color="#d23b2a" /></mesh>)}
        <mesh position={[1.2, 1.0, 0]} castShadow receiveShadow><boxGeometry args={[12, 0.12, 2.5]} /><meshStandardMaterial color="#555" /></mesh>
        <group ref={loads}>
          {Array.from({ length: 10 }, (_, i) => (
            <group key={i} position={[-3.6 + Math.floor(i / 2) * 1.35 + 0.5, 1.06, i % 2 ? 0.6 : -0.6]} rotation={[0, Math.PI / 2, 0]} scale={0.95}>
              <PalletBlock pallet={() => live.tick?.logistics?.truck?.pallets?.[i]} />
            </group>
          ))}
        </group>
        {[-2.5, -1.2, 5.5].map((x) => [-1.1, 1.1].map((z) => (
          <mesh key={`${x}${z}`} position={[x, 0.5, z]} rotation={[Math.PI / 2, 0, 0]} castShadow><cylinderGeometry args={[0.5, 0.5, 0.3, 20]} /><meshStandardMaterial color="#151515" /></mesh>
        )))}
        <group position={[8.6, 0, 0]}>
          <mesh position={[0, 1.7, 0]} castShadow><boxGeometry args={[2.4, 2.6, 2.5]} /><meshStandardMaterial color="#1f4e8c" metalness={0.3} roughness={0.4} /></mesh>
          {[-1.1, 1.1].map((z) => <mesh key={z} position={[0.3, 0.5, z]} rotation={[Math.PI / 2, 0, 0]}><cylinderGeometry args={[0.5, 0.5, 0.3, 20]} /><meshStandardMaterial color="#151515" /></mesh>)}
        </group>
      </group>
    </group>
  );
}

export { StackStand, BoardLayer, useStack, sMat, MAT, PRODUCTS };
