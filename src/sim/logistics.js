// ─────────────────────────────────────────────────────────────────────────────
// Logística coordinada de la planta (reloj visual)
//
//   Pórtico de troncos → sierra de cinta → pórtico apilador → pila verde
//   AGV-A (elevación) lleva la pila verde al secadero
//   AGV-B (elevación) lleva la pila seca a la cepilladora (alimenta la línea)
//   Final de línea → paletizador de 4 ejes → enfardadora
//   AGV-C (carretilla) lleva el palé al almacén
//   AGV-D (carretilla) lleva palés del almacén al camión del muelle
//
// Coordinación:
//   · Cada máquina solo arranca cuando su entrada tiene material y su salida está libre.
//   · Los AGVs reciben misiones por eventos (pila lista, palé enfardado, hueco libre…).
//   · Gestor de tráfico: los carriles son de sentido único y cada nodo (cruce, parada)
//     se concede a un solo AGV; además no se concede un nodo a menos de 2,2 m de un
//     nodo ocupado por otro AGV. Un AGV que no obtiene su siguiente nodo espera.
// ─────────────────────────────────────────────────────────────────────────────
import {
  NODES, ROUTES, RACK, PALLETIZER, OUT_X, LINE_Z, PIECE_Y, CABINET, LOG_YARD, SAW, SAW_PAD, DOCK,
} from './layout.js';
import { solveWorld } from './ik.js';

const smooth = (t) => t * t * (3 - 2 * t);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const SAFE_R = 2.2;
const DRY_TIME = 90;          // s visuales por pila en el secadero
const KILN_CAP = 4;
const TRUCK_CAP = 10;
export const STACK_LAYERS = 6;
export const PALLET_SLOTS = [[-0.33, -0.27], [0.33, -0.27], [-0.33, 0.27], [0.33, 0.27]];
const PAL_DEF = { id: 'PAL', model: 'palletizer', pos: PALLETIZER.pos, yaw: PALLETIZER.yaw, inverted: false };
const DOWN = -Math.PI / 2;

// Posiciones de los troncos en el patio (pirámides 3-2-1 por fila)
export const LOG_SLOTS = LOG_YARD.rows.flatMap((z) => [
  [z - 0.62, 0.3], [z, 0.3], [z + 0.62, 0.3], [z - 0.31, 0.83], [z + 0.31, 0.83], [z, 1.36],
]);

/** Cola de movimientos lineales suavizados para los pórticos. */
function runQueue(obj, dt) {
  const q = obj.queue;
  if (!q.length) return false;
  const step = q[0];
  if (!step.from) step.from = { ...obj.pos };
  step.t = (step.t || 0) + dt;
  const k = smooth(clamp(step.t / step.dur, 0, 1));
  for (const key of Object.keys(step.to)) obj.pos[key] = step.from[key] + (step.to[key] - step.from[key]) * k;
  if (step.t >= step.dur) { q.shift(); step.done?.(); }
  return true;
}
const travel = (from, to, speed) => Math.max(0.6, Math.hypot((to.x ?? from.x) - from.x, (to.z ?? from.z) - from.z) / speed);

class Logistics {
  constructor() { this.onLog = () => {}; this.reset(); }

