// ─────────────────────────────────────────────────────────────────────────────
// Rejilla de navegación de los AGV y planificador A*.
//
// · Celdas de 0,5 m sobre toda la nave; una celda está bloqueada si cae dentro de un
//   obstáculo (máquinas, vallados, racks, cintas) inflado con el radio del AGV.
// · A* 8-conexo con heurística octil y suavizado posterior por línea de visión, así
//   las rutas son tramos rectos largos en lugar de escalones.
// · `extra`: celdas bloqueadas temporalmente (otros AGV) para replanificar un desvío.
// ─────────────────────────────────────────────────────────────────────────────

export class NavGrid {
  constructor(hall, cell = 0.5) {
    this.hall = hall;
    this.cell = cell;
    this.nx = Math.round((hall.x1 - hall.x0) / cell);
    this.nz = Math.round((hall.z1 - hall.z0) / cell);
    this.blocked = new Uint8Array(this.nx * this.nz);
  }

  idx(i, k) { return k * this.nx + i; }
  cellOf(x, z) {
    return [Math.floor((x - this.hall.x0) / this.cell), Math.floor((z - this.hall.z0) / this.cell)];
  }
  center(i, k) { return [this.hall.x0 + (i + 0.5) * this.cell, this.hall.z0 + (k + 0.5) * this.cell]; }
  inside(i, k) { return i >= 0 && k >= 0 && i < this.nx && k < this.nz; }

  /** Marca un rectángulo (inflado `r`) como bloqueado. */
  markRect(x0, z0, x1, z1, r = 0) {
    const [i0, k0] = this.cellOf(Math.min(x0, x1) - r, Math.min(z0, z1) - r);
    const [i1, k1] = this.cellOf(Math.max(x0, x1) + r, Math.max(z0, z1) + r);
    for (let k = Math.max(0, k0); k <= Math.min(this.nz - 1, k1); k++)
      for (let i = Math.max(0, i0); i <= Math.min(this.nx - 1, i1); i++) this.blocked[this.idx(i, k)] = 1;
  }

  /** Bordes de la nave (con margen). */
  markBorder(r) {
    const h = this.hall;
    this.markRect(h.x0 - 1, h.z0 - 1, h.x1 + 1, h.z0 + r);
    this.markRect(h.x0 - 1, h.z1 - r, h.x1 + 1, h.z1 + 1);
    this.markRect(h.x0 - 1, h.z0 - 1, h.x0 + r, h.z1 + 1);
    this.markRect(h.x1 - r, h.z0 - 1, h.x1 + 1, h.z1 + 1);
  }

  isFreeCell(i, k, extra) {
    if (!this.inside(i, k)) return false;
    const id = this.idx(i, k);
    return !this.blocked[id] && !(extra && extra.has(id));
  }
  isFree(x, z, extra) { const [i, k] = this.cellOf(x, z); return this.isFreeCell(i, k, extra); }

  /** Celda libre más cercana (búsqueda en anillos). */
  nearestFree(x, z, extra, maxR = 40) {
    const [ci, ck] = this.cellOf(x, z);
    if (this.isFreeCell(ci, ck, extra)) return [ci, ck];
    for (let r = 1; r <= maxR; r++) {
      let best = null, bd = Infinity;
      for (let dk = -r; dk <= r; dk++) for (let di = -r; di <= r; di++) {
        if (Math.max(Math.abs(di), Math.abs(dk)) !== r) continue;
        if (this.isFreeCell(ci + di, ck + dk, extra)) {
          const d = di * di + dk * dk;
          if (d < bd) { bd = d; best = [ci + di, ck + dk]; }
        }
      }
      if (best) return best;
    }
    return null;
  }

  /** Celdas alcanzables desde (x, z) — para validar el layout. */
  reach(x, z) {
    const seen = new Uint8Array(this.nx * this.nz);
    const start = this.nearestFree(x, z);
    if (!start) return seen;
    const q = [this.idx(...start)];
    seen[q[0]] = 1;
    while (q.length) {
      const id = q.pop();
      const i = id % this.nx, k = (id - i) / this.nx;
      for (const [di, dk] of DIRS4) {
        const ni = i + di, nk = k + dk;
        if (!this.isFreeCell(ni, nk)) continue;
        const nid = this.idx(ni, nk);
        if (!seen[nid]) { seen[nid] = 1; q.push(nid); }
      }
    }
    return seen;
  }
  reachable(seen, x, z) {
    const c = this.nearestFree(x, z, null, 2);
    return !!c && !!seen[this.idx(...c)];
  }

