import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import * as THREE from 'three';
import {
  LOG_YARD, LOG_GANTRY, SAW, STACKER, SAW_PAD, PLANER_PAD, PALLETIZER, RACK, DOCK, OUT_X, LINE_Z, PIECE_Y,
} from '../sim/layout';
import { logistics, LOG_SLOTS, STACK_LAYERS, PALLET_SLOTS } from '../sim/logistics';
import { useRobotModel, applyJoints } from './robotCommon';
import { Cabinet } from './Line';
import { useTwinStore } from '../store/useTwinStore';

const LOG_LEN = 4.2, LOG_R = 0.28;
const steel = { color: '#5d6670', metalness: 0.8, roughness: 0.35 };
const yellow = { color: '#f2b705', metalness: 0.35, roughness: 0.5 };

// ── Materiales compartidos ───────────────────────────────────────────────────
const MAT = {
  bark: new THREE.MeshStandardMaterial({ color: '#5a4330', roughness: 1 }),
  end: new THREE.MeshStandardMaterial({ color: '#cfa46c', roughness: 0.9 }),
  green: new THREE.MeshStandardMaterial({ color: '#c8a874', roughness: 0.9 }),
  dry: new THREE.MeshStandardMaterial({ color: '#dcbd8c', roughness: 0.8 }),
  sticker: new THREE.MeshStandardMaterial({ color: '#6d5338', roughness: 0.9 }),
  pallet: new THREE.MeshStandardMaterial({ color: '#b48a57', roughness: 0.9 }),
  film: new THREE.MeshStandardMaterial({ color: '#dfe9f0', transparent: true, opacity: 0.38, roughness: 0.2, metalness: 0.1, depthWrite: false }),
};
const LOG_GEO = new THREE.CylinderGeometry(LOG_R, LOG_R * 1.05, LOG_LEN, 16).rotateZ(Math.PI / 2);
const BOARD_GEO = new THREE.BoxGeometry(LOG_LEN, 0.05, 0.17);

function Log(props) {
  return <mesh geometry={LOG_GEO} material={[MAT.bark, MAT.end, MAT.end]} castShadow receiveShadow {...props} />;
}

/** Capa de tablas (6 tablas a lo largo de X) */
function BoardLayer({ mat = MAT.green, ...props }) {
  return (
    <group {...props}>
      {Array.from({ length: 6 }, (_, i) => (
        <mesh key={i} geometry={BOARD_GEO} material={mat} position={[0, 0.025, (i - 2.5) * 0.2]} castShadow receiveShadow />
      ))}
    </group>
  );
}

/** Pila de tablas con rastreles entre capas (base en y = 0). */
function Stack({ layers, dry = false }) {
  const mat = dry ? MAT.dry : MAT.green;
  return (
    <group>
      {Array.from({ length: layers }, (_, l) => (
        <group key={l} position={[0, l * 0.13, 0]}>
          {[-1.7, 0, 1.7].map((x) => (
            <mesh key={x} position={[x, 0.0125, 0]} material={MAT.sticker} castShadow><boxGeometry args={[0.05, 0.025, 1.25]} /></mesh>
          ))}
          <BoardLayer mat={mat} position={[0, 0.025, 0]} />
        </group>
      ))}
    </group>
  );
}

/** Soporte de pila (deja hueco para que entre el AGV de elevación). */
function StackStand({ x, z }) {
  return (
    <group position={[x, 0, z]}>
      {[-0.7, 0.7].map((dz) => (
        <group key={dz}>
          <mesh position={[0, 0.41, dz]} castShadow><boxGeometry args={[4.0, 0.08, 0.12]} /><meshStandardMaterial {...steel} /></mesh>
          {[-1.8, 1.8].map((dx) => (
            <mesh key={dx} position={[dx, 0.2, dz]}><boxGeometry args={[0.1, 0.4, 0.1]} /><meshStandardMaterial {...steel} /></mesh>
          ))}
        </group>
      ))}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.006, 0]}><planeGeometry args={[4.4, 1.9]} /><meshBasicMaterial color="#f2c230" transparent opacity={0.35} /></mesh>
    </group>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// Patio de troncos y pórtico grúa con garra
