// ─────────────────────────────────────────────────────────────────────────────
// Secciones de la planta. Cada zona se dibuja dentro de un grupo con su colocación
// (posición + giro): moverla en el modo edición mueve todo lo que contiene.
// ─────────────────────────────────────────────────────────────────────────────
import { memo, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { ZONES, PIECE_Y, BAR_BEAM_Y, SIDE_RACK, robotsOfCell } from '../../../shared/zones.js';
import { fmtClock, fmtEur, SHIFTS } from '../../../shared/config.js';
import { live } from '../../net/client.js';
import { useUI } from '../ui.js';
import { ZoneFloor, Fence, HangingSign, FloorLabel, steel } from './common.jsx';
import { RobotArm, RobotCabinet } from './RobotArm.jsx';
import { SawZone, KilnZone, PlanerZone, PalletizerZone, WarehouseZone, DockZone } from './Machines.jsx';

// ── Equipos de las celdas ────────────────────────────────────────────────────
function CncEquipment() {
  return (
    <group>
      {[-1.05, 1.05].map((dx) => <mesh key={dx} position={[dx, 1.25, -0.75]} castShadow><boxGeometry args={[0.14, 1.0, 0.14]} /><meshStandardMaterial color="#3b3f45" /></mesh>)}
      <mesh position={[0, 1.78, -0.75]} castShadow><boxGeometry args={[2.3, 0.14, 0.18]} /><meshStandardMaterial color="#3b3f45" /></mesh>
      {[-0.6, 0.6].map((dx) => <mesh key={dx} position={[dx, PIECE_Y + 0.12, -0.32]} castShadow><boxGeometry args={[0.12, 0.08, 0.2]} /><meshStandardMaterial color="#d23b2a" /></mesh>)}
      <mesh position={[0, 3.6, 0]} castShadow><boxGeometry args={[2.4, 0.5, 1.6]} /><meshStandardMaterial color="#b8bec5" metalness={0.6} roughness={0.4} /></mesh>
      <mesh position={[0, 6.0, 0]}><cylinderGeometry args={[0.22, 0.22, 4.4, 14]} /><meshStandardMaterial color="#b8bec5" metalness={0.7} roughness={0.35} /></mesh>
      <group position={[-5.4, 0, 3.4]}>
        <mesh position={[0, 0.6, 0]} castShadow><boxGeometry args={[1.1, 1.2, 0.5]} /><meshStandardMaterial color="#3b3f45" /></mesh>
        {[-0.35, -0.12, 0.12, 0.35].map((x) => <mesh key={x} position={[x, 1.32, 0]}><cylinderGeometry args={[0.04, 0.04, 0.2, 10]} /><meshStandardMaterial color="#c9a245" metalness={1} /></mesh>)}
      </group>
    </group>
  );
}
function LijEquipment() {
  return (
    <group>
      <mesh position={[0, 3.4, 0]} castShadow><boxGeometry args={[3.2, 0.6, 2.2]} /><meshStandardMaterial color="#b8bec5" metalness={0.6} roughness={0.4} /></mesh>
      <mesh position={[0, 5.9, 0]}><cylinderGeometry args={[0.24, 0.24, 4.4, 14]} /><meshStandardMaterial color="#b8bec5" metalness={0.7} roughness={0.35} /></mesh>
      <group position={[5.2, 0, -3.6]}>
        <mesh position={[0, 0.55, 0]} castShadow><boxGeometry args={[0.8, 1.1, 0.8]} /><meshStandardMaterial color="#3b3f45" /></mesh>
        {[0, 1, 2, 3].map((i) => <mesh key={i} position={[0, 1.12 + i * 0.03, 0]}><cylinderGeometry args={[0.12, 0.12, 0.02, 20]} /><meshStandardMaterial color="#8a5a32" /></mesh>)}
      </group>
    </group>
  );
}
function EnsEquipment() {
  return (
    <group>
      {robotsOfCell('ENS').map((r) => {
        const rx = r.local[0] + (r.index === 2 ? 0.8 : 0), rz = r.local[2] + r.side * SIDE_RACK.dz;
        return (
          <group key={r.id} position={[rx, 0, rz]}>
            <mesh position={[0, SIDE_RACK.y / 2, 0]} castShadow><boxGeometry args={[0.9, SIDE_RACK.y, 0.8]} /><meshStandardMaterial color="#2f6db0" metalness={0.4} roughness={0.5} /></mesh>
            {[0, 1, 2, 3, 4].map((i) => <mesh key={i} position={[0, SIDE_RACK.y + 0.012 + i * 0.022, 0]} castShadow><boxGeometry args={[0.52, 0.018, 0.74]} /><meshStandardMaterial color="#e2c497" roughness={0.7} /></mesh>)}
          </group>
        );
      })}
      <group position={[5.2, 0, 3.6]}>
        <mesh position={[0, 0.7, 0]} castShadow><boxGeometry args={[0.7, 1.4, 0.7]} /><meshStandardMaterial color="#d9d6cf" /></mesh>
        <mesh position={[0, 1.55, 0]}><cylinderGeometry args={[0.28, 0.12, 0.35, 16]} /><meshStandardMaterial color="#9aa3ab" metalness={0.7} /></mesh>
      </group>
    </group>
  );
}
function VarnishBooth() {
  const [L, W, H] = ZONES.BAR.geo.booth;
  const glass = { color: '#a9d4ec', transparent: true, opacity: 0.13, metalness: 0.2, roughness: 0.1, depthWrite: false, side: THREE.DoubleSide };
  const frame = { color: '#e7e9eb', metalness: 0.5, roughness: 0.4 };
  const edges = [];
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) edges.push([sx * L / 2, H / 2, sz * W / 2, 0.12, H, 0.12]);
  for (const sz of [-1, 1]) edges.push([0, H, sz * W / 2, L, 0.14, 0.14]);
  for (const sx of [-1, 1]) edges.push([sx * L / 2, H, 0, 0.14, 0.14, W]);
  for (let i = -2; i <= 2; i++) for (const sz of [-1, 1]) edges.push([i * L / 6, H / 2, sz * W / 2, 0.08, H, 0.08]);
  return (
    <group>
      <mesh position={[0, H / 2, W / 2]}><planeGeometry args={[L, H]} /><meshStandardMaterial {...glass} /></mesh>
      <mesh position={[0, H / 2, -W / 2]}><planeGeometry args={[L, H]} /><meshStandardMaterial {...glass} /></mesh>
      {[-1, 1].map((sx) => (
        <group key={sx}>
          {[-1, 1].map((sz) => <mesh key={sz} position={[sx * L / 2, H / 2, sz * (W / 4 + 0.8)]} rotation={[0, Math.PI / 2, 0]}><planeGeometry args={[W / 2 - 1.6, H]} /><meshStandardMaterial {...glass} /></mesh>)}
          <mesh position={[sx * L / 2, H - 0.75, 0]} rotation={[0, Math.PI / 2, 0]}><planeGeometry args={[3.2, 1.5]} /><meshStandardMaterial {...glass} /></mesh>
        </group>
      ))}
      {edges.map(([ex, ey, ez, w, h, d], i) => <mesh key={i} position={[ex, ey, ez]} castShadow><boxGeometry args={[w, h, d]} /><meshStandardMaterial {...frame} /></mesh>)}
      {/* plénum de impulsión de aire filtrado: translúcido para ver los robots desde arriba */}
      <mesh position={[0, H + 0.45, 0]}><boxGeometry args={[L, 0.8, W]} /><meshStandardMaterial color="#f4f5f6" transparent opacity={0.22} roughness={0.4} depthWrite={false} /></mesh>
      {[-1, 1].map((s) => <mesh key={s} position={[0, H + 0.45, s * (W / 2 - 0.3)]} castShadow><boxGeometry args={[L, 0.8, 0.6]} /><meshStandardMaterial color="#f4f5f6" roughness={0.7} /></mesh>)}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.009, 0]}><planeGeometry args={[L - 0.4, W - 0.4]} /><meshStandardMaterial color="#9aa3ab" metalness={0.6} roughness={0.5} /></mesh>
      {robotsOfCell('BAR').map((r) => (
        <group key={r.id}>
          <mesh position={[0, BAR_BEAM_Y + 0.18, r.local[2]]} castShadow><boxGeometry args={[L - 0.4, 0.3, 0.42]} /><meshStandardMaterial color="#7d848c" metalness={0.6} roughness={0.4} /></mesh>
          <mesh position={[r.local[0], BAR_BEAM_Y + 0.02, r.local[2]]}><boxGeometry args={[0.9, 0.06, 0.9]} /><meshStandardMaterial color="#5d6670" metalness={0.7} /></mesh>
          {[-1, 1].map((sx) => <mesh key={sx} position={[sx * (L / 2 - 0.4), (BAR_BEAM_Y + H) / 2 + 0.1, r.local[2]]}><boxGeometry args={[0.2, H - BAR_BEAM_Y + 0.2, 0.2]} /><meshStandardMaterial color="#7d848c" /></mesh>)}
        </group>
      ))}
    </group>
  );
}

