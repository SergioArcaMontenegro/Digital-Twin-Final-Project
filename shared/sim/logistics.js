// ─────────────────────────────────────────────────────────────────────────────
// Logística coordinada de la planta.
//
//   Camión de troncos → patio (por especie) → pórtico de troncos → sierra de cinta →
//   pórtico apilador → pila verde → AGV-A → secadero → AGV-B → pila seca de la
//   cepilladora → línea → paletizador → AGV-C → almacén → AGV-D → camión → cliente.
//
// Las máquinas guardan su posición en coordenadas LOCALES de su zona: si la zona se mueve
// en el modo edición, todo lo que contiene se mueve con ella.
//
// AGV: rutas A* sobre la rejilla de la planta, giro sobre sí mismos, entrada recta a los
// puertos (bajo la pila o con las horquillas), marcha atrás para salir. Tráfico:
//   · se detienen si otro AGV está delante (cono de 3,3 m),
//   · si dos se bloquean mutuamente, el de menor prioridad replanifica rodeando al otro,
//   · el pasillo del almacén es exclusivo (un AGV dentro cada vez),
//   · supervisión: si un bloqueo dura más de 45 s se fuerza el paso y se registra.
// ─────────────────────────────────────────────────────────────────────────────
import { ZONES, PIECE_Y } from '../zones.js';
import { headingDir } from '../layout.js';
import { SPECIES, SPECIES_IDS, BOARDS_PER_LOG, LAYERS_PER_STACK, BOARDS_PER_STACK, PRODUCTS } from '../config.js';
import { DIMS, PALLET_PATTERN, PALLET_TOP } from '../products.js';
import { solveWorld } from '../ik.js';

const smooth = (t) => t * t * (3 - 2 * t);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
export function angDiff(a, b) { let d = a - b; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; return d; }

const ASE = ZONES.ASE.geo;
export const PILE_CAP = 15;
const LOG_R = 0.28;
/** Hueco i de la pila de una especie (pirámide 5-4-3-2-1 a lo largo de Z). */
export function pileSlot(species, i) {
  const rows = [5, 4, 3, 2, 1];
  let r = 0, k = i;
  while (r < rows.length && k >= rows[r]) { k -= rows[r]; r++; }
  r = Math.min(r, 4);
  const n = rows[r];
  return [ASE.pileX, LOG_R + r * LOG_R * 1.72, ASE.pileZ[species] + (k - (n - 1) / 2) * LOG_R * 2.05];
}
export const TRUCK_LOGS = 12;
export function truckSlot(i) {
  const x0 = ASE.truck.x0 + 2.4;
  return [x0 + (i % 2) * 4.4 + 2.1, 1.55 + Math.floor(i / 6) * 0.5, ASE.truck.z + ((Math.floor(i / 2) % 3) - 1) * 0.6];
}

const PAL = ZONES.PAL.geo;
const PAL_DEF = { model: 'palletizer', pos: [0, 0, 0], yaw: 0, inverted: false };
const DOWN = -Math.PI / 2;
const AGV_CFG = {
  lift: { speed: 1.5, loaded: 1.0, len: 2.2 },
  fork: { speed: 1.35, loaded: 0.95, len: 2.0 },
};

let palletSeq = 1;
const newPallet = (index) => ({ index, present: true, items: [], key: null, orderId: null, wrap: 0, ready: false, closing: false, reserved: false, respawn: 0, readyAt: 0 });

export class Logistics {
  constructor(w, saved = {}) {
    this.w = w;
    const s = saved;
    this.yard = { ...Object.fromEntries(SPECIES_IDS.map((k) => [k, 0])), ...(s.yard || { pino: 26, haya: 12, roble: 12, nogal: 8 }) };
    this.logTruck = { state: 'NONE', x: -60, logs: [], purchaseId: null, t: 0 };
    this.logGantry = { pos: { x: -10, z: 0, y: 6, claw: 0 }, queue: [], carrying: null, state: 'Parado' };
    this.deck = null;                       // especie del tronco en la mesa de la sierra
    this.saw = { state: 'IDLE', t: 0, logX: ASE.saw.deckX, species: null };
    this.outfeed = null;                    // capa de tablas (especie) en la mesa de salida
    this.stacker = { pos: { x: 12, z: -2, y: 3.6, vac: 0 }, queue: [], carrying: null, state: 'Parado' };
    this.greenPad = s.greenPad || { species: 'pino', layers: 3, closing: false, reserved: false };
    this.greenPad.reserved = false;
    this.kiln = { stacks: s.kilnStacks || [{ species: 'pino', boards: 36, left: 0 }, { species: 'roble', boards: 36, left: 0 }, { species: 'haya', boards: 36, left: 0 }, { species: 'pino', boards: 36, left: 1500 }, { species: 'nogal', boards: 36, left: 2400 }, { species: 'roble', boards: 36, left: 3600 }], doorIn: 0, doorOut: 0 };
    this.dryPad = s.dryPad || { species: 'pino', boards: 30 };
    this.pal = this.newPalletizer();
    this.slots = {};
    const A = ZONES.ALM.geo;
    A.rowZ.forEach((_, row) => A.bays.forEach((_, bay) => A.levels.forEach((_, lvl) => { this.slots[`${row}_${bay}_${lvl}`] = null; })));
    this.slotRes = {};
    if (s.slots) { for (const [k, v] of Object.entries(s.slots)) if (k in this.slots) this.slots[k] = v; }
    else this.seedWarehouse();
    for (const p of Object.values(this.slots)) if (p) palletSeq = Math.max(palletSeq, (+String(p.id).replace(/\D/g, '') || 0) + 1);
    this.truck = { state: 'DOCKED', t: 0, x: 0, pallets: [], lastLoad: 0, taskOpen: false };
    this.counters = s.counters || { logs: 0, greenStacks: 0, dryStacks: 0, pallets: 0, shipped: 0, trucks: 0, unloaded: 0 };
    this.agvs = [
      this.newAgv('AGV-A', 'lift', 0, 'Elevación · pila verde → secadero'),
      this.newAgv('AGV-B', 'lift', 1, 'Elevación · secadero → cepilladora'),
      this.newAgv('AGV-C', 'fork', 2, 'Carretilla · palés → almacén'),
      this.newAgv('AGV-D', 'fork', 3, 'Carretilla · almacén → camión'),
    ];
    this.locks = {};
    this.lastCheck = 0;
  }