// ═════════════════════════════════════════════════════════════════════════════
function LogYard() {
  const pile = useRef(null);
  useFrame(() => {
    if (!pile.current) return;
    pile.current.children.forEach((m, i) => { m.visible = i < logistics.yardLogs; });
  });
  return (
    <group>
      <group ref={pile}>
        {LOG_SLOTS.map(([z, y], i) => <Log key={i} position={[LOG_YARD.pileX, y, z]} />)}
      </group>
      {/* Pilas de reserva (decorado) */}
      {[16, 20.5, 25].map((z) => (
        <group key={z} position={[-63.2, 0, z]}>
          {[[-0.62, 0.3], [0, 0.3], [0.62, 0.3], [-0.31, 0.83], [0.31, 0.83], [0, 1.36]].map(([dz, y], i) => <Log key={i} position={[0, y, dz]} />)}
        </group>
      ))}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[(LOG_YARD.x0 + LOG_YARD.x1) / 2, 0.005, (LOG_YARD.z0 + LOG_YARD.z1) / 2]} receiveShadow>
        <planeGeometry args={[LOG_YARD.x1 - LOG_YARD.x0, LOG_YARD.z1 - LOG_YARD.z0]} />
        <meshStandardMaterial color="#8c7b62" roughness={1} />
      </mesh>
    </group>
  );
}

function Claw({ side, refCb }) {
  return (
    <group ref={refCb} position={[0, -0.15, side * 0.18]}>
      {[-1.2, 1.2].map((x) => (
        <mesh key={x} position={[x, -0.3, side * 0.12]} rotation={[0, 0, 0]} castShadow>
          <torusGeometry args={[0.42, 0.045, 8, 16, Math.PI / 2]} />
          <meshStandardMaterial {...yellow} />
        </mesh>
      ))}
      <mesh position={[0, 0, 0]} castShadow><boxGeometry args={[2.6, 0.08, 0.08]} /><meshStandardMaterial {...steel} /></mesh>
    </group>
  );
}

