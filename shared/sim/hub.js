// ─────────────────────────────────────────────────────────────────────────────
// Hub: reparte el estado del mundo a todas las pantallas conectadas y recibe sus
// acciones. No sabe nada de la red: el servidor lo usa con WebSocket y el navegador
// (modo sin servidor) lo usa con llamadas directas.
//
//   cliente → hub   { type: 'hello', want: ['tick','scene','state'], token? }
//                   { type: 'login', id, username, pin }   { type: 'logout' }
//                   { type: 'action', id, action, payload }
//                   { type: 'preview', id, placements }    (validar distribución)
//                   { type: 'reset', id }                  (reiniciar la simulación, gerente)
//   hub → cliente   { type: 'tick', data }   ≈10 Hz · visor 3D (posiciones, robots…)
//                   { type: 'scene', data }  ≈1 Hz  · visor 3D (almacén, distribución)
//                   { type: 'state', data }  ≈1 Hz  · apps (pedidos, tareas, caja…)
//                   { type: 'session', user, token }
//                   { type: 'reply', id, ok, error?, … }
//                   { type: 'event', e }     registro en directo
// ─────────────────────────────────────────────────────────────────────────────
import { World } from './world.js';

const TICK_DT = 0.1, STATE_DT = 1, SCENE_DT = 1;
const rid = () => Array.from({ length: 24 }, () => Math.floor(Math.random() * 16).toString(16)).join('');

export class Hub {
  constructor(world = new World(), { onSave } = {}) {
    this.world = world;
    this.conns = new Set();
    this.sessions = new Map();          // token → userId
    this.onSave = onSave;
    this.acc = { tick: 0, state: 0, scene: 0 };
    this.bindEvents();
  }

  bindEvents() {
    this.unbind?.();
    this.unbind = this.world.onEvent((e) => this.broadcast({ type: 'event', e }, (c) => c.want.has('state')));
  }

  connect(send, info = {}) {
    const conn = { id: rid().slice(0, 8), send, user: null, want: new Set(['tick', 'scene']), info };
    this.conns.add(conn);
    return conn;
  }
  disconnect(conn) { this.conns.delete(conn); }

  userOf(conn) {
    if (!conn.user) return null;
    const u = this.world.staff.user(conn.user);
    return u && u.active ? u : null;
  }

  sendSession(conn) {
    const u = this.userOf(conn);
    conn.send({ type: 'session', user: u ? publicUser(u) : null, token: conn.token || null });
  }

  handle(conn, msg) {
    if (!msg || typeof msg !== 'object') return;
    const W = this.world;
    const reply = (extra = {}) => conn.send({ type: 'reply', ...extra, ref: extra.id, id: msg.id });
    switch (msg.type) {
      case 'hello': {
        if (Array.isArray(msg.want)) conn.want = new Set(msg.want.filter((k) => ['tick', 'scene', 'state'].includes(k)));
        if (msg.token && this.sessions.has(msg.token)) { conn.user = this.sessions.get(msg.token); conn.token = msg.token; }
        this.sendSession(conn);
        if (conn.want.has('scene')) conn.send({ type: 'scene', data: W.scene() });
        if (conn.want.has('tick')) conn.send({ type: 'tick', data: W.tick() });
        if (conn.want.has('state')) conn.send({ type: 'state', data: this.stateFor(conn) });
        return;
      }
      case 'login': {
        const u = W.login(msg.username, msg.pin);
        if (!u) return reply({ ok: false, error: 'Usuario o PIN incorrectos' });
        const token = rid();
        this.sessions.set(token, u.id);
        conn.user = u.id; conn.token = token;
        reply({ ok: true, token, user: publicUser(u) });
        this.sendSession(conn);
        if (conn.want.has('state')) conn.send({ type: 'state', data: this.stateFor(conn) });
        return;
      }
      case 'logout': {
        if (conn.token) this.sessions.delete(conn.token);
        conn.user = null; conn.token = null;
        this.sendSession(conn);
        return;
      }
      case 'action': {
        const u = this.userOf(conn);
        if (!u) return reply({ ok: false, error: 'Inicia sesión para hacer esto' });
        let r;
        try { r = W.action(u, msg.action, msg.payload || {}); } catch (err) { r = { ok: false, error: `Error interno: ${err.message}` }; }
        reply(r || { ok: false });
        if (r?.ok) this.push();                 // que todos vean el cambio al momento
        return;
      }
      case 'preview': return reply(W.previewLayout(msg.placements));
      case 'reset': {
        const u = this.userOf(conn);
        if (!u || u.role !== 'gerente') return reply({ ok: false, error: 'Solo gerencia' });
        const users = W.staff.users;
        this.world = new World();
        this.world.staff.users = users;     // se conserva la plantilla
        this.bindEvents();
        reply({ ok: true });
        this.push();
        return;
      }
      default: return reply({ ok: false, error: 'Mensaje desconocido' });
    }
  }

  stateFor(conn) {
    const s = this.world.state();
    const u = this.userOf(conn);
    s.me = u ? { ...publicUser(u), stats: this.world.staff.stats[u.id] || {} } : null;
    return s;
  }

  broadcast(msg, filter) {
    for (const c of this.conns) if (!filter || filter(c)) c.send(msg);
  }

  push() {
    const W = this.world;
    const any = (k) => [...this.conns].some((c) => c.want.has(k));
    if (any('scene')) this.broadcast({ type: 'scene', data: W.scene() }, (c) => c.want.has('scene'));
    for (const c of this.conns) if (c.want.has('state')) c.send({ type: 'state', data: this.stateFor(c) });
  }

  /** Avanza el reloj y envía instantáneas. `dt` en segundos reales. */
  step(dt) {
    const W = this.world;
    W.advance(dt);
    this.acc.tick += dt; this.acc.state += dt; this.acc.scene += dt;
    const any = (k) => { for (const c of this.conns) if (c.want.has(k)) return true; return false; };
    if (this.acc.tick >= TICK_DT) {
      this.acc.tick = 0;
      if (any('tick')) { const data = W.tick(); this.broadcast({ type: 'tick', data }, (c) => c.want.has('tick')); }
    }
    if (this.acc.scene >= SCENE_DT) {
      this.acc.scene = 0;
      if (any('scene')) { const data = W.scene(); this.broadcast({ type: 'scene', data }, (c) => c.want.has('scene')); }
    }
    if (this.acc.state >= STATE_DT) {
      this.acc.state = 0;
      for (const c of this.conns) if (c.want.has('state')) c.send({ type: 'state', data: this.stateFor(c) });
    }
  }
}

export function publicUser(u) {
  const { pin, ...rest } = u;
  return rest;
}