  serialize() {
    return {
      yard: this.yard, greenPad: { ...this.greenPad, reserved: false },
      kilnStacks: this.kiln.stacks, dryPad: this.dryPad,
      slots: Object.fromEntries(Object.entries(this.slots).map(([k, p]) => [k, p])),
      counters: this.counters,
    };
  }

  seedWarehouse() {
    const put = (key, product, species, tone, units) => {
      this.slots[key] = { id: `PL-${palletSeq++}`, product, species, tone, orderId: null, units, items: Array.from({ length: units }, () => ({ product, species, tone })) };
    };
    put('0_0_0', 'silla', 'pino', 'natural', 4);
    put('0_0_1', 'silla', 'pino', 'natural', 4);
    put('1_1_0', 'tablon', 'pino', 'natural', 6);
    put('0_2_0', 'mesa', 'roble', 'miel', 2);
    put('1_3_0', 'estanteria', 'haya', 'natural', 3);
  }

  newPalletizer() {
    const home = solveWorld(PAL_DEF, { p: [0.2, 2.3, 1.4], g: DOWN });
    return { q: home.slice(), home, moves: [], clamp: 0, gap: 0.4, carrying: null, q1pick: 0,
      pallets: PAL.pallets.map((p, i) => newPallet(i)), state: 'Esperando producto' };
  }

  newAgv(id, type, chg, label) {
    const p = this.w.plant.ports[`AGVB.chg_${chg}`];
    return {
      id, type, label, homePort: `AGVB.chg_${chg}`, x: p.x, z: p.z, h: p.h,
      state: 'IDLE', mission: 'En base', battery: 65 + chg * 9, load: null,
      lift: 0, liftH: 0.15, reach: 0, reachTo: 1, steps: [], path: null, wait: null, waitT: 0, ghost: 0, moved: 0,
      prio: 4 - chg, travel: 0,
    };
  }

  log(level, msg) { this.w.log(level, msg); }
  staffed(post) { return this.w.staff.postStaffed(post); }

  // ═══════════════════════════════════════════════════════════════════════
  step(dt) {
    this.stepLogTruck(dt);
    this.stepLogGantry(dt);
    this.stepSaw(dt);
    this.stepStacker(dt);
    this.stepKiln(dt);
    this.stepPalletizer(dt);
    this.stepTruck(dt);
    for (const a of this.agvs) this.stepAgv(a, dt);
  }

  // ── Demanda de madera por especie (tablas) ────────────────────────────────
  boardsNeeded(species) {
    let n = 0;
    for (const po of this.w.eco.plan) if (po.species === species && po.status !== 'CANCELADA') n += Math.max(0, po.qty - po.started) * PRODUCTS[po.product].boards;
    return n;
  }
  boardsAvailable(species) {
    let n = 0;
    if (this.dryPad.species === species) n += this.dryPad.boards;
    for (const s of this.kiln.stacks) if (s.species === species) n += s.boards;
    if (this.greenPad.species === species) n += this.greenPad.layers * BOARDS_PER_LOG;
    if (this.outfeed === species) n += BOARDS_PER_LOG;
    if (this.deck === species) n += BOARDS_PER_LOG;
    if (this.logGantry.carrying === species && !this.logGantry.toPile) n += BOARDS_PER_LOG;
    for (const a of this.agvs) if (a.load?.kind === 'stack' && a.load.species === species) n += a.load.boards;
    return n;
  }
  deficit(species) {
    const need = this.boardsNeeded(species);
    return need > 0 ? need + BOARDS_PER_STACK - this.boardsAvailable(species) : -1;
  }
  /** Especie que conviene aserrar ahora (o null si no hay demanda). */
  sawPlan() {
    const gp = this.greenPad;
    if (gp.closing) return null;
    if (gp.layers > 0 && gp.species && this.yard[gp.species] > 0 && this.deficit(gp.species) > 0) return gp.species;
    let best = null, bv = 0;
    for (const s of SPECIES_IDS) { const d = this.deficit(s); if (d > bv && this.yard[s] > 0) { bv = d; best = s; } }
    if (best && gp.layers > 0 && gp.species !== best) { gp.closing = true; return null; }
    return best;
  }

  // ── Camión de troncos ─────────────────────────────────────────────────────
  stepLogTruck(dt) {
    const T = this.logTruck, w = this.w;
    T.t += dt;
    const bayX = (ASE.truck.x0 + ASE.truck.x1) / 2;
    if (T.state === 'NONE') {
      const p = w.eco.purchases.find((x) => x.status === 'EN_CAMINO' && x.eta <= w.t);
      if (p) {
        Object.assign(T, { state: 'ARRIVING', t: 0, purchaseId: p.id, logs: Array.from({ length: p.logs }, () => p.species), x: bayX - 45 });
        p.status = 'LLEGANDO';
      }
    } else if (T.state === 'ARRIVING') {
      T.x = bayX - 45 + 45 * smooth(clamp(T.t / 14, 0, 1));
      if (T.t >= 14) {
        T.state = 'WAIT'; T.t = 0;
        const p = w.eco.purchase(T.purchaseId);
        if (p) p.status = 'EN_PATIO';
        w.staff.addTask({ type: 'RECEPCION', role: 'aserrador', zone: 'ASE', ref: `REC_LOG:${T.purchaseId}`, title: `Recibir camión de troncos ${T.purchaseId}`, detail: `${T.logs.length} troncos de ${SPECIES[T.logs[0]]?.name.toLowerCase()} en la zona de descarga. Comprobar albarán y dar entrada.` });
        this.log('info', `Patio: camión de troncos ${T.purchaseId} en la zona de descarga · pendiente de recepción`);
      }
    } else if (T.state === 'UNLOADING') {
      if (!T.logs.length && !this.logGantry.fromTruck) {
        T.state = 'LEAVING'; T.t = 0;
        const p = w.eco.purchase(T.purchaseId);
        if (p) p.status = 'RECIBIDO';
        this.log('ok', `Patio: camión ${T.purchaseId} descargado`);
      }
    } else if (T.state === 'LEAVING') {
      T.x = bayX - 45 * smooth(clamp(T.t / 14, 0, 1));
      if (T.t >= 14) Object.assign(T, { state: 'NONE', purchaseId: null, logs: [] });
    }
  }
  receiveLogs(purchaseId) {
    const T = this.logTruck;
    if (T.state !== 'WAIT' || T.purchaseId !== purchaseId) return false;
    T.state = 'UNLOADING';
    const p = this.w.eco.purchase(purchaseId);
    if (p) p.status = 'DESCARGANDO';
    this.log('info', `Patio: recepción confirmada de ${purchaseId} · el pórtico descarga los troncos`);
    return true;
  }