  reset() {
    this.counters = { logs: 0, greenStacks: 0, dryStacks: 0, pallets: 0, shipped: 0, trucks: 0 };
    // Patio y pórtico de troncos
    this.yardLogs = 20;
    this.logGantry = { pos: { x: -50, z: 20, y: 6, claw: 0 }, queue: [], carrying: false, state: 'Parado' };
    this.deckLog = false;
    this.saw = { state: 'IDLE', t: 0, logX: SAW.deckX };
    this.outfeed = 0;
    // Pórtico apilador y pila verde
    this.stacker = { pos: { x: -23, z: 18, y: 3.6, vac: 0 }, queue: [], carrying: false, state: 'Parado' };
    this.sawPad = { layers: 4, reserved: false };
    // Secadero
    this.kiln = { loads: [35, 70], out: 1, doorIn: 0, doorOut: 0 };
    // Pila seca junto a la cepilladora
    this.planerPad = { layers: 5 };
    // Final de línea y paletizado
    this.outQueue = [];
    this.pal = { q: solveWorld(PAL_DEF, { p: [40.4, 2.2, LINE_Z + 1.3], g: DOWN }), moves: [], clamp: 0, carrying: null,
      pallet: { present: true, items: [], wrap: 0, ready: false }, state: 'Esperando', respawn: 0 };
    this.pal.home = this.pal.q.slice();
    // Arranque en régimen: palé a medias y un módulo esperando en el fin de línea
    this.pal.pallet.items = [{ color: '#8a5430' }, { color: '#b07a45' }];
    this.outQueue = [{ color: '#7b3f25' }];
    this.deckLog = true;
    // Almacén y camión
    this.rack = {};
    RACK.rowZ.forEach((_, row) => RACK.xs.forEach((x) => RACK.levels.forEach((_, lvl) => {
      this.rack[`${row}_${x}_${lvl}`] = { row, x, lvl, filled: false, t: 0, res: false };
    })));
    ['0_26_0', '0_30_0', '1_26_0', '1_30_1', '0_34_1', '1_38_0', '0_42_0', '1_46_0', '0_46_1', '1_34_0'].forEach((k, i) => {
      Object.assign(this.rack[k], { filled: true, t: -100 + i });
    });
    this.truck = { state: 'DOCKED', load: 2, t: 0, x: DOCK.truckX };
    // AGVs
    const agv = (id, type, home, label) => ({
      id, type, label, home, node: home, pos: [...NODES[home]], heading: Math.PI, path: [], idx: 0, seg: null,
      state: 'IDLE', action: null, battery: 70 + (id.charCodeAt(4) % 4) * 7, load: null, lift: 0, reach: 0, liftH: 0,
      mission: 'En base', wait: null, waitT: 0, slot: null, face: null,
    });
    this.agvs = [
      agv('AGV-A', 'lift', 'A_home', 'Elevación · pila verde'),
      agv('AGV-B', 'lift', 'B_home', 'Elevación · pila seca'),
      agv('AGV-C', 'fork', 'C_home', 'Carretilla · palés a almacén'),
      agv('AGV-D', 'fork', 'D_home', 'Carretilla · expedición'),
    ];
    this.res = {};
    for (const a of this.agvs) { this.res[a.node] = a.id; a.heading = a.type === 'fork' ? Math.PI / 2 : -Math.PI / 2; }
  }

  log(level, msg) { this.onLog(level, msg); }

  // ═════════════════════════════════════════════════════════════════════════
  step(dt) {
    if (dt <= 0) return;
    this.stepLogGantry(dt);
    this.stepSaw(dt);
    this.stepStacker(dt);
    this.stepKiln(dt);
    this.stepPalletizer(dt);
    this.stepTruck(dt);
    for (const a of this.agvs) this.stepAgv(a, dt);
  }

  // ── Pórtico de troncos ────────────────────────────────────────────────────
  stepLogGantry(dt) {
    const g = this.logGantry;
    if (runQueue(g, dt)) return;
    if (this.deckLog || this.yardLogs <= 0) {
      g.state = this.deckLog ? 'Esperando sierra' : 'Sin troncos';
      if (this.yardLogs <= 0) { this.yardLogs = 20; this.log('info', 'Recepción: camión de troncos descargado en el patio (20 troncos)'); }
      return;
    }
    const [lz, ly] = LOG_SLOTS[this.yardLogs - 1];
    const SP = 2.2, park = 6;
    const P = g.pos;
    const over = { x: LOG_YARD.pileX, z: lz };
    const deck = { x: SAW.deckX, z: SAW.z };
    g.state = 'Cogiendo tronco';
    g.queue.push(
      { to: { ...over, y: park }, dur: travel(P, over, SP) },
      { to: { y: ly + 0.45 }, dur: 2.2 },
      { to: { claw: 1 }, dur: 0.9, done: () => { g.carrying = true; this.yardLogs--; } },
      { to: { y: park }, dur: 2.2 },
      { to: { ...deck }, dur: travel(over, deck, SP), done: () => { g.state = 'Alimentando sierra'; } },
      { to: { y: SAW.y + 0.75 }, dur: 2.2 },
      { to: { claw: 0 }, dur: 0.9, done: () => { g.carrying = false; this.deckLog = true; } },
      { to: { y: park }, dur: 2.0 },
      { to: { x: -50, z: 20 }, dur: travel(deck, { x: -50, z: 20 }, SP) },
    );
  }

