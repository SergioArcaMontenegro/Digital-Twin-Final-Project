// ─────────────────────────────────────────────────────────────────────────────
// Economía de la empresa: caja, libro de movimientos, mercado de madera, compras,
// pedidos de clientes y plan de producción (órdenes de fabricación).
// ─────────────────────────────────────────────────────────────────────────────
import {
  SPECIES, SPECIES_IDS, PRODUCTS, PRODUCT_IDS, TONES, COSTS, CLIENTS, START_CASH, unitPrice,
  BOARDS_PER_LOG, LINE_STATIONS, fmtEur,
} from '../config.js';

const CAT = { venta: 'Ventas', madera: 'Compra de madera', transporte: 'Transporte', salarios: 'Salarios', energia: 'Energía', mantenimiento: 'Mantenimiento', penalizacion: 'Penalizaciones', otros: 'Otros' };
export const CATEGORIES = CAT;
/** Stock mínimo (referencias en acabado natural) que se fabrica cuando no hay pedidos. */
export const STOCK_TARGETS = [['silla', 'pino', 16], ['tablon', 'pino', 24], ['estanteria', 'pino', 9], ['mesa', 'pino', 6], ['silla', 'haya', 8], ['mesa', 'roble', 4]];

export class Economy {
  constructor(w, s = {}) {
    this.w = w;
    this.cash = s.cash ?? START_CASH;
    this.ledger = s.ledger || [];
    this.days = s.days || {};
    this.cashHist = s.cashHist || [[w.t, this.cash]];
    this.market = s.market || Object.fromEntries(SPECIES_IDS.map((k) => [k, 1]));
    this.purchases = (s.purchases || []).map((p) => (p.status === 'RECIBIDO' || p.status === 'EN_CAMINO' ? p : { ...p, status: 'EN_CAMINO', eta: w.t + 600 }));
    this.orders = s.orders || [];
    this.plan = s.plan || [];
    this.seq = s.seq || { order: 1040, po: 210, purchase: 300 };
    this.acc = { salarios: 0, energia: 0 };
    this.nextOrderAt = s.nextOrderAt ?? w.t + 600;
    this.nextHour = Math.ceil(w.t / 3600) * 3600;
    this.nextMarket = Math.ceil(w.t / 86400) * 86400;
    this.nextAutoBuy = w.t + 300;
    if (!s.orders) this.seed();
  }

  serialize() {
    const { cash, ledger, days, cashHist, market, purchases, orders, plan, seq, nextOrderAt } = this;
    return { cash, ledger: ledger.slice(0, 300), days, cashHist: cashHist.slice(-400), market, purchases: purchases.slice(-80), orders: orders.slice(-200), plan, seq, nextOrderAt };
  }

  rng() { return this.w.rng(); }

  seed() {
    const t = this.w.t;
    const mk = (client, product, species, tone, qty, dueH, status) => {
      const o = this.newOrder({ client, product, species, tone, qty, due: t + dueH * 3600 });
      o.status = 'OFERTA';
      if (status === 'ACEPTADO') this.acceptOrder(o.id, 'Comercial', true);
      else this.offerTask(o);
      return o;
    };
    mk('Escuelas del Valle', 'silla', 'pino', 'natural', 24, 10, 'ACEPTADO');
    mk('Hostelería Brisa', 'mesa', 'roble', 'miel', 6, 14, 'ACEPTADO');
    mk('Bricolaje Centro', 'tablon', 'pino', 'natural', 18, 8, 'ACEPTADO');
    mk('Casa Olmo', 'estanteria', 'haya', 'natural', 9, 20, 'OFERTA');
    mk('Interiores Vega', 'silla', 'nogal', 'nogal', 8, 30, 'OFERTA');
  }

  book(cat, amount, desc) {
    if (!amount) return;
    this.cash += amount;
    const t = this.w.t;
    this.ledger.unshift({ t, cat, amount: Math.round(amount * 100) / 100, desc });
    if (this.ledger.length > 400) this.ledger.length = 400;
    const day = Math.floor(t / 86400) + 1;
    const d = (this.days[day] ||= {});
    d[cat] = Math.round(((d[cat] || 0) + amount) * 100) / 100;
  }