  // ── Pórtico de troncos ───────────────────────────────────────────────────
  stepLogGantry(dt) {
    const g = this.logGantry;
    if (runQueue(g, dt)) return;
    if (!this.staffed('ASE')) { g.state = 'Sin aserrador'; return; }
    const T = this.logTruck;
    const SP = 2.4, park = 6;
    // 1 · descargar el camión
    if (T.state === 'UNLOADING' && T.logs.length) {
      const sp = T.logs[T.logs.length - 1];
      if (this.yard[sp] < PILE_CAP * 2) {
        const from = truckSlot(T.logs.length - 1);
        const to = pileSlot(sp, Math.min(this.yard[sp], PILE_CAP - 1));
        g.state = 'Descargando camión';
        g.fromTruck = true;
        g.queue.push(
          { to: { x: from[0], z: from[2], y: park }, dur: travel(g.pos, { x: from[0], z: from[2] }, SP) },
          { to: { y: from[1] + 0.4 }, dur: 2 },
          { to: { claw: 1 }, dur: 0.8, done: () => { g.carrying = T.logs.pop(); g.toPile = true; } },
          { to: { y: park }, dur: 2 },
          { to: { x: to[0], z: to[2] }, dur: travel({ x: from[0], z: from[2] }, { x: to[0], z: to[2] }, SP) },
          { to: { y: to[1] + 0.45 }, dur: 2 },
          { to: { claw: 0 }, dur: 0.8, done: () => { this.yard[g.carrying]++; g.carrying = null; g.toPile = false; g.fromTruck = false; this.counters.unloaded++; } },
          { to: { y: park }, dur: 1.8 },
        );
        return;
      }
    }
    // 2 · alimentar la sierra
    if (this.deck) { g.state = 'Esperando sierra'; return; }
    const sp = this.sawPlan();
    if (!sp) { g.state = this.greenPad.closing ? 'Esperando retirada de pila' : 'Sin demanda de madera'; return; }
    const i = this.yard[sp] - 1;
    const from = pileSlot(sp, Math.min(i, PILE_CAP - 1));
    const deck = { x: ASE.saw.deckX, z: ASE.saw.z };
    g.state = `Llevando tronco de ${SPECIES[sp].name.toLowerCase()} a la sierra`;
    this.yard[sp]--;
    g.reserved = sp;
    g.queue.push(
      { to: { x: from[0], z: from[2], y: park }, dur: travel(g.pos, { x: from[0], z: from[2] }, SP) },
      { to: { y: from[1] + 0.45 }, dur: 2 },
      { to: { claw: 1 }, dur: 0.8, done: () => { g.carrying = sp; g.reserved = null; } },
      { to: { y: park }, dur: 2 },
      { to: { ...deck }, dur: travel({ x: from[0], z: from[2] }, deck, SP) },
      { to: { y: ASE.saw.y + 0.75 }, dur: 2 },
      { to: { claw: 0 }, dur: 0.8, done: () => { this.deck = g.carrying; g.carrying = null; } },
      { to: { y: park }, dur: 1.8 },
      { to: { x: -10, z: 0 }, dur: travel(deck, { x: -10, z: 0 }, SP) },
    );
  }

  // ── Sierra de cinta ──────────────────────────────────────────────────────
  stepSaw(dt) {
    const s = this.saw;
    if (s.state === 'IDLE') {
      s.logX = ASE.saw.deckX;
      if (this.deck && !this.outfeed && this.logGantry.pos.y > 3 && this.staffed('ASE')) { s.state = 'CUT'; s.t = 0; s.species = this.deck; }
      return;
    }
    s.t += dt;
    s.logX = ASE.saw.deckX + (ASE.saw.outX - ASE.saw.deckX) * smooth(clamp(s.t / 16, 0, 1));
    if (s.t >= 16) {
      s.state = 'IDLE'; this.outfeed = this.deck; this.deck = null; this.counters.logs++;
      this.w.countZone('ASE', 1);
    }
  }

  // ── Pórtico apilador ─────────────────────────────────────────────────────
  stepStacker(dt) {
    const g = this.stacker, gp = this.greenPad;
    if (runQueue(g, dt)) return;
    if (!this.outfeed) { g.state = 'Esperando tablas'; return; }
    if (gp.reserved) { g.state = 'Esperando a AGV-A'; return; }
    if (gp.layers >= LAYERS_PER_STACK || (gp.layers > 0 && gp.species !== this.outfeed)) {
      if (gp.layers > 0 && !gp.closing) gp.closing = true;
      g.state = 'Pila llena · esperando AGV-A';
      return;
    }
    g.state = 'Apilando';
    const top = 3.6;
    const pick = { x: ASE.saw.outX, z: ASE.saw.z }, pad = { x: ASE.pad[0], z: ASE.pad[1] };
    const layerY = 0.45 + (gp.layers + 1) * 0.13 + 0.05;
    g.queue.push(
      { to: { ...pick, y: top }, dur: travel(g.pos, pick, 1.8) },
      { to: { y: ASE.saw.y + 0.2 }, dur: 1.4 },
      { to: { vac: 1 }, dur: 0.5, done: () => { g.carrying = this.outfeed; this.outfeed = null; } },
      { to: { y: top }, dur: 1.4 },
      { to: { ...pad }, dur: travel(pick, pad, 1.8) },
      { to: { y: layerY }, dur: 1.6 },
      { to: { vac: 0 }, dur: 0.5, done: () => {
        gp.species = g.carrying; gp.layers++; g.carrying = null;
        if (gp.layers >= LAYERS_PER_STACK) { this.counters.greenStacks++; this.log('info', `Aserradero: pila verde de ${SPECIES[gp.species].name.toLowerCase()} completa · solicitado AGV-A`); }
      } },
      { to: { y: top }, dur: 1.4 },
    );
  }

