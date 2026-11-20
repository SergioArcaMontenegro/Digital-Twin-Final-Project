// ─────────────────────────────────────────────────────────────────────────────
// Plantilla: usuarios, funciones, turnos, puestos, tareas, incidencias y avatares 3D.
//
// · Cada trabajador tiene usuario + PIN, función, turno y la zona a la que le manda
//   el administrador. Solo está en planta durante su turno (y cobra por ello).
// · Un puesto (POSTS) sin nadie de la función adecuada detiene lo que controla.
// · Las tareas se asignan por función. Si nadie las hace desde la app y el ajuste
//   «trabajadores simulados» está activo, el trabajador de ese turno las hace solo.
// ─────────────────────────────────────────────────────────────────────────────
import { ROLES, SHIFTS, POSTS, onShift, shiftKey, currentShift, PRODUCTS } from '../config.js';
import { ZONES, ZONE_IDS } from '../zones.js';

/** Hash sencillo (FNV-1a de 53 bits) para no guardar PIN en claro. */
export function hashPin(pin, salt = 'madera') {
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  const s = `${salt}:${pin}`;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 2654435761); h2 = Math.imul(h2 ^ c, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

const DEFAULT_ZONE = { gerente: 'CTRL', jefe: 'CTRL', comercial: 'CTRL', aserrador: 'ASE', cepillador: 'CEP', mecanizado: 'CNC', montaje: 'ENS', logistica: 'PAL', mantenimiento: 'MANT' };
const CREW = {
  M: [['Marta Iglesias', 'jefe'], ['Carlos Ruiz', 'aserrador'], ['Lucía Gómez', 'cepillador'], ['Andrés Molina', 'mecanizado'], ['Elena Navarro', 'montaje'], ['David Ortega', 'logistica'], ['Pablo Serrano', 'mantenimiento']],
  T: [['Javier Castro', 'jefe'], ['Rosa Medina', 'aserrador'], ['Iván Prieto', 'cepillador'], ['Nuria Campos', 'mecanizado'], ['Óscar Vidal', 'montaje'], ['Sara León', 'logistica'], ['Raúl Herrera', 'mantenimiento']],
  N: [['Beatriz Gil', 'jefe'], ['Tomás Rey', 'aserrador'], ['Alba Fuentes', 'cepillador'], ['Hugo Pascual', 'mecanizado'], ['Irene Lozano', 'montaje'], ['Marcos Cano', 'logistica'], ['Luis Moreno', 'mantenimiento']],
};
const username = (name) => {
  const plain = name.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().split(' ');
  return `${plain[0][0]}${plain[plain.length - 1]}`;
};

export const ADMIN_USER = 'digitaltwins';
export const ADMIN_PASS = 'digitaltwins2026';
const DEMO_USERNAMES = new Set(['admin', 'cibanez', ...Object.values(CREW).flat().map(([n]) => username(n))]);



/** Al empezar solo existe la cuenta de gerencia: los trabajadores los da de alta la administración. */
export function defaultUsers() {
  return [{ id: 'u0', name: 'Gerencia', username: ADMIN_USER, pin: hashPin(ADMIN_PASS), role: 'gerente', shift: 'D', zone: 'CTRL', active: true }];
}

const AUTO_DELAY = { APROBAR: 8, OT_PREV: 6, OT_CORR: 4, RECEPCION: 5, EXPEDICION: 5, OFERTA: 12 };
export const DOOR = [0, 29.0];

const validPass = (p) => typeof p === 'string' ? p.length >= 4 && p.length <= 32 : false;

export class Staff {
  constructor(w, s = {}) {
    this.w = w;
    this.users = s.users || defaultUsers();
    // migración desde versiones con usuarios de demostración: se quitan y se fija la cuenta de gerencia
    this.users = this.users.filter((u) => u.role === 'gerente' || !DEMO_USERNAMES.has(u.username) || u.pin !== hashPin('1234'));
    const boss = this.users.find((u) => u.role === 'gerente');
    if (!boss) this.users.unshift(defaultUsers()[0]);
    else if (boss.username === 'admin') Object.assign(boss, { username: ADMIN_USER, pin: hashPin(ADMIN_PASS) });
    this.tasks = (s.tasks || []).filter((t) => t.status === 'HECHA' || ['OFERTA', 'APROBAR', 'OT_PREV', 'OT_CORR'].includes(t.type))
      .map((t) => (t.status === 'EN_CURSO' ? { ...t, status: 'PENDIENTE', by: undefined } : t)).slice(-80);
    this.incidents = s.incidents || [];
    this.stats = s.stats || {};          // userId → { shiftKey: unidades }
    this.seq = s.seq || { task: 1, inc: 1, user: this.users.length + 1 };
    this.avatars = {};
    this.posts = {};
    this.recalcPosts();
  }

  serialize() {
    return { users: this.users, tasks: this.tasks.slice(-80), incidents: this.incidents.slice(-60), stats: this.stats, seq: this.seq };
  }

  user(id) { return this.users.find((u) => u.id === id); }
  byUsername(name) { return this.users.find((u) => u.username.toLowerCase() === String(name).toLowerCase() && u.active); }
  present(u) { return u.active && u.role !== 'gerente' && onShift(u.shift, this.w.t); }
  presentUsers() { return this.users.filter((u) => this.present(u)); }

  /**
   * Personal simulado: si un puesto (o jefatura/mantenimiento/comercial) no tiene a nadie de
   * la plantilla en turno y el ajuste «autoCrew» está activo, lo cubre un operario simulado
   * (sin acceso a las apps, cobra igual). Así la planta funciona mientras se da de alta a la gente.
   */
  simCrew() {
    if (!this.w.settings.autoCrew) return [];
    const pres = this.presentUsers();
    const out = [];
    const sh = currentShift(this.w.t);
    for (const p of POSTS) {
      if (pres.some((u) => u.role === p.role && p.zones.includes(u.zone))) continue;
      out.push({ id: `sim-${p.id}`, name: `Operario simulado (${p.name})`, role: p.role, zone: p.zones[0], shift: sh, sim: true, active: true });
    }
    for (const role of ['jefe', 'mantenimiento']) {
      if (!pres.some((u) => u.role === role)) out.push({ id: `sim-${role}`, name: `${ROLES[role].name} (simulado)`, role, zone: role === 'jefe' ? 'CTRL' : 'MANT', shift: sh, sim: true, active: true });
    }
    const h = (this.w.t / 3600) % 24;
    if (h >= 8 && h < 17 && !pres.some((u) => u.role === 'comercial')) out.push({ id: 'sim-comercial', name: 'Comercial (simulado)', role: 'comercial', zone: 'CTRL', shift: 'D', sim: true, active: true });
    return out;
  }
  /** Todas las personas en planta (plantilla en turno + personal simulado). */
  crew() { return [...this.presentUsers(), ...this.simCrew()]; }

  recalcPosts() {
    const pres = this.presentUsers();
    const auto = this.w.settings?.autoCrew;
    for (const p of POSTS) {
      const who = pres.filter((u) => u.role === p.role && p.zones.includes(u.zone));
      const sim = !who.length && !!auto;
      this.posts[p.id] = { id: p.id, name: p.name, staffed: who.length > 0 || sim, sim, who: sim ? ['Operario simulado'] : who.map((u) => u.name), stops: p.stops };
    }
  }
  postStaffed(id) { return this.posts[id]?.staffed ?? true; }

  // ── Tareas ───────────────────────────────────────────────────────────────
  addTask(t) {
    if (t.ref && this.openTaskByRef(t.ref)) return this.openTaskByRef(t.ref);
    const task = { id: `T-${this.seq.task++}`, status: 'PENDIENTE', createdAt: this.w.t, ...t };
    this.tasks.push(task);
    return task;
  }
  openTaskByRef(ref) { return this.tasks.find((t) => t.ref === ref && t.status !== 'HECHA' && t.status !== 'CANCELADA'); }
  closeTaskByRef(ref, by) {
    const t = this.openTaskByRef(ref);
    if (t) {
      t.status = 'HECHA'; t.doneAt = this.w.t; if (by) t.doneBy = by;
      if (t.type === 'OT_PREV' || t.type === 'OT_CORR') { const u = this.user(t.by); if (u) this.credit(u.id, 1); }
    }
  }
  cancelTaskByRef(ref) { const t = this.openTaskByRef(ref); if (t) { t.status = 'CANCELADA'; t.doneAt = this.w.t; } }

  /** Acción de un usuario sobre una tarea (desde la app). */
  doTask(taskId, u, action) {
    const w = this.w;
    const t = this.tasks.find((x) => x.id === taskId);
    if (!t || t.status === 'HECHA' || t.status === 'CANCELADA') return { ok: false, error: 'La tarea ya no está abierta' };
    if (u.role !== t.role && !ROLES[u.role].admin) return { ok: false, error: `Esta tarea es para ${ROLES[t.role].name.toLowerCase()}` };
    const robotId = t.ref?.split(':')[1];
    let ok = false;
    switch (t.type) {
      case 'APROBAR': ok = action === 'reject' ? w.twin.reject(u.name) : w.twin.approve(u.name); break;
      case 'OT_PREV':
        if (t.status === 'PENDIENTE') { ok = w.twin.startMaintenance(robotId); if (ok) { t.status = 'EN_CURSO'; t.by = u.id; t.startedAt = w.t; w.log('plc', `${u.name} autoriza la parada de ${robotId} en la HMI (${t.ot})`); } }
        break;
      case 'OT_CORR':
        if (t.status === 'PENDIENTE') { ok = w.twin.startRepair(robotId); if (ok) { t.status = 'EN_CURSO'; t.by = u.id; t.startedAt = w.t; } }
        break;
      case 'RECEPCION': ok = w.logistics.receiveLogs(t.ref.split(':')[1]); if (ok) this.closeTaskByRef(t.ref, u.name); break;
      case 'EXPEDICION': ok = w.logistics.dispatchTruck(u.name); if (ok) this.closeTaskByRef(t.ref, u.name); break;
      case 'OFERTA': {
        const r = action === 'reject' ? w.eco.rejectOrder(t.ref.split(':')[1], u.name) : w.eco.acceptOrder(t.ref.split(':')[1], u.name);
        ok = r.ok; break;
      }
      default: break;
    }
    if (ok && !t.doneBy) t.doneBy = u.name;
    return ok ? { ok: true } : { ok: false, error: 'No se ha podido completar ahora mismo' };
  }

  // ── Incidencias ──────────────────────────────────────────────────────────
  report(u, text, zone) {
    const inc = { id: `INC-${this.seq.inc++}`, t: this.w.t, userId: u.id, name: u.name, role: u.role, zone: zone || u.zone, text: String(text).slice(0, 400), status: 'ABIERTA' };
    this.incidents.unshift(inc);
    this.w.log('warn', `Incidencia ${inc.id} de ${u.name} (${ZONES[inc.zone]?.short || inc.zone}): ${inc.text}`);
    return inc;
  }

  // ── Gestión de la plantilla (administrador) ──────────────────────────────
  createWorker({ name, username: un, role, shift, zone, pin }) {
    if (!name || !String(name).trim() || !ROLES[role] || role === 'gerente' || !SHIFTS[shift] || (zone && !ZONES[zone])) return { ok: false, error: 'Faltan datos del trabajador' };
    const uname = String(un || username(name)).trim().toLowerCase().replace(/[^a-z0-9._-]/g, '');
    if (uname.length < 3) return { ok: false, error: 'El usuario debe tener al menos 3 caracteres (letras, números, . _ -)' };
    if (!validPass(pin)) return { ok: false, error: 'La clave debe tener entre 4 y 32 caracteres' };
    if (this.users.some((u) => u.username === uname)) return { ok: false, error: `El usuario «${uname}» ya existe` };
    const u = { id: `u${this.seq.user++}`, name: String(name).trim().slice(0, 60), username: uname, pin: hashPin(String(pin)), role, shift, zone: zone || DEFAULT_ZONE[role], active: true };
    this.users.push(u);
    this.w.log('info', `Alta de ${u.name} (${ROLES[role].name}, turno ${SHIFTS[shift].name.toLowerCase()})`);
    return { ok: true, id: u.id, username: uname };
  }
  updateWorker(id, patch) {
    const u = this.user(id);
    if (!u) return { ok: false, error: 'No existe' };
    if (patch.zone && ZONES[patch.zone]) u.zone = patch.zone;
    if (patch.shift && SHIFTS[patch.shift]) u.shift = patch.shift;
    if (patch.role && ROLES[patch.role] && u.role !== 'gerente') u.role = patch.role;
    if (typeof patch.active === 'boolean' && u.role !== 'gerente') u.active = patch.active;
    if (patch.pin !== undefined) { if (!validPass(patch.pin)) return { ok: false, error: 'La clave debe tener entre 4 y 32 caracteres' }; u.pin = hashPin(String(patch.pin)); }
    if (patch.name) u.name = String(patch.name).slice(0, 60);
    this.recalcPosts();
    return { ok: true };
  }

  deleteWorker(id) {
    const u = this.user(id);
    if (!u) return { ok: false, error: 'No existe' };
    if (u.role === 'gerente') return { ok: false, error: 'La cuenta de gerencia no se puede eliminar' };
    this.users = this.users.filter((x) => x.id !== id);
    delete this.avatars[id];
    this.recalcPosts();
    this.w.log('info', `Baja definitiva de ${u.name}`);
    return { ok: true };
  }

  credit(userId, n) {
    const k = shiftKey(this.w.t);
    const s = (this.stats[userId] ||= {});
    s[k] = (s[k] || 0) + n;
    const keys = Object.keys(s);
    if (keys.length > 40) delete s[keys[0]];
  }

  // ── Paso ─────────────────────────────────────────────────────────────────
  step(h) {
    const w = this.w;
    this.recalcPosts();
    // trabajadores simulados: hacen las tareas pendientes de su función
    if (w.settings.autoWorkers) {
      for (const t of this.tasks) {
        if (t.status !== 'PENDIENTE') continue;
        if (t.type === 'OFERTA' && !w.settings.autoSales) continue;
        if (w.t - t.createdAt < (AUTO_DELAY[t.type] || 5) * 60) continue;
        const u = this.crew().find((p) => p.role === t.role);
        if (!u) continue;
        if (t.type === 'OFERTA') {
          const o = w.eco.order(t.ref.split(':')[1]);
          // el comercial simulado acepta si el plazo es razonable para la carga de trabajo
          const backlog = w.eco.plan.reduce((a, p) => a + Math.max(0, p.qty - p.done), 0);
          const per = Math.max(75, w.line.snapshot().avgCycle || 90) / 60;     // min por unidad medidos
          const feasible = o && (o.due - w.t) / 60 > (backlog + o.qty) * per * 1.25 + 150;
          this.doTask(t.id, u, feasible ? 'accept' : 'reject');
        } else this.doTask(t.id, u, 'approve');
      }
    }
    this.stepAvatars(h);
  }

  // ── Avatares (personas en la planta 3D) ──────────────────────────────────
  targetFor(u) {
    const P = this.w.plant;
    if (u.role === 'mantenimiento') {
      const t = this.tasks.find((x) => x.by === u.id && x.status === 'EN_CURSO');
      if (t) {
        const r = P.robots.find((x) => x.id === t.ref.split(':')[1]);
        if (r) { const z = P.zones[r.cellId]; const [x, zz] = z.T.toWorld(r.local[0] + 0.9, r.local[2] + (r.side > 0 ? 1.1 : -1.1)); return { x, z: zz, y: 0 }; }
      }
    }
    const zs = P.spots[u.zone];
    const sp = zs?.[u.role] || (zs && Object.values(zs)[0]);
    const idx = (this.crewCache || this.presentUsers()).filter((p) => p.zone === u.zone).findIndex((p) => p.id === u.id);
    if (sp) return { x: sp.x + idx * 0.7 * (sp === zs?.[u.role] ? 0 : 1), z: sp.z, y: sp.y };
    const zr = P.zones[u.zone];
    const [x, z] = zr.T.toWorld(-ZONES[u.zone].size[0] / 2 + 1 + idx, -ZONES[u.zone].size[1] / 2 - 0.8);
    return { x, z, y: 0 };
  }

  stepAvatars(h) {
    const nav = this.w.plant.nav;
    const crew = this.crew();
    const present = new Set(crew.map((u) => u.id));
    const everyone = [...this.users, ...crew.filter((u) => u.sim)];
    for (const id of Object.keys(this.avatars)) if (!present.has(id) && !this.users.some((u) => u.id === id)) {
      // personal simulado que ya no hace falta: se va hacia la puerta
      if (!everyone.some((u) => u.id === id)) everyone.push({ id, sim: true, gone: true });
    }
    this.crewCache = crew;
    for (const u of everyone) {
      let a = this.avatars[u.id];
      if (present.has(u.id) && !a) {
        a = this.avatars[u.id] = { id: u.id, role: u.role, x: DOOR[0] + (Math.random() - 0.5) * 3, z: DOOR[1], y: 0, h: Math.PI / 2, path: null, tgt: null, moving: false, leaving: false };
      }
      if (!a) continue;
      const tgt = present.has(u.id) ? this.targetFor(u) : { x: DOOR[0], z: DOOR[1], y: 0 };
      a.leaving = !present.has(u.id);
      if (!a.tgt || Math.hypot(a.tgt.x - tgt.x, a.tgt.z - tgt.z) > 0.3) {
        a.tgt = tgt;
        const p = nav.findPath(a.x, a.z, tgt.x, tgt.z) || [];
        a.path = [...p, [tgt.x, tgt.z]];
        a.i = 0;
      }
      a.moving = false;
      let budget = 1.35 * h;
      while (a.path && a.i < a.path.length && budget > 0) {
        const [tx, tz] = a.path[a.i];
        const dx = tx - a.x, dz = tz - a.z, d = Math.hypot(dx, dz);
        if (d < 0.02) { a.i++; continue; }
        const s = Math.min(d, budget);
        a.x += (dx / d) * s; a.z += (dz / d) * s; a.h = Math.atan2(-dz, dx);
        budget -= s; a.moving = true;
        if (s >= d) a.i++;
      }
      a.y = a.path && a.i >= a.path.length ? a.tgt.y : 0;
      if (a.leaving && (!a.path || a.i >= a.path.length)) delete this.avatars[u.id];
    }
  }

  snapshotAvatars() {
    return Object.values(this.avatars).map((a) => {
      const u = this.user(a.id) || this.crewCache?.find((c) => c.id === a.id);
      return { id: a.id, name: u?.name, role: u?.role || a.role, sim: !!u?.sim, x: +a.x.toFixed(2), z: +a.z.toFixed(2), y: a.y, h: +a.h.toFixed(3), moving: a.moving };
    });
  }

  publicUsers() {
    return this.users.map(({ pin, ...u }) => ({ ...u, present: this.present(u) }));
  }
}

export { PRODUCTS, ZONE_IDS };