/** Baliza de estado de la celda (verde marcha · ámbar espera · rojo avería · azul mantenimiento). */
function LightTower({ cellId, at }) {
  const lamps = useRef([]);
  useFrame(({ clock }) => {
    const tk = live.tick; if (!tk) return;
    const rs = Object.values(tk.robots).filter((r) => r.cellId === cellId);
    const fault = rs.some((r) => r.status === 'FAULT'), maint = rs.some((r) => r.status === 'MAINT');
    const w = tk.line.work?.[cellId];
    const run = w && w.kind && !w.done;
    const blink = Math.sin(clock.elapsedTime * 7) > 0;
    const on = [fault && blink, !fault && !run, run && !fault, maint];
    lamps.current.forEach((m, i) => { if (m) m.emissiveIntensity = on[i] ? 2.2 : 0.05; });
  });
  const colors = ['#ff3030', '#ffb020', '#29d36a', '#2f8cff'];
  return (
    <group position={[at[0], 0, at[1]]}>
      <mesh position={[0, 1.2, 0]}><cylinderGeometry args={[0.03, 0.03, 2.4, 8]} /><meshStandardMaterial {...steel} /></mesh>
      {colors.map((c, i) => (
        <mesh key={c} position={[0, 2.95 - i * 0.16, 0]}>
          <cylinderGeometry args={[0.07, 0.07, 0.15, 16]} />
          <meshStandardMaterial ref={(r) => { lamps.current[i] = r; }} color={c} emissive={c} emissiveIntensity={0.05} toneMapped={false} />
        </mesh>
      ))}
    </group>
  );
}

