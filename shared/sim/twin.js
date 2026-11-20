// ─────────────────────────────────────────────────────────────────────────────
// Gemelo de los brazos robóticos: térmico, desgaste, reparto de carga y decisiones.
//
//   S_t  esfuerzo, desgaste en reductores, temperatura de bobinado  → wear, temp
//   O_t  corriente por fase, temperatura medida, alarmas             → current, measured
//   U_t  velocidad (admin), reducción de aceleración (gemelo), reparto, consigna de mant.
//   D_t  R_th calibrada, I²t, factor de fatiga                       → rthEst, i2t
//   Q_t  RUL, riesgo térmico, viabilidad monobrazo                   → rul, whatIf*()
//   R_t  horas sin paradas, cero fallos concurrentes, takt           → kpi del mundo
//
// Térmico de 1.er orden: dT/dt = (T_ss − T)/τ con T_ss = T_amb + K·(R_th/R_nom)·P·(1+0,35·w)²
// donde P = 1 mientras el brazo trabaja (× v², v = velocidad efectiva) y 0 en espera.
// Desgaste tipo Arrhenius: se duplica cada +10 °C y escala con el ciclo y con v².
// ─────────────────────────────────────────────────────────────────────────────
import { CELL_ROBOTS } from '../zones.js';
import { PRODUCTS, ROBOT_CELLS, COSTS } from '../config.js';

export const T_ALARM = 95;
export const T_TRIP = 110;
const TAU = 900;
const K_TH = 58;
const RTH_NOM = 0.43;
const I_NOM = 14;
const WEAR_REF = 1 / 300;            // desgaste/h a ciclo 50 %, 60 °C y v = 1
export const MAINT_MIN = 45;
export const MAINT_TAKT_TOL = 1.35;
const REPAIR_H = 4;
export const ACCEL_REDUCED = 0.88;
export const slowdown = (v) => 1 + 0.65 * (1 / v - 1);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

const MIX0 = { CNC: 55, LIJ: 62, ENS: 90, BAR: 64 };   // contenido de trabajo medio inicial

export class Twin {
  constructor(w, saved = {}) {
    this.w = w;
    this.robots = {};
    for (const def of CELL_ROBOTS) {
      const s = saved.robots?.[def.id] || {};
      this.robots[def.id] = {
        id: def.id, def, cellId: def.cellId, index: def.index,
        status: s.status === 'MAINT' ? 'RUN' : s.status || 'RUN', reason: s.reason || '', until: 0, repairing: false,
        share: s.share ?? 1, speed: s.speed ?? 1, accelF: 1, accelUntil: s.accelUntil || 0,
        temp: s.temp ?? 45, measured: s.temp ?? 45, wear: s.wear ?? def.wear0, i2t: s.i2t || 0,
        duty: s.duty ?? 0.4, current: 0, cycles: s.cycles || 0, rul: 0,
        rthEst: s.rthEst ?? def.rth * 1.04, hist: [], working: false, otId: null,
      };
      if (this.robots[def.id].accelUntil) this.robots[def.id].accelF = ACCEL_REDUCED;
    }
    this.mix = { ...MIX0, ...(saved.mix || {}) };
    this.recommendation = saved.recommendation || null;
    this.histClock = 0;
    this.otCounter = saved.otCounter || 4810;
  }

  serialize() {
    const robots = {};
    for (const r of Object.values(this.robots)) {
      robots[r.id] = { status: r.status === 'FAULT' ? 'FAULT' : 'RUN', reason: r.status === 'FAULT' ? r.reason : '', share: r.share, speed: r.speed, accelUntil: r.accelUntil, temp: r.temp, wear: r.wear, i2t: r.i2t, duty: r.duty, cycles: r.cycles, rthEst: r.rthEst };
    }
    return { robots, mix: this.mix, recommendation: this.recommendation, otCounter: this.otCounter };
  }

  ambient(t = this.w.t) { return 24 + 3 * Math.sin(2 * Math.PI * (t / 86400 - 0.375)); }
  inCell(cellId) { return Object.values(this.robots).filter((r) => r.cellId === cellId); }
  effSpeed(r) { return r.speed * (r.accelUntil > this.w.t ? r.accelF : 1); }

