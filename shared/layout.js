// ─────────────────────────────────────────────────────────────────────────────
// Distribución de la planta (layout dinámico).
//
// buildPlant(placements) calcula, a partir de dónde está cada zona y cómo está girada:
//   · la transformación local→mundo de cada zona,
//   · la cinta transportadora que une las estaciones (autoenrutada en tramos ortogonales),
//   · la posición de robots, puertos de AGV, puestos de trabajo y áreas exclusivas,
//   · la rejilla de navegación de los AGV,
//   · y la validación: dentro de la nave, sin solapes, cinta posible y puertos alcanzables.
// Lo usan el servidor (simulación), el visor 3D (dibujo y modo edición) y las pruebas.
// ─────────────────────────────────────────────────────────────────────────────
import { HALL, LINE_STATIONS } from './config.js';
import { ZONES, ZONE_IDS, DEFAULT_PLACEMENTS, CELL_ROBOTS } from './zones.js';
import { NavGrid } from './nav.js';

export const AGV_R = 0.8;       // inflado de obstáculos (medio ancho del AGV + holgura)
export const CONV_W = 1.2;      // ancho ocupado por la cinta
const STUB = 0.6;               // tramo recto mínimo a la salida/entrada de una estación
const EPS = 0.05;

// ── Transformaciones ─────────────────────────────────────────────────────────
export function makeTransform(pl) {
  const rot = ((pl.rot % 4) + 4) % 4;
  const th = rot * Math.PI / 2;
  const c = Math.round(Math.cos(th)), s = Math.round(Math.sin(th));
  const T = {
    x: pl.x, z: pl.z, rot, th, c, s,
    toWorld: (lx, lz) => [pl.x + lx * c + lz * s, pl.z - lx * s + lz * c],
    toLocal: (wx, wz) => { const dx = wx - pl.x, dz = wz - pl.z; return [dx * c - dz * s, dx * s + dz * c]; },
    heading: (h) => h + th,
    dir: (lx, lz) => [lx * c + lz * s, -lx * s + lz * c],
    rect: ([x0, z0, x1, z1]) => {
      const a = T.toWorld(x0, z0), b = T.toWorld(x1, z1);
      return [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[0], b[0]), Math.max(a[1], b[1])];
    },
  };
  return T;
}

export const headingDir = (h) => [Math.cos(h), -Math.sin(h)];

export function normalizePlacements(p = {}) {
  const out = {};
  for (const id of ZONE_IDS) {
    const d = DEFAULT_PLACEMENTS[id];
    const v = ZONES[id].movable && p[id] ? p[id] : d;
    out[id] = { x: +v.x, z: +v.z, rot: (((v.rot | 0) % 4) + 4) % 4 };
  }
  return out;
}

// ── Geometría auxiliar ───────────────────────────────────────────────────────
const overlap = (a, b, m = 0) => a[0] < b[2] - m && a[2] > b[0] + m && a[1] < b[3] - m && a[3] > b[1] + m;

/** Rectángulo ocupado por un tramo ortogonal de cinta (sin extender los extremos). */
function segRect([ax, az], [bx, bz], w = CONV_W) {
  const h = w / 2;
  if (Math.abs(az - bz) < 1e-6) return [Math.min(ax, bx), az - h, Math.max(ax, bx), az + h];
  return [ax - h, Math.min(az, bz), ax + h, Math.max(az, bz)];
}

function simplify(pts) {
  const out = [];
  for (const p of pts) {
    const q = out[out.length - 1];
    if (q && Math.abs(q[0] - p[0]) < 1e-6 && Math.abs(q[1] - p[1]) < 1e-6) continue;
    out.push(p);
  }
  for (let i = out.length - 2; i >= 1; i--) {
    const [a, b, c] = [out[i - 1], out[i], out[i + 1]];
    if ((Math.abs(a[0] - b[0]) < 1e-6 && Math.abs(b[0] - c[0]) < 1e-6) || (Math.abs(a[1] - b[1]) < 1e-6 && Math.abs(b[1] - c[1]) < 1e-6)) {
      // colineal: si no hay retroceso se elimina el punto intermedio
      const d1 = [b[0] - a[0], b[1] - a[1]], d2 = [c[0] - b[0], c[1] - b[1]];
      if (d1[0] * d2[0] + d1[1] * d2[1] >= 0) out.splice(i, 1);
    }
  }
  return out;
}

const pathLen = (pts) => pts.reduce((s, p, i) => (i ? s + Math.hypot(p[0] - pts[i - 1][0], p[1] - pts[i - 1][1]) : 0), 0);

function hasReversal(pts) {
  for (let i = 1; i < pts.length - 1; i++) {
    const d1 = [pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]];
    const d2 = [pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]];
    if (d1[0] * d2[0] + d1[1] * d2[1] < -1e-6) return true;
  }
  return false;
}

/**
 * Cinta entre la salida `a` (dirección da) de una estación y la entrada `b` (dirección db)
 * de la siguiente: prueba rutas rectas, en L y en Z (también con rodeos) y se queda con
 * la más corta que no atraviesa ninguna zona.
 */
