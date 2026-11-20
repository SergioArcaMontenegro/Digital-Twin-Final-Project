// ─────────────────────────────────────────────────────────────────────────────
// Mundo de la simulación: un único estado compartido por el visor 3D, la app de
// administración y la app móvil. Lo ejecuta el servidor (autoritativo) o, si no hay
// servidor, el propio navegador.
//
//   World ─┬─ Staff      plantilla, turnos, puestos, tareas, incidencias, avatares
//          ├─ Twin       brazos: térmico, desgaste, reparto, recomendaciones
//          ├─ Logistics  troncos → sierra → secadero → cepilladora … → camión (AGV)
//          ├─ Economy    caja, compras, pedidos, plan de producción
//          └─ Line       cinta con bandejas, estaciones CEP→CNC→LIJ→ENS→BAR→PAL
// ─────────────────────────────────────────────────────────────────────────────
import {
  T0, LINE_STATIONS, PRODUCTS, SPECIES, TONES, ROLES, POSTS, SHIFTS, CEP_TIME,
  hourOf, shiftKey, currentShift, fmtEur, SIM_SPEEDS,
} from '../config.js';
import { ZONES, DEFAULT_PLACEMENTS, ZONE_IDS } from '../zones.js';
import { buildPlant } from '../layout.js';
import { Staff, hashPin } from './staff.js';
import { Twin } from './twin.js';
import { Logistics } from './logistics.js';
import { Economy } from './economy.js';

export const DEFAULT_SETTINGS = {
  pace: 60,               // takt mínimo de la línea (s)
  twinEnabled: true,      // el gemelo propone decisiones de turno
  autoWorkers: true,      // los trabajadores simulados hacen sus tareas si nadie las hace desde la app
  autoCrew: true,         // los puestos sin nadie de la plantilla los cubre personal simulado
  autoSales: true,        // el comercial simulado responde a las ofertas
  autoBuy: true,          // compras automáticas de troncos según el plan
  autoStock: true,        // fabricar para stock mínimo si no hay pedidos
  kilnTime: 3600,         // s de secado por pila
  cepTime: CEP_TIME,      // s por unidad en la cepilladora
};

const POST_OF_STATION = { CEP: 'CEP', CNC: 'MEC', LIJ: 'MEC', ENS: 'MON', BAR: 'MON', PAL: 'LOG' };
const V_LINE = 1.6;         // m/s de la cinta en la transferencia
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

