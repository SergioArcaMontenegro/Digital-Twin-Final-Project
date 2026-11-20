// ─────────────────────────────────────────────────────────────────────────────
// Modelos de producto construidos con three.js (imperativo, para poder cambiarlos en
// cada fotograma sin renders de React).
//
// La madera cambia de forma a lo largo del proceso:
//   tablas en bruto → (cepillado) tablero encolado → (CNC) piezas cortadas →
//   (lijado) piezas lijadas → (ensamblaje) mueble montado pieza a pieza →
//   (barnizado) acabado con el tono elegido → (paletizado) palé enfardado.
// ─────────────────────────────────────────────────────────────────────────────
import * as THREE from 'three';
import { PRODUCTS, LINE_STATIONS } from '../../../shared/config.js';
import { PARTS, BLANK, DIMS, woodColor } from '../../../shared/products.js';
import { cellPlan, partStates } from '../../../shared/timeline.js';

const box = new THREE.BoxGeometry(1, 1, 1);
const clamp01 = (v) => Math.max(0, Math.min(1, v));
const smooth = (t) => t * t * (3 - 2 * t);
const mat = (c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.72, metalness: 0 });

/** Crea el grupo de un producto con todas sus representaciones (se muestran según la fase). */
export function buildProduct(product) {
  const g = new THREE.Group();
  const P = PRODUCTS[product];
  // tablas en bruto
  const rough = new THREE.Group();
  const roughMat = mat('#a08060');
  for (let i = 0; i < P.boards; i++) {
    const m = new THREE.Mesh(box, roughMat);
    m.scale.set(1.8, 0.04, 0.2);
    m.position.set(0, 0.02 + i * 0.041, (i % 2 ? 1 : -1) * 0.12 * (i > 1 ? 2 : 1) * 0.5);
    m.castShadow = true;
    rough.add(m);
  }
  g.add(rough);
  // tablero encolado
  let blank = null;
  if (BLANK[product]) {
    blank = new THREE.Mesh(box, mat('#e0c090'));
    blank.castShadow = true; blank.receiveShadow = true;
    g.add(blank);
  }
  // piezas
  const parts = PARTS[product].map((pt) => {
    const m = new THREE.Mesh(box, mat('#e0c090'));
    m.scale.set(...pt.size);
    m.castShadow = true;
    m.userData = { pt, qLay: new THREE.Quaternion().setFromEuler(new THREE.Euler(...pt.lay.r)), qAsm: new THREE.Quaternion().setFromEuler(new THREE.Euler(...pt.asm.r)) };
    g.add(m);
    return m;
  });
  g.userData = { product, rough, roughMat, blank, parts };
  return g;
}

const cA = new THREE.Color(), cB = new THREE.Color();
const setColor = (m, a, b, k) => { cA.set(a); if (b) { cB.set(b); cA.lerp(cB, k); } m.material.color.copy(cA); };

/**
 * Coloca el producto según su avance.
 * st = { cep, cnc: {cut:bool[]|null, frac}, sand: bool[]|number, asm: (string|{k})[], bar }
 */
