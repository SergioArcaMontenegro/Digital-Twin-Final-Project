// AGVs y personas (coordenadas de mundo, interpoladas entre instantáneas).
import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Html, Line } from '@react-three/drei';
import * as THREE from 'three';
import { ROLES, LAYERS_PER_STACK } from '../../../shared/config.js';
import { live } from '../../net/client.js';
import { tickAlpha, lerp, lerpAngle } from '../clock.js';
import { useUI } from '../ui.js';
import { useStack, PalletBlock } from './Machines.jsx';

const BEACON = { MOVING: '#39d353', WAIT: '#ffb020', ACTION: '#2f8cff', IDLE: '#7fdcff' };
const agvNow = (i) => live.tick?.logistics?.agvs?.[i];
const agvPrev = (i, id) => live.prev?.logistics?.agvs?.find((a) => a.id === id);

function Wheel({ x, z, r = 0.14 }) {
  return <mesh position={[x, r, z]} rotation={[Math.PI / 2, 0, 0]} castShadow><cylinderGeometry args={[r, r, 0.1, 18]} /><meshStandardMaterial color="#151515" /></mesh>;
}

function Agv({ index, id, type }) {
  const g = useRef(null), body = useRef(null), plate = useRef(null), beacon = useRef(null), field = useRef(null);
  const carriage = useRef(null), stackG = useRef(null), tag = useRef(null), lidar = useRef(null), batt = useRef(null);
  const showLabels = useUI((s) => s.showLabels);
  const select = useUI((s) => s.select);
  const selected = useUI((s) => s.selected === id);
  const isFork = type === 'fork';
  const stack = useStack(LAYERS_PER_STACK);
  const lineRef = useRef(null);
  useFrame(({ clock }, dt) => {
    const a = agvNow(index); if (!a || !g.current) return;
    const p = agvPrev(index, id), k = tickAlpha();
    const x = p ? lerp(p.x, a.x, k) : a.x, z = p ? lerp(p.z, a.z, k) : a.z, h = p ? lerpAngle(p.h, a.h, k) : a.h;
    g.current.position.set(x, 0, z);
    body.current.rotation.y = h;
    const col = BEACON[a.state] ?? '#fff';
    beacon.current.material.color.set(col);
    beacon.current.material.emissive.set(col);
    beacon.current.material.emissiveIntensity = a.state === 'WAIT' ? (Math.sin(clock.elapsedTime * 8) > 0 ? 2 : 0.2) : 1.5;
    field.current.visible = a.state === 'MOVING' || a.state === 'WAIT';
    field.current.material.color.set(a.state === 'WAIT' ? '#ffb020' : '#39d353');
    if (lidar.current) lidar.current.rotation.y += dt * 12;
    if (batt.current) { batt.current.scale.x = Math.max(0.02, a.battery / 100); batt.current.material.color.set(a.battery < 25 ? '#ff5a4a' : '#3ddc84'); }
    if (!isFork) {
      const lift = p ? lerp(p.lift, a.lift, k) : a.lift;
      plate.current.position.y = 0.32 + lift * 0.14;
      stackG.current.visible = a.load?.kind === 'stack';
      if (a.load?.kind === 'stack') stack.set(Math.ceil(a.load.boards / 6), a.load.species, a.load.dry);
      stackG.current.position.y = 0.45 + lift * 0.05;
    } else {
      carriage.current.position.y = 0.1 + (p ? lerp(p.liftH, a.liftH, k) : a.liftH);
      carriage.current.position.x = 0.95 + (p ? lerp(p.reach, a.reach, k) : a.reach) * (a.reachTo || 1.2);
    }
    if (tag.current) {
      tag.current.dataset.state = a.state;
      tag.current.querySelector('span').textContent = a.state === 'WAIT' ? a.wait : a.mission;
    }
    // ruta planificada (A*) del AGV seleccionado o de todos si se muestran etiquetas
    if (lineRef.current) {
      const show = (selected || showLabels) && a.path && a.path.length > 1;
      lineRef.current.visible = !!show;
      if (show) {
        const pts = a.path.map(([px, pz]) => new THREE.Vector3(px, 0.05, pz));
        lineRef.current.geometry.setPositions(pts.flatMap((v) => [v.x, v.y, v.z]));
      }
    }
  });
  const color = { 'AGV-A': '#f2b705', 'AGV-B': '#3ddc84', 'AGV-C': '#f28c28', 'AGV-D': '#2f8cff' }[id];
  return (
    <>
      <Line ref={lineRef} points={[[0, 0, 0], [0.01, 0, 0]]} color={color} lineWidth={2} dashed dashSize={0.6} gapSize={0.35} transparent opacity={0.85} />
      <group ref={g} onClick={(e) => { e.stopPropagation(); select(id); }}>
        <group ref={body}>
          {isFork ? (
            <group>
              <mesh position={[-0.35, 0.42, 0]} castShadow><boxGeometry args={[1.3, 0.7, 1.1]} /><meshStandardMaterial color="#e9eaec" metalness={0.2} roughness={0.5} /></mesh>
              <mesh position={[-0.35, 0.79, 0]} castShadow><boxGeometry args={[1.25, 0.06, 1.05]} /><meshStandardMaterial color={color} /></mesh>
              {[-0.45, 0.45].map((z) => <mesh key={z} position={[0.62, 1.4, z]} castShadow><boxGeometry args={[0.1, 2.7, 0.1]} /><meshStandardMaterial color="#3b3f45" metalness={0.6} /></mesh>)}
              <mesh position={[0.62, 2.72, 0]}><boxGeometry args={[0.12, 0.1, 1.0]} /><meshStandardMaterial color="#3b3f45" /></mesh>
              {[-0.45, 0.45].map((z) => <mesh key={`l${z}`} position={[0.55, 0.1, z]} castShadow><boxGeometry args={[1.0, 0.12, 0.14]} /><meshStandardMaterial color="#3b3f45" /></mesh>)}
              <Wheel x={-0.8} z={0.45} /><Wheel x={-0.8} z={-0.45} /><Wheel x={0.95} z={0.45} r={0.08} /><Wheel x={0.95} z={-0.45} r={0.08} />
              <group ref={carriage} position={[0.95, 0.1, 0]}>
                <mesh position={[-0.25, 0.35, 0]}><boxGeometry args={[0.08, 0.7, 0.95]} /><meshStandardMaterial color="#2b2d31" /></mesh>
                {[-0.3, 0.3].map((z) => <mesh key={z} position={[0.35, 0.02, z]} castShadow><boxGeometry args={[1.15, 0.05, 0.12]} /><meshStandardMaterial color="#2b2d31" metalness={0.6} /></mesh>)}
                <group position={[0.35, 0.05, 0]} rotation={[0, Math.PI / 2, 0]}>
                  <PalletBlock pallet={() => { const a = agvNow(index); return a?.load?.kind === 'pallet' ? a.load.pallet : null; }} />
                </group>
              </group>
              <group position={[-0.95, 0.85, 0.42]}>
                <mesh><cylinderGeometry args={[0.07, 0.07, 0.06, 16]} /><meshStandardMaterial color="#111" /></mesh>
                <mesh ref={lidar} position={[0, 0.05, 0]}><boxGeometry args={[0.1, 0.03, 0.03]} /><meshStandardMaterial color="#ff3030" emissive="#ff3030" emissiveIntensity={1} /></mesh>
              </group>
              <mesh ref={beacon} position={[-0.95, 1.05, -0.42]}><cylinderGeometry args={[0.06, 0.06, 0.16, 14]} /><meshStandardMaterial color="#39d353" emissive="#39d353" /></mesh>
              <mesh ref={batt} position={[-1.01, 0.6, 0]} rotation={[0, Math.PI / 2, 0]}><planeGeometry args={[0.6, 0.08]} /><meshBasicMaterial color="#3ddc84" /></mesh>
            </group>
          ) : (
            <group>
              <mesh position={[0, 0.16, 0]} castShadow><boxGeometry args={[2.2, 0.3, 1.25]} /><meshStandardMaterial color="#f4f4f1" metalness={0.2} roughness={0.5} /></mesh>
              <mesh position={[0, 0.06, 0]}><boxGeometry args={[2.24, 0.08, 1.29]} /><meshStandardMaterial color={color} /></mesh>
              {[-1.1, 1.1].map((x) => <mesh key={x} position={[x, 0.16, 0]}><boxGeometry args={[0.04, 0.22, 1.2]} /><meshStandardMaterial color="#222" /></mesh>)}
              <mesh ref={plate} position={[0, 0.32, 0]} castShadow><cylinderGeometry args={[0.5, 0.5, 0.06, 32]} /><meshStandardMaterial color="#3b3f45" metalness={0.7} /></mesh>
              <group position={[1.02, 0.34, 0.5]}>
                <mesh><cylinderGeometry args={[0.07, 0.07, 0.06, 16]} /><meshStandardMaterial color="#111" /></mesh>
                <mesh ref={lidar} position={[0, 0.04, 0]}><boxGeometry args={[0.1, 0.03, 0.03]} /><meshStandardMaterial color="#ff3030" emissive="#ff3030" emissiveIntensity={1} /></mesh>
              </group>
              <mesh ref={beacon} position={[-1.0, 0.38, -0.5]}><cylinderGeometry args={[0.06, 0.06, 0.14, 14]} /><meshStandardMaterial color="#39d353" emissive="#39d353" /></mesh>
              <mesh ref={batt} position={[-1.105, 0.2, 0]} rotation={[0, -Math.PI / 2, 0]}><planeGeometry args={[0.8, 0.07]} /><meshBasicMaterial color="#3ddc84" /></mesh>
            </group>
          )}
          <mesh ref={field} position={[isFork ? 1.6 : 1.9, 0.012, 0]} rotation={[-Math.PI / 2, 0, 0]}>
            <planeGeometry args={[1.6, isFork ? 1.4 : 1.6]} /><meshBasicMaterial color="#39d353" transparent opacity={0.22} depthWrite={false} />
          </mesh>
          {!isFork && <group ref={stackG}><primitive object={stack.group} /></group>}
          {selected && <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.02, 0]}><ringGeometry args={[1.5, 1.65, 48]} /><meshBasicMaterial color="#2f8cff" /></mesh>}
        </group>
        {showLabels && (
          <Html position={[0, isFork ? 3.2 : 1.9, 0]} center distanceFactor={10} zIndexRange={[5, 0]}>
            <div ref={tag} className="agv-tag" onClick={() => select(id)}><b>{id}</b><span /></div>
          </Html>
        )}
      </group>
    </>
  );
}