function mulberry32(a) {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ═════════════════════════════════════════════════════════════════════════════
// Línea: transferencia síncrona. En la fase WORK cada estación trabaja la bandeja que
// tiene; cuando todas han terminado (y ha pasado el takt mínimo) la cinta avanza todas
// las bandejas a la estación siguiente (fase TRANSFER) y entra una nueva en la cepilladora.
// ═════════════════════════════════════════════════════════════════════════════
export class Line {
  constructor(w, s = {}) {
    this.w = w;
    this.uid = s.uid || 1;
    this.slots = (s.slots || LINE_STATIONS.map(() => null)).map((t) => (t ? { ...t, picked: false } : null));
    this.phase = 'WORK';
    this.phaseStart = w.t;
    this.transferDur = 0;
    this.lastTransfer = 0;
    this.work = {};
    this.blocked = '';
    this.stopSec = 0;
    this.lastCycle = 0;
    this.cycleHist = [];
    this.cycleStart = w.t;
    for (let i = 0; i < this.slots.length; i++) if (this.slots[i]) this.slots[i].s0 = this.slots[i].s1 = this.stationS(i);
  }

  serialize() { return { uid: this.uid, slots: this.slots.map((t) => (t ? { ...t, picked: false } : null)) }; }

  stationS(i) { return this.w.plant.stations[i].s; }
  get idle() { return this.slots.every((t) => !t); }
  trayAt(st) { const i = LINE_STATIONS.indexOf(st); return i >= 0 && this.phase === 'WORK' ? this.slots[i] : null; }

  transferEstimate() {
    let g = 0;
    for (let i = 1; i < LINE_STATIONS.length; i++) g = Math.max(g, this.stationS(i) - this.stationS(i - 1));
    return g / V_LINE + 1.2;
  }

  unitPicked(tray) {
    const i = this.slots.indexOf(tray);
    if (i >= 0) this.slots[i] = null;
  }

  /** ¿Necesita trabajo esta estación para esta bandeja? */
  needs(st, tray) {
    if (st === 'PAL') return false;
    if (!tray.route.includes(st)) return false;
    if (st !== 'CEP' && !(PRODUCTS[tray.product].work[st] > 0)) return false;
    return !tray.done.includes(st);
  }

  startStation(i) {
    const w = this.w, st = LINE_STATIONS[i], tray = this.slots[i];
    if (!tray || !this.needs(st, tray)) return null;
    if (!w.staff.postStaffed(POST_OF_STATION[st])) return { wait: `Sin operario en ${POSTS.find((p) => p.id === POST_OF_STATION[st]).name}` };
    if (st === 'CEP') return { kind: 'CEP', start: w.t, cycle: w.settings.cepTime, product: tray.product };
    const active = w.twin.active(st);
    if (!active.length) return { wait: `Celda ${st} sin brazos disponibles` };
    const { times, cycle } = w.twin.workTimes(st, tray.product, active);
    return { kind: 'CELL', start: w.t, times, cycle, active: active.map((a) => ({ index: a.index, share: a.share, v: a.v, id: a.id })), product: tray.product };
  }

  /** Un brazo ha cambiado de estado o de velocidad: se reparte de nuevo lo que falta. */
  replan(cellId) {
    const i = LINE_STATIONS.indexOf(cellId);
    const info = this.work[cellId];
    if (this.phase !== 'WORK' || !info || info.kind !== 'CELL' || info.done) return;
    const w = this.w;
    const prog = clamp((w.t - info.start) / Math.max(1e-6, info.cycle), 0, 1);
    const active = w.twin.active(cellId);
    if (!active.length) { this.work[cellId] = { wait: `Celda ${cellId} sin brazos disponibles` }; return; }
    const { times, cycle } = w.twin.workTimes(cellId, this.slots[i].product, active);
    Object.assign(info, { times, cycle, active: active.map((a) => ({ index: a.index, share: a.share, v: a.v, id: a.id })), start: w.t - prog * cycle });
  }

  step(h) {
    const w = this.w, t = w.t;
    for (const r of Object.values(w.twin.robots)) r.working = false;

    if (this.phase === 'TRANSFER') {
      if (t - this.phaseStart >= this.transferDur) {
        for (let i = 0; i < this.slots.length; i++) if (this.slots[i]) this.slots[i].s0 = this.slots[i].s1 = this.stationS(i);
        this.phase = 'WORK'; this.phaseStart = t; this.work = {};
        this.lastCycle = t - this.cycleStart; this.cycleStart = t;
        this.cycleHist.push(this.lastCycle); if (this.cycleHist.length > 30) this.cycleHist.shift();
      }
      return;
    }

    // ── fase WORK ──
    let allDone = true;
    this.blocked = '';
    for (let i = 0; i < LINE_STATIONS.length; i++) {
      const st = LINE_STATIONS[i], tray = this.slots[i];
      if (!tray) continue;
      if (st === 'PAL') { if (!tray.picked) { allDone = false; if (!this.blocked && t - this.phaseStart > 30) this.blocked = 'Paletizador ocupado'; } continue; }
      let info = this.work[st];
      if (!info || info.wait) {
        info = this.startStation(i);
        if (!info) continue;
        this.work[st] = info;
        if (info.wait) { allDone = false; this.blocked ||= info.wait; continue; }
      }
      if (info.done) continue;
      const el = t - info.start;
      if (info.kind === 'CELL') for (const a of info.active) if (el < info.times[a.index]) {
        const r = w.twin.robots[a.id];
        if (r && r.status === 'RUN') r.working = true;
      }
      if (el >= info.cycle) {
        info.done = true;
        tray.done.push(st);
        if (info.kind === 'CELL') {
          w.twin.noteMix(st, tray.product);
          for (const a of info.active) { const r = w.twin.robots[a.id]; if (r) r.cycles++; }
        }
        w.countZone(st, 1);
      } else allDone = false;
    }
    if (!allDone) { if (this.blocked) this.stopSec += h; return; }
    if (t - this.phaseStart < w.settings.pace - this.lastTransfer && !this.idle) return;

    // ── ¿avanzar? ──
    const last = this.slots.length - 1;
    if (this.slots[last]) return;                                   // aún no se ha recogido
    const next = w.staff.postStaffed('CEP') ? w.eco.nextUnit() : null;
    if (this.idle && !next) { this.blocked = w.eco.plan.some((p) => p.status !== 'CANCELADA' && p.started < p.qty) ? (w.staff.postStaffed('CEP') ? 'Esperando madera seca en la cepilladora' : 'Sin cepillador') : ''; this.phaseStart = t; return; }
    let dur = 0;
    for (let i = last - 1; i >= 0; i--) {
      const tr = this.slots[i];
      if (!tr) continue;
      tr.s0 = this.stationS(i); tr.s1 = this.stationS(i + 1);
      this.slots[i + 1] = tr; this.slots[i] = null; tr.station = LINE_STATIONS[i + 1];
      dur = Math.max(dur, (tr.s1 - tr.s0) / V_LINE);
    }
    if (next) {
      const tr = { uid: this.uid++, ...next, done: [], station: 'CEP', s0: Math.max(0, this.stationS(0) - 4.5), s1: this.stationS(0), picked: false };
      this.slots[0] = tr;
      dur = Math.max(dur, (tr.s1 - tr.s0) / V_LINE);
    }
    if (this.idle) return;
    if (this.cycleStart === undefined) this.cycleStart = t;
    this.phase = 'TRANSFER'; this.phaseStart = t; this.transferDur = dur + 1.2; this.lastTransfer = this.transferDur; this.work = {};
  }

  snapshot() {
    const work = {};
    for (const [st, info] of Object.entries(this.work)) {
      if (info.wait) work[st] = { wait: info.wait };
      else work[st] = { kind: info.kind, start: info.start, cycle: info.cycle, times: info.times, active: info.active, product: info.product, done: !!info.done };
    }
    return {
      phase: this.phase, phaseStart: this.phaseStart, transferDur: this.transferDur, blocked: this.blocked,
      trays: this.slots.map((t) => (t ? { uid: t.uid, product: t.product, species: t.species, tone: t.tone, route: t.route, done: t.done, station: t.station, s0: t.s0, s1: t.s1, picked: t.picked, orderId: t.orderId, poId: t.poId } : null)),
      work, lastCycle: this.lastCycle,
      avgCycle: this.cycleHist.length ? this.cycleHist.reduce((a, b) => a + b, 0) / this.cycleHist.length : 0,
    };
  }
}

// ═════════════════════════════════════════════════════════════════════════════
const PERM = {
  setSimSpeed: ['gerente'], setRunning: ['gerente'], setSetting: ['gerente'], setRobot: ['gerente'],
  applyLayout: ['gerente'], resetLayout: ['gerente'], createWorker: ['gerente'], updateWorker: ['gerente'], deleteWorker: ['gerente'],
  buyLogs: ['gerente', 'jefe'], addPO: ['gerente', 'jefe'], movePO: ['gerente', 'jefe'], cancelPO: ['gerente', 'jefe'],
  setRoute: ['gerente', 'jefe'], setTone: ['gerente', 'jefe'], recommend: ['gerente', 'jefe'],
  acceptOrder: ['gerente', 'comercial'], rejectOrder: ['gerente', 'comercial'],
  approveRec: ['gerente', 'jefe'], rejectRec: ['gerente', 'jefe'],
  resolveIncident: ['gerente', 'jefe', 'mantenimiento'],
  doTask: '*', report: '*', changePin: '*',
};

export class World {
  constructor(saved = null) {
    const s = saved && saved.v === 2 ? saved : {};
    this.seed = s.seed ?? 20261120;
    this.rngState = s.rngState ?? this.seed;
    this.rng = () => { const r = mulberry32(this.rngState)(); this.rngState = (this.rngState + 0x6d2b79f5) | 0; return r; };
    this.t = s.t ?? T0;
    this.speed = s.speed ?? 20;
    this.running = s.running ?? true;
    this.settings = { ...DEFAULT_SETTINGS, ...(s.settings || {}) };
    this.events = s.events || [];
    this.listeners = new Set();
    this.kpi = { unplanned: 0, simultaneous: 0, maint: 0, produced: {}, shipped: 0, pallets: 0, sinceStop: 0, ...(s.kpi || {}) };
    this.zoneCount = s.zoneCount || {};
    this.layoutVersion = s.layoutVersion || 1;
    let plant = buildPlant(s.placements || DEFAULT_PLACEMENTS);
    if (!plant.valid) plant = buildPlant(DEFAULT_PLACEMENTS);
    this.plant = plant;
    this.placements = plant.placements;
    this.staff = new Staff(this, s.staff);
    this.twin = new Twin(this, s.twin);
    this.logistics = new Logistics(this, s.logistics);
    this.eco = new Economy(this, s.eco);
    this.line = new Line(this, s.line);
    this.acc = 0;
    this.lastHour = Math.floor(this.t / 3600);
    this.recAt = s.recAt ?? (saved ? null : this.t + 15 * 60);
    if (!saved) this.log('info', 'Planta en marcha · día 1, turno de mañana');
  }

  // ── Utilidades usadas por los subsistemas ──────────────────────────────────
  log(level, msg) {
    const e = { t: Math.round(this.t), level, msg };
    this.events.unshift(e);
    if (this.events.length > 300) this.events.length = 300;
    for (const fn of this.listeners) fn(e);
  }
  onEvent(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }

  robotsChanged(cellId) { this.line?.replan(cellId); }

  countZone(zone, n) {
    const k = shiftKey(this.t);
    const c = (this.zoneCount[k] ||= {});
    c[zone] = (c[zone] || 0) + n;
    const keys = Object.keys(this.zoneCount);
    if (keys.length > 12) delete this.zoneCount[keys[0]];
    const post = POSTS.find((p) => p.zones.includes(zone));
    if (post) for (const u of this.staff.presentUsers()) if (u.role === post.role && post.zones.includes(u.zone)) this.staff.credit(u.id, n);
  }

  unitPalletized(item) {
    this.eco.unitDone(item);
    this.kpi.produced[item.product] = (this.kpi.produced[item.product] || 0) + 1;
    this.countZone('PAL', 1);
  }
  palletStored(p) { this.kpi.pallets++; }
  shipPallets(pallets, by) {
    const total = this.eco.ship(pallets);
    this.kpi.shipped += pallets.length;
    this.log('ok', `Expedición: camión con ${pallets.length} palés · ${fmtEur(total)} facturados${by ? ` · confirmado por ${by}` : ''}`);
    return total;
  }

  // ── Avance del reloj ───────────────────────────────────────────────────────
  advance(realDt) {
    if (!this.running) return 0;
    let simDt = Math.min(realDt, 0.5) * this.speed;
    const h = this.speed >= 300 ? 0.5 : 0.25;
    let n = 0;
    while (simDt > 1e-9) { const d = Math.min(h, simDt); this.stepSim(d); simDt -= d; n++; }
    return n;
  }

  /** Avanza `seconds` de simulación de golpe (pruebas). */
  run(seconds, h = 0.5) { let s = seconds; while (s > 1e-9) { const d = Math.min(h, s); this.stepSim(d); s -= d; } }

  stepSim(h) {
    this.t += h;
    this.line.step(h);
    this.logistics.step(h);
    this.acc += h;
    if (this.acc >= 1) {
      const a = this.acc; this.acc = 0;
      this.twin.step(a);
      this.eco.step(a);
      this.staff.step(a);
      const anyFault = Object.values(this.twin.robots).some((r) => r.status === 'FAULT');
      this.kpi.sinceStop = anyFault ? 0 : this.kpi.sinceStop + a;
    }
    const hr = Math.floor(this.t / 3600);
    if (hr !== this.lastHour) {
      this.lastHour = hr;
      const hh = hr % 24;
      if (hh === 6 || hh === 14 || hh === 22) {
        const sh = currentShift(this.t);
        const pres = this.staff.crew().length;
        this.log('info', `Cambio de turno: entra el turno de ${SHIFTS[sh].name.toLowerCase()} (${pres} personas)`);
        this.recAt = this.t + 15 * 60;
      }
    }
    if (this.recAt && this.t >= this.recAt) {
      this.recAt = null;
      if (this.settings.twinEnabled) this.twin.makeRecommendation();
    }
  }

  // ── Modo edición ───────────────────────────────────────────────────────────
  previewLayout(placements) {
    const p = buildPlant(placements);
    return { valid: p.valid, errors: p.errors };
  }
  applyLayout(placements) {
    const p = buildPlant(placements);
    if (!p.valid) return { ok: false, errors: p.errors, error: p.errors[0]?.msg };
    this.plant = p;
    this.placements = p.placements;
    this.layoutVersion++;
    for (let i = 0; i < this.line.slots.length; i++) { const tr = this.line.slots[i]; if (tr) tr.s0 = tr.s1 = this.line.stationS(i); }
    if (this.line.phase === 'TRANSFER') this.line.transferDur = 0;
    this.logistics.relayout();
    for (const a of Object.values(this.staff.avatars)) { a.tgt = null; if (!p.nav.isFree(a.x, a.z)) { const f = p.nav.nearestFree(a.x, a.z); if (f) [a.x, a.z] = p.nav.center(f[0], f[1]); } }
    this.log('ok', `Distribución de la planta actualizada (versión ${this.layoutVersion}) · cinta de ${p.conveyor.length.toFixed(1)} m`);
    return { ok: true, layoutVersion: this.layoutVersion };
  }

  // ── Acciones de los usuarios ───────────────────────────────────────────────
  login(username, pin) {
    const u = this.staff.byUsername(username);
    if (!u || u.pin !== hashPin(String(pin))) return null;
    return u;
  }

  action(user, type, p = {}) {
    const perm = PERM[type];
    if (!perm) return { ok: false, error: `Acción desconocida: ${type}` };
    if (perm !== '*' && !perm.includes(user.role)) return { ok: false, error: 'No tienes permiso para esta acción' };
    const S = this.staff, E = this.eco, T = this.twin;
    switch (type) {
      case 'setSimSpeed': if (!SIM_SPEEDS.includes(p.speed)) return { ok: false }; this.speed = p.speed; return { ok: true };
      case 'setRunning': this.running = !!p.running; return { ok: true };
      case 'setSetting': {
        if (!(p.key in DEFAULT_SETTINGS)) return { ok: false, error: 'Ajuste desconocido' };
        let v = p.value;
        if (typeof DEFAULT_SETTINGS[p.key] === 'number') { v = Number(v); if (!Number.isFinite(v)) return { ok: false }; }
        if (p.key === 'pace') v = clamp(v, 30, 240);
        if (p.key === 'kilnTime') v = clamp(v, 600, 6 * 3600);
        if (p.key === 'cepTime') v = clamp(v, 10, 90);
        if (typeof DEFAULT_SETTINGS[p.key] === 'boolean') v = !!v;
        this.settings[p.key] = v;
        this.log('info', `${user.name}: ajuste «${p.key}» = ${v}`);
        return { ok: true };
      }
      case 'setRobot': {
        const r = T.robots[p.robotId];
        if (!r) return { ok: false, error: 'Robot desconocido' };
        if (p.speed !== undefined) r.speed = clamp(Number(p.speed), 0.5, 1.3);
        if (p.share !== undefined) r.share = clamp(Number(p.share), 0, 3);
        this.robotsChanged(r.cellId);
        this.log('info', `${user.name}: ${r.id} velocidad ${Math.round(r.speed * 100)} % · reparto ${r.share.toFixed(1)}`);
        return { ok: true };
      }
      case 'applyLayout': return this.applyLayout(p.placements);
      case 'resetLayout': return this.applyLayout(DEFAULT_PLACEMENTS);
      case 'createWorker': return S.createWorker(p);
      case 'deleteWorker': return S.deleteWorker(p.id);
      case 'updateWorker': {
        const r = S.updateWorker(p.id, p);
        if (r.ok) { const u = S.user(p.id); this.log('info', `${user.name} asigna a ${u.name}: ${ZONES[u.zone]?.short || u.zone} · turno ${SHIFTS[u.shift].name.toLowerCase()}${u.active ? '' : ' · de baja'}`); }
        return r;
      }
      case 'buyLogs': return E.buyLogs(p.species, p.logs, user.name);
      case 'addPO': return E.addPO({ product: p.product, species: p.species, tone: p.tone, qty: p.qty, route: p.route });
      case 'movePO': return E.movePO(p.id, p.dir);
      case 'cancelPO': return E.cancelPO(p.id);
      case 'setRoute': return E.setRoute(p.id, p.route || []);
      case 'setTone': return E.setTone(p.id, p.tone);
      case 'recommend': T.makeRecommendation(); return { ok: true };
      case 'acceptOrder': return E.acceptOrder(p.id, user.name);
      case 'rejectOrder': return E.rejectOrder(p.id, user.name);
      case 'approveRec': return { ok: T.approve(user.name) };
      case 'rejectRec': return { ok: T.reject(user.name) };
      case 'doTask': {
        if (!ROLES[user.role].admin && !S.present(user)) return { ok: false, error: 'Estás fuera de tu turno' };
        return S.doTask(p.id, user, p.action);
      }
      case 'report': {
        if (!p.text || !String(p.text).trim()) return { ok: false, error: 'Escribe qué pasa' };
        const inc = S.report(user, p.text, p.zone);
        return { ok: true, id: inc.id };
      }
      case 'resolveIncident': {
        const inc = S.incidents.find((i) => i.id === p.id);
        if (!inc || inc.status !== 'ABIERTA') return { ok: false, error: 'No está abierta' };
        inc.status = 'RESUELTA'; inc.resolvedBy = user.name; inc.resolvedAt = this.t;
        this.log('ok', `${user.name} resuelve la incidencia ${inc.id}`);
        return { ok: true };
      }
      case 'changePin': {
        if (typeof p.pin !== 'string' || p.pin.length < 4 || p.pin.length > 32) return { ok: false, error: 'La clave debe tener entre 4 y 32 caracteres' };
        user.pin = hashPin(String(p.pin));
        return { ok: true };
      }
      default: return { ok: false };
    }
  }

  // ── Instantáneas ───────────────────────────────────────────────────────────
  /** Lo que necesita el visor 3D (≈10 Hz). */
  tick() {
    return {
      t: this.t, speed: this.speed, running: this.running, layoutVersion: this.layoutVersion,
      line: this.line.snapshot(), robots: this.twin.snapshotRobots(), logistics: this.logistics.snapshot(),
      avatars: this.staff.snapshotAvatars(), posts: this.staff.posts,
      hud: this.hud(),
    };
  }

  /** Lo que cambia despacio en el visor (≈1 Hz): distribución y almacén. */
  scene() {
    const slots = {};
    for (const [k, p] of Object.entries(this.logistics.slots)) slots[k] = p ? { id: p.id, product: p.product, species: p.species, tone: p.tone, units: p.units, orderId: p.orderId } : null;
    return { layoutVersion: this.layoutVersion, placements: this.placements, slots, slotRes: this.logistics.slotRes, settings: this.settings };
  }

  /** Indicadores para el visor (videowall, barra superior). */
  hud() {
    const E = this.eco, day = Math.floor(this.t / 86400) + 1;
    const today = E.days[day] || {};
    const k = shiftKey(this.t);
    return {
      cash: Math.round(E.cash), sales: Math.round(today.venta || 0), produced: this.kpi.produced, shift: currentShift(this.t),
      shiftUnits: this.zoneCount[k]?.PAL || 0, unplanned: this.kpi.unplanned, maint: this.kpi.maint, sinceStop: Math.round(this.kpi.sinceStop),
      openOrders: E.orders.filter((o) => ['ACEPTADO', 'EN_PRODUCCION', 'LISTO'].includes(o.status)).length,
      offers: E.orders.filter((o) => o.status === 'OFERTA').length,
      tasks: this.staff.tasks.filter((t) => t.status === 'PENDIENTE').length,
      rec: this.twin.recommendation?.status || null, twin: this.settings.twinEnabled,
    };
  }

  /** Lo que necesitan las apps (≈1 Hz). */
  state() {
    const E = this.eco;
    const stock = {};
    for (const p of Object.values(this.logistics.slots)) if (p) {
      const k = `${p.product}|${p.species}|${p.tone}`;
      const s = (stock[k] ||= { product: p.product, species: p.species, tone: p.tone, units: 0, free: 0, pallets: 0 });
      s.units += p.units; s.pallets++; if (!p.orderId) s.free += p.units;
    }
    const L = this.logistics;
    return {
      t: this.t, speed: this.speed, running: this.running, settings: this.settings, layoutVersion: this.layoutVersion,
      placements: this.placements,
      eco: E.summary(), orders: E.orders.slice(-60), plan: E.plan.filter((p) => p.status !== 'HECHA' && p.status !== 'CANCELADA').concat(E.plan.filter((p) => p.status === 'HECHA').slice(-10)),
      purchases: E.purchases.slice(-20),
      tasks: this.staff.tasks.slice(-80), incidents: this.staff.incidents.slice(0, 40), users: this.staff.publicUsers(), posts: this.staff.posts,
      userStats: this.staff.stats, zoneCount: this.zoneCount, shiftKey: shiftKey(this.t), shift: currentShift(this.t),
      kpi: this.kpi, events: this.events.slice(0, 80), recommendation: this.twin.recommendation, robots: this.twin.snapshotRobots(),
      evaluation: this.twin.evaluate(),
      line: { blocked: this.line.blocked, phase: this.line.phase, lastCycle: this.line.lastCycle, avgCycle: this.line.snapshot().avgCycle, trays: this.line.slots.filter(Boolean).length, stopSec: this.line.stopSec },
      stock: Object.values(stock), yard: L.yard, dryPad: L.dryPad, greenPad: L.greenPad,
      kiln: L.kiln.stacks.map((s) => ({ species: s.species, boards: s.boards, left: Math.max(0, Math.round(s.left)) })),
      truck: { state: L.truck.state, pallets: L.truck.pallets.length }, counters: L.counters,
      agvs: L.agvs.map((a) => ({ id: a.id, label: a.label, state: a.state, mission: a.mission, battery: Math.round(a.battery), wait: a.wait })),
    };
  }

  serialize() {
    return {
      v: 2, seed: this.seed, rngState: this.rngState, t: this.t, speed: this.speed, running: this.running, settings: this.settings,
      placements: this.placements, layoutVersion: this.layoutVersion, events: this.events.slice(0, 120), kpi: this.kpi, zoneCount: this.zoneCount, recAt: this.recAt,
      staff: this.staff.serialize(), twin: this.twin.serialize(), logistics: this.logistics.serialize(), eco: this.eco.serialize(), line: this.line.serialize(),
    };
  }
}

export { hourOf, ZONE_IDS, TONES, SPECIES };
