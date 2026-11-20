// Cinta de rodillos autoenrutada entre estaciones + bandejas con el producto encima.
import { useLayoutEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { LINE_Y, TRAY_H, PIECE_Y } from '../../../shared/zones.js';
import { live } from '../../net/client.js';
import { simNow } from '../clock.js';
import { buildProduct, poseProduct, trayState } from './products3d.js';

const W = 1.05;            // ancho útil
const PITCH = 0.3;

export function Conveyor({ conveyor }) {
  const rollers = useRef(null), rails = useRef(null), legs = useRef(null), corners = useRef(null);
  const data = useMemo(() => {
    const pts = conveyor.pts;
    const roll = [], rail = [], leg = [], corner = [];
    const q = new THREE.Quaternion(), e = new THREE.Euler(), s = new THREE.Vector3(1, 1, 1);
    for (let i = 1; i < pts.length; i++) {
      const [ax, az] = pts[i - 1], [bx, bz] = pts[i];
      const len = Math.hypot(bx - ax, bz - az);
      if (len < 1e-3) continue;
      const h = Math.atan2(-(bz - az), bx - ax);
      const dx = (bx - ax) / len, dz = (bz - az) / len, nx = -dz, nz = dx;
      const start = i > 1 ? 0.6 : 0, end = i < pts.length - 1 ? len - 0.6 : len;
      for (let d = start + PITCH / 2; d < end; d += PITCH) {
        e.set(0, h, Math.PI / 2); q.setFromEuler(e);
        roll.push(new THREE.Matrix4().compose(new THREE.Vector3(ax + dx * d, LINE_Y - 0.04, az + dz * d), q, s));
      }
      for (const side of [-1, 1]) {
        e.set(0, h, 0); q.setFromEuler(e);
        rail.push(new THREE.Matrix4().compose(new THREE.Vector3((ax + bx) / 2 + nx * side * (W / 2 + 0.05), LINE_Y - 0.06, (az + bz) / 2 + nz * side * (W / 2 + 0.05)), q, new THREE.Vector3(len, 1, 1)));
      }
      for (let d = 0.8; d < len - 0.4; d += 2.2) for (const side of [-1, 1]) {
        leg.push(new THREE.Matrix4().makeTranslation(ax + dx * d + nx * side * (W / 2), (LINE_Y - 0.1) / 2, az + dz * d + nz * side * (W / 2)));
      }
      if (i > 1) corner.push(new THREE.Matrix4().makeTranslation(ax, LINE_Y - 0.08, az));
    }
    return { roll, rail, leg, corner };
  }, [conveyor]);

  useLayoutEffect(() => {
    data.roll.forEach((m, i) => rollers.current.setMatrixAt(i, m));
    data.rail.forEach((m, i) => rails.current.setMatrixAt(i, m));
    data.leg.forEach((m, i) => legs.current.setMatrixAt(i, m));
    data.corner.forEach((m, i) => corners.current.setMatrixAt(i, m));
    for (const [r, list] of [[rollers, data.roll], [rails, data.rail], [legs, data.leg], [corners, data.corner]]) {
      r.current.count = list.length;
      r.current.instanceMatrix.needsUpdate = true;
    }
  }, [data]);

  return (
    <group>
      <instancedMesh ref={rollers} args={[null, null, Math.max(1, data.roll.length)]} castShadow receiveShadow>
        <cylinderGeometry args={[0.04, 0.04, W, 10]} /><meshStandardMaterial color="#b9c0c7" metalness={0.85} roughness={0.3} />
      </instancedMesh>
      <instancedMesh ref={rails} args={[null, null, Math.max(1, data.rail.length)]} castShadow>
        <boxGeometry args={[1, 0.14, 0.06]} /><meshStandardMaterial color="#3a6fb0" metalness={0.5} roughness={0.45} />
      </instancedMesh>
      <instancedMesh ref={legs} args={[null, null, Math.max(1, data.leg.length)]} castShadow>
        <boxGeometry args={[0.06, LINE_Y - 0.1, 0.06]} /><meshStandardMaterial color="#5d6670" metalness={0.7} roughness={0.4} />
      </instancedMesh>
      <instancedMesh ref={corners} args={[null, null, Math.max(1, data.corner.length)]} castShadow>
        <boxGeometry args={[W + 0.2, 0.12, W + 0.2]} /><meshStandardMaterial color="#2f5e96" metalness={0.5} roughness={0.45} />
      </instancedMesh>
    </group>
  );
}

/** Bandejas y productos en la línea (pool imperativo por uid de bandeja). */
export function LineTrays({ conveyor }) {
  const root = useRef(null);
  const pool = useRef(new Map());
  const trayGeo = useMemo(() => new THREE.BoxGeometry(1.95, TRAY_H, 0.98), []);
  const trayMat = useMemo(() => new THREE.MeshStandardMaterial({ color: '#2b3036', metalness: 0.4, roughness: 0.6 }), []);
  useFrame(() => {
    const tk = live.tick;
    if (!tk || !root.current) return;
    const L = tk.line, t = simNow();
    const seen = new Set();
    L.trays.forEach((tray, idx) => {
      if (!tray) return;
      seen.add(tray.uid);
      let e = pool.current.get(tray.uid);
      if (!e || e.product !== tray.product) {
        if (e) root.current.remove(e.group);
        const group = new THREE.Group();
        const plate = new THREE.Mesh(trayGeo, trayMat);
        plate.position.y = LINE_Y + TRAY_H / 2; plate.castShadow = true; plate.receiveShadow = true;
        const prod = buildProduct(tray.product);
        prod.position.y = PIECE_Y;
        group.add(plate, prod);
        root.current.add(group);
        e = { group, prod, product: tray.product };
        pool.current.set(tray.uid, e);
      }
      // posición sobre la cinta
      let s = tray.s1;
      if (L.phase === 'TRANSFER') {
        const k = Math.max(0, Math.min(1, (t - L.phaseStart) / Math.max(0.1, L.transferDur - 1.2)));
        s = tray.s0 + (tray.s1 - tray.s0) * (k * k * (3 - 2 * k));
      }
      const p = conveyor.at(Math.max(0, Math.min(conveyor.length, s)));
      e.group.position.set(p.x, 0, p.z);
      e.group.rotation.y = p.h;
      poseProduct(e.prod, tray.species, tray.tone, trayState(tray, idx, L, t));
      e.group.visible = !tray.picked;
    });
    for (const [uid, e] of pool.current) if (!seen.has(uid)) { root.current.remove(e.group); pool.current.delete(uid); }
  });
  return <group ref={root} />;
}
