// ─────────────────────────────────────────────────────────────────────────────
// Visor 3D del gemelo digital: planta, robots, AGV, personas y modo edición.
// ─────────────────────────────────────────────────────────────────────────────
import { Suspense, useEffect, useMemo, useRef } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import * as THREE from 'three';
import { buildPlant } from '../../shared/layout.js';
import { DEFAULT_PLACEMENTS } from '../../shared/zones.js';
import { HALL } from '../../shared/config.js';
import { connect, useNet } from '../net/client.js';
import { useUI } from './ui.js';
import { Building, Luminaires } from './scene/common.jsx';
import { Zones } from './scene/Zones.jsx';
import { Conveyor, LineTrays } from './scene/Conveyor.jsx';
import { Agvs, Workers } from './scene/Movers.jsx';
import { Hud } from './hud/Hud.jsx';
import '../ui/twin.css';
import './viewer.css';

const api = connect({ want: ['tick', 'scene', 'state'], app: 'viewer' });

/** Distribución a dibujar: la del servidor o, en modo edición, el borrador. */
export function usePlant() {
  const placements = useNet((s) => s.scene?.placements);
  const draft = useUI((s) => (s.edit ? s.draft : null));
  const src = draft || placements || DEFAULT_PLACEMENTS;
  const key = JSON.stringify(src);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => buildPlant(src), [key]);
}

const Q = new URLSearchParams(location.search);
const CAM = Q.get('cam')?.split(',').map(Number);
const VIEW0 = CAM?.length === 6 ? { pos: CAM.slice(0, 3), target: CAM.slice(3) } : { pos: [-2, 92, 70], target: [-2, 0, -2] };
const NOHUD = Q.has('nohud');

function CameraRig({ controls }) {
  const focus = useUI((s) => s.focus);
  const setFocus = useUI((s) => s.setFocus);
  const { camera } = useThree();
  const goal = useRef(null);
  useEffect(() => {
    if (!focus) return;
    goal.current = { pos: new THREE.Vector3(...focus.pos), target: new THREE.Vector3(...focus.target) };
  }, [focus]);
  useFrame((_, dt) => {
    const c = controls.current;
    if (!goal.current || !c) return;
    const k = 1 - Math.exp(-dt * 3);
    camera.position.lerp(goal.current.pos, k);
    c.target.lerp(goal.current.target, k);
    c.update();
    if (camera.position.distanceTo(goal.current.pos) < 0.05) { goal.current = null; setFocus(null); }
  });
  return null;
}

/** Arrastre de zonas en el modo edición (plano del suelo + rejilla de 1 m). */
function EditDrag({ plant, controls }) {
  const edit = useUI((s) => s.edit);
  const drag = useRef(null);
  const plane = useMemo(() => new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), []);
  const hit = useMemo(() => new THREE.Vector3(), []);
  const { camera, gl, raycaster, pointer } = useThree();
  // ayuda para pruebas automáticas: posición en pantalla de un punto del suelo
  useEffect(() => {
    window.__gdProject = (x, z) => {
      const v = new THREE.Vector3(x, 0, z).project(camera);
      const r = gl.domElement.getBoundingClientRect();
      return [r.left + ((v.x + 1) / 2) * r.width, r.top + ((1 - v.y) / 2) * r.height];
    };
  }, [camera, gl]);
  useEffect(() => {
    if (!edit) return undefined;
    const ground = () => { raycaster.setFromCamera(pointer, camera); return raycaster.ray.intersectPlane(plane, hit) ? hit.clone() : null; };
    const down = (e) => {
      if (e.button !== 0) return;
      const p = ground(); if (!p) return;
      const { draft } = useUI.getState();
      // zona bajo el puntero (la de menor área si se solapan)
      let best = null, area = Infinity;
      for (const z of Object.values(plant.zones)) {
        const [x0, z0, x1, z1] = z.rect;
        if (p.x >= x0 && p.x <= x1 && p.z >= z0 && p.z <= z1) { const a = (x1 - x0) * (z1 - z0); if (a < area) { area = a; best = z; } }
      }
      if (!best) { useUI.getState().setEditZone(null); return; }
      useUI.getState().setEditZone(best.id);
      if (!best.def.movable) return;
      drag.current = { id: best.id, dx: draft[best.id].x - p.x, dz: draft[best.id].z - p.z };
      if (controls.current) controls.current.enabled = false;
      useUI.getState().setDragging(true);
    };
    const move = () => {
      if (!drag.current) return;
      const p = ground(); if (!p) return;
      const { draft, setDraft } = useUI.getState();
      const d = drag.current;
      const nx = Math.round(p.x + d.dx), nz = Math.round(p.z + d.dz);
      const cur = draft[d.id];
      if (cur.x !== nx || cur.z !== nz) setDraft({ ...draft, [d.id]: { ...cur, x: Math.max(HALL.x0, Math.min(HALL.x1, nx)), z: Math.max(HALL.z0, Math.min(HALL.z1, nz)) } });
    };
    const up = () => {
      if (!drag.current) return;
      drag.current = null;
      if (controls.current) controls.current.enabled = true;
      useUI.getState().setDragging(false);
    };
    const el = gl.domElement;
    el.addEventListener('pointerdown', down);
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    return () => { el.removeEventListener('pointerdown', down); window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
  }, [edit, plant, camera, gl, raycaster, pointer, plane, hit, controls]);
  return null;
}

