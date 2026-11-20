// ─────────────────────────────────────────────────────────────────────────────
// Brazos de las celdas. Se dibujan en coordenadas LOCALES de su celda y siguen el mismo
// cronograma que la simulación (shared/timeline.js): con el producto, el reparto y el
// instante del ciclo se obtiene la pose exacta, así que robot y pieza van sincronizados.
//
// Mejoras sobre el modelo GLB: paquete de cables (dress pack) dinámico entre antebrazo y
// herramienta, armario controlador con colgante de programación, canaleta de cables por
// el suelo y anillo de estado (marcha, aviso, avería, mantenimiento).
// ─────────────────────────────────────────────────────────────────────────────
import { useMemo, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import * as THREE from 'three';
import { cellPlan, poseAt } from '../../../shared/timeline.js';
import { ROBOT_SPECS, ROBOT_MODELS } from '../../../shared/robotSpecs.js';
import { T_ALARM } from '../../../shared/sim/twin.js';
import { live } from '../../net/client.js';
import { simNow } from '../clock.js';
import { useRobotModel, applyJoints, STATUS_COLOR } from '../../components/robotCommon';
import { useUI } from '../ui.js';

const PARK = [0, 0.55, 1.15, 0, -1.25, 0];
const hash = (i, n) => { const x = Math.sin(i * 12.9898 + n * 78.233) * 43758.5453; return x - Math.floor(x); };
const additive = (color, opacity) => new THREE.MeshBasicMaterial({ color, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false });

function particles(parent, n, color, size) {
  const g = new THREE.Group();
  const mat = new THREE.MeshBasicMaterial({ color });
  const list = [];
  for (let i = 0; i < n; i++) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(size, size * 0.4, size * 1.6), mat);
    m.userData = { dir: new THREE.Vector3(hash(i, 1) - 0.5, hash(i, 2) * 0.6 - 0.1, hash(i, 3) - 0.5).normalize(), ph: hash(i, 4) };
    g.add(m); list.push(m);
  }
  g.visible = false;
  parent.add(g);
  return { group: g, list };
}

/** Paquete de cables flexible: tubo que se recalcula entre dos anclajes. */
function makeDressPack(root, a, b, { r = 0.03, sag = 0.18, color = '#1b1d20' } = {}) {
  const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.75, metalness: 0.1 });
  const mesh = new THREE.Mesh(new THREE.BufferGeometry(), mat);
  mesh.castShadow = true;
  root.add(mesh);
  // abrazaderas en los extremos
  const clampGeo = new THREE.CylinderGeometry(r * 1.6, r * 1.6, r * 2.2, 14);
  const clampMat = new THREE.MeshStandardMaterial({ color: '#ff6a13', roughness: 0.5 });
  const ca = new THREE.Mesh(clampGeo, clampMat), cb = new THREE.Mesh(clampGeo, clampMat);
  root.add(ca, cb);
  const pa = new THREE.Vector3(), pb = new THREE.Vector3(), m1 = new THREE.Vector3(), m2 = new THREE.Vector3();
  const ta = new THREE.Vector3(), tb = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
  const qa = new THREE.Quaternion(), qb = new THREE.Quaternion();
  const curve = new THREE.CatmullRomCurve3([pa, m1, m2, pb], false, 'centripetal');
  let frame = 0;
  return (inverted) => {
    if ((frame++ & 1) === 1) return;           // cada dos fotogramas basta
    a.getWorldPosition(pa); b.getWorldPosition(pb);
    a.getWorldQuaternion(qa); b.getWorldQuaternion(qb);
    root.worldToLocal(pa); root.worldToLocal(pb);
    ta.set(1, 0, 0).applyQuaternion(qa); tb.set(-1, 0, 0).applyQuaternion(qb);
    const d = pa.distanceTo(pb);
    const g = (inverted ? 1 : -1) * sag * Math.min(1.4, d);
    m1.copy(pa).addScaledVector(ta, d * 0.33); m1.y += g * 0.6;
    m2.copy(pb).addScaledVector(tb, d * 0.3); m2.y += g;
    const geo = new THREE.TubeGeometry(curve, 24, r, 8, false);
    mesh.geometry.dispose();
    mesh.geometry = geo;
    ca.position.copy(pa); ca.quaternion.setFromUnitVectors(up, ta);
    cb.position.copy(pb); cb.quaternion.setFromUnitVectors(up, tb);
  };
}