  // ── Sierra de cinta ───────────────────────────────────────────────────────
  stepSaw(dt) {
    const s = this.saw;
    if (s.state === 'IDLE') {
      s.logX = SAW.deckX;
      if (this.deckLog && this.outfeed === 0 && this.logGantry.pos.y > 3) { s.state = 'CUT'; s.t = 0; }
      return;
    }
    s.t += dt;
    s.logX = SAW.deckX + (SAW.outX - SAW.deckX) * smooth(clamp(s.t / 14, 0, 1));
    if (s.t >= 14) {
      s.state = 'IDLE'; this.deckLog = false; this.outfeed = 1; this.counters.logs++;
    }
  }

  // ── Pórtico apilador ──────────────────────────────────────────────────────
  stepStacker(dt) {
    const g = this.stacker;
    if (runQueue(g, dt)) return;
    if (this.outfeed !== 1) { g.state = 'Esperando tablas'; return; }
    if (this.sawPad.layers >= STACK_LAYERS || this.sawPad.reserved) { g.state = 'Pila llena · esperando AGV'; return; }
    g.state = 'Apilando';
    const SP = 1.8, top = 3.6;
    const pick = { x: SAW.outX, z: SAW.z }, pad = { x: SAW_PAD[0], z: SAW_PAD[1] };
    const layerY = 0.42 + (this.sawPad.layers + 1) * 0.13 + 0.05;
    g.queue.push(
      { to: { ...pick, y: top }, dur: travel(g.pos, pick, SP) },
      { to: { y: SAW.y + 0.2 }, dur: 1.4 },
      { to: { vac: 1 }, dur: 0.5, done: () => { g.carrying = true; this.outfeed = 0; } },
      { to: { y: top }, dur: 1.4 },
      { to: { ...pad }, dur: travel(pick, pad, SP) },
      { to: { y: layerY }, dur: 1.6 },
      { to: { vac: 0 }, dur: 0.5, done: () => {
        g.carrying = false; this.sawPad.layers++;
        if (this.sawPad.layers >= STACK_LAYERS) { this.counters.greenStacks++; this.log('info', 'Aserradero: pila verde completa · solicitado AGV-A'); }
      } },
      { to: { y: top }, dur: 1.4 },
    );
  }

  // ── Secadero ──────────────────────────────────────────────────────────────
  stepKiln(dt) {
    const k = this.kiln;
    for (let i = k.loads.length - 1; i >= 0; i--) {
      k.loads[i] -= dt;
      if (k.loads[i] <= 0 && k.out < 3) {
        k.loads.splice(i, 1); k.out++; this.counters.dryStacks++;
        this.log('info', 'Secadero: pila seca (humedad 10 %) lista en la salida');
      }
    }
    const a = this.agvs[0], b = this.agvs[1];
    const near = (agv, node) => agv.node === node && agv.state === 'ACTION';
    k.doorIn += ((near(a, 'kilnIn') ? 1 : 0) - k.doorIn) * Math.min(1, dt * 2);
    k.doorOut += ((near(b, 'kilnOut') ? 1 : 0) - k.doorOut) * Math.min(1, dt * 2);
  }

  /** La línea toma una capa de tablas de la pila seca al cargar un tablero nuevo. */
  consumeLayer() {
    if (this.planerPad.layers > 0) this.planerPad.layers--;
    if (this.planerPad.layers === 1) this.log('info', 'Cepilladora: pila seca casi agotada · solicitado AGV-B');
  }