/** Superposición del modo edición: cinta propuesta y obstáculos de navegación. */
function EditOverlay({ plant }) {
  const edit = useUI((s) => s.edit);
  if (!edit) return null;
  return (
    <group>
      {plant.obstacles.map((o, i) => {
        const [x0, z0, x1, z1] = o.rect;
        return (
          <mesh key={i} rotation={[-Math.PI / 2, 0, 0]} position={[(x0 + x1) / 2, 0.04, (z0 + z1) / 2]}>
            <planeGeometry args={[Math.max(0.05, x1 - x0), Math.max(0.05, z1 - z0)]} />
            <meshBasicMaterial color={o.zone === 'CINTA' ? '#2f8cff' : '#000'} transparent opacity={o.zone === 'CINTA' ? 0.25 : 0.12} depthWrite={false} />
          </mesh>
        );
      })}
      {Object.values(plant.ports).filter((p) => p.zone !== 'ALM').map((p) => (
        <group key={p.key}>
          <mesh rotation={[-Math.PI / 2, 0, 0]} position={[p.ax, 0.06, p.az]}><circleGeometry args={[0.35, 20]} /><meshBasicMaterial color="#3ddc84" /></mesh>
          <mesh rotation={[-Math.PI / 2, 0, 0]} position={[p.x, 0.06, p.z]}><ringGeometry args={[0.25, 0.4, 20]} /><meshBasicMaterial color="#3ddc84" /></mesh>
        </group>
      ))}
    </group>
  );
}

function Scene() {
  const controls = useRef(null);
  const plant = usePlant();
  const edit = useUI((s) => s.edit);
  const convKey = useMemo(() => plant.conveyor.pts.map((p) => p.join(',')).join(';'), [plant]);
  return (
    <>
      <CameraRig controls={controls} />
      <EditDrag plant={plant} controls={controls} />
      <color attach="background" args={['#d9dde1']} />
      <fog attach="fog" args={['#d9dde1', 170, 360]} />
      <hemisphereLight args={['#ffffff', '#8c8a84', 1.25]} />
      <ambientLight intensity={0.35} />
      <directionalLight
        castShadow position={[-30, 60, 28]} intensity={2.4} color="#fffaf0"
        shadow-mapSize={[4096, 4096]} shadow-bias={-0.0003} shadow-normalBias={0.02}
        shadow-camera-left={-80} shadow-camera-right={80} shadow-camera-top={40} shadow-camera-bottom={-40}
        shadow-camera-near={1} shadow-camera-far={170}
      />
      <directionalLight position={[40, 30, -30]} intensity={0.7} color="#eef3ff" />
      <Building />
      <Luminaires />
      <Suspense fallback={null}>
        <Zones plant={plant} />
      </Suspense>
      <Conveyor key={convKey} conveyor={plant.conveyor} />
      {!edit && <LineTrays conveyor={plant.conveyor} />}
      {!edit && <Suspense fallback={null}><Agvs /></Suspense>}
      {!edit && <Workers />}
      <EditOverlay plant={plant} />
      <OrbitControls
        ref={controls} makeDefault enableDamping dampingFactor={0.08}
        target={VIEW0.target} minDistance={2.5} maxDistance={240} maxPolarAngle={Math.PI / 2 - 0.03}
        onStart={() => useUI.getState().setFocus(null)}
      />
    </>
  );
}

export default function Viewer() {
  return (
    <div className="app">
      <Canvas
        shadows dpr={[1, 2]}
        camera={{ position: VIEW0.pos, fov: 38, near: 0.1, far: 500 }}
        gl={{ antialias: true }}
        onPointerMissed={() => { if (!useUI.getState().edit) useUI.getState().select(null); }}
      >
        <Scene />
      </Canvas>
      {!NOHUD && <Hud api={api} usePlant={usePlant} />}
    </div>
  );
}