function RobotCell({ id }) {
  const robots = robotsOfCell(id);
  const cabinets = robots.map((r, i) => [2.2 + i * 2.2, r.side * (id === 'BAR' ? 5.25 : 4.9)]);
  return (
    <group>
      {id === 'CNC' && <CncEquipment />}
      {id === 'LIJ' && <LijEquipment />}
      {id === 'ENS' && <EnsEquipment />}
      {id === 'BAR' && <VarnishBooth />}
      {robots.map((r) => <RobotArm key={r.id} def={r} />)}
      {robots.map((r, i) => <RobotCabinet key={r.id} def={r} at={cabinets[i]} />)}
      <LightTower cellId={id} at={[-6.9, 5.35]} />
    </group>
  );
}

// ── Base de AGVs, sala de control y taller ───────────────────────────────────
function AgvBase() {
  const G = ZONES.AGVB.geo;
  return (
    <group>
      {G.chargers.map((x, i) => (
        <group key={x} position={[x, 0, 0.15]}>
          <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.006, 0]}><planeGeometry args={[1.6, 2.6]} /><meshStandardMaterial color="#2f8cff" transparent opacity={0.22} /></mesh>
          <mesh position={[0, 0.5, -1.95]} castShadow><boxGeometry args={[0.5, 1.0, 0.3]} /><meshStandardMaterial color="#e6e8ea" /></mesh>
          <mesh position={[0, 0.85, -1.79]}><boxGeometry args={[0.3, 0.12, 0.02]} /><meshStandardMaterial color="#0b3550" emissive="#2f8cff" emissiveIntensity={0.8} /></mesh>
          <FloorLabel text={`C${i + 1}`} position={[0, 0.012, 1.0]} height={0.35} color="#2f8cff" />
        </group>
      ))}
    </group>
  );
}

