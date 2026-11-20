// ─────────────────────────────────────────────────────────────────────────────
// Servidor del gemelo digital
//
//   · Ejecuta la simulación (una sola planta compartida por todas las pantallas).
//   · Sirve las tres aplicaciones:  /  visor 3D · /admin  administración · /app  móvil
//   · WebSocket en /ws para el estado en directo y las acciones de los usuarios.
//   · Guarda el estado en DATA_DIR/estado.json cada 30 s y al apagarse.
//
//   node server/index.mjs            producción (sirve ./dist)
//   node server/index.mjs --dev      desarrollo (Vite en modo middleware, recarga en caliente)
//
// Variables: PORT (8080) · DATA_DIR (./data) · HOST (0.0.0.0)
// ─────────────────────────────────────────────────────────────────────────────
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { World } from '../shared/sim/world.js';
import { Hub } from '../shared/sim/hub.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEV = process.argv.includes('--dev');
const PORT = +(process.env.PORT || 8080);
const HOST = process.env.HOST || '0.0.0.0';
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(ROOT, 'data'));
const STATE_FILE = path.join(DATA_DIR, 'estado.json');
const DIST = path.join(ROOT, 'dist');

// ── Estado persistente ─────────────────────────────────────────────────────
function loadWorld() {
  try {
    const saved = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    const w = new World(saved);
    console.log(`[estado] cargado de ${STATE_FILE}`);
    return w;
  } catch (e) {
    if (e.code !== 'ENOENT') console.warn(`[estado] no se pudo leer (${e.message}); se empieza de cero`);
    return new World();
  }
}
function save() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const tmp = `${STATE_FILE}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(hub.world.serialize()));
    fs.renameSync(tmp, STATE_FILE);
  } catch (e) { console.warn(`[estado] no se pudo guardar: ${e.message}`); }
}

const hub = new Hub(loadWorld());

// ── HTTP: estáticos (producción) o Vite (desarrollo) ───────────────────────
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.glb': 'model/gltf-binary', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8',
};
const APPS = ['admin', 'app'];

function serveStatic(req, res) {
  const url = new URL(req.url, 'http://x');
  let p = decodeURIComponent(url.pathname);
  if (p === '/salud' || p === '/health') { res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ ok: true, t: hub.world.t, clientes: hub.conns.size })); }
  if (p === '/api/estado') { res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify(hub.world.state())); }
  let file = path.join(DIST, p);
  if (!file.startsWith(DIST)) { res.writeHead(403); return res.end(); }
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
  if (!fs.existsSync(file)) {
    // rutas de las aplicaciones: /admin/…, /app/… → su index.html
    const app = APPS.find((a) => p === `/${a}` || p.startsWith(`/${a}/`));
    file = path.join(DIST, app || '', 'index.html');
    if (p === `/${app}`) { res.writeHead(301, { location: `/${app}/` }); return res.end(); }
  }
  if (!fs.existsSync(file)) { res.writeHead(404); return res.end('No encontrado'); }
  const ext = path.extname(file);
  const headers = { 'content-type': MIME[ext] || 'application/octet-stream' };
  if (p.startsWith('/assets/')) headers['cache-control'] = 'public, max-age=31536000, immutable';
  else if (ext === '.glb') headers['cache-control'] = 'public, max-age=604800';
  else headers['cache-control'] = 'no-cache';
  res.writeHead(200, headers);
  fs.createReadStream(file).pipe(res);
}

let handler = serveStatic;
const server = http.createServer((req, res) => handler(req, res));

if (DEV) {
  const { createServer } = await import('vite');
  const vite = await createServer({ root: ROOT, server: { middlewareMode: true, ws: { server } }, appType: 'mpa' });
  handler = (req, res) => {
    const u = new URL(req.url, 'http://x');
    if (u.pathname === '/salud' || u.pathname === '/api/estado') return serveStatic(req, res);
    // /admin y /app sin barra final → con barra (Vite sirve admin/index.html)
    if (APPS.includes(u.pathname.slice(1))) { res.writeHead(301, { location: `${u.pathname}/` }); return res.end(); }
    vite.middlewares(req, res, () => { res.writeHead(404); res.end('No encontrado'); });
  };
}

// ── WebSocket ──────────────────────────────────────────────────────────────
const wss = new WebSocketServer({ noServer: true, maxPayload: 1 << 20 });
server.on('upgrade', (req, socket, head) => {
  if (new URL(req.url, 'http://x').pathname !== '/ws') return;      // el resto (HMR de Vite) lo atiende Vite
  wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
});
wss.on('connection', (ws, req) => {
  const conn = hub.connect((msg) => {
    if (ws.readyState !== ws.OPEN) return;
    if (ws.bufferedAmount > 4e6 && (msg.type === 'tick' || msg.type === 'scene')) return;   // cliente lento: se saltan instantáneas
    ws.send(JSON.stringify(msg));
  }, { ip: req.socket.remoteAddress });
  ws.on('message', (data) => {
    let msg;
    try { msg = JSON.parse(data); } catch { return; }
    hub.handle(conn, msg);
  });
  ws.on('close', () => hub.disconnect(conn));
  ws.on('error', () => hub.disconnect(conn));
});

// ── Bucle de simulación ────────────────────────────────────────────────────
let last = performance.now();
setInterval(() => {
  const now = performance.now();
  const dt = Math.min(0.25, (now - last) / 1000);
  last = now;
  hub.step(dt);
}, 50);
setInterval(save, 30_000);

for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { save(); console.log('\n[estado] guardado · hasta luego'); process.exit(0); });

server.listen(PORT, HOST, () => {
  const ips = Object.values(os.networkInterfaces()).flat().filter((i) => i && i.family === 'IPv4' && !i.internal).map((i) => i.address);
  console.log(`\nGemelo digital · planta de madera ${DEV ? '(desarrollo)' : ''}`);
  console.log(`  Visor 3D         http://localhost:${PORT}/`);
  console.log(`  Administración   http://localhost:${PORT}/admin/   (usuario de gerencia: digitaltwins)`);
  console.log(`  App móvil        http://localhost:${PORT}/app/     (usuarios creados en Administración → Plantilla)`);
  for (const ip of ips) console.log(`  En la red local  http://${ip}:${PORT}/app/`);
  console.log(`  Estado guardado en ${STATE_FILE}\n`);
});