  /** Un módulo barnizado llega al final de la línea. */
  lineOutput(piece) { this.outQueue.push({ color: piece.color, uid: piece.uid }); }

  // ── Paletizador de 4 ejes + enfardadora ───────────────────────────────────
  stepPalletizer(dt) {
    const P = this.pal, pl = P.pallet;
    if (!pl.present) {
      P.respawn -= dt;
      if (P.respawn <= 0) { Object.assign(pl, { present: true, items: [], wrap: 0, ready: false }); }
    }
    if (pl.items.length === PALLET_SLOTS.length && !pl.ready && pl.present) {
      pl.wrap = Math.min(1, pl.wrap + dt / 8);
      P.state = 'Enfardando';
      if (pl.wrap >= 1) { pl.ready = true; this.counters.pallets++; this.log('info', 'Paletizado: palé enfardado · solicitada carretilla AGV-C'); }
    }
    if (P.moves.length) {
      const m = P.moves[0];
      m.t = (m.t || 0) + dt;
      if (!m.from) m.from = P.q.slice();
      const k = smooth(clamp(m.t / m.dur, 0, 1));
      if (m.q) for (let i = 0; i < 6; i++) P.q[i] = m.from[i] + (m.q[i] - m.from[i]) * k;
      if (m.clamp !== undefined) P.clamp = m.clampFrom + (m.clamp - m.clampFrom) * k;
      if (m.t >= m.dur) { P.moves.shift(); m.done?.(); if (P.moves[0]?.clamp !== undefined) P.moves[0].clampFrom = P.clamp; }
      return;
    }
    if (!this.outQueue.length) { if (pl.wrap === 0 || pl.ready) P.state = pl.ready ? 'Palé listo · esperando AGV-C' : 'Esperando producto'; return; }
    if (!pl.present || pl.items.length >= PALLET_SLOTS.length) { P.state = pl.present ? P.state : 'Esperando palé vacío'; return; }
    // Ciclo de paletizado con IK sobre los puntos de recogida y de depósito
    P.state = 'Paletizando';
    const slot = PALLET_SLOTS[pl.items.length];
    const hTop = PIECE_Y + CABINET.ly + 0.04;
    const pick = [OUT_X, hTop, LINE_Z];
    const place = [PALLETIZER.pallet[0] + slot[0], 0.15 + CABINET.ly + 0.04, PALLETIZER.pallet[1] + slot[1]];
    const ik = (p, up = 0) => solveWorld(PAL_DEF, { p: [p[0], p[1] + up, p[2]], g: DOWN });
    const mv = (q, dur, done) => ({ q, dur, done });
    const cl = (v, dur, done) => ({ clamp: v, clampFrom: P.clamp, dur, done });
    P.moves.push(
      mv(ik(pick, 0.45), 1.2), mv(ik(pick), 0.8),
      cl(1, 0.5, () => { P.carrying = this.outQueue.shift(); }),
      mv(ik(pick, 0.55), 0.8), mv(ik(place, 0.55), 1.4), mv(ik(place), 0.8),
      cl(0, 0.5, () => { pl.items.push(P.carrying); P.carrying = null; }),
      mv(ik(place, 0.5), 0.7), mv(P.home, 1.1),
    );
  }

  // ── Camión del muelle ─────────────────────────────────────────────────────
  stepTruck(dt) {
    const T = this.truck;
    T.t += dt;
    if (T.state === 'DOCKED' && T.load >= TRUCK_CAP && !this.agvs.some((a) => a.node === 'dock')) {
      T.state = 'LEAVING'; T.t = 0; this.counters.trucks++;
      this.log('ok', `Expedición: camión completo (${TRUCK_CAP} palés) sale del muelle`);
    } else if (T.state === 'LEAVING') {
      T.x = DOCK.truckX + smooth(clamp(T.t / 10, 0, 1)) * 45;
      if (T.t >= 10) { T.state = 'AWAY'; T.t = 0; }
    } else if (T.state === 'AWAY' && T.t >= 20) {
      T.state = 'ARRIVING'; T.t = 0; T.load = 0;
    } else if (T.state === 'ARRIVING') {
      T.x = DOCK.truckX + 45 - smooth(clamp(T.t / 10, 0, 1)) * 45;
      if (T.t >= 10) { T.state = 'DOCKED'; T.x = DOCK.truckX; this.log('info', 'Expedición: camión vacío atracado en el muelle'); }
    }
  }