function VideoWall() {
  const { canvas, texture } = useMemo(() => {
    const canvas = document.createElement('canvas'); canvas.width = 1024; canvas.height = 512;
    const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
    return { canvas, texture };
  }, []);
  const last = useRef(0);
  useFrame(({ clock }) => {
    if (clock.elapsedTime - last.current < 0.5) return;
    last.current = clock.elapsedTime;
    const tk = live.tick; if (!tk) return;
    const h = tk.hud || {};
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#07131d'; ctx.fillRect(0, 0, 1024, 512);
    ctx.fillStyle = '#39c0ff'; ctx.font = '700 38px Segoe UI, Arial'; ctx.fillText('GEMELO DIGITAL · PLANTA DE MADERA', 32, 58);
    ctx.fillStyle = '#9fb6c8'; ctx.font = '500 24px Segoe UI, Arial';
    ctx.fillText(`${fmtClock(tk.t)} · turno de ${SHIFTS[h.shift]?.name.toLowerCase() || ''} · ×${tk.speed}`, 32, 94);
    const produced = Object.values(h.produced || {}).reduce((a, b) => a + b, 0);
    const tiles = [
      ['CAJA', fmtEur(h.cash || 0), (h.cash || 0) >= 0 ? '#3ddc84' : '#ff5a4a'],
      ['UDS. ESTE TURNO', `${h.shiftUnits || 0}`, '#e8eef3'],
      ['PEDIDOS ABIERTOS', `${h.openOrders || 0}`, '#e8eef3'],
      ['PARADAS NO PROG.', `${h.unplanned || 0}`, h.unplanned ? '#ff5a4a' : '#3ddc84'],
    ];
    tiles.forEach(([t, v, c], i) => {
      const x = 32 + i * 245;
      ctx.fillStyle = '#0f2231'; ctx.fillRect(x, 120, 225, 110);
      ctx.fillStyle = '#7f98ab'; ctx.font = '600 19px Segoe UI, Arial'; ctx.fillText(t, x + 14, 150);
      ctx.fillStyle = c; ctx.font = '700 40px Segoe UI, Arial'; ctx.fillText(v, x + 14, 208);
    });
    Object.values(tk.robots).forEach((r, i) => {
      const x = 32 + (i % 5) * 196, y = 250 + Math.floor(i / 5) * 84;
      const c = r.status === 'FAULT' ? '#ff5a4a' : r.status === 'MAINT' ? '#3d8bff' : r.temp > 85 ? '#ffb020' : '#3ddc84';
      ctx.fillStyle = '#0f2231'; ctx.fillRect(x, y, 180, 74);
      ctx.fillStyle = c; ctx.fillRect(x, y, 6, 74);
      ctx.fillStyle = '#e8eef3'; ctx.font = '700 22px Segoe UI, Arial'; ctx.fillText(r.id, x + 16, y + 28);
      ctx.fillStyle = '#9fb6c8'; ctx.font = '500 18px Segoe UI, Arial';
      ctx.fillText(`${r.temp.toFixed(0)} °C · ${Math.round(r.wear * 100)} % desg.`, x + 16, y + 56);
    });
    ctx.fillStyle = '#9fb6c8'; ctx.font = '500 20px Segoe UI, Arial';
    ctx.fillText(`Producido total: ${produced} uds · ${tk.line.blocked ? `Línea: ${tk.line.blocked}` : 'Línea en marcha'}`, 32, 470);
    texture.needsUpdate = true;
  });
  return <mesh position={[0, 0, 0.06]}><planeGeometry args={[6.4, 3.2]} /><meshBasicMaterial map={texture} toneMapped={false} /></mesh>;
}