export function poseProduct(g, species, tone, st) {
  const { product, rough, roughMat, blank, parts } = g.userData;
  const route = st.route;
  // 1 · tablas en bruto hasta el cepillado
  rough.visible = st.cep < 0.85;
  if (rough.visible) {
    setColor({ material: roughMat }, woodColor(species, 'rough'), woodColor(species, 'planed'), clamp01(st.cep / 0.85));
    rough.position.x = st.cep > 0 ? -0.6 + 0.6 * smooth(clamp01(st.cep / 0.85)) : 0;
    for (const m of parts) m.visible = false;
    if (blank) blank.visible = false;
    return;
  }
  // 2 · tablero encolado hasta que el CNC corta las piezas
  const hasCnc = blank && route.includes('CNC');
  const cutFlags = st.cut;            // null = sin cortar todavía · true = todo cortado
  if (hasCnc && cutFlags !== true) {
    const B = BLANK[product];
    const cut = Array.isArray(cutFlags) ? cutFlags : parts.map(() => false);
    const frac = cut.filter(Boolean).length / parts.length;
    blank.visible = frac < 0.999;
    const sx = B.size[0] * (1 - frac * 0.85);
    blank.scale.set(sx, B.size[1], B.size[2]);
    blank.position.set(B.p[0] + (B.size[0] - sx) / 2, B.p[1], B.p[2]);
    setColor(blank, woodColor(species, 'planed'));
    parts.forEach((m, j) => {
      m.visible = !!cut[j];
      if (m.visible) { const { pt, qLay } = m.userData; m.position.set(...pt.lay.p); m.quaternion.copy(qLay); m.position.y += 0.002; setColor(m, woodColor(species, 'planed')); }
    });
    return;
  }
  if (blank) blank.visible = false;
  // 3 · piezas: lijado, montaje y barniz
  const finalNatural = route.includes('LIJ') ? woodColor(species, 'sanded') : woodColor(species, 'planed');
  parts.forEach((m, j) => {
    m.visible = true;
    const { pt, qLay, qAsm } = m.userData;
    const a = st.asm?.[j] ?? 'lay';
    if (a === 'asm') { m.position.set(...pt.asm.p); m.quaternion.copy(qAsm); }
    else if (a && typeof a === 'object') {
      const k = smooth(clamp01(a.k));
      m.position.set(
        pt.lay.p[0] + (pt.asm.p[0] - pt.lay.p[0]) * k,
        pt.lay.p[1] + (pt.asm.p[1] - pt.lay.p[1]) * k + Math.sin(Math.PI * k) * 0.28 + 0.03,
        pt.lay.p[2] + (pt.asm.p[2] - pt.lay.p[2]) * k,
      );
      m.quaternion.slerpQuaternions(qLay, qAsm, k);
    } else { m.position.set(...pt.lay.p); m.quaternion.copy(qLay); }
    const sanded = Array.isArray(st.sand) ? st.sand[j] : st.sand;
    const base = sanded ? woodColor(species, 'sanded') : woodColor(species, 'planed');
    if (st.bar > 0) setColor(m, sanded || route.includes('LIJ') ? woodColor(species, 'sanded') : base, woodColor(species, 'finished', tone), st.bar);
    else setColor(m, st.done ? finalNatural : base);
  });
}

/** Producto terminado (para palés y paletizador). */
export function poseFinished(g, species, tone, route = ['CEP', 'CNC', 'LIJ', 'ENS', 'BAR', 'PAL']) {
  poseProduct(g, species, tone, { route, cep: 1, cut: true, sand: true, asm: g.userData.parts.map(() => 'asm'), bar: route.includes('BAR') ? 1 : 0, done: true });
}

/** Estado de avance de una bandeja de la línea en el instante `t`. */
export function trayState(tray, idx, line, t) {
  const st = LINE_STATIONS[idx];
  const done = new Set(tray.done);
  const work = line.phase === 'WORK' && tray.station === st ? line.work?.[st] : null;
  const live = work && work.kind && !work.wait;
  const prog = live ? clamp01((t - work.start) / Math.max(1e-6, work.cycle)) : 0;
  const s = { route: tray.route, cep: done.has('CEP') ? 1 : st === 'CEP' && live ? prog : 0, cut: null, sand: false, asm: null, bar: 0, done: false };
  if (s.cep < 0.85) return s;
  const parts = PARTS[tray.product];
  // CNC
  if (done.has('CNC') || !tray.route.includes('CNC')) s.cut = true;
  else if (st === 'CNC' && live && work.active?.length) {
    const plan = cellPlan('CNC', tray.product, work.active);
    s.cut = partStates('CNC', plan, work.times, t - work.start).map((x) => x === 'cut');
  }
  // lijado
  if (done.has('LIJ')) s.sand = true;
  else if (st === 'LIJ' && live && work.active?.length) {
    const plan = cellPlan('LIJ', tray.product, work.active);
    s.sand = partStates('LIJ', plan, work.times, t - work.start).map((x) => x === 'sanded');
  }
  // ensamblaje
  if (tray.product === 'tablon' || done.has('ENS')) s.asm = parts.map(() => (tray.product === 'tablon' || done.has('ENS') ? 'asm' : 'lay'));
  else if (st === 'ENS' && live && work.active?.length) {
    const plan = cellPlan('ENS', tray.product, work.active);
    s.asm = partStates('ENS', plan, work.times, t - work.start).map((x) => (x && typeof x === 'object' ? { k: x.k } : x || 'lay'));
  }
  // barniz
  if (done.has('BAR')) s.bar = 1;
  else if (st === 'BAR' && live) s.bar = prog;
  s.done = idx >= 4 || done.has('BAR');
  return s;
}

export { DIMS };