  // ═════════════════════════════════════════════════════════════════════════
  // AGVs
  // ═════════════════════════════════════════════════════════════════════════
  canTake(agv, node) {
    const [x, z] = NODES[node];
    for (const [n, holder] of Object.entries(this.res)) {
      if (holder === agv.id) continue;
      const [nx, nz] = NODES[n];
      if (Math.hypot(nx - x, nz - z) < SAFE_R) return holder;
    }
    return null;
  }

  go(agv, route, mission) {
    agv.path = route; agv.idx = 0; agv.state = 'MOVING'; agv.mission = mission;
  }
  /** Acción en una parada; `handoff` se ejecuta a mitad de la maniobra (traspaso de la carga). */
  act(agv, kind, dur, handoff, done) { agv.state = 'ACTION'; agv.action = { kind, t: 0, dur, handoff, done, handed: false }; }

  dispatch(agv) {
    const ok = agv.battery > 25;
    if (agv.id === 'AGV-A' && ok && this.sawPad.layers >= STACK_LAYERS && this.kiln.loads.length < KILN_CAP) {
      this.sawPad.reserved = true;
      this.go(agv, ROUTES.A_toPad, 'Hacia pila verde');
      agv.next = 'A_pad';
    } else if (agv.id === 'AGV-B' && ok && this.kiln.out > 0 && this.planerPad.layers <= 1) {
      this.go(agv, ROUTES.B_toKiln, 'Hacia salida del secadero');
      agv.next = 'B_kiln';
    } else if (agv.id === 'AGV-C' && ok && this.pal.pallet.ready) {
      this.go(agv, ROUTES.C_toPallet, 'Hacia palé enfardado');
      agv.next = 'C_pal';
    } else if (agv.id === 'AGV-D' && ok && this.truck.state === 'DOCKED' && this.truck.load < TRUCK_CAP
      && Object.values(this.rack).filter((r) => r.filled).length > 6) {      // stock mínimo de seguridad en almacén
      const slot = Object.values(this.rack).filter((s) => s.filled && !s.res).sort((a, b) => a.t - b.t)[0];
      if (!slot) return;
      slot.res = true; agv.slot = slot;
      this.go(agv, ROUTES.D_toRack(slot.x), `Hacia hueco ${slotName(slot)}`);
      agv.next = 'D_rack';
    }
  }

