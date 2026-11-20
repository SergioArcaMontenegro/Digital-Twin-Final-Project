// ─────────────────────────────────────────────────────────────────────────────
// Trayectorias de los brazos de cada celda según el producto que hay en la bandeja.
//
// Todo en coordenadas LOCALES de la zona (la bandeja está en el origen de la celda), por
// lo que es válido aunque la celda se mueva o gire en el modo edición.
//
// La misma función la usan el servidor y el visor: el robot se mueve por estos puntos y
// la pieza cambia de forma con los mismos tiempos (se corta, se lija, se monta…).
//
// Reparto: con `active` = brazos en marcha y su parte de la carga, cada brazo hace su
// lote de piezas. Cronograma de cada brazo con N puntos y tiempo T: N+1 tramos iguales
// (el último vuelve a reposo); en cada tramo el 62 % es movimiento y el resto, trabajo.
// ─────────────────────────────────────────────────────────────────────────────
import { PARTS, BLANK, DIMS, halfExtents, topOf } from './products.js';
import { PIECE_Y, BAR_BEAM_Y, robotsOfCell, SIDE_RACK } from './zones.js';
import { solveWorld } from './ik.js';

const DOWN = -Math.PI / 2;
export const MOVE_FRAC = 0.62;
const VIA = 0.16;

const robotFrame = (r) => ({ model: r.model, pos: r.local, yaw: r.yaw, inverted: r.inverted });

export function homePoint(r) {
  const [x, , z] = r.local;
  if (r.inverted) return { p: [x, BAR_BEAM_Y - 1.5, z - r.side * 0.6], g: DOWN, kind: 'home' };
  return { p: [x, 1.6, z - r.side * 1.0], g: DOWN, kind: 'home' };
}

const cache = new Map();

/**
 * Plan de una celda para un producto y un reparto.
 * @param {string} cellId
 * @param {string} product
 * @param {{index:number, share:number}[]} active  brazos activos (share normalizado)
 */
export function cellPlan(cellId, product, active) {
  const key = `${cellId}|${product}|${active.map((a) => `${a.index}:${a.share.toFixed(3)}`).join(',')}`;
  if (cache.has(key)) return cache.get(key);
  if (cache.size > 400) cache.clear();

  const robots = robotsOfCell(cellId);
  const parts = PARTS[product] || [];
  const byRobot = {};
  const partRobot = parts.map(() => -1);
  const partWp = parts.map(() => ({}));
  for (const a of active) byRobot[a.index] = [];
  const n = active.length;

  // Reparto de piezas: cada pieza va al brazo activo más cercano, compensando la carga
  // según la parte que tiene asignada cada brazo (así en monobrazo uno solo lo hace todo).
  const assign = () => {
    const load = active.map(() => 0);
    return parts.map((pt) => {
      let best = 0, bv = Infinity;
      active.forEach((a, k) => {
        const r = robots[a.index];
        const d = Math.hypot(pt.lay.p[0] - r.local[0], pt.lay.p[2] - r.local[2]);
        const v = d + 0.9 * (load[k] + 1) / Math.max(a.share, 1e-6) / Math.max(1, parts.length / n);
        if (v < bv) { bv = v; best = k; }
      });
      load[best]++;
      return active[best].index;
    });
  };

  const add = (ri, wp) => { byRobot[ri].push(wp); return byRobot[ri].length - 1; };
  const y0 = PIECE_Y;

  if (cellId === 'CNC' && BLANK[product]) {
    const who = assign();
    const topY = y0 + BLANK[product].size[1] - 0.008;
    parts.forEach((pt, j) => {
      const ri = who[j];
      partRobot[j] = ri;
      const [hx, , hz] = halfExtents(pt.size, pt.lay.r);
      const [cx, , cz] = pt.lay.p;
      const corners = [[cx - hx, cz - hz], [cx + hx, cz - hz], [cx + hx, cz + hz], [cx - hx, cz + hz]];
      corners.forEach(([x, z], k) => { partWp[j].cut = add(ri, { p: [x, topY, z], g: DOWN, kind: k ? 'mill' : 'plunge', part: j }); });
    });
  }

  if (cellId === 'LIJ') {
    const who = assign();
    parts.forEach((pt, j) => {
      const ri = who[j];
      partRobot[j] = ri;
      const [hx, , hz] = halfExtents(pt.size, pt.lay.r);
      const [cx, , cz] = pt.lay.p;
      const top = y0 + topOf(pt, 'lay') + 0.005;
      const along = hx >= hz;
      const e = Math.max(0.02, (along ? hx : hz) - 0.05);
      const a = along ? [cx - e, cz] : [cx, cz - e];
      const b = along ? [cx + e, cz] : [cx, cz + e];
      add(ri, { p: [a[0], top, a[1]], g: DOWN, kind: 'sand', part: j });
      partWp[j].sand = add(ri, { p: [b[0], top, b[1]], g: DOWN, kind: 'sand', part: j });
    });
  }

  if (cellId === 'ENS' && product !== 'tablon') {
    const who = assign();
    parts.forEach((pt, j) => {
      const ri = who[j];
      partRobot[j] = ri;
      const lay = [pt.lay.p[0], y0 + topOf(pt, 'lay'), pt.lay.p[2]];
      const asm = [pt.asm.p[0], y0 + topOf(pt, 'asm'), pt.asm.p[2]];
      add(ri, { p: [lay[0], lay[1] + VIA, lay[2]], g: DOWN, kind: 'via' });
      partWp[j].pick = add(ri, { p: lay, g: DOWN, kind: 'pick', part: j });
      add(ri, { p: [lay[0], lay[1] + VIA + 0.1, lay[2]], g: DOWN, kind: 'carry', part: j });
      add(ri, { p: [asm[0], asm[1] + VIA, asm[2]], g: DOWN, kind: 'carry', part: j });
      partWp[j].place = add(ri, { p: asm, g: DOWN, kind: 'place', part: j });
      add(ri, { p: [asm[0], asm[1] + 0.02, asm[2]], g: DOWN, kind: 'screw', part: j });
    });
  }

  if (cellId === 'BAR') {
    const [dx, dy, dz] = DIMS[product];
    for (const a of active) {
      const r = robots[a.index];
      const s = r.side;
      const hx = Math.min(dx / 2 + 0.2, 0.95);
      const yTop = y0 + dy + 0.35;
      const zf = s * (dz / 2 + 0.3);
      const ri = a.index;
      add(ri, { p: [-hx, yTop, s * 0.1], g: DOWN, kind: 'spray' });
      add(ri, { p: [hx, yTop, s * 0.1], g: DOWN, kind: 'spray' });
      for (const fy of dy > 0.3 ? [0.75, 0.3] : [0.5]) {
        add(ri, { p: [hx, y0 + Math.max(0.12, dy * fy), zf], g: 0, kind: 'spray' });
        add(ri, { p: [-hx, y0 + Math.max(0.12, dy * fy), zf], g: 0, kind: 'spray' });
      }
    }
  }

  // Configuración articular de cada punto (IK en el marco local de la celda)
  for (const a of active) {
    const r = robots[a.index];
    const F = robotFrame(r);
    for (const wp of byRobot[a.index]) wp.q = solveWorld(F, wp);
  }
  const home = {};
  for (const r of robots) { const h = homePoint(r); h.q = solveWorld(robotFrame(r), h); home[r.index] = h; }

  const plan = { byRobot, home, partRobot, partWp, parts };
  cache.set(key, plan);
  return plan;
}