  /** Brazos en marcha de una celda con su parte de la carga (normalizada). */
  active(cellId, overrides = {}) {
    const rs = this.inCell(cellId).map((r) => ({ ...r, ...(overrides[r.id] || {}) }));
    const on = rs.filter((r) => r.status === 'RUN' && r.share > 0);
    const sum = on.reduce((a, r) => a + r.share, 0);
    return on.map((r) => ({ index: r.index, id: r.id, share: r.share / sum, v: r.speed * ((r.accelUntil ?? 0) > this.w.t ? (r.accelF ?? 1) : 1) }));
  }

  /** Tiempo de trabajo de cada brazo de la celda para una pieza. */
  workTimes(cellId, product, act = this.active(cellId)) {
    const W = PRODUCTS[product].work[cellId] || 0;
    const times = {};
    let cycle = 0;
    for (const a of act) { times[a.index] = W * a.share * slowdown(a.v); cycle = Math.max(cycle, times[a.index]); }
    return { times, cycle, W };
  }

  /** Registra el producto procesado para el contenido de trabajo medio (what-if). */
  noteMix(cellId, product) {
    const W = PRODUCTS[product].work[cellId] || 0;
    this.mix[cellId] += (W - this.mix[cellId]) * 0.15;
  }

  steadyTemp(r, p, tamb = this.ambient()) {
    const wf = 1 + 0.35 * r.wear;
    return tamb + (r.def.rth / RTH_NOM) * K_TH * p * wf * wf;
  }
  wearRate(duty, v, temp) { return WEAR_REF * (duty / 0.5) * v * v * Math.pow(2, (temp - 60) / 10); }

  // ── Paso de simulación ───────────────────────────────────────────────────
  step(h) {
    const w = this.w, t = w.t, tamb = this.ambient();
    for (const r of Object.values(this.robots)) {
      const v = this.effSpeed(r);
      const on = r.status === 'RUN';
      const p = on && r.working ? v * v : 0;
      const tss = this.steadyTemp(r, p, tamb);
      r.temp = tss + (r.temp - tss) * Math.exp(-h / TAU);
      r.measured = r.temp + 1.6 * Math.sin(t / 97 + r.index * 2.1);
      const inst = on && r.working ? 1 : 0;
      r.duty += (inst - r.duty) * Math.min(1, h / 600);
      const wf = 1 + 0.35 * r.wear;
      r.current = I_NOM * Math.sqrt(Math.max(0, r.duty)) * v * wf;
      r.i2t += (I_NOM * I_NOM * inst * v * v * wf * wf * h) / 3600;
      if (on) r.wear += (this.wearRate(inst, v, r.temp) * h) / 3600;
      const rate = this.wearRate(Math.max(0.05, r.duty), v, this.steadyTemp(r, r.duty * v * v, tamb));
      r.rul = Math.max(0, (1 - r.wear) / Math.max(rate, 1e-6));
      if (on && r.duty > 0.1) r.rthEst += (r.def.rth - r.rthEst) * Math.min(1, h / 7200);
      if (r.accelUntil && t >= r.accelUntil) {
        r.accelUntil = 0; r.accelF = 1;
        w.log('info', `${r.id}: perfil de aceleración restaurado`);
        w.robotsChanged(r.cellId);
      }

      if (on && r.wear >= 1) this.fault(r, 'Fallo por desgaste en reductora / servomotor', true);
      else if (on && r.temp >= T_TRIP) this.fault(r, `Disparo térmico (${r.temp.toFixed(0)} °C)`, false);
      else if (r.status === 'MAINT' && t >= r.until) this.finishMaintenance(r);
      else if (r.status === 'FAULT') {
        if (!r.needsTech && t >= r.until && r.temp < 70) this.reset(r, 'Rearme tras disparo térmico');
        if (r.needsTech && r.repairing && t >= r.until) {
          r.wear = 0.08;
          w.eco.book('mantenimiento', -COSTS.maintCorr, `Reparación correctiva ${r.id}`);
          w.staff.closeTaskByRef(`CORR:${r.id}`);
          this.reset(r, 'Avería reparada');
        }
      }
    }
    this.histClock += h;
    if (this.histClock >= 180) {
      this.histClock = 0;
      for (const r of Object.values(this.robots)) { r.hist.push([Math.round(t), +r.temp.toFixed(1), +r.wear.toFixed(3)]); if (r.hist.length > 160) r.hist.shift(); }
    }
  }