  /** Llegada al final de una ruta: acción de carga/descarga y siguiente tramo. */
  arrive(agv) {
    const n = agv.next;
    agv.next = null;
    const home = (route, msg = 'Volviendo a base') => { this.go(agv, route, msg); agv.next = 'home'; };
    if (n === 'A_pad') this.act(agv, 'lift', 3,
      () => { agv.load = 'green'; this.sawPad.layers = 0; this.sawPad.reserved = false; },
      () => { this.go(agv, ROUTES.A_toKiln, 'Pila verde → secadero'); agv.next = 'A_kiln'; });
    else if (n === 'A_kiln') this.act(agv, 'drop', 4,
      () => { agv.load = null; this.kiln.loads.push(DRY_TIME); },
      () => { home(ROUTES.A_home); this.log('info', 'AGV-A: pila verde entregada al secadero'); });
    else if (n === 'B_kiln') this.act(agv, 'lift', 4,
      () => { agv.load = 'dry'; this.kiln.out--; },
      () => { this.go(agv, ROUTES.B_toPlaner, 'Pila seca → cepilladora'); agv.next = 'B_plan'; });
    else if (n === 'B_plan') this.act(agv, 'drop', 3,
      () => { agv.load = null; this.planerPad.layers = STACK_LAYERS; },
      () => { home(ROUTES.B_home); this.log('info', 'AGV-B: pila seca entregada a la cepilladora'); });
    else if (n === 'C_pal') this.act(agv, 'forkPick', 5,
      () => {
        const pl = this.pal.pallet;
        agv.load = { items: pl.items.slice() };
        Object.assign(pl, { present: false, items: [], wrap: 0, ready: false });
        this.pal.respawn = 6;
      },
      () => {
        const slot = Object.values(this.rack).filter((r) => !r.filled && !r.res).sort((a, b) => a.x - b.x || a.lvl - b.lvl)[0];
        slot.res = true; agv.slot = slot;
        this.go(agv, ROUTES.C_toRack(slot.x), `Palé → hueco ${slotName(slot)}`); agv.next = 'C_store';
      });
    else if (n === 'C_store') this.act(agv, 'store', 6,
      () => { Object.assign(agv.slot, { filled: true, t: performance.now() / 1000, items: agv.load.items }); agv.load = null; },
      () => { const x = agv.slot.x; agv.slot.res = false; agv.slot = null; home(ROUTES.C_home(x)); });
    else if (n === 'D_rack') this.act(agv, 'retrieve', 6,
      () => { agv.load = { items: agv.slot.items || [] }; agv.slot.filled = false; },
      () => { const x = agv.slot.x; agv.slot.res = false; agv.slot = null; this.go(agv, ROUTES.D_toDock(x), 'Palé → camión'); agv.next = 'D_dock'; });
    else if (n === 'D_dock') this.act(agv, 'load', 5,
      () => { agv.load = null; this.truck.load++; this.counters.shipped++; },
      () => { home(ROUTES.D_home); });
    else { agv.state = 'IDLE'; agv.mission = 'En base · cargando'; }
  }