function useEffects(model, cellId, modelKey) {
  return useMemo(() => {
    const fx = {};
    const S = ROBOT_SPECS[ROBOT_MODELS[modelKey].spec];
    const R = S.radius;
    // anclajes del paquete de cables: parte alta del antebrazo → lateral de la herramienta
    const j3 = model.joints[2], j6 = model.joints[5];
    const A = new THREE.Object3D(); A.position.set(S.L3 * 0.38 - 0.05, S.a3 + R.fore * 1.25, 0); j3.add(A);
    const B = new THREE.Object3D(); B.position.set(0.08, R.wrist * 1.35, 0); j6.add(B);
    fx.dress = makeDressPack(model.root, A, B, { r: R.wrist * 0.3, sag: cellId === 'BAR' ? 0.12 : 0.16 });
    if (cellId === 'CNC') fx.chips = particles(model.tcp, 18, '#d9b27a', 0.025);
    if (cellId === 'LIJ') {
      const puff = new THREE.Mesh(new THREE.SphereGeometry(0.16, 14, 10), new THREE.MeshBasicMaterial({ color: '#e8d2a8', transparent: true, opacity: 0.35, depthWrite: false }));
      puff.position.x = 0.02; puff.visible = false;
      model.tcp.add(puff);
      fx.dust = puff;
    }
    if (cellId === 'ENS') {
      fx.screwFlash = new THREE.Mesh(new THREE.SphereGeometry(0.025, 8, 6), additive('#fff2c0', 0.9));
      fx.screwFlash.position.set(0, 0.24, 0); fx.screwFlash.visible = false;
      model.tcp.add(fx.screwFlash);
    }
    if (cellId === 'BAR') {
      const cone = new THREE.Mesh(
        new THREE.ConeGeometry(0.22, 0.42, 24, 1, true).rotateZ(Math.PI / 2).translate(0.21, 0, 0),
        new THREE.MeshBasicMaterial({ color: '#d9a865', transparent: true, opacity: 0.3, side: THREE.DoubleSide, depthWrite: false }),
      );
      cone.scale.set(1, 1, 0.35);
      cone.visible = false;
      model.tcp.add(cone);
      fx.spray = cone;
    }
    return fx;
  }, [model, cellId, modelKey]);
}

/** Estado del ciclo de un brazo: pose objetivo, acción de la herramienta y si está en marcha. */
export function robotCycle(def, out) {
  const tk = live.tick;
  out.action = null; out.working = false; out.u = 0; out.T = 0;
  if (!tk) return null;
  const r = tk.robots[def.id];
  if (!r) return null;
  if (r.status === 'MAINT') { out.q = PARK; return r; }
  if (r.status === 'FAULT') { out.q = null; return r; }
  const info = tk.line.work?.[def.cellId];
  if (!info || info.kind !== 'CELL' || tk.line.phase !== 'WORK') { out.q = 'home'; return r; }
  const tray = tk.line.trays[['CEP', 'CNC', 'LIJ', 'ENS', 'BAR', 'PAL'].indexOf(def.cellId)];
  const product = info.product || tray?.product;
  const act = info.active || [];
  if (!product || !act.some((a) => a.index === def.index)) { out.q = 'home'; return r; }
  const plan = cellPlan(def.cellId, product, act);
  const T = info.times?.[def.index] || 0;
  const u = simNow() - info.start;
  const wps = plan.byRobot[def.index] || [];
  const p = poseAt(wps, plan.home[def.index], T, u);
  out.u = u; out.T = T;
  out.from = p.from.q; out.to = p.to.q; out.k = p.k;
  out.q = 'lerp';
  out.working = u < T;
  if (out.working) {
    const kind = p.to.kind;
    if ((kind === 'mill' || kind === 'sand' || kind === 'spray') && (p.dwelling || p.from.kind === kind)) out.action = kind;
    if ((kind === 'plunge' || kind === 'screw') && p.dwelling) out.action = kind === 'plunge' ? 'mill' : 'screw';
  }
  return r;
}