function ControlRoom() {
  const h = ZONES.CTRL.elevated;
  return (
    <group>
      <mesh position={[0, h / 2, 0]} castShadow receiveShadow><boxGeometry args={[9, h, 7]} /><meshStandardMaterial color="#59626b" metalness={0.3} roughness={0.7} /></mesh>
      <mesh position={[0, h + 1.5, 0]}><boxGeometry args={[9, 3, 7]} /><meshStandardMaterial color="#9cc7e0" transparent opacity={0.22} metalness={0.3} roughness={0.1} depthWrite={false} /></mesh>
      <mesh position={[0, h + 3.05, 0]} castShadow><boxGeometry args={[9.2, 0.12, 7.2]} /><meshStandardMaterial color="#e6e8ea" /></mesh>
      {[[-4.5, -3.5], [4.5, -3.5], [-4.5, 3.5], [4.5, 3.5]].map(([a, b]) => <mesh key={`${a}${b}`} position={[a, h + 1.5, b]}><boxGeometry args={[0.12, 3, 0.12]} /><meshStandardMaterial color="#e6e8ea" /></mesh>)}
      <mesh position={[0, h + 0.45, -1.6]} castShadow><boxGeometry args={[5, 0.9, 1]} /><meshStandardMaterial color="#20262c" /></mesh>
      {[-1.6, 0, 1.6].map((dx) => <mesh key={dx} position={[dx, h + 1.25, -1.9]} rotation={[0.2, 0, 0]}><boxGeometry args={[1.2, 0.7, 0.05]} /><meshStandardMaterial color="#0a1520" emissive="#0b3550" emissiveIntensity={0.9} /></mesh>)}
      {Array.from({ length: 10 }, (_, i) => <mesh key={i} position={[5.2, 0.16 + i * 0.32, -3.2 + i * 0.32]} castShadow><boxGeometry args={[1.2, 0.08, 0.34]} /><meshStandardMaterial color="#8a939c" metalness={0.6} /></mesh>)}
      <group position={[0, h + 4.6, -3.6]} rotation={[0, Math.PI, 0]}>
        <mesh><boxGeometry args={[6.7, 3.5, 0.1]} /><meshStandardMaterial color="#111" /></mesh>
        <VideoWall />
      </group>
      <group position={[0, h + 4.6, -3.66]}>
        <VideoWall />
      </group>
    </group>
  );
}

function Workshop() {
  return (
    <group>
      <mesh position={[0, 0.45, -1.9]} castShadow receiveShadow><boxGeometry args={[6.4, 0.9, 1.0]} /><meshStandardMaterial color="#5d6670" metalness={0.5} roughness={0.5} /></mesh>
      <mesh position={[0, 0.92, -1.9]}><boxGeometry args={[6.4, 0.04, 1.0]} /><meshStandardMaterial color="#8a6a46" roughness={0.8} /></mesh>
      <mesh position={[0, 1.8, -2.4]}><boxGeometry args={[6.4, 1.6, 0.05]} /><meshStandardMaterial color="#2f6db0" /></mesh>
      {[-2.5, -1.5, -0.5, 0.5, 1.5, 2.5].map((x) => <mesh key={x} position={[x, 1.8, -2.35]}><boxGeometry args={[0.08, 0.4, 0.06]} /><meshStandardMaterial color="#c8cdd2" metalness={0.9} /></mesh>)}
      {/* reductora de repuesto sobre su soporte */}
      <group position={[2.4, 0, 1.0]}>
        <mesh position={[0, 0.4, 0]} castShadow><boxGeometry args={[0.8, 0.8, 0.8]} /><meshStandardMaterial color="#3a3d42" /></mesh>
        <mesh position={[0, 1.0, 0]} rotation={[Math.PI / 2, 0, 0]} castShadow><cylinderGeometry args={[0.28, 0.28, 0.4, 24]} /><meshStandardMaterial color="#f28c28" /></mesh>
      </group>
      <group position={[-2.6, 0, 1.2]}>
        {[0.3, 0.9, 1.5].map((y) => <mesh key={y} position={[0, y, 0]} castShadow><boxGeometry args={[1.2, 0.05, 0.6]} /><meshStandardMaterial color="#9aa3ab" /></mesh>)}
        {[0.3, 0.9].map((y) => <mesh key={`b${y}`} position={[0.1, y + 0.18, 0]}><boxGeometry args={[0.5, 0.3, 0.4]} /><meshStandardMaterial color="#d23b2a" /></mesh>)}
      </group>
    </group>
  );
}