function routeConveyor(a, da, b, db, rects) {
  if (Math.hypot(a[0] - b[0], a[1] - b[1]) < 1e-3) return [a];
  const p1 = [a[0] + da[0] * STUB, a[1] + da[1] * STUB];
  const p2 = [b[0] - db[0] * STUB, b[1] - db[1] * STUB];
  const cands = [[a, b], [a, p1, [p2[0], p1[1]], p2, b], [a, p1, [p1[0], p2[1]], p2, b]];
  const mx = (p1[0] + p2[0]) / 2, mz = (p1[1] + p2[1]) / 2;
  for (const off of [0, -4, 4, -8, 8, -13, 13, -19, 19]) {
    cands.push([a, p1, [mx + off, p1[1]], [mx + off, p2[1]], p2, b]);
    cands.push([a, p1, [p1[0], mz + off], [p2[0], mz + off], p2, b]);
  }
  let best = null, bestLen = Infinity;
  for (const raw of cands) {
    const pts = simplify(raw);
    if (pts.length < 2) continue;
    let ok = !hasReversal(pts);
    for (let i = 1; ok && i < pts.length; i++) {
      const p = pts[i - 1], q = pts[i];
      if (Math.abs(p[0] - q[0]) > 1e-6 && Math.abs(p[1] - q[1]) > 1e-6) { ok = false; break; }   // solo ortogonal
      const r = segRect(p, q);
      if (r[0] < HALL.x0 + 0.3 || r[2] > HALL.x1 - 0.3 || r[1] < HALL.z0 + 0.3 || r[3] > HALL.z1 - 0.3) ok = false;
      for (const z of rects) if (ok && overlap(r, z, EPS)) ok = false;
    }
    // entrar a la estación siguiente en su dirección
    if (ok) {
      const n = pts.length, d = [pts[n - 1][0] - pts[n - 2][0], pts[n - 1][1] - pts[n - 2][1]];
      if (d[0] * db[0] + d[1] * db[1] <= 0) ok = false;
      const d0 = [pts[1][0] - pts[0][0], pts[1][1] - pts[0][1]];
      if (d0[0] * da[0] + d0[1] * da[1] <= 0) ok = false;
    }
    if (!ok) continue;
    const L = pathLen(pts) + (pts.length - 2) * 0.8;            // penaliza las curvas
    if (L < bestLen) { bestLen = L; best = pts; }
  }
  return best;
}

