// ─────────────────────────────────────────────────────────────────────────────
// Motor del gemelo digital
//
// Dos relojes:
//   · reloj del gemelo  (simTime) → térmica, desgaste, producción, turnos. Puede
//     acelerarse hasta 1 h de planta por segundo real.
//   · reloj visual       → animación de la línea y los brazos (máx. ×6) para que la
//     escena 3D siga siendo legible aunque el gemelo vaya acelerado.
//
// Marco formal (ver documento del proyecto):
//   S_t  esfuerzo, desgaste en reductores, temperatura de bobinado  → robot.wear, robot.temp
//   O_t  corriente por fase, posición, temperatura medida, alarmas  → robot.current, robot.measured
//   U_t  aceleración, reparto de tareas, consigna de mantenimiento  → robot.accel, robot.share, status
//   D_t  R_th, factor de fatiga acumulada, modelo 3D sincronizado   → robot.rthEst, robot.i2t
//   Q_t  RUL, riesgo térmico, viabilidad monobrazo                  → robot.rul, whatIf*()
//   R_t  horas sin paradas, cero fallos concurrentes, takt          → kpi
// ─────────────────────────────────────────────────────────────────────────────
import { CELLS, ROBOTS, STATIONS, TAKT_TARGET, TRANSFER_TIME } from './layout.js';
import { logistics } from './logistics.js';

export const T_ALARM = 95;          // °C · alarma de temperatura de bobinado
export const T_TRIP = 110;          // °C · disparo térmico del drive
const TAU = 900;                    // s  · constante de tiempo térmica bobinado-carcasa
const K_TH = 55;                    // K  · ΔT en régimen a ciclo 100 % (R_th nominal)
const RTH_NOM = 0.43;               // K/W
const I_NOM = 14;                   // A rms a ciclo 100 %
const WEAR_REF = 1 / 1500;          // desgaste/h a ciclo 50 % y 60 °C
export const SHIFT = 8 * 3600;      // s · duración de turno
export const MAINT_MIN = 45;        // min · mantenimiento preventivo
const REPAIR_H = 4;                 // h · reparación correctiva tras avería
export const ACCEL_REDUCED = 0.88;  // −12 % de aceleración en ejes 2 y 3
const VIS_MAX = 6;                  // aceleración máxima de la animación

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const slowdown = (accel) => 1 + 0.65 * (1 / accel - 1);   // ciclo más largo al bajar la aceleración

let otCounter = 4810;

class TwinEngine {
  constructor() { this.reset(); }

  reset() {
    this.simTime = 6 * 3600;        // día 1, 06:00 (inicio de turno de mañana)
    this.running = true;
    this.speed = 1;
    this.twinEnabled = true;        // gemelo activo: recomendaciones en cada turno
    this.autoApprove = false;       // el responsable aprueba (o automático para demos)
    this.robots = {};
    for (const def of ROBOTS) {
      this.robots[def.id] = {
        id: def.id, def, cellId: def.cellId,
        status: 'RUN', reason: '', until: 0,
        share: 1, accel: 1, accelUntil: 0,
        temp: 45, measured: 45, wear: def.wear0, i2t: 0, rul: 0,
        duty: 0, current: 0, work: 0, cycles: 0,
        rthEst: def.rth * 1.04,     // estimación del gemelo (se calibra con la medida)
        hist: [],
      };
    }
    this.cells = {};
    for (const c of CELLS) this.cells[c.id] = { cycle: 0, blocked: false, active: 0, mode: 'REPARTO' };
    this.takt = TAKT_TARGET;
    this.lineStopped = false;
    this.kpi = { produced: 0, unplanned: 0, simultaneous: 0, lineStops: 0, lineDown: 0, run: 0, longestRun: 0, maint: 0, taktViolations: 0 };
    this.events = [];
    this.recommendation = null;
    this.nextShift = 14 * 3600;
    this.histClock = 0;

    // Línea (reloj visual)
    this.line = { phase: 'WORK', time: 0, t: 0 };
    this.uid = 0;
    this.pieces = STATIONS.map((_, i) => ({ uid: this.uid++, station: i, from: i, stage: i - 1, color: this.pickColor() }));
    logistics.onLog = (level, msg) => this.log(level, msg);
    logistics.reset();

    this.computeLoads();
    for (const r of Object.values(this.robots)) r.temp = r.measured = this.steadyTemp(r, r.duty, 1);
    this.twinStep(1);
    this.log('info', 'Gemelo inicializado · turno de mañana');
  }