function LogGantry() {
  const G = LOG_GANTRY;
  const bridge = useRef(null), trolley = useRef(null), head = useRef(null), cable = useRef(null), log = useRef(null);
  const claws = useRef([]);
  const cols = useMemo(() => { const out = []; for (let x = G.x0; x <= G.x1 + 0.01; x += 6) out.push(x); return out; }, [G.x0, G.x1]);
  useFrame(() => {
    const P = logistics.logGantry.pos;
    bridge.current.position.x = P.x;
    trolley.current.position.z = P.z;
    head.current.position.set(0, P.y - G.railY, 0);
    const L = G.railY - 0.3 - P.y;
    cable.current.scale.y = Math.max(0.05, L);
    cable.current.position.y = -0.3 - L / 2;
    const open = (1 - P.claw) * 0.75;
    if (claws.current[0]) claws.current[0].rotation.x = -open;
    if (claws.current[1]) claws.current[1].rotation.x = open;
    log.current.visible = logistics.logGantry.carrying;
  });
  return (
    <group>
      {/* Caminos de rodadura sobre pilares */}
      {[G.z0, G.z1].map((z) => (
        <group key={z}>
          <mesh position={[(G.x0 + G.x1) / 2, G.railY, z]} castShadow><boxGeometry args={[G.x1 - G.x0 + 1, 0.5, 0.4]} /><meshStandardMaterial {...yellow} /></mesh>
          {cols.map((x) => (
            <mesh key={x} position={[x, G.railY / 2, z]} castShadow><boxGeometry args={[0.4, G.railY, 0.4]} /><meshStandardMaterial {...steel} /></mesh>
          ))}
        </group>
      ))}
      <group ref={bridge} position={[-50, G.railY + 0.45, 0]}>
        <mesh position={[0, 0, (G.z0 + G.z1) / 2]} castShadow><boxGeometry args={[0.7, 0.8, G.z1 - G.z0 + 0.6]} /><meshStandardMaterial {...yellow} /></mesh>
        {[G.z0, G.z1].map((z) => (
          <mesh key={z} position={[0, -0.2, z]} castShadow><boxGeometry args={[2.2, 0.4, 0.6]} /><meshStandardMaterial color="#333" /></mesh>
        ))}
        <mesh position={[0.7, 0.1, (G.z0 + G.z1) / 2 + 3]}><boxGeometry args={[0.4, 0.5, 0.6]} /><meshStandardMaterial color="#d22" /></mesh>
        <group ref={trolley} position={[0, -0.45, 20]}>
          <mesh position={[0, 0.55, 0]} castShadow><boxGeometry args={[1.4, 0.6, 1.2]} /><meshStandardMaterial color="#3b3f45" /></mesh>
          <mesh ref={cable} position={[0, -1, 0]}><boxGeometry args={[0.04, 1, 0.5]} /><meshStandardMaterial color="#222" /></mesh>
          <group ref={head}>
            <mesh castShadow><boxGeometry args={[2.8, 0.3, 0.5]} /><meshStandardMaterial {...yellow} /></mesh>
            <mesh position={[0, 0.25, 0]}><cylinderGeometry args={[0.2, 0.2, 0.25, 16]} /><meshStandardMaterial {...steel} /></mesh>
            <Claw side={-1} refCb={(r) => { claws.current[0] = r; }} />
            <Claw side={1} refCb={(r) => { claws.current[1] = r; }} />
            <group ref={log} position={[0, -0.45, 0]}><Log /></group>
          </group>
        </group>
      </group>
    </group>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// Aserradero: mesa de entrada, carro, sierra de cinta y mesa de salida
// ═════════════════════════════════════════════════════════════════════════════
function Sawmill() {
  const log = useRef(null), carriage = useRef(null), wheels = useRef([]), boards = useRef(null);
  useFrame((_, dt) => {
    const S = logistics.saw;
    const onDeck = logistics.deckLog || S.state === 'CUT';
    log.current.visible = onDeck;
    log.current.position.x = S.logX;
    carriage.current.position.x = S.logX;
    const spin = S.state === 'CUT' ? 18 : 2;
    wheels.current.forEach((w) => { if (w) w.rotation.z += dt * spin; });
    boards.current.visible = logistics.outfeed === 1;
  });
  const y = SAW.y, z = SAW.z;
  return (
    <group>
      {/* Mesa de entrada (transportador de cadenas) */}
      <mesh position={[SAW.deckX, y / 2, z]} castShadow receiveShadow><boxGeometry args={[6, y, 2.2]} /><meshStandardMaterial color="#3c4249" metalness={0.5} roughness={0.5} /></mesh>
      {[-0.7, 0, 0.7].map((dz) => (
        <mesh key={dz} position={[SAW.deckX, y + 0.01, z + dz]}><boxGeometry args={[6, 0.02, 0.08]} /><meshStandardMaterial color="#111" /></mesh>
      ))}
      {/* Vía del carro */}
      {[-0.5, 0.5].map((dz) => (
        <mesh key={dz} position={[(SAW.deckX + SAW.outX) / 2 + 1, 0.06, z + dz]}><boxGeometry args={[22, 0.12, 0.12]} /><meshStandardMaterial {...steel} /></mesh>
      ))}
      <group ref={carriage} position={[SAW.deckX, 0, z]}>
        <mesh position={[0, y - 0.2, 0]} castShadow><boxGeometry args={[4.6, 0.25, 1.4]} /><meshStandardMaterial color="#2f6db0" metalness={0.4} roughness={0.5} /></mesh>
        {[-1.6, 0, 1.6].map((dx) => (
          <mesh key={dx} position={[dx, y + 0.2, -0.45]} castShadow><boxGeometry args={[0.15, 0.6, 0.12]} /><meshStandardMaterial color="#d23b2a" /></mesh>
        ))}
      </group>
      <group ref={log} position={[SAW.deckX, y + LOG_R, z]}><Log /></group>
      {/* Sierra de cinta */}
      <group position={[SAW.headX, 0, z + 1.6]}>
        <mesh position={[0, 2.2, 0.4]} castShadow><boxGeometry args={[0.8, 4.4, 0.6]} /><meshStandardMaterial color="#6b7a3a" metalness={0.3} roughness={0.6} /></mesh>
        {[0.95, 3.6].map((wy, i) => (
          <group key={wy} position={[0, wy, -0.05]}>
            <mesh ref={(r) => { wheels.current[i] = r; }} rotation={[Math.PI / 2, 0, 0]} castShadow>
              <cylinderGeometry args={[0.95, 0.95, 0.18, 32]} /><meshStandardMaterial color="#9aa3ab" metalness={0.8} roughness={0.3} />
            </mesh>
            <mesh position={[0, 0, -0.1]}><boxGeometry args={[2.1, 0.12, 0.02]} /><meshStandardMaterial color="#333" /></mesh>
          </group>
        ))}
        <mesh position={[0, 2.3, -1.55]}><boxGeometry args={[0.02, 2.7, 0.08]} /><meshStandardMaterial color="#e8eef3" metalness={1} roughness={0.15} /></mesh>
        <mesh position={[0, 2.3, -0.8]} castShadow><boxGeometry args={[2.2, 4.9, 0.12]} /><meshStandardMaterial color="#f2b705" transparent opacity={0.55} /></mesh>
      </group>
      {/* Mesa de salida */}
      <mesh position={[SAW.outX, y / 2, z]} castShadow receiveShadow><boxGeometry args={[6, y, 2.2]} /><meshStandardMaterial color="#3c4249" metalness={0.5} roughness={0.5} /></mesh>
      <group ref={boards} position={[SAW.outX, y, z]}><BoardLayer /></group>
      {/* Pilas sobre soportes: verde (aserradero) y seca (cepilladora) */}
      <StackStand x={SAW_PAD[0]} z={SAW_PAD[1]} />
      <StackStand x={PLANER_PAD[0]} z={PLANER_PAD[1]} />
    </group>
  );
}

function PadStacks() {
  const green = useRef(null), dry = useRef(null);
  useFrame(() => {
    green.current.children.forEach((c, i) => { c.visible = i < logistics.sawPad.layers; });
    dry.current.children.forEach((c, i) => { c.visible = i < logistics.planerPad.layers; });
  });
  return (
    <group>
      <group ref={green} position={[SAW_PAD[0], 0.45, SAW_PAD[1]]}>
        {Array.from({ length: STACK_LAYERS }, (_, l) => <group key={l} position={[0, l * 0.13, 0]}><Stack layers={1} /></group>)}
      </group>
      <group ref={dry} position={[PLANER_PAD[0], 0.45, PLANER_PAD[1]]}>
        {Array.from({ length: STACK_LAYERS }, (_, l) => <group key={l} position={[0, l * 0.13, 0]}><Stack layers={1} dry /></group>)}
      </group>
    </group>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// Pórtico apilador (robot cartesiano de techo) con viga de ventosas
// ═════════════════════════════════════════════════════════════════════════════
function StackerGantry() {
  const S = STACKER;
  const bridge = useRef(null), trolley = useRef(null), mast = useRef(null), beam = useRef(null), layer = useRef(null);
  useFrame(() => {
    const P = logistics.stacker.pos;
    bridge.current.position.x = P.x;
    trolley.current.position.z = P.z;
    beam.current.position.y = P.y - S.railY;
    const L = S.railY - 0.2 - P.y;
    mast.current.scale.y = Math.max(0.1, L);
    mast.current.position.y = -0.2 - L / 2;
    layer.current.visible = logistics.stacker.carrying;
  });
  return (
    <group>
      {[S.z0, S.z1].map((z) => (
        <group key={z}>
          <mesh position={[(S.x0 + S.x1) / 2, S.railY, z]} castShadow><boxGeometry args={[S.x1 - S.x0, 0.35, 0.3]} /><meshStandardMaterial color="#2f6db0" metalness={0.4} roughness={0.5} /></mesh>
          {[S.x0, (S.x0 + S.x1) / 2, S.x1].map((x) => (
            <mesh key={x} position={[x, S.railY / 2, z]} castShadow><boxGeometry args={[0.3, S.railY, 0.3]} /><meshStandardMaterial {...steel} /></mesh>
          ))}
        </group>
      ))}
      <group ref={bridge} position={[-23, S.railY + 0.3, 0]}>
        <mesh position={[0, 0, (S.z0 + S.z1) / 2]} castShadow><boxGeometry args={[0.45, 0.45, S.z1 - S.z0 + 0.4]} /><meshStandardMaterial color="#2f6db0" metalness={0.4} roughness={0.5} /></mesh>
        <group ref={trolley} position={[0, -0.3, 18]}>
          <mesh position={[0, 0.3, 0]} castShadow><boxGeometry args={[0.9, 0.4, 0.8]} /><meshStandardMaterial color="#3b3f45" /></mesh>
          <mesh ref={mast} position={[0, -1, 0]} castShadow><boxGeometry args={[0.22, 1, 0.22]} /><meshStandardMaterial {...steel} /></mesh>
          <group ref={beam}>
            <mesh castShadow><boxGeometry args={[4.4, 0.14, 0.2]} /><meshStandardMaterial color="#f2b705" metalness={0.35} roughness={0.5} /></mesh>
            {[-1.8, -0.9, 0, 0.9, 1.8].map((x) => [-0.42, 0.42].map((dz) => (
              <group key={`${x}${dz}`}>
                <mesh position={[x, -0.04, dz / 2]}><boxGeometry args={[0.05, 0.05, Math.abs(dz)]} /><meshStandardMaterial {...steel} /></mesh>
                <mesh position={[x, -0.1, dz]}><cylinderGeometry args={[0.06, 0.04, 0.06, 14]} /><meshStandardMaterial color="#141414" /></mesh>
              </group>
            )))}
            <group ref={layer} position={[0, -0.18, 0]}><BoardLayer position={[0, -0.05, 0]} /></group>
          </group>
        </group>
      </group>
    </group>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// AGVs
// ═════════════════════════════════════════════════════════════════════════════
const BEACON = { MOVING: '#39d353', WAIT: '#ffb020', ACTION: '#2f8cff', IDLE: '#7fdcff' };

function PalletLoad({ items = [] }) {
  const color = items[0]?.color ?? '#9a6a3c';
  return (
    <group>
      <mesh position={[0, 0.07, 0]} material={MAT.pallet} castShadow><boxGeometry args={[1.2, 0.14, 1.0]} /></mesh>
      {PALLET_SLOTS.map(([a, b], i) => (
        <group key={i} position={[a, 0.14, b]} rotation={[0, Math.PI / 2, 0]}><Cabinet color={items[i]?.color ?? color} gloss /></group>
      ))}
      <mesh position={[0, 0.14 + 0.4, 0]} material={MAT.film}><boxGeometry args={[1.32, 0.8, 1.1]} /></mesh>
    </group>
  );
}

function Agv({ index }) {
  const g = useRef(null), body = useRef(null), plate = useRef(null), beacon = useRef(null), field = useRef(null);
  const carriage = useRef(null), stack = useRef(null), pallet = useRef(null), tag = useRef(null);
  const showLabels = useTwinStore((s) => s.showLabels);
  const agv0 = logistics.agvs[index];
  const isFork = agv0.type === 'fork';
  const stackItems = useRef(null);
  useFrame(({ clock }) => {
    const a = logistics.agvs[index];
    g.current.position.set(a.pos[0], 0, a.pos[1]);
    body.current.rotation.y = a.heading;
    const col = BEACON[a.state] ?? '#fff';
    beacon.current.material.color.set(col);
    beacon.current.material.emissive.set(col);
    beacon.current.material.emissiveIntensity = a.state === 'WAIT' ? (Math.sin(clock.elapsedTime * 8) > 0 ? 2 : 0.2) : 1.5;
    // Campo de protección del escáner láser
    field.current.visible = a.state === 'MOVING' || a.state === 'WAIT';
    field.current.material.color.set(a.state === 'WAIT' ? '#ffb020' : '#39d353');
    if (!isFork) {
      plate.current.position.y = 0.32 + a.lift * 0.14;
      stack.current.visible = !!a.load;
      stack.current.position.set(a.pos[0], 0.47 + a.lift * 0.0, a.pos[1]);
      if (stackItems.current) stackItems.current.forEach((m) => {
        m.traverse((o) => { if (o.isMesh && o.material !== MAT.sticker) o.material = a.load === 'dry' ? MAT.dry : MAT.green; });
      });
    } else {
      carriage.current.position.y = 0.1 + a.liftH;
      carriage.current.position.x = 0.95 + a.reach * 2.0;
      pallet.current.visible = !!a.load;
    }
    if (tag.current) {
      tag.current.dataset.state = a.state;
      tag.current.querySelector('span').textContent = a.state === 'WAIT' ? a.wait : a.mission;
    }
  });

  return (
    <>
      <group ref={g}>
        <group ref={body}>
          {isFork ? (
            <group>
              {/* Carretilla AGV retráctil */}
              <mesh position={[-0.35, 0.42, 0]} castShadow><boxGeometry args={[1.3, 0.7, 1.1]} /><meshStandardMaterial color="#e9eaec" metalness={0.2} roughness={0.5} /></mesh>
              <mesh position={[-0.35, 0.79, 0]} castShadow><boxGeometry args={[1.25, 0.06, 1.05]} /><meshStandardMaterial color="#f28c28" /></mesh>
              {[-0.45, 0.45].map((z) => (
                <mesh key={z} position={[0.62, 1.4, z]} castShadow><boxGeometry args={[0.1, 2.7, 0.1]} /><meshStandardMaterial color="#3b3f45" metalness={0.6} /></mesh>
              ))}
              <mesh position={[0.62, 2.72, 0]}><boxGeometry args={[0.12, 0.1, 1.0]} /><meshStandardMaterial color="#3b3f45" /></mesh>
              {[-0.45, 0.45].map((z) => (
                <mesh key={`l${z}`} position={[0.55, 0.1, z]} castShadow><boxGeometry args={[1.0, 0.12, 0.14]} /><meshStandardMaterial color="#3b3f45" /></mesh>
              ))}
              <group ref={carriage} position={[0.95, 0.1, 0]}>
                <mesh position={[-0.25, 0.35, 0]}><boxGeometry args={[0.08, 0.7, 0.95]} /><meshStandardMaterial color="#2b2d31" /></mesh>
                {[-0.3, 0.3].map((z) => (
                  <mesh key={z} position={[0.35, 0.02, z]} castShadow><boxGeometry args={[1.15, 0.05, 0.12]} /><meshStandardMaterial color="#2b2d31" metalness={0.6} /></mesh>
                ))}
                <group ref={pallet} position={[0.35, 0.05, 0]} rotation={[0, Math.PI / 2, 0]}>
                  <AgvPallet index={index} />
                </group>
              </group>
              <mesh position={[-0.95, 0.9, 0.42]}><cylinderGeometry args={[0.07, 0.07, 0.1, 16]} /><meshStandardMaterial color="#111" /></mesh>
              <mesh ref={beacon} position={[-0.95, 1.05, -0.42]}><cylinderGeometry args={[0.06, 0.06, 0.16, 14]} /><meshStandardMaterial color="#39d353" emissive="#39d353" /></mesh>
            </group>
          ) : (
            <group>
              {/* AGV de elevación (latente): entra bajo la pila y la levanta */}
              <mesh position={[0, 0.16, 0]} castShadow><boxGeometry args={[2.2, 0.3, 1.25]} /><meshStandardMaterial color="#f4f4f1" metalness={0.2} roughness={0.5} /></mesh>
              <mesh position={[0, 0.06, 0]}><boxGeometry args={[2.24, 0.08, 1.29]} /><meshStandardMaterial color="#f2b705" /></mesh>
              {[-1.1, 1.1].map((x) => (
                <mesh key={x} position={[x, 0.16, 0]}><boxGeometry args={[0.04, 0.22, 1.2]} /><meshStandardMaterial color="#222" /></mesh>
              ))}
              <mesh ref={plate} position={[0, 0.32, 0]} castShadow><cylinderGeometry args={[0.5, 0.5, 0.06, 32]} /><meshStandardMaterial color="#3b3f45" metalness={0.7} /></mesh>
              <mesh position={[1.02, 0.36, 0.5]}><cylinderGeometry args={[0.07, 0.07, 0.1, 16]} /><meshStandardMaterial color="#111" /></mesh>
              <mesh ref={beacon} position={[-1.0, 0.38, -0.5]}><cylinderGeometry args={[0.06, 0.06, 0.14, 14]} /><meshStandardMaterial color="#39d353" emissive="#39d353" /></mesh>
            </group>
          )}
          <mesh ref={field} position={[isFork ? 1.6 : 1.9, 0.012, 0]} rotation={[-Math.PI / 2, 0, 0]}>
            <planeGeometry args={[1.6, isFork ? 1.4 : 1.6]} />
            <meshBasicMaterial color="#39d353" transparent opacity={0.22} depthWrite={false} />
          </mesh>
        </group>
        {showLabels && (
          <Html position={[0, isFork ? 3.2 : 1.7, 0]} center distanceFactor={10} zIndexRange={[5, 0]}>
            <div ref={tag} className="agv-tag"><b>{agv0.id}</b><span /></div>
          </Html>
        )}
      </group>
      {!isFork && (
        <group ref={stack} visible={false}>
          <group ref={(r) => { stackItems.current = r ? [r] : null; }}><Stack layers={STACK_LAYERS} /></group>
        </group>
      )}
    </>
  );
}

function AgvPallet({ index }) {
  const ref = useRef(null);
  useFrame(() => {
    const a = logistics.agvs[index];
    if (ref.current && a.load?.items) ref.current.userData.items = a.load.items;
  });
  return <group ref={ref}><PalletLoad /></group>;
}

function Chargers() {
  return ['A_home', 'B_home', 'C_home', 'D_home'].map((id) => (
    <ChargerPad key={id} id={id} />
  ));
}
function ChargerPad({ id }) {
  const a = logistics.agvs.find((x) => x.home === id);
  const [x, z] = a.pos;
  return (
    <group position={[x, 0, z]}>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.006, 0]}><planeGeometry args={[2.6, 1.8]} /><meshStandardMaterial color="#2f8cff" transparent opacity={0.25} /></mesh>
      <mesh position={[0, 0.5, z > 0 ? 1.1 : -1.1]} castShadow><boxGeometry args={[0.5, 1.0, 0.25]} /><meshStandardMaterial color="#e6e8ea" /></mesh>
      <mesh position={[0, 0.85, z > 0 ? 0.97 : -0.97]}><boxGeometry args={[0.3, 0.12, 0.02]} /><meshStandardMaterial color="#0b3550" emissive="#2f8cff" emissiveIntensity={0.8} /></mesh>
    </group>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// Paletizador de 4 ejes, palé, enfardadora y producto en fin de línea
// ═════════════════════════════════════════════════════════════════════════════
function Palletizer() {
  const model = useRobotModel('palletizer');
  const carried = useRef(null), outItem = useRef(null), palletItems = useRef(null), film = useRef(null), arm = useRef(null), pallet = useRef(null);
  const carriedMat = useMemo(() => new THREE.MeshStandardMaterial({ color: '#8a5430', roughness: 0.25 }), []);
  useMemo(() => {
    // Módulo agarrado: cuelga de la pinza (eje de herramienta = +X, hacia abajo)
    const box = new THREE.Mesh(new THREE.BoxGeometry(0.75, 0.62, 0.5), carriedMat);
    box.position.x = 0.75 / 2 - 0.02;
    box.castShadow = true;
    box.visible = false;
    model.tcp.add(box);
    carried.current = box;
  }, [model, carriedMat]);
  useFrame((_, dt) => {
    const P = logistics.pal;
    applyJoints(model, P.q);
    const gap = 0.36 - P.clamp * 0.055;
    if (model.clamps[0]) model.clamps[0].position.z = -gap;
    if (model.clamps[1]) model.clamps[1].position.z = gap;
    carried.current.visible = !!P.carrying;
    if (P.carrying) carriedMat.color.set(P.carrying.color);
    outItem.current.visible = logistics.outQueue.length > 0;
    const pl = P.pallet;
    pallet.current.visible = pl.present;
    palletItems.current.children.forEach((c, i) => { c.visible = i < pl.items.length; });
    film.current.visible = pl.wrap > 0.02;
    film.current.scale.y = Math.max(0.01, pl.wrap);
    film.current.position.y = 0.14 + 0.4 * pl.wrap;
    if (pl.wrap > 0 && pl.wrap < 1) arm.current.rotation.y += dt * 2.2;
  });
  const [px, pz] = PALLETIZER.pallet;
  const [wx, wz] = PALLETIZER.wrapper;
  return (
    <group>
      <primitive object={model.root} position={PALLETIZER.pos} rotation={[0, PALLETIZER.yaw, 0]} />
      <group ref={outItem} position={[OUT_X, PIECE_Y, LINE_Z]}><Cabinet color="#8a5430" gloss /></group>
      <group ref={pallet} position={[px, 0, pz]}>
        <mesh position={[0, 0.07, 0]} material={MAT.pallet} castShadow receiveShadow><boxGeometry args={[1.2, 0.14, 1.0]} /></mesh>
        <group ref={palletItems}>
          {PALLET_SLOTS.map(([a, b], i) => <PalletSlotItem key={i} i={i} a={a} b={b} />)}
        </group>
        <mesh ref={film} position={[0, 0.14, 0]} material={MAT.film}><boxGeometry args={[1.34, 0.8, 1.12]} /></mesh>
      </group>
      {/* Enfardadora de brazo giratorio */}
      <group position={[wx, 0, wz]}>
        <mesh position={[0.9, 1.4, 0]} castShadow><boxGeometry args={[0.25, 2.8, 0.25]} /><meshStandardMaterial color="#2f6db0" /></mesh>
        <mesh position={[0, 2.85, 0]} castShadow><boxGeometry args={[2.0, 0.18, 0.25]} /><meshStandardMaterial color="#2f6db0" /></mesh>
        <group ref={arm} position={[-2, 2.75, 0]}>
          <mesh position={[0.95, 0, 0]}><boxGeometry args={[0.12, 0.12, 0.12]} /><meshStandardMaterial color="#333" /></mesh>
          <mesh position={[0.95, -1.4, 0]} castShadow><cylinderGeometry args={[0.07, 0.07, 0.55, 14]} /><meshStandardMaterial color="#cfe0ea" /></mesh>
          <mesh position={[0.95, -0.7, 0]}><boxGeometry args={[0.05, 1.4, 0.05]} /><meshStandardMaterial color="#555" /></mesh>
        </group>
      </group>
      {/* Almacén de palés vacíos */}
      <group position={[px + 2.6, 0, pz - 1.8]}>
        {Array.from({ length: 8 }, (_, i) => (
          <mesh key={i} position={[0, 0.07 + i * 0.145, 0]} material={MAT.pallet} castShadow><boxGeometry args={[1.2, 0.14, 1.0]} /></mesh>
        ))}
      </group>
    </group>
  );
}
function PalletSlotItem({ i, a, b }) {
  const mat = useMemo(() => new THREE.MeshStandardMaterial({ color: '#8a5430', roughness: 0.25 }), []);
  useFrame(() => { const it = logistics.pal.pallet.items[i]; if (it) mat.color.set(it.color); });
  return (
    <group position={[a, 0.14, b]} rotation={[0, Math.PI / 2, 0]}>
      <Cabinet material={mat} />
    </group>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// Almacén de producto terminado y camión del muelle
// ═════════════════════════════════════════════════════════════════════════════
function Warehouse() {
  const slots = useMemo(() => Object.keys(logistics.rack), []);
  const refs = useRef({});
  useFrame(() => {
    for (const k of slots) { const r = refs.current[k]; if (r) r.visible = logistics.rack[k].filled; }
  });
  const len = RACK.xs[RACK.xs.length - 1] - RACK.xs[0] + 3.2;
  const cx = (RACK.xs[0] + RACK.xs[RACK.xs.length - 1]) / 2;
  return (
    <group>
      {RACK.rowZ.map((z, row) => (
        <group key={z}>
          {[...RACK.xs.map((x) => x - 1.6), RACK.xs[RACK.xs.length - 1] + 1.6].map((x) => [-0.6, 0.6].map((dz) => (
            <mesh key={`${x}${dz}`} position={[x, 1.75, z + dz]} castShadow><boxGeometry args={[0.1, 3.5, 0.1]} /><meshStandardMaterial color="#2f6db0" /></mesh>
          )))}
          {[1.6, 3.3].map((y) => [-0.6, 0.6].map((dz) => (
            <mesh key={`${y}${dz}`} position={[cx, y, z + dz]} castShadow><boxGeometry args={[len, 0.12, 0.08]} /><meshStandardMaterial color="#f28c28" /></mesh>
          )))}
          {RACK.xs.map((x) => RACK.levels.map((ly, lvl) => {
            const key = `${row}_${x}_${lvl}`;
            return (
              <group key={key} ref={(r) => { refs.current[key] = r; }} position={[x, ly, z]}>
                <PalletLoad />
              </group>
            );
          }))}
        </group>
      ))}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[cx + 4, 0.006, RACK.aisleZ]}><planeGeometry args={[len + 14, 2.6]} /><meshStandardMaterial color="#5b6670" transparent opacity={0.2} /></mesh>
    </group>
  );
}

function Truck() {
  const g = useRef(null), loads = useRef(null);
  useFrame(() => {
    g.current.position.x = logistics.truck.x;
    loads.current.children.forEach((c, i) => { c.visible = i < logistics.truck.load; });
  });
  return (
    <group ref={g} position={[DOCK.truckX, 0, DOCK.z]}>
      {/* Semirremolque (abierto por la parte trasera, hacia el muelle) */}
      <mesh position={[1.2, 2.45, 0]} castShadow><boxGeometry args={[12, 0.08, 2.5]} /><meshStandardMaterial color="#e6e8ea" /></mesh>
      {[-1.25, 1.25].map((z) => (
        <mesh key={z} position={[1.2, 1.75, z]} castShadow><boxGeometry args={[12, 1.4, 0.05]} /><meshStandardMaterial color="#d23b2a" /></mesh>
      ))}
      <mesh position={[1.2, 1.0, 0]} castShadow receiveShadow><boxGeometry args={[12, 0.12, 2.5]} /><meshStandardMaterial color="#555" /></mesh>
      <group ref={loads}>
        {Array.from({ length: 10 }, (_, i) => (
          <group key={i} position={[-3.6 + Math.floor(i / 2) * 1.35 + 0.5, 1.06, i % 2 ? 0.6 : -0.6]} rotation={[0, Math.PI / 2, 0]}><PalletLoad /></group>
        ))}
      </group>
      {[-2.5, -1.2, 5.5].map((x) => [-1.1, 1.1].map((z) => (
        <mesh key={`${x}${z}`} position={[x, 0.5, z]} rotation={[Math.PI / 2, 0, 0]} castShadow><cylinderGeometry args={[0.5, 0.5, 0.3, 20]} /><meshStandardMaterial color="#151515" /></mesh>
      )))}
      {/* Cabeza tractora */}
      <group position={[8.6, 0, 0]}>
        <mesh position={[0, 1.7, 0]} castShadow><boxGeometry args={[2.4, 2.6, 2.5]} /><meshStandardMaterial color="#1f4e8c" metalness={0.3} roughness={0.4} /></mesh>
        <mesh position={[1.21, 2.3, 0]}><planeGeometry args={[0.02, 1]} /><meshStandardMaterial color="#9cc7e0" /></mesh>
        {[-1.1, 1.1].map((z) => (
          <mesh key={z} position={[0.3, 0.5, z]} rotation={[Math.PI / 2, 0, 0]}><cylinderGeometry args={[0.5, 0.5, 0.3, 20]} /><meshStandardMaterial color="#151515" /></mesh>
        ))}
      </group>
    </group>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
export function Logistics3D() {
  return (
    <group>
      <LogYard />
      <LogGantry />
      <Sawmill />
      <PadStacks />
      <StackerGantry />
      <Chargers />
      {logistics.agvs.map((a, i) => <Agv key={a.id} index={i} />)}
      <Palletizer />
      <Warehouse />
      <Truck />
    </group>
  );
}