  fault(r, reason, needsTech) {
    const w = this.w;
    const concurrent = this.inCell(r.cellId).some((o) => o !== r && o.status === 'FAULT');
    r.status = 'FAULT'; r.reason = reason; r.needsTech = needsTech; r.repairing = false;
    r.until = w.t + 20 * 60;
    w.kpi.unplanned++;
    if (concurrent) w.kpi.simultaneous++;
    w.log('err', `${r.id}: PARADA NO PROGRAMADA · ${reason}`);
    if (needsTech) {
      // cerrar OT preventiva pendiente del mismo robot y abrir la correctiva
      w.staff.cancelTaskByRef(`PREV:${r.id}`);
      const id = `OT-${++this.otCounter}`;
      w.staff.addTask({
        type: 'OT_CORR', role: 'mantenimiento', zone: r.cellId, ref: `CORR:${r.id}`, ot: id, urgent: true,
        title: `${id} · Reparar ${r.id}`, detail: `${reason}. Reparación estimada ${REPAIR_H} h. Coste ${COSTS.maintCorr} €.`,
      });
    }
    w.robotsChanged(r.cellId);
  }

  reset(r, msg) {
    r.status = 'RUN'; r.reason = ''; r.needsTech = false; r.repairing = false;
    this.w.log('ok', `${r.id}: ${msg} · vuelve a producción`);
    this.w.robotsChanged(r.cellId);
  }

  startRepair(robotId) {
    const r = this.robots[robotId];
    if (!r || r.status !== 'FAULT' || r.repairing) return false;
    r.repairing = true; r.until = this.w.t + REPAIR_H * 3600;
    this.w.log('plc', `${r.id}: técnico en la celda · reparación en curso (${REPAIR_H} h)`);
    return true;
  }

  startMaintenance(robotId, minutes = MAINT_MIN) {
    const r = this.robots[robotId];
    if (!r || r.status !== 'RUN') return false;
    r.status = 'MAINT'; r.until = this.w.t + minutes * 60; r.reason = 'Mantenimiento preventivo';
    this.w.log('plc', `PLC: ${r.id} parado para mantenimiento · trabajo reasignado al resto de la celda`);
    this.w.robotsChanged(r.cellId);
    return true;
  }

  finishMaintenance(r) {
    r.status = 'RUN'; r.wear = Math.max(0.05, r.wear * 0.18); r.reason = '';
    this.w.kpi.maint++;
    this.w.eco.book('mantenimiento', -COSTS.maintPrev, `Mantenimiento preventivo ${r.id}`);
    this.w.staff.closeTaskByRef(`PREV:${r.id}`);
    this.w.log('ok', `${r.id}: mantenimiento preventivo terminado · vuelve a producción`);
    this.w.robotsChanged(r.cellId);
  }

  // ── ¿Qué pasaría si…? ────────────────────────────────────────────────────
  evaluate(overrides = {}) {
    const w = this.w;
    const res = { cells: {}, robots: {}, blocked: false };
    let maxCycle = w.settings.cepTime || 28;
    for (const cellId of ROBOT_CELLS) {
      const act = this.active(cellId, overrides);
      const W = this.mix[cellId];
      let cycle = 0;
      for (const r of this.inCell(cellId)) res.robots[r.id] = { share: 0, work: 0 };
      for (const a of act) {
        const work = W * a.share * slowdown(a.v);
        res.robots[a.id] = { share: a.share, work, v: a.v };
        cycle = Math.max(cycle, work);
      }
      const n = this.inCell(cellId).length;
      res.cells[cellId] = { cycle, active: act.length, mode: !act.length ? 'PARADA' : act.length === 1 && n > 1 ? 'MONOBRAZO' : act.length < n ? `REPARTO (${act.length}/${n})` : 'REPARTO' };
      if (!act.length) res.blocked = true;
      maxCycle = Math.max(maxCycle, cycle);
    }
    res.takt = Math.max(w.settings.pace, maxCycle + w.line.transferEstimate());
    for (const id in res.robots) res.robots[id].duty = res.blocked ? 0 : res.robots[id].work / res.takt;
    return res;
  }