  stepAgv(agv, dt) {
    // Batería: consume al moverse, carga en la base
    if (agv.state === 'MOVING') agv.battery = Math.max(0, agv.battery - dt * 0.22);
    else if (agv.state === 'IDLE') agv.battery = Math.min(100, agv.battery + dt * 1.2);

    // Mástil / plataforma de elevación hacia su consigna
    if (agv.state !== 'ACTION') agv.lift += ((agv.load ? 1 : 0) - agv.lift) * Math.min(1, dt * 3);

    if (agv.state === 'IDLE') { this.dispatch(agv); return; }

    if (agv.state === 'ACTION') {
      const A = agv.action;
      A.t += dt;
      const k = clamp(A.t / A.dur, 0, 1);
      if (A.kind === 'lift') agv.lift = smooth(k);
      if (A.kind === 'drop') agv.lift = 1 - smooth(k);
      if (agv.type === 'fork') {
        // Encarar el destino → elevar → extender horquilla → traspaso → retraer → bajar
        const face = A.kind === 'load' ? 0 : A.kind === 'forkPick' ? Math.PI / 2 : agv.slot.row === 0 ? Math.PI / 2 : -Math.PI / 2;
        const lvl = A.kind === 'store' || A.kind === 'retrieve' ? RACK.levels[agv.slot.lvl] + 0.1 : 0.1;
        agv.heading += angDiff(face, agv.heading) * Math.min(1, dt * 5);
        agv.liftH = k < 0.2 ? lvl * (k / 0.2) : k > 0.8 ? lvl * (1 - (k - 0.8) / 0.2) : lvl;
        agv.reach = k < 0.2 ? 0 : k < 0.45 ? (k - 0.2) / 0.25 : k < 0.55 ? 1 : k < 0.8 ? 1 - (k - 0.55) / 0.25 : 0;
      }
      if (!A.handed && k >= 0.5) { A.handed = true; A.handoff?.(); }
      if (A.t >= A.dur) { agv.action = null; agv.reach = 0; agv.liftH = 0; agv.state = 'MOVING'; A.done(); }
      return;
    }

    // MOVING / WAIT
    if (!agv.seg) {
      if (agv.idx >= agv.path.length - 1) { agv.state = 'MOVING'; this.arrive(agv); return; }
      const nextNode = agv.path[agv.idx + 1];
      const blocker = this.canTake(agv, nextNode);
      if (blocker) {
        agv.waitT += dt;
        agv.wait = `Cede el paso a ${blocker}`;
        if (agv.state !== 'WAIT') { agv.state = 'WAIT'; }
        if (agv.waitT > 45) { this.log('warn', `Tráfico: ${agv.id} desbloqueado por supervisión`); agv.waitT = 0; delete this.res[nextNode]; }
        else return;
      }
      if (agv.waitT > 4) this.log('info', `Tráfico: ${agv.id} cedió el paso a ${agv.wait?.replace('Cede el paso a ', '') ?? 'otro AGV'} en ${nextNode}`);
      agv.wait = null; agv.waitT = 0; agv.state = 'MOVING';
      this.res[nextNode] = agv.id;
      const a = NODES[agv.path[agv.idx]], b = NODES[nextNode];
      agv.seg = { a, b, len: Math.hypot(b[0] - a[0], b[1] - a[1]), d: 0, from: agv.path[agv.idx], to: nextNode,
        hd: Math.atan2(-(b[1] - a[1]), b[0] - a[0]) };
    }
    const S = agv.seg;
    // Girar en el sitio hasta encarar el tramo (las carretillas pueden ir marcha atrás)
    let target = S.hd;
    if (agv.type === 'fork' && Math.abs(angDiff(target + Math.PI, agv.heading)) < Math.abs(angDiff(target, agv.heading)) && S.len < 8) target += Math.PI;
    const err = angDiff(target, agv.heading);
    if (Math.abs(err) > 0.05) { agv.heading += Math.sign(err) * Math.min(Math.abs(err), dt * 1.8); return; }
    agv.heading = target;
    const speed = agv.load ? 1.0 : 1.4;
    S.d = Math.min(S.len, S.d + dt * speed);
    const k = S.len ? S.d / S.len : 1;
    agv.pos = [S.a[0] + (S.b[0] - S.a[0]) * k, S.a[1] + (S.b[1] - S.a[1]) * k];
    if (S.d >= S.len) {
      if (this.res[S.from] === agv.id) delete this.res[S.from];
      agv.node = S.to; agv.idx++; agv.seg = null;
    }
  }

  snapshot() {
    const rackSlots = Object.values(this.rack);
    return {
      yardLogs: this.yardLogs, logGantry: this.logGantry.state, stacker: this.stacker.state,
      saw: this.saw.state === 'CUT' ? 'Aserrando' : this.deckLog ? 'Tronco en mesa' : 'Esperando tronco',
      sawPad: this.sawPad.layers, kilnLoads: this.kiln.loads.length, kilnOut: this.kiln.out,
      kilnNext: this.kiln.loads.length ? Math.max(0, Math.min(...this.kiln.loads)) : 0,
      planerPad: this.planerPad.layers, outQueue: this.outQueue.length,
      palletizer: this.pal.state, palletItems: this.pal.pallet.items.length, wrap: this.pal.pallet.wrap,
      rackFilled: rackSlots.filter((s) => s.filled).length, rackTotal: rackSlots.length,
      truck: this.truck.state, truckLoad: this.truck.load, truckCap: TRUCK_CAP,
      counters: { ...this.counters },
      agvs: this.agvs.map((a) => ({
        id: a.id, label: a.label, type: a.type, state: a.state, mission: a.mission, battery: a.battery,
        wait: a.wait, load: !!a.load, node: a.node,
      })),
    };
  }
}

export function angDiff(a, b) {
  let d = a - b;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  return d;
}
export const slotName = (s) => `${s.row ? 'B' : 'A'}${RACK.xs.indexOf(s.x) + 1}-${s.lvl + 1}`;

export const logistics = new Logistics();