  // ── Paso ─────────────────────────────────────────────────────────────────
  step(h) {
    const w = this.w, t = w.t;
    // salarios (trabajadores en turno) y energía, contabilizados cada hora
    let wages = 0;
    for (const u of w.staff.crew()) wages += COSTS.wage[u.role] || 0;
    this.acc.salarios += (wages * h) / 3600;
    let energy = COSTS.energy.base + w.twin.energyPerHour();
    if (w.logistics.kiln.stacks.some((s) => s.left > 0)) energy += COSTS.energy.kiln;
    if (w.logistics.saw.state === 'CUT') energy += COSTS.energy.saw;
    if (!w.line.idle) energy += COSTS.energy.line;
    this.acc.energia += (energy * h) / 3600;
    if (t >= this.nextHour) {
      this.nextHour += 3600;
      if (this.acc.salarios > 0.5) this.book('salarios', -this.acc.salarios, `Salarios · ${w.staff.crew().length} personas en turno`);
      this.book('energia', -this.acc.energia, 'Energía eléctrica y térmica');
      this.acc = { salarios: 0, energia: 0 };
      this.cashHist.push([t, Math.round(this.cash)]);
      if (this.cashHist.length > 600) this.cashHist.shift();
    }
    // mercado de la madera (cambia cada día)
    if (t >= this.nextMarket) {
      this.nextMarket += 86400;
      for (const k of SPECIES_IDS) this.market[k] = Math.min(1.35, Math.max(0.8, this.market[k] * (0.94 + this.rng() * 0.12)));
    }
    // pedidos de clientes
    if (t >= this.nextOrderAt) {
      this.nextOrderAt = t + (8 + this.rng() * 17) * 60;
      const hh = (t / 3600) % 24;
      if (hh >= 7 && hh < 20) this.generateOrder();       // los clientes piden en horario comercial
    }
    for (const o of this.orders) {
      if (o.status === 'OFERTA' && t > o.expires) {
        o.status = 'CADUCADA';
        w.staff.cancelTaskByRef(`OFERTA:${o.id}`);
        w.log('warn', `Pedido ${o.id} de ${o.client} caducado sin respuesta`);
      }
      if (['ACEPTADO', 'EN_PRODUCCION', 'LISTO'].includes(o.status) && t > o.due && !o.lateWarned) {
        o.lateWarned = true;
        w.log('warn', `Pedido ${o.id} (${o.client}) fuera de plazo · se aplicará un −${COSTS.latePenalty * 100} %`);
      }
    }
    // compras automáticas de troncos
    if (w.settings.autoBuy && t >= this.nextAutoBuy) { this.nextAutoBuy = t + 900; this.autoBuy(); }
    // fabricación para stock cuando el plan se queda corto
    if (w.settings.autoStock && t >= (this.nextStock || 0)) { this.nextStock = t + 600; this.autoStock(); }
  }

  // ── Mercado y compras ─────────────────────────────────────────────────────
  logPrice(species) { return Math.round(SPECIES[species].log * this.market[species] * 100) / 100; }
  purchase(id) { return this.purchases.find((p) => p.id === id); }
  inTransit(species) { return this.purchases.filter((p) => p.species === species && p.status !== 'RECIBIDO').reduce((a, p) => a + p.logs, 0); }

  buyLogs(species, logs, by = 'Gerencia') {
    logs = Math.max(1, Math.min(12, Math.round(logs)));
    if (!SPECIES[species]) return { ok: false, error: 'Especie desconocida' };
    const unit = this.logPrice(species);
    const cost = unit * logs;
    if (this.cash < cost + COSTS.logTransport) return { ok: false, error: 'No hay caja suficiente' };
    const id = `C-${++this.seq.purchase}`;
    const eta = this.w.t + (40 + this.rng() * 50) * 60;
    this.purchases.push({ id, species, logs, unit, cost, t: this.w.t, eta, status: 'EN_CAMINO', by });
    this.book('madera', -cost, `${id} · ${logs} troncos de ${SPECIES[species].name.toLowerCase()} a ${unit.toFixed(2)} €`);
    this.book('transporte', -COSTS.logTransport, `${id} · transporte`);
    this.w.log('info', `Compra ${id}: ${logs} troncos de ${SPECIES[species].name.toLowerCase()} (${fmtEur(cost + COSTS.logTransport)}) · llegada prevista en ${Math.round((eta - this.w.t) / 60)} min`);
    return { ok: true, id };
  }