  whatIfStop(robotId, minutes = MAINT_MIN, accelOthers = 1) {
    const r = this.robots[robotId];
    const ov = { [robotId]: { status: 'MAINT' } };
    if (accelOthers !== 1) for (const o of this.inCell(r.cellId)) if (o !== r) ov[o.id] = { accelUntil: this.w.t + 1e9, accelF: accelOthers };
    const ev = this.evaluate(ov);
    const tsec = minutes * 60;
    const others = this.inCell(r.cellId).filter((o) => o !== r && o.status === 'RUN').map((o) => {
      const e = ev.robots[o.id];
      const v = e.v || this.effSpeed(o);
      const tss = this.steadyTemp(o, e.duty * v * v);
      const tEnd = tss + (o.temp - tss) * Math.exp(-tsec / TAU);
      return { id: o.id, share: e.share, duty: e.duty, tss, peak: Math.max(o.temp, tEnd) };
    });
    const peak = Math.max(0, ...others.map((o) => o.peak));
    const pace = this.w.settings.pace;
    const taktOk = !ev.blocked && ev.takt <= pace * MAINT_TAKT_TOL + 0.01;     // se acepta perder algo de ritmo durante la parada
    return {
      robotId, minutes, accelOthers, others, mode: ev.cells[r.cellId].mode, takt: ev.takt, pace,
      taktOk, thermalOk: others.length > 0 && peak < T_ALARM, ok: taktOk && others.length > 0 && peak < T_ALARM, peak,
    };
  }

  whatIfSpeed(robotId, factor = ACCEL_REDUCED, hours = 16) {
    const r = this.robots[robotId];
    const now = this.evaluate();
    const red = this.evaluate({ [robotId]: { accelUntil: this.w.t + 1e9, accelF: factor } });
    const v0 = this.effSpeed(r), v1 = r.speed * factor;
    const d0 = now.robots[robotId].duty, d1 = red.robots[robotId].duty;
    const T0 = this.steadyTemp(r, d0 * v0 * v0), T1 = this.steadyTemp(r, d1 * v1 * v1);
    const rate0 = Math.max(this.wearRate(d0, v0, T0), 1e-6), rate1 = this.wearRate(d1, v1, T1);
    const rul0 = (1 - r.wear) / rate0;
    const rul1 = hours + Math.max(0, 1 - r.wear - rate1 * hours) / rate0;
    return { robotId, factor, hours, T0, T1, rul0, rul1, gain: rul1 - rul0, takt: red.takt, taktOk: red.takt <= this.w.settings.pace + 0.01 };
  }

  makeRecommendation() {
    const w = this.w;
    const items = [];
    for (const cellId of ROBOT_CELLS) {
      const rs = this.inCell(cellId);
      if (rs.some((r) => r.status !== 'RUN')) continue;
      if (rs.some((r) => w.staff.openTaskByRef(`PREV:${r.id}`))) continue;      // ya hay una OT abierta
      const cand = rs.reduce((a, b) => (b.wear > a.wear ? b : a));
      if (cand.wear < 0.45 && cand.rul > 500) continue;
      let wi = this.whatIfStop(cand.id, MAINT_MIN, 1);
      if (!wi.ok) { const w2 = this.whatIfStop(cand.id, MAINT_MIN, ACCEL_REDUCED); if (w2.ok) wi = w2; }
      if (wi.ok) {
        items.push({
          type: 'MAINT', cellId, robotId: cand.id, minutes: MAINT_MIN, accelOthers: wi.accelOthers,
          text: `Mantenimiento preventivo de ${cand.id} (${MAINT_MIN} min). ${wi.mode === 'MONOBRAZO' ? 'Ciclo monobrazo' : 'Reparto'} en el resto${wi.accelOthers !== 1 ? ' con aceleración −12 %' : ''}: takt ${wi.takt.toFixed(1)} s${wi.takt > wi.pace + 0.5 ? ` (−${Math.round((1 - wi.pace / wi.takt) * 100)} % de ritmo durante la parada)` : ''}, pico ${wi.peak.toFixed(0)} °C.`,
        });
      } else {
        const a = this.whatIfSpeed(cand.id, ACCEL_REDUCED, 16);
        items.push({
          type: 'REDUCE', cellId, robotId: cand.id, hours: 16,
          text: `Sin margen para parar ${cand.id} (pico ${wi.peak.toFixed(0)} °C · takt ${wi.takt.toFixed(1)} s). Reducir aceleración ejes 2-3 un 12 % durante 16 h: +${a.gain.toFixed(0)} h de vida útil.`,
        });
      }
    }
    this.recommendation = { at: w.t, items, status: items.length ? 'PENDIENTE' : 'SIN ACCIONES' };
    if (items.length) {
      w.log('twin', `Gemelo: ${items.length} recomendación(es) para el turno · pendiente de aprobación del jefe de turno`);
      w.staff.addTask({ type: 'APROBAR', role: 'jefe', zone: 'CTRL', ref: `REC:${w.t}`, title: 'Aprobar decisión de turno del gemelo', detail: items.map((i) => i.text).join('\n') });
    } else w.log('twin', 'Gemelo: sin acciones necesarias este turno');
  }