  // ── Secadero ─────────────────────────────────────────────────────────────
  stepKiln(dt) {
    const k = this.kiln;
    for (const s of k.stacks) if (s.left > 0) {
      s.left -= dt;
      if (s.left <= 0) { this.counters.dryStacks++; this.log('info', `Secadero: pila de ${SPECIES[s.species].name.toLowerCase()} seca (humedad 10 %)`); }
    }
    const near = (port) => this.agvs.some((a) => a.atPort === port && a.state === 'ACTION');
    k.doorIn += ((near('KILN.in') ? 1 : 0) - k.doorIn) * Math.min(1, dt * 2);
    k.doorOut += ((near('KILN.out') ? 1 : 0) - k.doorOut) * Math.min(1, dt * 2);
  }
  kilnCap() { return 12; }

  /** Especie que necesita la cepilladora y si hay que retirar lo que queda en su pila. */
  cepNeed() {
    const pad = this.dryPad;
    const pos = this.w.eco.plan.filter((po) => po.status !== 'CANCELADA' && po.started < po.qty);
    if (!pos.length) return null;
    const usable = pos.find((po) => po.species === pad.species && pad.boards >= PRODUCTS[po.product].boards);
    if (usable && pad.boards >= PRODUCTS[usable.product].boards * 2) return null;     // hay material para un rato
    for (const po of pos) {
      const dry = this.kiln.stacks.find((s) => s.species === po.species && s.left <= 0);
      if (!dry) continue;
      if (pad.boards > 0 && pad.species !== po.species) {
        if (usable) return null;                                    // primero se gasta lo que hay
        return { species: po.species, returnFirst: true };
      }
      return { species: po.species, returnFirst: false };
    }
    return null;
  }

  // ── Paletizador de 4 ejes + enfardadora ──────────────────────────────────
  stepPalletizer(dt) {
    const P = this.pal, w = this.w;
    for (const pl of P.pallets) {
      if (!pl.present) {
        pl.respawn -= dt;
        if (pl.respawn <= 0) Object.assign(pl, newPallet(pl.index));
        continue;
      }
      if (pl.items.length && !pl.ready && (pl.closing || pl.items.length >= PRODUCTS[pl.items[0].product].perPallet) && P.target !== pl.index) {
        pl.wrap = Math.min(1, pl.wrap + dt / 9);
        if (pl.wrap >= 1) {
          pl.ready = true; pl.readyAt = w.t;
          pl.id = `PL-${palletSeq++}`;
          this.counters.pallets++;
          this.log('info', `Paletizado: palé ${pl.id} (${pl.items.length} ${PRODUCTS[pl.items[0].product].unit}) enfardado · solicitado AGV-C`);
        }
      }
    }
    if (P.moves.length) {
      const m = P.moves[0];
      m.t = (m.t || 0) + dt;
      if (!m.from) { m.from = P.q.slice(); m.c0 = P.clamp; }
      const k = smooth(clamp(m.t / m.dur, 0, 1));
      if (m.q) for (let i = 0; i < 6; i++) P.q[i] = m.from[i] + (m.q[i] - m.from[i]) * k;
      if (m.clamp !== undefined) P.clamp = m.c0 + (m.clamp - m.c0) * k;
      if (m.t >= m.dur) { P.moves.shift(); m.done?.(); }
      return;
    }
    P.target = null;
    const tray = w.line.trayAt('PAL');
    const ready = tray && !tray.picked;
    const wrapping = P.pallets.some((p) => p.present && p.items.length && !p.ready && p.wrap > 0);
    if (!ready) { P.state = wrapping ? 'Enfardando' : P.pallets.some((p) => p.ready) ? 'Palé listo · esperando AGV-C' : 'Esperando producto'; return; }
    const key = `${tray.product}|${tray.species}|${tray.tone}|${tray.orderId || ''}`;
    const per = PRODUCTS[tray.product].perPallet;
    const usable = (p) => p.present && !p.ready && p.wrap === 0 && !p.closing;
    let pl = P.pallets.find((p) => usable(p) && p.items.length && p.key === key && p.items.length < per)
      || P.pallets.find((p) => usable(p) && !p.items.length);
    if (!pl) {
      // ningún palé admite esta referencia: se cierra el palé a medias de otra referencia
      const other = P.pallets.find((p) => usable(p) && p.items.length && p.key !== key);
      if (other) other.closing = true;
      P.state = other ? 'Cambio de referencia · cerrando palé' : (wrapping ? 'Enfardando' : 'Esperando palé vacío');
      return;
    }
    P.target = pl.index;
    P.state = `Paletizando en puesto ${pl.index ? 'B' : 'A'}`;
    const [dx, dy, dz] = DIMS[tray.product];
    const slot = PALLET_PATTERN[tray.product][pl.items.length];
    const [px, pz] = PAL.pallets[pl.index];
    const line = ZONES.PAL.line.work;
    const pick = [line[0], PIECE_Y + dy + 0.04, line[1]];
    // el puesto B está girado 90°: el patrón también
    const off = pl.index ? [slot[2], slot[0]] : [slot[0], slot[2]];
    const place = [px + off[0], PALLET_TOP + slot[1] + dy + 0.04, pz + off[1]];
    const ik = (p, up = 0, rot = 0) => { const q = solveWorld(PAL_DEF, { p: [p[0], p[1] + up, p[2]], g: DOWN }); q[5] = rot; return q; };
    const qPick = ik(pick);
    const rotFor = (p) => { const q = ik(p); return q[0] - qPick[0] + (pl.index ? Math.PI / 2 : 0); };
    const rPlace = rotFor(place);
    P.gap = dz / 2 + 0.03;
    const mv = (q, dur, done) => ({ q, dur, done });
    const cl = (v, dur, done) => ({ clamp: v, dur, done });
    P.moves.push(
      mv(ik(pick, 0.5), 1.3), mv(qPick, 0.9),
      cl(1, 0.5, () => {
        tray.picked = true;
        P.carrying = { product: tray.product, species: tray.species, tone: tray.tone, orderId: tray.orderId, poId: tray.poId };
        w.line.unitPicked(tray);
      }),
      mv(ik(pick, 0.6), 0.9), mv(ik(place, 0.6, rPlace), 1.5), mv(ik(place, 0, rPlace), 0.9),
      cl(0, 0.5, () => {
        if (!pl.items.length) { pl.key = key; pl.orderId = tray.orderId || null; }
        pl.items.push(P.carrying); P.carrying = null;
        w.unitPalletized(pl.items[pl.items.length - 1]);
      }),
      mv(ik(place, 0.5, rPlace), 0.7), mv(P.home, 1.2),
    );
  }