// ═════════════════════════════════════════════════════════════════════════════
export function buildPlant(placementsIn) {
  const placements = normalizePlacements(placementsIn);
  const errors = [];
  const zones = {};
  for (const id of ZONE_IDS) {
    const def = ZONES[id], pl = placements[id], T = makeTransform(pl);
    const [lx, lz] = def.size;
    zones[id] = { id, def, pl, T, rect: T.rect([-lx / 2, -lz / 2, lx / 2, lz / 2]) };
  }

  // 1 · dentro de la nave y sin solapes
  for (const id of ZONE_IDS) {
    const r = zones[id].rect;
    if (r[0] < HALL.x0 - EPS || r[2] > HALL.x1 + EPS || r[1] < HALL.z0 - EPS || r[3] > HALL.z1 + EPS)
      errors.push({ zone: id, msg: `«${ZONES[id].short}» se sale de la nave` });
  }
  for (let i = 0; i < ZONE_IDS.length; i++) for (let j = i + 1; j < ZONE_IDS.length; j++) {
    const a = ZONE_IDS[i], b = ZONE_IDS[j];
    if (overlap(zones[a].rect, zones[b].rect, EPS)) errors.push({ zone: a, other: b, msg: `«${ZONES[a].short}» se solapa con «${ZONES[b].short}»` });
  }

  // 2 · estaciones y cinta transportadora
  const stations = LINE_STATIONS.map((id) => {
    const { T, def } = zones[id];
    return {
      id, zone: id,
      in: T.toWorld(...def.line.in), out: T.toWorld(...def.line.out), work: T.toWorld(...def.line.work),
      dir: T.dir(1, 0), heading: T.heading(0),
    };
  });
  const path = [];
  const pushPts = (pts) => { for (const p of pts) { const q = path[path.length - 1]; if (!q || Math.hypot(q[0] - p[0], q[1] - p[1]) > 1e-6) path.push(p); } };
  pushPts([stations[0].in, stations[0].out]);
  for (let i = 0; i < stations.length - 1; i++) {
    const A = stations[i], B = stations[i + 1];
    const rects = ZONE_IDS.map((id) => zones[id].rect);
    const r = routeConveyor(A.out, A.dir, B.in, B.dir, rects);
    if (!r) {
      errors.push({ zone: B.id, other: A.id, msg: `La cinta no puede unir «${ZONES[A.id].short}» con «${ZONES[B.id].short}»` });
      pushPts([A.out, B.in]);
    } else pushPts(r);
    pushPts([B.in, B.out]);
  }
  const conveyor = buildPolyline(simplify(path));
  for (const st of stations) st.s = conveyor.project(st.work);

  // 3 · robots, puertos, puestos y áreas exclusivas en coordenadas de mundo
  const robots = CELL_ROBOTS.map((r) => {
    const { T } = zones[r.cellId];
    const [x, z] = T.toWorld(r.local[0], r.local[2]);
    return { ...r, pos: [x, r.local[1], z], worldYaw: r.yaw + T.th };
  });
  const ports = {};
  for (const id of ZONE_IDS) {
    const { T, def } = zones[id];
    for (const [name, p] of Object.entries(def.ports)) {
      const [x, z] = T.toWorld(...p.p);
      const h = T.heading(p.h);
      const d = headingDir(h);
      ports[`${id}.${name}`] = {
        key: `${id}.${name}`, zone: id, name, x, z, h, reachTo: p.reachTo ?? 0, approach: p.approach,
        ax: x - d[0] * p.approach, az: z - d[1] * p.approach,
      };
    }
  }
  const spots = {};
  for (const id of ZONE_IDS) {
    const { T, def } = zones[id];
    for (const [role, p] of Object.entries(def.spots || {})) {
      const [x, z] = T.toWorld(...p);
      (spots[id] ||= {})[role] = { x, z, y: def.elevated || 0, h: T.th };
    }
  }
  const exclusive = ZONE_IDS.filter((id) => ZONES[id].exclusive).map((id) => ({ zone: id, rect: zones[id].T.rect(ZONES[id].exclusive) }));

  // 4 · rejilla de navegación
  const nav = new NavGrid(HALL, 0.5);
  nav.markBorder(AGV_R);
  const obstacles = [];
  for (const id of ZONE_IDS) for (const b of ZONES[id].blocks) obstacles.push({ zone: id, rect: zones[id].T.rect(b) });
  for (let i = 1; i < conveyor.pts.length; i++) obstacles.push({ zone: 'CINTA', rect: segRect(conveyor.pts[i - 1], conveyor.pts[i]) });
  for (const o of obstacles) nav.markRect(...o.rect, AGV_R);

  // 5 · alcanzabilidad de los puntos de carga
  if (!errors.length) {
    const base = ports['AGVB.chg_0'];
    const seen = nav.reach(base.x, base.z);
    for (const p of Object.values(ports)) {
      const label = `${ZONES[p.zone].short}${p.zone === 'ALM' ? '' : ` · ${PORT_NAMES[p.name] || p.name}`}`;
      if (!nav.reachable(seen, p.ax, p.az)) {
        if (!errors.some((e) => e.msg.includes(label))) errors.push({ zone: p.zone, msg: `Los AGV no pueden llegar a «${label}»` });
        continue;
      }
      // la entrada recta al puerto no puede atravesar otras zonas
      if (p.approach > 0) {
        const r = [Math.min(p.x, p.ax) - 0.6, Math.min(p.z, p.az) - 0.6, Math.max(p.x, p.ax) + 0.6, Math.max(p.z, p.az) + 0.6];
        for (const id of ZONE_IDS) if (id !== p.zone && overlap(r, zones[id].rect, EPS))
          errors.push({ zone: p.zone, other: id, msg: `«${ZONES[id].short}» tapa el acceso a «${label}»` });
      }
    }
  }

  return { placements, zones, stations, conveyor, robots, ports, spots, exclusive, nav, obstacles, errors, valid: errors.length === 0 };
}

const PORT_NAMES = { pad: 'pila', in: 'entrada', out: 'salida', pallet: 'palé', load: 'carga' };

// ── Polilínea con parámetro de longitud ───────────────────────────────────────
export function buildPolyline(pts) {
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  const length = cum[cum.length - 1];
  return {
    pts, cum, length,
    /** Punto y rumbo a la distancia s. */
    at(s) {
      s = Math.max(0, Math.min(length, s));
      let i = 1;
      while (i < pts.length - 1 && cum[i] < s) i++;
      const a = pts[i - 1] || pts[0], b = pts[i] || pts[0];
      const L = cum[i] - cum[i - 1] || 1;
      const t = (s - cum[i - 1]) / L;
      return { x: a[0] + (b[0] - a[0]) * t, z: a[1] + (b[1] - a[1]) * t, h: Math.atan2(-(b[1] - a[1]), b[0] - a[0]) };
    },
    /** Distancia a lo largo de la polilínea del punto más cercano a p. */
    project([px, pz]) {
      let best = 0, bd = Infinity;
      for (let i = 1; i < pts.length; i++) {
        const [ax, az] = pts[i - 1], [bx, bz] = pts[i];
        const L2 = (bx - ax) ** 2 + (bz - az) ** 2 || 1;
        const t = Math.max(0, Math.min(1, ((px - ax) * (bx - ax) + (pz - az) * (bz - az)) / L2));
        const d = (ax + (bx - ax) * t - px) ** 2 + (az + (bz - az) * t - pz) ** 2;
        if (d < bd) { bd = d; best = cum[i - 1] + t * Math.sqrt(L2); }
      }
      return best;
    },
  };
}