  /**
   * Compras automáticas: troncos para cubrir el plan (menos lo que ya hay en tablas) más
   * un colchón en el patio (mayor para el pino, la especie de más rotación).
   */
  autoBuy() {
    const L = this.w.logistics;
    for (const s of SPECIES_IDS) {
      const need = L.boardsNeeded(s);
      const cushion = s === 'pino' ? 12 : need > 0 ? 6 : 0;
      const target = Math.ceil(Math.max(0, need + 36 - L.boardsAvailable(s)) / BOARDS_PER_LOG) + cushion;
      let missing = Math.min(30, target) - (L.yard[s] + this.inTransit(s));
      let trucks = 0;
      while (missing > 0 && trucks < 2) {
        const logs = Math.min(12, Math.max(6, missing));
        if (!this.buyLogs(s, logs, 'Compras automáticas').ok) break;
        missing -= logs; trucks++;
      }
    }
  }

  /** Mantiene un stock mínimo de las referencias más vendidas si el plan se queda sin trabajo. */
  autoStock() {
    const pending = this.plan.reduce((a, p) => a + (p.status === 'CANCELADA' ? 0 : Math.max(0, p.qty - p.started)), 0);
    if (pending >= 14) return;
    const L = this.w.logistics;
    const free = {};
    for (const p of Object.values(L.slots)) if (p && !p.orderId) free[`${p.product}|${p.species}|${p.tone}`] = (free[`${p.product}|${p.species}|${p.tone}`] || 0) + p.units;
    for (const p of this.plan) if (!p.orderId && p.status !== 'CANCELADA' && p.status !== 'HECHA') free[`${p.product}|${p.species}|${p.tone}`] = (free[`${p.product}|${p.species}|${p.tone}`] || 0) + p.qty - p.done;
    const cand = STOCK_TARGETS.map(([product, species, target]) => ({ product, species, gap: target - (free[`${product}|${species}|natural`] || 0) }))
      .filter((c) => c.gap > 0)
      .sort((a, b) => (L.boardsAvailable(b.species) > 0) - (L.boardsAvailable(a.species) > 0) || b.gap - a.gap)[0];
    if (!cand) return;
    const qty = PRODUCTS[cand.product].perPallet * Math.max(1, Math.min(3, Math.round(cand.gap / PRODUCTS[cand.product].perPallet)));
    this.addPO({ product: cand.product, species: cand.species, tone: 'natural', qty }, true);
    this.w.log('info', `Plan: orden para stock de ${qty} ${PRODUCTS[cand.product].unit} de ${SPECIES[cand.species].name.toLowerCase()} (stock mínimo)`);
  }

  // ── Pedidos de clientes ───────────────────────────────────────────────────
  order(id) { return this.orders.find((o) => o.id === id); }

  newOrder({ client, product, species, tone, qty, due, price }) {
    const t = this.w.t;
    const o = {
      id: `P-${++this.seq.order}`, client, product, species, tone, qty,
      unitPrice: price ?? Math.round(unitPrice(product, species) * (0.92 + this.rng() * 0.28) * 100) / 100,
      created: t, expires: t + 14 * 3600, due, status: 'OFERTA',
      allocated: 0, produced: 0, shipped: 0, revenue: 0,
    };
    this.orders.push(o);
    return o;
  }