// ── Carcasa de cada zona ─────────────────────────────────────────────────────
const CONTENT = {
  ASE: SawZone, KILN: KilnZone, CEP: PlanerZone, PAL: PalletizerZone, ALM: WarehouseZone, DOCK: DockZone,
  AGVB: AgvBase, CTRL: ControlRoom, MANT: Workshop,
};
const FENCE = {
  CNC: { gaps: [['w', -1.3, 1.3], ['e', -1.3, 1.3], ['n', -6.8, -4.6]], tint: '#d0743a' },
  LIJ: { gaps: [['w', -1.3, 1.3], ['e', -1.3, 1.3], ['n', -6.8, -4.6]] },
  ENS: { gaps: [['w', -1.3, 1.3], ['e', -1.3, 1.3], ['n', -6.8, -4.6]] },
  PAL: { gaps: [['w', -1.3, 1.3], ['s', -1.1, 1.1], ['e', -1.1, 1.1], ['s', -5.6, -3.6]], curtains: [[0, 5.75]] },
};

const Zone = memo(function Zone({ z, invalid, selected }) {
  const { def, pl } = z;
  const Content = CONTENT[z.id];
  const [lx, lz] = def.size;
  const fence = FENCE[z.id];
  const editing = useUI((s) => s.edit);
  return (
    <group position={[pl.x, 0, pl.z]} rotation={[0, pl.rot * Math.PI / 2, 0]}>
      <ZoneFloor lx={lx} lz={lz} color={def.color} label={def.name.toUpperCase()} opacity={editing ? 0.32 : 0.16} />
      {fence && <Fence cx={0} cz={0} lx={lx} lz={lz} gaps={fence.gaps} tint={fence.tint} curtains={fence.curtains} />}
      {def.cell && <RobotCell id={z.id} />}
      {Content && <Content />}
      {(def.station || z.id === 'KILN' || z.id === 'ASE') && <HangingSign text={`${z.id} · ${def.short}`} position={[0, z.id === 'KILN' ? 9.2 : 7.4, lz / 2]} />}
      {editing && (
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.03, 0]}>
          <planeGeometry args={[lx, lz]} />
          <meshBasicMaterial color={invalid ? '#ff3b30' : selected ? '#2f8cff' : def.movable ? '#ffffff' : '#888'} transparent opacity={invalid ? 0.35 : selected ? 0.3 : 0.08} depthWrite={false} />
        </mesh>
      )}
    </group>
  );
}, (a, b) => a.invalid === b.invalid && a.selected === b.selected && a.z.pl.x === b.z.pl.x && a.z.pl.z === b.z.pl.z && a.z.pl.rot === b.z.pl.rot);

export function Zones({ plant }) {
  const editZone = useUI((s) => s.editZone);
  const bad = useMemo(() => new Set(plant.errors.flatMap((e) => [e.zone, e.other].filter(Boolean))), [plant]);
  return Object.values(plant.zones).map((z) => <Zone key={z.id} z={z} invalid={bad.has(z.id)} selected={editZone === z.id} />);
}