  /** Tono del barniz de cada lote (nogal, roble, cerezo, wengué, natural). */
  pickColor() {
    const c = ['#8a5430', '#b07a45', '#7b3f25', '#4a3020', '#caa071'];
    return c[(this.uid * 3) % c.length];
  }

  log(level, msg) {
    this.events.unshift({ t: this.simTime, level, msg });
    if (this.events.length > 80) this.events.length = 80;
  }

  // ── Reparto de carga ──────────────────────────────────────────────────────
  /** Calcula ciclo de celda, takt y ciclo de trabajo de cada brazo para unos estados dados. */
  evaluate(overrides = {}) {
    const st = (r) => ({ ...r, ...(overrides[r.id] || {}) });
    const res = { cells: {}, robots: {}, takt: 0, blocked: false };
    for (const cell of CELLS) {
      const rs = Object.values(this.robots).filter((r) => r.cellId === cell.id).map(st);
      const active = rs.filter((r) => r.status === 'RUN' && r.share > 0);
      const sum = active.reduce((a, r) => a + r.share, 0) || 1;
      let cycle = 0;
      for (const r of rs) {
        const on = active.includes(r);
        const share = on ? r.share / sum : 0;
        const work = on ? cell.W * share * slowdown(r.accel) : 0;
        res.robots[r.id] = { share, work, accel: r.accel, status: r.status };
        cycle = Math.max(cycle, work);
      }
      const blocked = active.length === 0;
      res.cells[cell.id] = {
        cycle, blocked, active: active.length,
        mode: blocked ? 'PARADA' : active.length === 1 && rs.length > 1 ? 'MONOBRAZO' : active.length < rs.length ? `REPARTO (${active.length}/${rs.length})` : 'REPARTO',
      };
      res.blocked ||= blocked;
    }
    // La línea va pausada al takt objetivo; solo se alarga si alguna celda no llega
    const fixed = Math.max(0, ...STATIONS.filter((st) => st.fixed).map((st) => st.fixed));
    res.takt = Math.max(TAKT_TARGET, Math.max(fixed, ...Object.values(res.cells).map((c) => c.cycle)) + TRANSFER_TIME);
    for (const id in res.robots) res.robots[id].duty = res.blocked ? 0 : res.robots[id].work / res.takt;
    return res;
  }

  computeLoads() {
    const ev = this.evaluate();
    this.cells = ev.cells;
    this.takt = ev.takt;
    this.lineStopped = ev.blocked;
    for (const id in ev.robots) {
      const r = this.robots[id];
      r.shareNorm = ev.robots[id].share;
      r.work = ev.robots[id].work;
      r.duty = ev.robots[id].duty;
    }
  }

  // ── Modelo térmico y de desgaste ──────────────────────────────────────────
  ambient(t = this.simTime) {
    return 24 + 3 * Math.sin(2 * Math.PI * (t / 86400 - 0.375));
  }
  steadyTemp(r, duty, accel, tamb = this.ambient()) {
    const wearF = 1 + 0.35 * r.wear;
    return tamb + (r.def.rth / RTH_NOM) * K_TH * duty * accel * accel * wearF * wearF;
  }
  wearRate(duty, accel, temp) {            // desgaste por hora
    return WEAR_REF * (duty / 0.5) * accel * accel * Math.pow(2, (temp - 60) / 10);
  }