  generateOrder() {
    const r = () => this.rng();
    const pick = (arr, wts) => { let x = r() * wts.reduce((a, b) => a + b, 0); for (let i = 0; i < arr.length; i++) { x -= wts[i]; if (x <= 0) return arr[i]; } return arr[0]; };
    const product = pick(PRODUCT_IDS, [3, 4, 2, 2]);
    const species = pick(['pino', 'haya', 'roble', 'nogal'], [5, 3, 3, 1]);
    const tone = product === 'tablon' ? 'natural' : pick(Object.keys(TONES), [5, 2, 2, 1, 1]);
    const per = PRODUCTS[product].perPallet;
    const range = { tablon: [2, 7], silla: [3, 10], mesa: [2, 7], estanteria: [2, 6] }[product];
    const qty = per * (range[0] + Math.floor(r() * (range[1] - range[0] + 1)));
    const due = this.w.t + (6 + r() * 30) * 3600;
    const o = this.newOrder({ client: CLIENTS[Math.floor(r() * CLIENTS.length)], product, species, tone, qty, due });
    this.w.log('info', `Nuevo pedido ${o.id}: ${o.client} · ${qty} ${PRODUCTS[product].unit} de ${SPECIES[species].name.toLowerCase()} · ${fmtEur(o.qty * o.unitPrice)}`);
    this.offerTask(o);
  }

  offerTask(o) {
    this.w.staff.addTask({ type: 'OFERTA', role: 'comercial', zone: 'CTRL', ref: `OFERTA:${o.id}`, title: `Responder al pedido ${o.id} de ${o.client}`, detail: `${o.qty} ${PRODUCTS[o.product].unit} de ${SPECIES[o.species].name.toLowerCase()} (${TONES[o.tone].name.toLowerCase()}) · ${o.unitPrice.toFixed(2)} €/ud · total ${fmtEur(o.qty * o.unitPrice)}` });
  }

  acceptOrder(id, by = 'Gerencia', silent = false) {
    const w = this.w, o = this.order(id);
    if (!o || o.status !== 'OFERTA') return { ok: false, error: 'El pedido ya no está pendiente' };
    o.status = 'ACEPTADO'; o.acceptedBy = by; o.accepted = w.t;
    // 1 · servir desde stock (palés completos de la misma referencia)
    for (const [k, p] of Object.entries(w.logistics.slots)) {
      if (!p || p.orderId || p.product !== o.product || p.species !== o.species || p.tone !== o.tone) continue;
      if (o.allocated + p.units > o.qty) continue;
      p.orderId = o.id; o.allocated += p.units; o.produced += p.units;
      if (o.allocated >= o.qty) break;
    }
    // 2 · fabricar el resto
    const rest = o.qty - o.allocated;
    if (rest > 0) this.addPO({ product: o.product, species: o.species, tone: o.tone, qty: rest, orderId: o.id }, true);
    else o.status = 'LISTO';
    w.staff.closeTaskByRef(`OFERTA:${o.id}`);
    if (!silent) w.log('ok', `${by} acepta el pedido ${o.id}${o.allocated ? ` (${o.allocated} uds desde stock)` : ''}`);
    return { ok: true };
  }

  rejectOrder(id, by = 'Gerencia') {
    const o = this.order(id);
    if (!o || o.status !== 'OFERTA') return { ok: false, error: 'El pedido ya no está pendiente' };
    o.status = 'RECHAZADO';
    this.w.staff.closeTaskByRef(`OFERTA:${o.id}`);
    this.w.log('info', `${by} rechaza el pedido ${o.id}`);
    return { ok: true };
  }