export function Agvs() {
  const list = useMemo(() => [['AGV-A', 'lift'], ['AGV-B', 'lift'], ['AGV-C', 'fork'], ['AGV-D', 'fork']], []);
  return list.map(([id, type], i) => <Agv key={id} index={i} id={id} type={type} />);
}

// ═════════════════════════════════════════════════════════════════════════════
// Personas: un avatar por trabajador en turno, con chaleco del color de su función
// ═════════════════════════════════════════════════════════════════════════════
const BODY = new THREE.CapsuleGeometry(0.2, 0.55, 4, 10);
const HEAD = new THREE.SphereGeometry(0.14, 14, 12);
const HELMET = new THREE.SphereGeometry(0.155, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2);
const LEG = new THREE.CapsuleGeometry(0.08, 0.5, 4, 8);
const SKIN = new THREE.MeshStandardMaterial({ color: '#e2b48a', roughness: 0.8 });
const PANTS = new THREE.MeshStandardMaterial({ color: '#2a3442', roughness: 0.8 });
const roleMat = {};
const vest = (role) => (roleMat[role] ||= new THREE.MeshStandardMaterial({ color: ROLES[role]?.color || '#888', roughness: 0.6 }));
const HELMET_MAT = new THREE.MeshStandardMaterial({ color: '#f5f5f5', roughness: 0.4 });