  // ── Paso de simulación ───────────────────────────────────────────────────
  step(dtReal) {
    if (!this.running) return;
    const dt = Math.min(dtReal, 0.1);
    let twinDt = dt * this.speed;
    while (twinDt > 0) {
      const h = Math.min(twinDt, 60);
      this.twinStep(h);
      twinDt -= h;
    }
    const vdt = dt * Math.min(this.speed, VIS_MAX);
    this.visualStep(vdt);
    logistics.step(vdt);
  }

  twinStep(h) {
    const tamb = this.ambient();
    let changed = false;

    for (const r of Object.values(this.robots)) {
      const on = r.status === 'RUN';
      const duty = on ? r.duty : 0;
      const wearF = 1 + 0.35 * r.wear;
      r.current = I_NOM * Math.sqrt(duty) * r.accel * wearF;
      const tss = this.steadyTemp(r, duty, r.accel, tamb);
      r.temp = tss + (r.temp - tss) * Math.exp(-h / TAU);
      r.measured = r.temp + 1.6 * Math.sin(this.simTime / 97 + r.def.index * 2.1);  // medida PT100/KTY con ruido
      r.i2t += (r.current * r.current * h) / 3600;
      const rate = this.wearRate(duty, r.accel, r.temp);
      r.wear += (rate * h) / 3600;
      if (on) r.cycles += h / this.takt;
      // RUL proyectada al reparto nominal (también para brazos parados)
      const nomDuty = on ? duty : (this.cellOf(r).W / this.robotsIn(r.cellId).length) / TAKT_TARGET;
      const nomRate = this.wearRate(nomDuty, 1, this.steadyTemp(r, nomDuty, 1, tamb));
      r.rul = Math.max(0, (1 - r.wear) / Math.max(on ? rate : nomRate, 1e-6));
      // Calibración de R_th con la temperatura real (filtro lento)
      if (on && duty > 0.1) r.rthEst += (r.def.rth - r.rthEst) * Math.min(1, h / 7200);

      if (on && r.wear >= 1) { this.fault(r, 'Fallo por desgaste en reductora / servomotor', REPAIR_H * 3600); changed = true; }
      else if (on && r.temp >= T_TRIP) { this.fault(r, `Disparo térmico (${r.temp.toFixed(0)} °C)`, 20 * 60); changed = true; }
      else if (r.status === 'MAINT' && this.simTime >= r.until) {
        r.status = 'RUN'; r.wear = Math.max(0.05, r.wear * 0.18); r.reason = '';
        this.kpi.maint++;
        this.log('ok', `${r.id}: mantenimiento preventivo terminado · vuelve a producción`);
        changed = true;
      } else if (r.status === 'FAULT' && this.simTime >= r.until && r.temp < 70) {
        if (r.wear >= 1) r.wear = 0.08;
        r.status = 'RUN'; r.reason = '';
        this.log('ok', `${r.id}: avería resuelta · vuelve a producción`);
        changed = true;
      }
      if (r.accelUntil && this.simTime >= r.accelUntil) {
        r.accel = 1; r.accelUntil = 0; changed = true;
        this.log('info', `${r.id}: perfil de aceleración restaurado al 100 %`);
      }
    }
    if (changed) this.computeLoads();

    // Producción y continuidad
    if (this.lineStopped) {
      this.kpi.lineDown += h;
      this.kpi.run = 0;
    } else {
      this.kpi.produced += h / this.takt;
      this.kpi.run += h;
      this.kpi.longestRun = Math.max(this.kpi.longestRun, this.kpi.run);
      if (this.takt > TAKT_TARGET + 0.01) this.kpi.taktViolations += h / this.takt;
    }

    // Histórico para las gráficas (≈ cada 2 min de planta, máx. 180 muestras)
    this.histClock += h;
    if (this.histClock >= 120) {
      this.histClock = 0;
      for (const r of Object.values(this.robots)) {
        r.hist.push([this.simTime, r.temp, r.wear]);
        if (r.hist.length > 180) r.hist.shift();
      }
    }

    this.simTime += h;

    // Cambio de turno: el gemelo recomienda, el responsable aprueba, el PLC ejecuta
    if (this.simTime >= this.nextShift) {
      this.nextShift += SHIFT;
      this.log('info', `Cambio de turno · ${shiftName(this.simTime)}`);
      if (this.twinEnabled) {
        this.makeRecommendation();
        if (this.autoApprove && this.recommendation?.items.length) this.approve();
      }
    }
  }