  // ── Plan de producción ────────────────────────────────────────────────────
  addPO({ product, species, tone = 'natural', qty, orderId = null, route }, silent = false) {
    if (!PRODUCTS[product] || !SPECIES[species] || !(qty > 0)) return { ok: false, error: 'Datos de la orden incorrectos' };
    const po = {
      id: `OF-${++this.seq.po}`, product, species, tone: TONES[tone] ? tone : 'natural', qty: Math.round(qty), started: 0, done: 0,
      orderId, route: route?.length ? LINE_STATIONS.filter((s) => route.includes(s) || s === 'CEP' || s === 'PAL') : PRODUCTS[product].route.slice(),
      status: 'PENDIENTE', created: this.w.t,
    };
    // las órdenes de pedido se ordenan por fecha de entrega; las de stock van al final
    if (orderId) {
      const due = this.order(orderId)?.due ?? Infinity;
      const i = this.plan.findIndex((p) => p.status !== 'HECHA' && (!p.orderId || (this.order(p.orderId)?.due ?? Infinity) > due) && p.started === 0);
      if (i < 0) this.plan.push(po); else this.plan.splice(i, 0, po);
    } else this.plan.push(po);
    if (!silent) this.w.log('info', `Orden de fabricación ${po.id}: ${po.qty} ${PRODUCTS[product].unit} de ${SPECIES[species].name.toLowerCase()}${orderId ? ` para ${orderId}` : ' para stock'}`);
    return { ok: true, id: po.id };
  }
  po(id) { return this.plan.find((p) => p.id === id); }
  movePO(id, dir) {
    const i = this.plan.findIndex((p) => p.id === id), j = i + dir;
    if (i < 0 || j < 0 || j >= this.plan.length) return { ok: false };
    [this.plan[i], this.plan[j]] = [this.plan[j], this.plan[i]];
    return { ok: true };
  }
  cancelPO(id) {
    const p = this.po(id);
    if (!p || p.status === 'HECHA') return { ok: false, error: 'No se puede cancelar' };
    if (p.orderId) return { ok: false, error: 'Es de un pedido de cliente: no se puede cancelar' };
    p.qty = p.started; p.status = p.started ? 'EN_CURSO' : 'CANCELADA';
    return { ok: true };
  }
  setRoute(id, route) {
    const p = this.po(id);
    if (!p) return { ok: false };
    const opt = PRODUCTS[p.product].optional;
    const base = PRODUCTS[p.product].route.filter((s) => !opt.includes(s));
    p.route = LINE_STATIONS.filter((s) => base.includes(s) || (opt.includes(s) && route.includes(s)));
    return { ok: true };
  }
  setTone(id, tone) { const p = this.po(id); if (!p || !TONES[tone] || p.started) return { ok: false }; p.tone = tone; return { ok: true }; }

  /** Siguiente unidad para la línea según el plan y la madera de la pila de la cepilladora. */
  nextUnit() {
    const pad = this.w.logistics.dryPad;
    for (const po of this.plan) {
      if (po.status === 'CANCELADA' || po.started >= po.qty) continue;
      const b = PRODUCTS[po.product].boards;
      if (pad.species === po.species && pad.boards >= b) {
        pad.boards -= b;
        po.started++; po.status = 'EN_CURSO';
        const o = po.orderId && this.order(po.orderId);
        if (o && o.status === 'ACEPTADO') o.status = 'EN_PRODUCCION';
        return { product: po.product, species: po.species, tone: po.tone, poId: po.id, orderId: po.orderId, route: po.route.slice() };
      }
    }
    return null;
  }

  unitDone(item) {
    const po = this.po(item.poId);
    if (po) { po.done++; if (po.done >= po.qty) po.status = 'HECHA'; }
    const o = item.orderId && this.order(item.orderId);
    if (o) { o.produced++; if (o.produced >= o.qty && o.status !== 'ENVIADO') o.status = 'LISTO'; }
  }

  /** Ingresos al salir el camión. */
  ship(pallets) {
    const t = this.w.t;
    let total = 0;
    for (const p of pallets) {
      const o = this.order(p.orderId);
      if (!o) continue;
      const late = t > o.due;
      const amount = p.units * o.unitPrice * (late ? 1 - COSTS.latePenalty : 1);
      o.shipped += p.units; o.revenue += amount; total += amount;
      this.book('venta', amount, `${o.id} · ${o.client} · ${p.units} ${PRODUCTS[o.product].unit}${late ? ' (con retraso −25 %)' : ''}`);
      if (o.shipped >= o.qty) { o.status = 'ENVIADO'; o.deliveredAt = t; o.late = late; }
    }
    return total;
  }

  summary() {
    const day = Math.floor(this.w.t / 86400) + 1;
    return {
      cash: Math.round(this.cash * 100) / 100, today: this.days[day] || {}, yesterday: this.days[day - 1] || {},
      market: Object.fromEntries(SPECIES_IDS.map((k) => [k, this.logPrice(k)])),
      cashHist: this.cashHist.slice(-200), ledger: this.ledger.slice(0, 60), days: this.days,
    };
  }
}
