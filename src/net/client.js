// ─────────────────────────────────────────────────────────────────────────────
// Conexión de cualquier pantalla (visor 3D, administración, app móvil) con la planta.
//
//   · Con servidor: WebSocket a /ws (estado compartido por todas las pantallas).
//   · Sin servidor (p. ej. `npm run dev` sin el servidor, o ?local=1): la simulación
//     corre en el propio navegador y se guarda en este navegador.
//
// El estado que llega se guarda en un store de zustand (`useNet`). Las instantáneas
// rápidas del visor (tick, 10 Hz) se guardan fuera de React en `live` para leerlas
// desde useFrame sin provocar renders.
// ─────────────────────────────────────────────────────────────────────────────
import { create } from 'zustand';

export const live = { tick: null, prev: null, at: 0, prevAt: 0, scene: null };

export const useNet = create(() => ({
  mode: null,              // 'remote' | 'local'
  status: 'conectando',    // 'conectando' | 'conectado' | 'reconectando'
  user: null,
  state: null,
  scene: null,
  tickT: 0,
  events: [],
}));

const LS = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch { /* sin almacenamiento */ } },
};
const LOCAL_KEY = 'gemelo-madera-v2';

let api = null;

/**
 * @param {{ want: string[], app: string }} opts  want ⊂ ['tick','scene','state']
 */
export function connect({ want, app }) {
  if (api) return api;
  const tokenKey = `gm-token-${app}`;
  const pending = new Map();
  let seq = 1;
  let transport = null;     // { send(msg) }

  const onMessage = (msg) => {
    switch (msg.type) {
      case 'tick':
        live.prev = live.tick; live.prevAt = live.at;
        live.tick = msg.data; live.at = performance.now();
        useNet.setState({ tickT: msg.data.t });
        break;
      case 'scene': live.scene = msg.data; useNet.setState({ scene: msg.data }); break;
      case 'state': useNet.setState({ state: msg.data }); break;
      case 'session':
        useNet.setState({ user: msg.user });
        if (msg.token) LS.set(tokenKey, msg.token); else if (!msg.user) LS.set(tokenKey, null);
        break;
      case 'event': useNet.setState((s) => ({ events: [msg.e, ...s.events].slice(0, 60) })); break;
      case 'reply': {
        const p = pending.get(msg.id);
        if (p) { pending.delete(msg.id); p(msg); }
        break;
      }
      default: break;
    }
  };

  const request = (msg) => new Promise((resolve) => {
    const id = seq++;
    pending.set(id, resolve);
    transport.send({ ...msg, id });
    setTimeout(() => { if (pending.has(id)) { pending.delete(id); resolve({ ok: false, error: 'Sin respuesta del servidor' }); } }, 10000);
  });

  const hello = () => transport.send({ type: 'hello', want, token: LS.get(tokenKey) });

  // ── Modo local: la simulación corre en el navegador ─────────────────────
  async function startLocal() {
    const [{ World }, { Hub }] = await Promise.all([import('../../shared/sim/world.js'), import('../../shared/sim/hub.js')]);
    let saved = null;
    try { saved = JSON.parse(LS.get(LOCAL_KEY) || 'null'); } catch { saved = null; }
    let world;
    try { world = new World(saved); } catch { world = new World(); }
    const hub = new Hub(world);
    const conn = hub.connect((m) => onMessage(structuredClone(m)));
    transport = { send: (m) => queueMicrotask(() => hub.handle(conn, m)) };
    useNet.setState({ mode: 'local', status: 'conectado' });
    hello();
    let last = performance.now();
    setInterval(() => { const now = performance.now(); hub.step(Math.min(0.25, (now - last) / 1000)); last = now; }, 50);
    const persist = () => LS.set(LOCAL_KEY, JSON.stringify(hub.world.serialize()));
    setInterval(persist, 10000);
    window.addEventListener('beforeunload', persist);
    api.resetLocal = () => { LS.set(LOCAL_KEY, null); location.reload(); };
  }

  // ── Modo servidor ─────────────────────────────────────────────────────────
  function startRemote() {
    return new Promise((resolve) => {
      const url = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`;
      let ws, opened = false, queue = [];
      const open = () => {
        ws = new WebSocket(url);
        ws.onopen = () => {
          opened = true;
          useNet.setState({ mode: 'remote', status: 'conectado' });
          transport = { send: (m) => (ws.readyState === 1 ? ws.send(JSON.stringify(m)) : queue.push(m)) };
          hello();
          for (const m of queue) ws.send(JSON.stringify(m));
          queue = [];
          resolve(true);
        };
        ws.onmessage = (e) => { try { onMessage(JSON.parse(e.data)); } catch { /* mensaje dañado */ } };
        ws.onclose = () => {
          if (!opened) { resolve(false); return; }
          useNet.setState({ status: 'reconectando' });
          setTimeout(open, 1500);
        };
      };
      open();
      setTimeout(() => { if (!opened) { try { ws.close(); } catch { /* */ } resolve(false); } }, 2500);
    });
  }

  api = {
    ready: null,
    login: (username, pin) => request({ type: 'login', username, pin }),
    logout: () => { transport.send({ type: 'logout' }); LS.set(tokenKey, null); },
    action: (action, payload) => request({ type: 'action', action, payload }),
    preview: (placements) => request({ type: 'preview', placements }),
    reset: () => request({ type: 'reset' }),
    resetLocal: null,
  };
  const forceLocal = new URLSearchParams(location.search).has('local');
  api.ready = (forceLocal ? Promise.resolve(false) : startRemote()).then((ok) => (ok ? null : startLocal()));
  return api;
}

export const getApi = () => api;