  fault(r, reason, duration) {
    const others = this.robotsIn(r.cellId).filter((o) => o !== r);
    const concurrent = others.some((o) => o.status === 'FAULT');
    r.status = 'FAULT'; r.reason = reason; r.until = this.simTime + duration;
    this.kpi.unplanned++;
    if (concurrent) this.kpi.simultaneous++;
    this.log('err', `${r.id}: PARADA NO PROGRAMADA · ${reason}`);
    const prevStopped = this.lineStopped;
    this.computeLoads();
    if (this.lineStopped && !prevStopped) {
      this.kpi.lineStops++;
      this.log('err', `LÍNEA PARADA · celda ${this.cellOf(r).name} sin brazos disponibles`);
    }
  }

  cellOf(r) { return CELLS.find((c) => c.id === r.cellId); }
  robotsIn(cellId) { return Object.values(this.robots).filter((r) => r.cellId === cellId); }

  // ── ¿Qué pasaría si…? ────────────────────────────────────────────────────
  /** Simula la parada de un brazo `minutes` minutos: margen térmico y takt del resto. */
  whatIfStop(robotId, minutes = MAINT_MIN, accelOthers = 1) {
    const r = this.robots[robotId];
    const overrides = { [robotId]: { status: 'MAINT' } };
    for (const o of this.robotsIn(r.cellId)) if (o !== r && accelOthers !== 1) overrides[o.id] = { accel: accelOthers };
    const ev = this.evaluate(overrides);
    const t = minutes * 60;
    const others = this.robotsIn(r.cellId).filter((o) => o !== r && o.status === 'RUN').map((o) => {
      const e = ev.robots[o.id];
      const tss = this.steadyTemp(o, e.duty, e.accel);
      const tEnd = tss + (o.temp - tss) * Math.exp(-t / TAU);
      return { id: o.id, share: e.share, duty: e.duty, tss, peak: Math.max(o.temp, tEnd) };
    });
    const peak = Math.max(0, ...others.map((o) => o.peak));
    const cell = ev.cells[r.cellId];
    return {
      robotId, minutes, accelOthers, others,
      mode: cell.mode, takt: ev.takt, cellCycle: cell.cycle,
      taktOk: !ev.blocked && ev.takt <= TAKT_TARGET,
      thermalOk: others.length > 0 && peak < T_ALARM,
      ok: !ev.blocked && ev.takt <= TAKT_TARGET && others.length > 0 && peak < T_ALARM,
      peak,
    };
  }

  /** Simula reducir la aceleración de un brazo durante `hours`: vida útil ganada. */
  whatIfAccel(robotId, accel = ACCEL_REDUCED, hours = 16) {
    const r = this.robots[robotId];
    const now = this.evaluate();
    const red = this.evaluate({ [robotId]: { accel } });
    const d0 = now.robots[robotId].duty, d1 = red.robots[robotId].duty;
    const T0 = this.steadyTemp(r, d0, r.accel), T1 = this.steadyTemp(r, d1, accel);
    const rate0 = Math.max(this.wearRate(d0, r.accel, T0), 1e-6);
    const rate1 = this.wearRate(d1, accel, T1);
    const rul0 = (1 - r.wear) / rate0;
    const rul1 = hours + Math.max(0, 1 - r.wear - rate1 * hours) / rate0;
    return {
      robotId, accel, hours, T0, T1, rul0, rul1, gain: rul1 - rul0,
      takt: red.takt, taktOk: red.takt <= TAKT_TARGET,
    };
  }