  // ── Camión de expedición ─────────────────────────────────────────────────
  shippable() {
    return Object.entries(this.slots).filter(([k, p]) => p && p.orderId && !this.slotRes[k] && this.w.eco.order(p.orderId)?.status !== 'CANCELADO');
  }
  stepTruck(dt) {
    const T = this.truck, w = this.w;
    T.t += dt;
    if (T.state === 'DOCKED') {
      const loading = this.agvs.some((a) => a.mission?.startsWith('Palé → camión') || a.atPort === 'DOCK.load');
      const full = T.pallets.length >= 10;
      const nothingMore = !this.shippable().length && !loading && w.t - T.lastLoad > 600;
      if (T.pallets.length && (full || nothingMore) && !T.taskOpen) {
        T.taskOpen = true;
        w.staff.addTask({ type: 'EXPEDICION', role: 'logistica', zone: 'DOCK', ref: `EXP:${w.t}`, title: `Confirmar salida del camión (${T.pallets.length} palés)`, detail: T.pallets.map((p) => `${p.id} · ${p.units} ${PRODUCTS[p.product].unit} · ${p.orderId}`).join('\n') });
      }
    } else if (T.state === 'LEAVING') {
      T.x = 45 * smooth(clamp(T.t / 12, 0, 1));
      if (T.t >= 12) { T.state = 'AWAY'; T.t = 0; }
    } else if (T.state === 'AWAY' && T.t >= 900) {
      T.state = 'ARRIVING'; T.t = 0; T.pallets = [];
    } else if (T.state === 'ARRIVING') {
      T.x = 45 - 45 * smooth(clamp(T.t / 12, 0, 1));
      if (T.t >= 12) { T.state = 'DOCKED'; T.x = 0; this.log('info', 'Expedición: camión vacío atracado en el muelle'); }
    }
  }
  dispatchTruck(byName) {
    const T = this.truck;
    if (T.state !== 'DOCKED' || !T.pallets.length) return false;
    T.state = 'LEAVING'; T.t = 0; T.taskOpen = false;
    this.counters.trucks++;
    this.w.shipPallets(T.pallets, byName);
    return true;
  }

  // ═══════════════════════════════════════════════════════════════════════
  // AGV
  // ═══════════════════════════════════════════════════════════════════════
  port(key) { return this.w.plant.ports[key]; }

  /** Pasos para ir a un puerto: ruta A* hasta la aproximación, orientarse y entrar recto. */
  toPort(key) {
    const p = this.port(key);
    if (p.approach > 0) return [{ kind: 'goto', x: p.ax, z: p.az }, { kind: 'face', h: p.h }, { kind: 'straight', x: p.x, z: p.z, port: key }];
    return [{ kind: 'goto', x: p.x, z: p.z }, { kind: 'face', h: p.h, port: key }];
  }
  leavePort(key) {
    const p = this.port(key);
    return p.approach > 0 ? [{ kind: 'straight', x: p.ax, z: p.az, reverse: true, leave: true }] : [{ kind: 'call', fn: (a) => { a.atPort = null; } }];
  }
  act(kind, dur, handoff, extra = {}) { return { kind: 'act', act: kind, dur, handoff, ...extra }; }

