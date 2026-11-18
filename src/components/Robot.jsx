import { useMemo, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import * as THREE from 'three';
import { solveWorld } from '../sim/ik';
import { workPointsFor, homePointFor, robotsOf } from '../sim/layout';
import { engine, T_ALARM } from '../sim/engine';
import { useTwinStore } from '../store/useTwinStore';
import { useRobotModel, applyJoints, STATUS_COLOR } from './robotCommon';

const PARK = [0, 0.55, 1.15, 0, -1.25, 0];                 // pose de aparcamiento (mantenimiento)
const hash = (i, n) => { const x = Math.sin(i * 12.9898 + n * 78.233) * 43758.5453; return x - Math.floor(x); };
const additive = (color, opacity) => new THREE.MeshBasicMaterial({ color, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false });

/** Partículas sencillas (virutas, polvo) colgadas del TCP. */
function particles(parent, n, color, size, opacity = 1) {
  const g = new THREE.Group();
  const mat = new THREE.MeshBasicMaterial({ color, transparent: opacity < 1, opacity });
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

/** Efectos de proceso según la herramienta de cada celda. */
function useEffects(model, cellId) {
  return useMemo(() => {
    const fx = {};
    if (cellId === 'CNC') fx.chips = particles(model.tcp, 18, '#d9b27a', 0.025);
    if (cellId === 'LIJ') {
      const puff = new THREE.Mesh(new THREE.SphereGeometry(0.16, 14, 10), new THREE.MeshBasicMaterial({ color: '#e8d2a8', transparent: true, opacity: 0.35, depthWrite: false }));
      puff.position.x = 0.02; puff.visible = false;
      model.tcp.add(puff);
      fx.dust = puff;
    }
    if (cellId === 'ENS') {
      const panel = new THREE.Mesh(new THREE.BoxGeometry(0.018, 0.5, 0.72), new THREE.MeshStandardMaterial({ color: '#e2c497', roughness: 0.7 }));
      panel.position.x = 0.012; panel.rotation.x = Math.PI / 2; panel.castShadow = true; panel.visible = false;
      model.tcp.add(panel);
      fx.carry = panel;
      fx.screwFlash = new THREE.Mesh(new THREE.SphereGeometry(0.025, 8, 6), additive('#fff2c0', 0.9));
      fx.screwFlash.position.set(0, 0.24, 0); fx.screwFlash.visible = false;
      model.tcp.add(fx.screwFlash);
    }
    if (cellId === 'BAR') {
      const cone = new THREE.Mesh(
        new THREE.ConeGeometry(0.22, 0.42, 24, 1, true).rotateZ(Math.PI / 2).translate(0.21, 0, 0),
        new THREE.MeshBasicMaterial({ color: '#d9a865', transparent: true, opacity: 0.3, side: THREE.DoubleSide, depthWrite: false }),
      );
      cone.scale.set(1, 1, 0.35);          // abanico plano de la pistola HVLP
      cone.visible = false;
      model.tcp.add(cone);
      fx.spray = cone;
    }
    return fx;
  }, [model, cellId]);
}

export function Robot({ def }) {
  const model = useRobotModel(def.model);
  const fx = useEffects(model, def.cellId);
  const selected = useTwinStore((s) => s.selectedRobot === def.id);
  const showLabels = useTwinStore((s) => s.showLabels);
  const selectRobot = useTwinStore((s) => s.selectRobot);
  const [hover, setHover] = useState(false);
  const labelRef = useRef(null);
  const markerRef = useRef(null);

  // Plan de trayectoria: configuraciones articulares de cada punto (IK)
  const plan = useMemo(() => {
    const points = workPointsFor(def).map((pt) => ({ ...pt, q: solveWorld(def, pt) }));
    const home = { ...homePointFor(def), kind: 'home' };
    home.q = solveWorld(def, home);
    return { points, home, nRobots: robotsOf(def.cellId).length, group: def.cellId === 'ENS' ? 4 : 2 };
  }, [def]);

  const q = useRef(plan.home.q.slice());
  const target = useMemo(() => new Array(6).fill(0), []);
  const ringColor = useMemo(() => new THREE.Color(), []);
  const clock = useRef(0);

  useFrame((_, dtRaw) => {
    const dt = Math.min(dtRaw, 0.1);
    const r = engine.robots[def.id];
    const L = engine.line;
    clock.current += dt;
    let action = null;
    let carrying = false;

    if (r.status === 'MAINT') {
      for (let i = 0; i < 6; i++) target[i] = PARK[i];
    } else if (r.status === 'FAULT') {
      for (let i = 0; i < 6; i++) target[i] = q.current[i];
    } else {
      const working = L.phase === 'WORK' && !engine.lineStopped && r.work > 0;
      const u = working ? L.time / r.work : 1;
      if (u >= 1) {
        for (let i = 0; i < 6; i++) target[i] = plan.home.q[i];
      } else {
        // Nº de puntos proporcional a la parte del contenido de trabajo asignada
        const P = plan.points;
        let k = Math.max(plan.group, Math.round(P.length * (r.shareNorm ?? 0) * plan.nRobots));
        k = Math.ceil(k / plan.group) * plan.group;
        const at = (i) => (i < 0 || i >= k ? plan.home : P[i % P.length]);
        const moves = k + 1;
        const seg = Math.min(moves - 1, Math.floor(u * moves));
        const f = u * moves - seg;
        const from = at(seg - 1), to = at(seg);
        const moveT = Math.min(1, f / 0.62);
        const k3 = moveT * moveT * (3 - 2 * moveT);
        for (let i = 0; i < 6; i++) target[i] = from.q[i] + (to.q[i] - from.q[i]) * k3;
        const dwelling = f >= 0.62;
        const continuous = ['mill', 'sand', 'spray'];
        if (continuous.includes(to.kind) && (dwelling || from.kind === to.kind)) action = to.kind;
        if ((to.kind === 'drill' || to.kind === 'screw') && dwelling) action = to.kind;
        if (def.cellId === 'ENS') {
          carrying = (to.kind === 'place' && !(dwelling && f > 0.9)) || (to.kind === 'pick' && dwelling && f > 0.85);
        }
      }
    }

    // Seguimiento suave (servos) — más lento si la aceleración está reducida
    const gain = 1 - Math.exp(-dt * 10 * (r.accel ?? 1));
    for (let i = 0; i < 6; i++) q.current[i] += (target[i] - q.current[i]) * gain;
    applyJoints(model, q.current);

    // ── Efectos de herramienta ──
    const c = clock.current;
    if (model.bit) model.bit.rotation.x += dt * (action === 'mill' || action === 'drill' ? 90 : 0);
    if (fx.chips) {
      fx.chips.group.visible = action === 'mill' || action === 'drill';
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
    if (fx.dust) {
      fx.dust.visible = action === 'sand';
      fx.dust.scale.setScalar(0.8 + 0.3 * Math.sin(c * 9));
    }
    if (fx.carry) fx.carry.visible = carrying;
    if (model.driver) {
      const on = action === 'screw';
      model.driver.rotation.x += dt * (on ? 60 : 0);
      model.driver.position.x = 0.3 + (on ? 0.03 * Math.min(1, (c * 2) % 1.5) : 0);
      fx.screwFlash.visible = on && Math.sin(c * 30) > 0.6;
    }
    if (fx.spray) {
      fx.spray.visible = action === 'spray';
      fx.spray.material.opacity = 0.24 + 0.08 * Math.sin(c * 30);
    }

    // ── Anillo de estado ──
    let state = r.status;
    if (state === 'RUN' && (r.temp > T_ALARM - 10 || r.rul < 120)) state = 'WARN';
    if (state === 'RUN' && r.work === 0) state = 'IDLE';
    ringColor.set(STATUS_COLOR[state]);
    model.ring.material.color.copy(ringColor);
    model.ring.material.emissive.copy(ringColor);
    model.ring.material.emissiveIntensity = state === 'FAULT' ? (Math.sin(c * 8) > 0 ? 1.8 : 0.2) : 1.4;

    if (markerRef.current) markerRef.current.rotation.z += dt * 0.8;
    if (labelRef.current) {
      labelRef.current.dataset.state = state;
      const t = labelRef.current.querySelector('[data-t]');
      if (t) t.textContent = `${r.temp.toFixed(0)} °C · ${Math.round((r.shareNorm ?? 0) * 100)} %`;
    }
  });

  const labelPos = def.inverted ? [0, -0.9, 0] : [0, 3.0, 0];
  return (
    <group position={def.pos} rotation={[def.inverted ? Math.PI : 0, def.yaw, 0]}>
      <primitive
        object={model.root}
        onClick={(e) => { e.stopPropagation(); selectRobot(def.id); }}
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
          <div ref={labelRef} className={`robot-tag ${selected ? 'is-selected' : ''}`} onClick={() => selectRobot(def.id)}>
            <b>{def.id}</b><span data-t />
          </div>
        </Html>
      )}
    </group>
  );
}