  // ── Recomendación de turno ───────────────────────────────────────────────
  makeRecommendation() {
    const items = [];
    for (const cell of CELLS) {
      const rs = this.robotsIn(cell.id);
      if (rs.some((r) => r.status !== 'RUN')) continue;          // celda ya degradada
      const cand = rs.reduce((a, b) => (b.wear > a.wear ? b : a));
      if (cand.wear < 0.45 && cand.rul > 500) continue;

      let w = this.whatIfStop(cand.id, MAINT_MIN, 1);
      if (!w.ok) {
        const w2 = this.whatIfStop(cand.id, MAINT_MIN, ACCEL_REDUCED);
        if (w2.ok) w = w2;
      }
      if (w.ok) {
        items.push({
          type: 'MAINT', cellId: cell.id, robotId: cand.id, minutes: MAINT_MIN, accelOthers: w.accelOthers, whatIf: w,
          text: `Mantenimiento preventivo de ${cand.id} (${MAINT_MIN} min). ${w.mode === 'MONOBRAZO' ? 'Ciclo monobrazo' : 'Reparto'} en el resto${w.accelOthers !== 1 ? ' con aceleración −12 %' : ''}: takt ${w.takt.toFixed(1)} s, pico ${w.peak.toFixed(0)} °C.`,
        });
      } else {
        const a = this.whatIfAccel(cand.id, ACCEL_REDUCED, 16);
        items.push({
          type: 'REDUCE', cellId: cell.id, robotId: cand.id, hours: 16, whatIf: a,
          text: `Sin margen para parar ${cand.id} (pico ${w.peak.toFixed(0)} °C / takt ${w.takt.toFixed(1)} s). Reducir aceleración ejes 2-3 un 12 % durante 16 h: +${a.gain.toFixed(0)} h de vida útil.`,
        });
      }
    }
    this.recommendation = { at: this.simTime, items, status: items.length ? 'PENDIENTE' : 'SIN ACCIONES' };
    this.log('twin', items.length
      ? `Gemelo: ${items.length} recomendación(es) para el turno · pendiente de aprobación`
      : 'Gemelo: sin acciones necesarias este turno');
  }

  approve() {
    const rec = this.recommendation;
    if (!rec || rec.status !== 'PENDIENTE') return;
    for (const it of rec.items) {
      const r = this.robots[it.robotId];
      if (it.type === 'MAINT' && r.status === 'RUN') {
        r.status = 'MAINT'; r.until = this.simTime + it.minutes * 60; r.reason = 'Mantenimiento preventivo';
        if (it.accelOthers !== 1) {
          for (const o of this.robotsIn(r.cellId)) if (o !== r) { o.accel = it.accelOthers; o.accelUntil = r.until; }
        }
        it.ot = `OT-${++otCounter}`;
        this.log('plc', `PLC: ${r.id} a mantenimiento · trabajo reasignado (${it.ot} abierta en GMAO)`);
      }
      if (it.type === 'REDUCE') {
        r.accel = ACCEL_REDUCED; r.accelUntil = this.simTime + it.hours * 3600;
        this.log('plc', `PLC: nuevas trayectorias para ${r.id} · aceleración ejes 2-3 al 88 % durante ${it.hours} h`);
      }
    }
    rec.status = 'APROBADA';
    this.computeLoads();
  }

  reject() {
    if (this.recommendation?.status === 'PENDIENTE') {
      this.recommendation.status = 'RECHAZADA';
      this.log('info', 'Responsable: recomendación rechazada');
    }
  }