export function RobotArm({ def }) {
  const model = useRobotModel(def.model);
  const fx = useEffects(model, def.cellId, def.model);
  const selected = useUI((s) => s.selected === def.id);
  const showLabels = useUI((s) => s.showLabels);
  const select = useUI((s) => s.select);
  const [hover, setHover] = useState(false);
  const labelRef = useRef(null);
  const markerRef = useRef(null);
  const homeQ = useMemo(() => cellPlan(def.cellId, 'silla', [{ index: def.index, share: 1 }]).home[def.index].q, [def]);
  const q = useRef(homeQ.slice());
  const target = useMemo(() => new Array(6).fill(0), []);
  const cyc = useMemo(() => ({}), []);
  const ringColor = useMemo(() => new THREE.Color(), []);
  const clock = useRef(0);

  useFrame((_, dtRaw) => {
    const dt = Math.min(dtRaw, 0.1);
    clock.current += dt;
    const r = robotCycle(def, cyc);
    if (!r) return;
    if (cyc.q === PARK) for (let i = 0; i < 6; i++) target[i] = PARK[i];
    else if (cyc.q === 'home') for (let i = 0; i < 6; i++) target[i] = homeQ[i];
    else if (cyc.q === 'lerp') for (let i = 0; i < 6; i++) target[i] = cyc.from[i] + (cyc.to[i] - cyc.from[i]) * cyc.k;
    else for (let i = 0; i < 6; i++) target[i] = q.current[i];
    // servos: seguimiento rápido (más suave con la aceleración reducida por el gemelo)
    const gain = 1 - Math.exp(-dt * 16 * (r.accelF ?? 1));
    for (let i = 0; i < 6; i++) q.current[i] += (target[i] - q.current[i]) * gain;
    applyJoints(model, q.current);
    fx.dress?.(def.inverted);

    const action = cyc.action, c = clock.current;
    if (model.bit) model.bit.rotation.x += dt * (action === 'mill' ? 90 : 0);
    if (fx.chips) {
      fx.chips.group.visible = action === 'mill';
      if (fx.chips.group.visible) for (const m of fx.chips.list) {
        const ph = (c * 3 + m.userData.ph) % 1;
        m.position.copy(m.userData.dir).multiplyScalar(0.1 + ph * 0.5);
        m.position.x -= ph * 0.1;
        m.rotation.set(ph * 9, ph * 7, 0);
      }
    }
    if (model.pad) {
      const on = action === 'sand';
      model.pad.position.y = on ? Math.sin(c * 60) * 0.004 : 0;
      model.pad.position.z = on ? Math.cos(c * 60) * 0.004 : 0;
      model.pad.rotation.x += dt * (on ? 8 : 0);
    }
    if (fx.dust) { fx.dust.visible = action === 'sand'; fx.dust.scale.setScalar(0.8 + 0.3 * Math.sin(c * 9)); }
    if (model.driver) {
      const on = action === 'screw';
      model.driver.rotation.x += dt * (on ? 60 : 0);
      fx.screwFlash.visible = on && Math.sin(c * 30) > 0.6;
    }
    if (fx.spray) { fx.spray.visible = action === 'spray'; fx.spray.material.opacity = 0.24 + 0.08 * Math.sin(c * 30); }

    let state = r.status;
    if (state === 'RUN' && (r.temp > T_ALARM - 10 || r.rul < 24)) state = 'WARN';
    if (state === 'RUN' && !cyc.working) state = 'IDLE';
    ringColor.set(STATUS_COLOR[state]);
    model.ring.material.color.copy(ringColor);
    model.ring.material.emissive.copy(ringColor);
    model.ring.material.emissiveIntensity = state === 'FAULT' ? (Math.sin(c * 8) > 0 ? 1.8 : 0.2) : 1.4;
    if (markerRef.current) markerRef.current.rotation.z += dt * 0.8;
    if (labelRef.current) {
      labelRef.current.dataset.state = state;
      const t = labelRef.current.querySelector('[data-t]');
      if (t) t.textContent = `${r.temp.toFixed(0)} °C · ${Math.round(r.speed * 100)} %`;
    }
  });

  const labelPos = def.inverted ? [0, -0.9, 0] : [0, 3.0, 0];
  return (
    <group position={def.local} rotation={[def.inverted ? Math.PI : 0, def.yaw, 0]}>
      <primitive
        object={model.root}
        onClick={(e) => { e.stopPropagation(); select(def.id); }}
        onPointerOver={(e) => { e.stopPropagation(); setHover(true); document.body.style.cursor = 'pointer'; }}
        onPointerOut={() => { setHover(false); document.body.style.cursor = ''; }}
      />
      {(selected || hover) && !def.inverted && (
        <mesh ref={markerRef} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.02, 0]}>
          <ringGeometry args={[0.85, 1.0, 48]} />
          <meshBasicMaterial color={selected ? '#2f8cff' : '#ffffff'} transparent opacity={0.8} />
        </mesh>
      )}
      {showLabels && (
        <Html position={labelPos} center distanceFactor={9} zIndexRange={[5, 0]}>
          <div ref={labelRef} className={`robot-tag ${selected ? 'is-selected' : ''}`} onClick={() => select(def.id)}>
            <b>{def.id}</b><span data-t />
          </div>
        </Html>
      )}
    </group>
  );
}