/** Tiempos (inicio, llegada, fin de trabajo) del punto i de una lista de n puntos en T s. */
export function wpTimes(n, T, i) {
  const seg = T / (n + 1);
  return { t0: i * seg, tm: i * seg + MOVE_FRAC * seg, t1: (i + 1) * seg };
}

/**
 * Pose del brazo en el instante u del ciclo: devuelve { from, to, k (0..1 de movimiento),
 * dwelling, wp } para que el visor interpole las articulaciones y active la herramienta.
 */
export function poseAt(wps, home, T, u) {
  const n = wps.length;
  if (!n || T <= 0 || u >= T) return { from: home, to: home, k: 1, dwelling: false, wp: null };
  const seg = T / (n + 1);
  const i = Math.min(n, Math.floor(u / seg));
  const f = (u - i * seg) / seg;
  const from = i === 0 ? home : wps[i - 1];
  const to = i >= n ? home : wps[i];
  const m = Math.min(1, f / MOVE_FRAC);
  return { from, to, k: m * m * (3 - 2 * m), dwelling: f >= MOVE_FRAC, wp: i < n ? to : null, index: i };
}

/**
 * Estado de cada pieza en el instante u (para dibujarla):
 *   CNC: cortada o no · LIJ: lijada o no · ENS: 'lay' | 'carried' | 'asm'
 * `times[ri]` = tiempo de trabajo del brazo ri en este ciclo.
 */
export function partStates(cellId, plan, times, u) {
  return plan.parts.map((_, j) => {
    const ri = plan.partRobot[j];
    if (ri < 0 || !plan.byRobot[ri]) return null;
    const n = plan.byRobot[ri].length, T = times[ri] || 0;
    const w = plan.partWp[j];
    const done = (wi) => wi !== undefined && u >= wpTimes(n, T, wi).t1;
    if (cellId === 'CNC') return done(w.cut) ? 'cut' : 'blank';
    if (cellId === 'LIJ') return done(w.sand) ? 'sanded' : 'planed';
    if (cellId === 'ENS') {
      if (done(w.place)) return 'asm';
      if (w.pick !== undefined && u >= wpTimes(n, T, w.pick).tm + (wpTimes(n, T, w.pick).t1 - wpTimes(n, T, w.pick).tm) * 0.8) {
        const a = wpTimes(n, T, w.pick).t1, b = wpTimes(n, T, w.place).t1;
        return { carried: ri, k: Math.max(0, Math.min(1, (u - a) / Math.max(1e-3, b - a))) };
      }
      return 'lay';
    }
    return null;
  });
}

export { SIDE_RACK };