export function Workers() {
  const root = useRef(null);
  const pool = useRef(new Map());
  const showLabels = useUI((s) => s.showLabels);
  useFrame(({ clock }) => {
    const tk = live.tick; if (!tk || !root.current) return;
    const prev = new Map((live.prev?.avatars || []).map((a) => [a.id, a]));
    const k = tickAlpha();
    const seen = new Set();
    for (const a of tk.avatars || []) {
      seen.add(a.id);
      let e = pool.current.get(a.id);
      if (!e) {
        const g = new THREE.Group();
        const body = new THREE.Mesh(BODY, vest(a.role)); body.position.y = 1.0; body.castShadow = true;
        const head = new THREE.Mesh(HEAD, SKIN); head.position.y = 1.55; head.castShadow = true;
        const helmet = new THREE.Mesh(HELMET, a.role === 'gerente' || a.role === 'comercial' ? SKIN : HELMET_MAT); helmet.position.y = 1.58;
        if (a.role === 'gerente' || a.role === 'comercial') helmet.visible = false;
        const l1 = new THREE.Mesh(LEG, PANTS), l2 = new THREE.Mesh(LEG, PANTS);
        l1.position.set(0, 0.35, 0.1); l2.position.set(0, 0.35, -0.1);
        g.add(body, head, helmet, l1, l2);
        root.current.add(g);
        e = { g, l1, l2, ph: Math.random() * 6 };
        pool.current.set(a.id, e);
      }
      const p = prev.get(a.id);
      const x = p ? lerp(p.x, a.x, k) : a.x, z = p ? lerp(p.z, a.z, k) : a.z;
      e.g.position.set(x, a.y || 0, z);
      e.g.rotation.y = p ? lerpAngle(p.h, a.h, k) : a.h;
      const sw = a.moving ? Math.sin(clock.elapsedTime * 8 + e.ph) * 0.45 : 0;
      e.l1.rotation.z = sw; e.l2.rotation.z = -sw;
    }
    for (const [id, e] of pool.current) if (!seen.has(id)) { root.current.remove(e.g); pool.current.delete(id); }
  });
  return (
    <group>
      <group ref={root} />
      {showLabels && <WorkerTags />}
    </group>
  );
}

/** Etiquetas con el nombre (solo de los que están parados en su puesto, para no saturar). */
function WorkerTags() {
  const ref = useRef(null);
  const tags = useRef([]);
  useFrame(() => {
    const tk = live.tick; if (!tk) return;
    const list = (tk.avatars || []).filter((a) => !a.moving).slice(0, 24);
    tags.current.forEach((el, i) => {
      if (!el) return;
      const a = list[i];
      el.style.display = a ? '' : 'none';
      if (a) {
        el.textContent = `${a.name?.split(' ')[0] || ''} · ${ROLES[a.role]?.short || ''}`;
      }
    });
    if (ref.current) ref.current.children.forEach((c, i) => { const a = list[i]; c.visible = !!a; if (a) c.position.set(a.x, (a.y || 0) + 2.05, a.z); });
  });
  return (
    <group ref={ref}>
      {Array.from({ length: 24 }, (_, i) => (
        <group key={i}>
          <Html center distanceFactor={12} zIndexRange={[4, 0]}>
            <div className="person-tag" ref={(r) => { tags.current[i] = r; }} />
          </Html>
        </group>
      ))}
    </group>
  );
}