/** Armario controlador + colgante + canaleta hasta la base del robot (coordenadas de la celda). */
export function RobotCabinet({ def, at }) {
  const [x, z] = at;
  const [rx, , rz] = def.local;
  const len = Math.hypot(x - rx, z - rz);
  const ang = Math.atan2(-(z - rz), x - rx);
  const led = useRef(null);
  useFrame(({ clock }) => {
    const r = live.tick?.robots?.[def.id];
    if (!led.current || !r) return;
    const c = r.status === 'FAULT' ? '#ff3030' : r.status === 'MAINT' ? '#2f8cff' : '#29d36a';
    led.current.color.set(c);
    led.current.emissive.set(c);
    led.current.emissiveIntensity = r.status === 'FAULT' && Math.sin(clock.elapsedTime * 8) < 0 ? 0.2 : 1.6;
  });
  return (
    <group>
      <group position={[x, 0, z]} rotation={[0, ang + Math.PI / 2, 0]}>
        <mesh position={[0, 0.9, 0]} castShadow receiveShadow><boxGeometry args={[0.75, 1.8, 0.55]} /><meshStandardMaterial color="#d7d9db" metalness={0.3} roughness={0.55} /></mesh>
        <mesh position={[0, 0.9, 0.28]}><boxGeometry args={[0.7, 1.7, 0.01]} /><meshStandardMaterial color="#c9ccd0" metalness={0.3} roughness={0.5} /></mesh>
        <mesh position={[0.22, 1.45, 0.29]}><boxGeometry args={[0.1, 0.1, 0.02]} /><meshStandardMaterial ref={led} color="#29d36a" emissive="#29d36a" emissiveIntensity={1.4} /></mesh>
        <mesh position={[-0.2, 1.45, 0.29]}><cylinderGeometry args={[0.04, 0.04, 0.03, 16]} /><meshStandardMaterial color="#e02020" /></mesh>
        <mesh position={[0, 1.6, 0.3]}><boxGeometry args={[0.42, 0.12, 0.02]} /><meshStandardMaterial color="#202326" /></mesh>
        {/* colgante de programación */}
        <group position={[0.42, 1.15, 0.1]} rotation={[0, 0, 0.12]}>
          <mesh castShadow><boxGeometry args={[0.06, 0.28, 0.2]} /><meshStandardMaterial color="#e6e4dc" /></mesh>
          <mesh position={[0.031, 0.03, 0]}><boxGeometry args={[0.002, 0.14, 0.15]} /><meshStandardMaterial color="#0a1520" emissive="#0b3550" emissiveIntensity={0.9} /></mesh>
        </group>
        <mesh position={[0, 0.06, -0.36]}><boxGeometry args={[0.8, 0.12, 0.2]} /><meshStandardMaterial color="#3a3d42" /></mesh>
      </group>
      {/* canaleta por el suelo */}
      <mesh position={[(x + rx) / 2, 0.035, (z + rz) / 2]} rotation={[0, ang, 0]} receiveShadow>
        <boxGeometry args={[Math.max(0.1, len - 0.9), 0.07, 0.22]} /><meshStandardMaterial color="#f2c230" roughness={0.6} />
      </mesh>
    </group>
  );
}