  dispatch(a) {
    const w = this.w;
    if (a.battery < 22) { a.mission = 'Batería baja · a cargar'; a.steps = [...this.toPort(a.homePort)]; a.charging = true; return; }
    if (a.id === 'AGV-A') {
      const gp = this.greenPad;
      if ((gp.layers >= LAYERS_PER_STACK || (gp.closing && gp.layers > 0)) && !gp.reserved && this.kiln.stacks.filter((s) => s.left > 0).length < this.kilnCap()) {
        gp.reserved = true;
        a.mission = 'Hacia la pila verde';
        a.steps = [
          ...this.toPort('ASE.pad'),
          this.act('lift', 3, () => { a.load = { kind: 'stack', species: gp.species, boards: gp.layers * BOARDS_PER_LOG, dry: false }; gp.layers = 0; gp.closing = false; gp.reserved = false; gp.species = null; }),
          { kind: 'call', fn: () => { a.mission = 'Pila verde → secadero'; } },
          ...this.leavePort('ASE.pad'),
          ...this.toPort('KILN.in'),
          this.act('drop', 4, () => { this.kiln.stacks.push({ species: a.load.species, boards: a.load.boards, left: w.settings.kilnTime }); a.load = null; this.log('info', `AGV-A: pila verde entregada al secadero`); }),
          ...this.leavePort('KILN.in'),
        ];
      }
    } else if (a.id === 'AGV-B') {
      const need = this.cepNeed();
      if (need) {
        const steps = [];
        if (need.returnFirst) {
          a.mission = 'Retirando pila de otra especie';
          steps.push(
            ...this.toPort('CEP.pad'),
            this.act('lift', 3, () => { a.load = { kind: 'stack', species: this.dryPad.species, boards: this.dryPad.boards, dry: true }; this.dryPad.boards = 0; }),
            ...this.leavePort('CEP.pad'),
            ...this.toPort('KILN.out'),
            this.act('drop', 3, () => { this.kiln.stacks.push({ species: a.load.species, boards: a.load.boards, left: 0 }); a.load = null; }),
          );
        } else {
          a.mission = `Hacia el secadero (${SPECIES[need.species].name.toLowerCase()})`;
          steps.push(...this.toPort('KILN.out'));
        }
        steps.push(
          this.act('lift', 4, () => {
            const i = this.kiln.stacks.findIndex((s) => s.species === need.species && s.left <= 0);
            if (i < 0) { a.load = null; return; }
            const s = this.kiln.stacks.splice(i, 1)[0];
            a.load = { kind: 'stack', species: s.species, boards: s.boards, dry: true };
            a.mission = 'Pila seca → cepilladora';
          }),
          ...this.leavePort('KILN.out'),
          { kind: 'call', fn: (ag) => { if (!ag.load) { ag.steps = []; ag.mission = 'Sin pila seca'; } } },
          ...this.toPort('CEP.pad'),
          this.act('drop', 3, () => {
            const pad = this.dryPad;
            if (pad.boards > 0 && pad.species !== a.load.species) { this.kiln.stacks.push({ species: pad.species, boards: pad.boards, left: 0 }); pad.boards = 0; }
            pad.species = a.load.species; pad.boards += a.load.boards; a.load = null;
            this.log('info', `AGV-B: pila seca de ${SPECIES[pad.species].name.toLowerCase()} en la cepilladora`);
          }),
          ...this.leavePort('CEP.pad'),
        );
        a.steps = steps;
        a.needSpecies = need.species;
      }
    } else if (a.id === 'AGV-C') {
      const pl = this.pal.pallets.filter((p) => p.ready && p.present && !p.reserved).sort((p, q) => p.readyAt - q.readyAt)[0];
      if (pl) {
        const free = Object.keys(this.slots).filter((k) => !this.slots[k] && !this.slotRes[k]).sort((p, q) => slotOrder(p) - slotOrder(q))[0];
        if (!free) { a.mission = 'Almacén lleno'; return; }
        pl.reserved = a.id;
        this.slotRes[free] = a.id;
        const [row, bay, lvl] = free.split('_').map(Number);
        const portKey = `ALM.rack_${row}_${bay}`;
        const palPort = pl.index ? 'PAL.palletB' : 'PAL.pallet';
        a.mission = `Hacia el palé enfardado (puesto ${pl.index ? 'B' : 'A'})`;
        a.steps = [
          ...this.toPort(palPort),
          this.act('forkPick', 5, () => {
            a.load = { kind: 'pallet', pallet: { id: pl.id, product: pl.items[0].product, species: pl.items[0].species, tone: pl.items[0].tone, orderId: pl.orderId, units: pl.items.length, items: pl.items.slice() } };
            Object.assign(pl, newPallet(pl.index), { present: false, respawn: 6 });
            a.mission = `Palé → hueco ${slotName(free)}`;
          }, { level: 0.14 }),
          ...this.leavePort(palPort),
          ...this.toPort(portKey),
          this.act('forkPlace', 6, () => { this.slots[free] = a.load.pallet; a.load = null; delete this.slotRes[free]; this.w.palletStored(this.slots[free]); }, { level: ZONES.ALM.geo.levels[lvl] }),
          ...this.leavePort(portKey),
        ];
      }
    } else if (a.id === 'AGV-D') {
      const T = this.truck;
      if (T.state === 'DOCKED' && T.pallets.length < 10 && !T.taskOpen) {
        const cand = this.shippable().sort(([, p], [, q]) => (w.eco.order(p.orderId)?.due ?? 0) - (w.eco.order(q.orderId)?.due ?? 0))[0];
        if (!cand) return;
        const [key] = cand;
        const [row, bay, lvl] = key.split('_').map(Number);
        this.slotRes[key] = a.id;
        const portKey = `ALM.rack_${row}_${bay}`;
        a.mission = `Hacia hueco ${slotName(key)}`;
        a.steps = [
          ...this.toPort(portKey),
          this.act('forkPick', 6, () => { a.load = { kind: 'pallet', pallet: this.slots[key] }; this.slots[key] = null; delete this.slotRes[key]; a.mission = 'Palé → camión'; }, { level: ZONES.ALM.geo.levels[lvl] }),
          ...this.leavePort(portKey),
          ...this.toPort('DOCK.load'),
          this.act('forkPlace', 5, () => { T.pallets.push(a.load.pallet); T.lastLoad = w.t; a.load = null; }, { level: 1.0 }),
          ...this.leavePort('DOCK.load'),
        ];
      }
    }
    if (!a.steps.length) {
      const hp = this.port(a.homePort);
      if (Math.hypot(a.x - hp.x, a.z - hp.z) > 0.9) { a.mission = "Volviendo a base"; a.steps = this.toPort(a.homePort); }
    }
  }