  // ── Acciones manuales (HMI) ──────────────────────────────────────────────
  setShare(id, v) { this.robots[id].share = clamp(v, 0, 1); this.computeLoads(); }
  balanceByHealth(cellId) {
    for (const r of this.robotsIn(cellId)) r.share = clamp(1 - r.wear, 0.15, 1);
    this.computeLoads();
    this.log('info', `Reparto por salud aplicado en ${CELLS.find((c) => c.id === cellId).name}`);
  }
  resetShares(cellId) { for (const r of this.robotsIn(cellId)) r.share = 1; this.computeLoads(); }
  startMaintenance(id, minutes = MAINT_MIN) {
    const r = this.robots[id];
    if (r.status !== 'RUN') return;
    r.status = 'MAINT'; r.until = this.simTime + minutes * 60; r.reason = 'Mantenimiento (manual)';
    this.log('plc', `PLC: ${id} a mantenimiento manual (${minutes} min) · OT-${++otCounter}`);
    this.computeLoads();
  }
  setAccel(id, accel, hours = 16) {
    const r = this.robots[id];
    r.accel = accel; r.accelUntil = accel === 1 ? 0 : this.simTime + hours * 3600;
    this.computeLoads();
  }
  forceShift() { this.makeRecommendation(); }

  // ── Línea (reloj visual) ─────────────────────────────────────────────────
  visualStep(dt) {
    const L = this.line;
    const last = STATIONS.length - 1;
    if (L.phase === 'WORK') {
      if (this.lineStopped) return;
      L.time += dt;
      if (L.time >= this.takt - TRANSFER_TIME) {
        for (const p of this.pieces) if (p.station >= 0 && p.station <= last) p.stage = p.station;
        for (const p of this.pieces) p.from = p.station;
        this.pieces.push({ uid: this.uid++, station: -1, from: -1, stage: -1, color: this.pickColor() });
        L.phase = 'TRANSFER'; L.t = 0;
      }
    } else {
      L.t += dt;
      if (L.t >= TRANSFER_TIME) {
        for (const p of this.pieces) p.station = p.from + 1;
        // Los módulos que salen de la última estación pasan al paletizador
        for (const p of this.pieces) if (p.station > last) logistics.lineOutput(p);
        this.pieces = this.pieces.filter((p) => p.station <= last);
        for (const p of this.pieces) p.from = p.station;
        logistics.consumeLayer();      // la cepilladora toma una capa de la pila seca
        L.phase = 'WORK'; L.time = 0;
      }
    }
  }

  /** Progreso 0–1 del trabajo de una estación (celda o máquina) en el ciclo visual actual. */
  cellProgress(id) {
    if (this.line.phase !== 'WORK') return 1;
    const st = STATIONS.find((s) => s.id === id);
    const cycle = st?.fixed ?? this.cells[id]?.cycle ?? 0;
    return cycle > 0 ? clamp(this.line.time / cycle, 0, 1) : 0;
  }

  // ── Instantánea para la interfaz ─────────────────────────────────────────
  snapshot() {
    return {
      simTime: this.simTime, running: this.running, speed: this.speed,
      twinEnabled: this.twinEnabled, autoApprove: this.autoApprove,
      takt: this.takt, lineStopped: this.lineStopped, nextShift: this.nextShift,
      cells: { ...this.cells },
      robots: Object.values(this.robots).map((r) => ({
        id: r.id, cellId: r.cellId, status: r.status, reason: r.reason, until: r.until,
        share: r.share, shareNorm: r.shareNorm, accel: r.accel, accelUntil: r.accelUntil,
        temp: r.temp, measured: r.measured, wear: r.wear, rul: r.rul, i2t: r.i2t,
        duty: r.duty, current: r.current, cycles: r.cycles, rth: r.def.rth, rthEst: r.rthEst,
        hist: r.hist.slice(-120),
      })),
      kpi: { ...this.kpi },
      events: this.events.slice(0, 40),
      recommendation: this.recommendation ? { ...this.recommendation, items: [...this.recommendation.items] } : null,
      logistics: logistics.snapshot(),
    };
  }
}

export function shiftName(t) {
  const h = (t / 3600) % 24;
  return h >= 6 && h < 14 ? 'Turno de mañana' : h >= 14 && h < 22 ? 'Turno de tarde' : 'Turno de noche';
}

export function fmtClock(t) {
  const day = Math.floor(t / 86400) + 1;
  const h = Math.floor((t % 86400) / 3600);
  const m = Math.floor((t % 3600) / 60);
  return `Día ${day} · ${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export const engine = new TwinEngine();