  /** Visibilidad directa entre dos puntos (muestreo cada media celda). */
  lineOfSight(ax, az, bx, bz, extra) {
    const d = Math.hypot(bx - ax, bz - az);
    const n = Math.max(1, Math.ceil(d / (this.cell * 0.5)));
    for (let s = 0; s <= n; s++) {
      const t = s / n;
      if (!this.isFree(ax + (bx - ax) * t, az + (bz - az) * t, extra)) return false;
    }
    return true;
  }

  /**
   * A* de (ax, az) a (bx, bz). Devuelve la lista de puntos (mundo) o null.
   * Si el origen o el destino caen en celda bloqueada se usa la libre más cercana.
   */
  findPath(ax, az, bx, bz, extra) {
    const s = this.nearestFree(ax, az, extra, 6);
    const g = this.nearestFree(bx, bz, extra, 6);
    if (!s || !g) return null;
    const N = this.nx * this.nz;
    const start = this.idx(...s), goal = this.idx(...g);
    const gScore = new Float32Array(N).fill(Infinity);
    const came = new Int32Array(N).fill(-1);
    const closed = new Uint8Array(N);
    const heap = new MinHeap();
    const [gi, gk] = g;
    const h = (i, k) => { const dx = Math.abs(i - gi), dz = Math.abs(k - gk); return Math.max(dx, dz) + 0.4142 * Math.min(dx, dz); };
    gScore[start] = 0;
    heap.push(start, h(...s));
    let found = false, iters = 0;
    while (heap.size) {
      const id = heap.pop();
      if (closed[id]) continue;
      if (id === goal) { found = true; break; }
      closed[id] = 1;
      if (++iters > 60000) break;
      const i = id % this.nx, k = (id - i) / this.nx;
      for (const [di, dk, c] of DIRS8) {
        const ni = i + di, nk = k + dk;
        if (!this.isFreeCell(ni, nk, extra)) continue;
        if (di && dk && (!this.isFreeCell(i + di, k, extra) || !this.isFreeCell(i, k + dk, extra))) continue;  // sin cortar esquinas
        const nid = this.idx(ni, nk);
        if (closed[nid]) continue;
        const ng = gScore[id] + c;
        if (ng < gScore[nid]) { gScore[nid] = ng; came[nid] = id; heap.push(nid, ng + h(ni, nk)); }
      }
    }
    if (!found) return null;
    const cells = [];
    for (let id = goal; id !== -1; id = came[id]) cells.push(id);
    cells.reverse();
    const pts = cells.map((id) => { const i = id % this.nx; return this.center(i, (id - i) / this.nx); });
    pts[0] = this.isFree(ax, az, extra) ? [ax, az] : pts[0];
    pts[pts.length - 1] = this.isFree(bx, bz, extra) ? [bx, bz] : pts[pts.length - 1];
    return this.smooth(pts, extra);
  }

  /** Suavizado «string pulling»: se salta puntos mientras haya línea de visión. */
  smooth(pts, extra) {
    if (pts.length <= 2) return pts;
    const out = [pts[0]];
    let a = 0;
    while (a < pts.length - 1) {
      let b = pts.length - 1;
      while (b > a + 1 && !this.lineOfSight(pts[a][0], pts[a][1], pts[b][0], pts[b][1], extra)) b--;
      out.push(pts[b]);
      a = b;
    }
    return out;
  }

  /** Conjunto de celdas en un disco (para bloquear temporalmente a otro AGV). */
  disc(x, z, r) {
    const set = new Set();
    const [i0, k0] = this.cellOf(x - r, z - r), [i1, k1] = this.cellOf(x + r, z + r);
    for (let k = k0; k <= k1; k++) for (let i = i0; i <= i1; i++) {
      if (!this.inside(i, k)) continue;
      const [cx, cz] = this.center(i, k);
      if ((cx - x) ** 2 + (cz - z) ** 2 <= r * r) set.add(this.idx(i, k));
    }
    return set;
  }
}

const DIRS4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const DIRS8 = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, 1.4142], [1, -1, 1.4142], [-1, 1, 1.4142], [-1, -1, 1.4142]];

class MinHeap {
  constructor() { this.ids = []; this.keys = []; }
  get size() { return this.ids.length; }
  push(id, key) {
    const a = this.ids, k = this.keys;
    a.push(id); k.push(key);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (k[p] <= k[i]) break;
      [a[p], a[i]] = [a[i], a[p]]; [k[p], k[i]] = [k[i], k[p]];
      i = p;
    }
  }
  pop() {
    const a = this.ids, k = this.keys;
    const top = a[0];
    const lastId = a.pop(), lastK = k.pop();
    if (a.length) {
      a[0] = lastId; k[0] = lastK;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1;
        let m = i;
        if (l < a.length && k[l] < k[m]) m = l;
        if (r < a.length && k[r] < k[m]) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i], a[m]]; [k[m], k[i]] = [k[i], k[m]];
        i = m;
      }
    }
    return top;
  }
}