  stepAgv(a, dt) {
    const w = this.w;
    if (a.ghost > 0) a.ghost -= dt;
    const hp = this.port(a.homePort);
    const atHome = Math.hypot(a.x - hp.x, a.z - hp.z) < 0.9;
    if (a.state === 'MOVING') a.battery = Math.max(0, a.battery - dt * (a.load ? 0.05 : 0.035));
    else if (atHome && !a.steps.length) a.battery = Math.min(100, a.battery + dt * 0.25);
    if (a.charging && a.battery > 90) a.charging = false;

    if (!a.steps.length) {
      a.state = 'IDLE'; a.wait = null; a.atPort = atHome ? a.homePort : null;
      if (!a.charging) this.dispatch(a);
      if (!a.steps.length) { a.mission = atHome ? (a.battery < 99 ? 'En base · cargando' : 'En base') : a.mission; return; }
    }
    const s = a.steps[0];
    const cfg = AGV_CFG[a.type];
    const speed = a.load ? cfg.loaded : cfg.speed;

    if (s.kind === 'call') { a.steps.shift(); s.fn(a); return; }

    if (s.kind === 'face') {
      a.state = 'MOVING';
      const e = angDiff(s.h, a.h);
      if (Math.abs(e) > 0.02) { a.h += Math.sign(e) * Math.min(Math.abs(e), dt * 1.6); return; }
      a.h = s.h; a.steps.shift();
      if (s.port) a.atPort = s.port;
      return;
    }

    if (s.kind === 'act') {
      a.state = 'ACTION';
      s.t = (s.t || 0) + dt;
      const k = clamp(s.t / s.dur, 0, 1);
      if (a.type === 'lift') a.lift = s.act === 'lift' ? smooth(k) : 1 - smooth(k);
      else {
        const port = this.port(a.atPort) || {};
        const L = s.level ?? 0.14;
        a.reachTo = Math.max(0.3, (port.reachTo || 1.2) - 0.95);
        const pick = s.act === 'forkPick';
        const base = L + (pick ? -0.06 : 0.1);
        if (k < 0.2) a.liftH = 0.15 + (base - 0.15) * smooth(k / 0.2);
        else if (k < 0.45) { a.liftH = base; a.reach = smooth((k - 0.2) / 0.25); }
        else if (k < 0.55) { a.reach = 1; a.liftH = base + (pick ? 0.14 : -0.14) * smooth((k - 0.45) / 0.1); }
        else if (k < 0.8) { a.reach = 1 - smooth((k - 0.55) / 0.25); }
        else { a.reach = 0; a.liftH = (base + (pick ? 0.14 : -0.14)) + (0.15 - (base + (pick ? 0.14 : -0.14))) * smooth((k - 0.8) / 0.2); }
      }
      if (!s.handed && k >= 0.5) { s.handed = true; s.handoff?.(); }
      if (s.t >= s.dur) { a.steps.shift(); a.reach = 0; a.liftH = 0.15; if (a.type === 'lift') a.lift = a.load ? 1 : 0; }
      return;
    }

    if (s.kind === 'straight') {
      a.state = 'MOVING';
      const dx = s.x - a.x, dz = s.z - a.z, d = Math.hypot(dx, dz);
      if (!s.reverse && !a.ghost) {
        const b = this.blocker(a, dx / (d || 1), dz / (d || 1));
        if (b) return this.waitFor(a, b, dt, s);
      }
      a.waitT = 0; a.wait = null;
      const step = Math.min(d, dt * speed * 0.6);
      if (d > 1e-4) { a.x += (dx / d) * step; a.z += (dz / d) * step; }
      if (d - step < 0.01) { a.x = s.x; a.z = s.z; a.steps.shift(); if (s.port) a.atPort = s.port; if (s.leave) a.atPort = null; }
      return;
    }

    if (s.kind === 'goto') {
      if (!s.path || s.replan) {
        const extra = s.replan ? this.othersDiscs(a) : null;
        let path = w.plant.nav.findPath(a.x, a.z, s.x, s.z, extra);
        if (!path && extra) path = w.plant.nav.findPath(a.x, a.z, s.x, s.z);
        s.replan = false;
        if (!path) { a.state = 'WAIT'; a.wait = 'Sin ruta disponible'; a.waitT += dt; if (a.waitT > 20) { a.steps = []; a.waitT = 0; } return; }
        s.path = path; s.i = 1;
        a.path = path;
      }
      a.state = 'MOVING';
      if (s.i >= s.path.length) { a.steps.shift(); a.path = null; return; }
      const [tx, tz] = s.path[s.i];
      const dx = tx - a.x, dz = tz - a.z, d = Math.hypot(dx, dz);
      if (d < 0.02) { s.i++; return; }
      const hd = Math.atan2(-dz, dx);
      const e = angDiff(hd, a.h);
      if (Math.abs(e) > 0.06) { a.h += Math.sign(e) * Math.min(Math.abs(e), dt * 1.8); return; }
      a.h = hd;
      // área exclusiva (pasillo del almacén)
      const look = Math.min(2.5, d);
      for (const ex of w.plant.exclusive) {
        const [x0, z0, x1, z1] = ex.rect;
        const inside = (x, z) => x > x0 && x < x1 && z > z0 && z < z1;
        const k = ex.zone;
        if (inside(a.x + (dx / d) * look, a.z + (dz / d) * look) || inside(a.x, a.z)) {
          if (this.locks[k] && this.locks[k] !== a.id) { a.state = 'WAIT'; a.wait = `Esperando pasillo (${this.locks[k]})`; return; }
          this.locks[k] = a.id;
        } else if (this.locks[k] === a.id && !inside(a.x, a.z)) delete this.locks[k];
      }
      if (!a.ghost) {
        const b = this.blocker(a, dx / d, dz / d);
        if (b) return this.waitFor(a, b, dt, s);
      }
      if (a.waitT > 4) this.log('info', `Tráfico: ${a.id} cedió el paso a ${a.waitFor}`);
      a.waitT = 0; a.wait = null; a.waitFor = null;
      const step = Math.min(d, dt * speed);
      a.x += (dx / d) * step; a.z += (dz / d) * step;
      a.travel += step;
      if (d - step < 0.01) s.i++;
      // libera bloqueos de áreas al salir
      for (const ex of w.plant.exclusive) {
        const [x0, z0, x1, z1] = ex.rect;
        if (this.locks[ex.zone] === a.id && !(a.x > x0 - 0.5 && a.x < x1 + 0.5 && a.z > z0 - 0.5 && a.z < z1 + 0.5)) delete this.locks[ex.zone];
      }
    }
  }

  /** Otro AGV delante en la dirección de avance (dx, dz). */
  blocker(a, dx, dz) {
    for (const o of this.agvs) {
      if (o === a) continue;
      const vx = o.x - a.x, vz = o.z - a.z;
      const dist = Math.hypot(vx, vz);
      // un AGV aparcado en su cargador solo estorba si está justo delante
      const parked = o.state === 'IDLE' && !o.steps.length;
      if (dist > (parked ? 2.3 : 3.4)) continue;
      const ahead = vx * dx + vz * dz;
      const lat = Math.abs(vx * dz - vz * dx);
      if (ahead > 0.3 && lat < (parked ? 1.2 : 1.75)) return o;
    }
    return null;
  }

  othersDiscs(a) {
    const set = new Set();
    for (const o of this.agvs) if (o !== a) for (const c of this.w.plant.nav.disc(o.x, o.z, 2.3)) set.add(c);
    return set;
  }

  waitFor(a, b, dt, step) {
    a.state = 'WAIT'; a.waitFor = b.id; a.wait = `Cede el paso a ${b.id}`;
    a.waitT += dt;
    const mutual = b.waitFor === a.id;
    const bStill = b.state !== 'MOVING' || (b.state === 'WAIT' && b.waitFor !== a.id);
    const lower = (a.load ? 1 : 0) * 10 + a.prio < (b.load ? 1 : 0) * 10 + b.prio;
    if (step.kind === 'goto' && a.waitT > 1.5 && (bStill || (mutual && lower) || a.waitT > 10) && !(step.lastReplan > a.waitT - 3 && step.lastReplan <= a.waitT)) {
      step.replan = true; step.lastReplan = a.waitT;
    }
    if (a.waitT > 45) {
      a.ghost = 6; a.waitT = 0;
      this.log('warn', `Supervisión de tráfico: paso forzado de ${a.id} junto a ${b.id}`);
    }
  }