  approve(byName = 'Responsable') {
    const w = this.w, rec = this.recommendation;
    if (!rec || rec.status !== 'PENDIENTE') return false;
    for (const it of rec.items) {
      const r = this.robots[it.robotId];
      if (it.type === 'MAINT') {
        const id = `OT-${++this.otCounter}`;
        it.ot = id;
        if (it.accelOthers !== 1) for (const o of this.inCell(r.cellId)) if (o !== r) { o.accelF = it.accelOthers; o.accelUntil = w.t + 3 * 3600; }
        w.staff.addTask({
          type: 'OT_PREV', role: 'mantenimiento', zone: r.cellId, ref: `PREV:${r.id}`, ot: id,
          title: `${id} · Preventivo ${r.id}`, detail: `Autorizar la parada física en la HMI. ${it.minutes} min · el PLC reasigna el trabajo al resto de la celda.`,
        });
        w.log('plc', `${byName} aprueba · ${id} abierta en GMAO para ${r.id}`);
      }
      if (it.type === 'REDUCE') {
        r.accelF = ACCEL_REDUCED; r.accelUntil = w.t + it.hours * 3600;
        w.log('plc', `PLC: nuevas trayectorias para ${r.id} · aceleración ejes 2-3 al 88 % durante ${it.hours} h`);
        w.robotsChanged(r.cellId);
      }
    }
    rec.status = 'APROBADA'; rec.by = byName;
    w.staff.closeTaskByRef(`REC:${rec.at}`);
    return true;
  }

  reject(byName = 'Responsable') {
    const rec = this.recommendation;
    if (rec?.status !== 'PENDIENTE') return false;
    rec.status = 'RECHAZADA'; rec.by = byName;
    this.w.staff.closeTaskByRef(`REC:${rec.at}`);
    this.w.log('info', `${byName} rechaza la recomendación del gemelo`);
    return true;
  }

  energyPerHour() {
    let e = 0;
    for (const r of Object.values(this.robots)) if (r.status === 'RUN') { const v = this.effSpeed(r); e += COSTS.energy.robot * (0.15 + r.duty) * v * v; }
    return e;
  }

  snapshotRobots() {
    const out = {};
    for (const r of Object.values(this.robots)) {
      out[r.id] = {
        id: r.id, cellId: r.cellId, index: r.index, status: r.status, reason: r.reason, until: r.until, repairing: r.repairing,
        share: r.share, speed: r.speed, accelF: r.accelUntil > this.w.t ? r.accelF : 1, accelUntil: r.accelUntil,
        temp: +r.temp.toFixed(2), measured: +r.measured.toFixed(2), wear: +r.wear.toFixed(4), rul: Math.round(r.rul), i2t: Math.round(r.i2t),
        duty: +r.duty.toFixed(3), current: +r.current.toFixed(2), cycles: Math.floor(r.cycles), rth: r.def.rth, rthEst: +r.rthEst.toFixed(4),
      };
    }
    return out;
  }
}

export { clamp };