  /**
   * Tras mover zonas en el modo edición: los AGV se recolocan en una celda libre, se
   * olvidan las rutas antiguas y, si llevaban carga, la entregan en el nuevo destino.
   */
  relayout() {
    const nav = this.w.plant.nav;
    this.locks = {};
    for (const a of this.agvs) {
      if (!nav.isFree(a.x, a.z)) { const f = nav.nearestFree(a.x, a.z); if (f) [a.x, a.z] = nav.center(f[0], f[1]); }
      a.steps = []; a.path = null; a.atPort = null; a.wait = null; a.waitT = 0; a.reach = 0; a.liftH = 0.15;
      if (a.type === 'lift') a.lift = a.load ? 1 : 0;
      if (!a.load) {
        if (a.id === 'AGV-A') this.greenPad.reserved = false;
        if (a.id === 'AGV-C') for (const p of this.pal.pallets) if (p.reserved === a.id) p.reserved = false;
        for (const k of Object.keys(this.slotRes)) if (this.slotRes[k] === a.id) delete this.slotRes[k];
        continue;
      }
      const L = a.load;
      if (a.id === 'AGV-A') {
        a.mission = 'Pila verde → secadero';
        a.steps = [...this.toPort('KILN.in'), this.act('drop', 4, () => { this.kiln.stacks.push({ species: L.species, boards: L.boards, left: this.w.settings.kilnTime }); a.load = null; }), ...this.leavePort('KILN.in')];
      } else if (a.id === 'AGV-B') {
        a.mission = 'Pila seca → cepilladora';
        a.steps = [...this.toPort('CEP.pad'), this.act('drop', 3, () => {
          const pad = this.dryPad;
          if (pad.boards > 0 && pad.species !== L.species) { this.kiln.stacks.push({ species: pad.species, boards: pad.boards, left: 0 }); pad.boards = 0; }
          pad.species = L.species; pad.boards += L.boards; a.load = null;
        }), ...this.leavePort('CEP.pad')];
      } else if (a.id === 'AGV-C') {
        let free = Object.keys(this.slotRes).find((k) => this.slotRes[k] === a.id);
        if (!free) { free = Object.keys(this.slots).find((k) => !this.slots[k] && !this.slotRes[k]); if (free) this.slotRes[free] = a.id; }
        if (!free) continue;
        const [row, bay, lvl] = free.split('_').map(Number);
        const pk = `ALM.rack_${row}_${bay}`;
        a.mission = `Palé → hueco ${slotName(free)}`;
        a.steps = [...this.toPort(pk), this.act('forkPlace', 6, () => { this.slots[free] = L.pallet; a.load = null; delete this.slotRes[free]; this.w.palletStored(L.pallet); }, { level: ZONES.ALM.geo.levels[lvl] }), ...this.leavePort(pk)];
      } else if (a.id === 'AGV-D') {
        a.mission = 'Palé → camión';
        a.steps = [...this.toPort('DOCK.load'), this.act('forkPlace', 5, () => { this.truck.pallets.push(L.pallet); this.truck.lastLoad = this.w.t; a.load = null; }, { level: 1.0 }), ...this.leavePort('DOCK.load')];
      }
    }
  }

  // ── Instantánea para el visor ─────────────────────────────────────────────
  snapshot() {
    const P = this.pal;
    return {
      yard: this.yard,
      logTruck: { state: this.logTruck.state, x: +this.logTruck.x.toFixed(2), logs: this.logTruck.logs },
      logGantry: { ...rnd(this.logGantry.pos), carrying: this.logGantry.carrying, state: this.logGantry.state },
      deck: this.deck, saw: { state: this.saw.state, logX: +this.saw.logX.toFixed(2), species: this.saw.species }, outfeed: this.outfeed,
      stacker: { ...rnd(this.stacker.pos), carrying: this.stacker.carrying, state: this.stacker.state },
      greenPad: { species: this.greenPad.species, layers: this.greenPad.layers, closing: this.greenPad.closing },
      kiln: { stacks: this.kiln.stacks.map((s) => ({ species: s.species, boards: s.boards, left: Math.max(0, Math.round(s.left)) })), doorIn: +this.kiln.doorIn.toFixed(2), doorOut: +this.kiln.doorOut.toFixed(2) },
      dryPad: this.dryPad,
      pal: { q: P.q.map((v) => +v.toFixed(4)), clamp: +P.clamp.toFixed(3), gap: P.gap, carrying: P.carrying, state: P.state,
        target: P.target, pallets: P.pallets.map((p) => ({ index: p.index, present: p.present, items: p.items, wrap: +p.wrap.toFixed(3), ready: p.ready, closing: p.closing })) },
      truck: { state: this.truck.state, x: +this.truck.x.toFixed(2), pallets: this.truck.pallets.map(miniPallet) },
      agvs: this.agvs.map((a) => ({
        id: a.id, type: a.type, label: a.label, x: +a.x.toFixed(3), z: +a.z.toFixed(3), h: +a.h.toFixed(4), state: a.state, mission: a.mission,
        wait: a.wait, battery: +a.battery.toFixed(1), lift: +a.lift.toFixed(3), liftH: +a.liftH.toFixed(3), reach: +a.reach.toFixed(3), reachTo: a.reachTo,
        load: a.load ? (a.load.kind === 'stack' ? { kind: 'stack', species: a.load.species, boards: a.load.boards, dry: a.load.dry } : { kind: 'pallet', pallet: miniPallet(a.load.pallet) }) : null,
        path: a.state !== 'IDLE' && a.steps[0]?.kind === 'goto' && a.steps[0].path ? [[+a.x.toFixed(2), +a.z.toFixed(2)], ...a.steps[0].path.slice(a.steps[0].i)] : null,
        travel: Math.round(a.travel),
      })),
      counters: this.counters,
    };
  }
}

export const miniPallet = (p) => (p ? { id: p.id, product: p.product, species: p.species, tone: p.tone, units: p.units, orderId: p.orderId } : null);
const rnd = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, typeof v === 'number' ? +v.toFixed(3) : v]));
const slotOrder = (k) => { const [row, bay, lvl] = k.split('_').map(Number); return bay * 10 + lvl * 2 + row; };
export const slotName = (k) => { const [row, bay, lvl] = k.split('_').map(Number); return `${row ? 'B' : 'A'}${bay + 1}-${lvl + 1}`; };

/** Cola de movimientos lineales suavizados (pórticos). */
function runQueue(obj, dt) {
  const q = obj.queue;
  if (!q.length) return false;
  const st = q[0];
  if (!st.from) st.from = { ...obj.pos };
  st.t = (st.t || 0) + dt;
  const k = smooth(clamp(st.t / st.dur, 0, 1));
  for (const key of Object.keys(st.to)) obj.pos[key] = st.from[key] + (st.to[key] - st.from[key]) * k;
  if (st.t >= st.dur) { q.shift(); st.done?.(); }
  return true;
}
const travel = (from, to, speed) => Math.max(0.6, Math.hypot((to.x ?? from.x) - from.x, (to.z ?? from.z) - from.z) / speed);

export { headingDir, BOARDS_PER_STACK };
