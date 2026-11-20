// ─────────────────────────────────────────────────────────────────────────────
// Configuración común (servidor, visor 3D, app de administración y app móvil).
// Unidades: metros, segundos, euros.
// ─────────────────────────────────────────────────────────────────────────────

export const HALL = { x0: -68, x1: 68, z0: -30, z1: 30, h: 12 };

/** Reloj: la simulación empieza el día 1 a las 06:00. */
export const T0 = 6 * 3600;
export const SIM_SPEEDS = [1, 5, 20, 60, 300, 600];

// ── Especies de madera ───────────────────────────────────────────────────────
// log: precio base por tronco (≈ 0,6 m³) · factor: multiplicador del precio de venta
export const SPECIES = {
  pino:  { name: 'Pino',  log: 55,  factor: 1.0, wood: '#e9d1a2', planed: '#f0dcb3', bark: '#6e5139', end: '#e3c48e', ring: '#c9a46c' },
  haya:  { name: 'Haya',  log: 75,  factor: 1.3, wood: '#e2b48a', planed: '#ebc39d', bark: '#8b877d', end: '#dcae84', ring: '#c4936a' },
  roble: { name: 'Roble', log: 120, factor: 1.8, wood: '#c6a06e', planed: '#d3ae7c', bark: '#5c4834', end: '#c99f6a', ring: '#a87f4f' },
  nogal: { name: 'Nogal', log: 210, factor: 2.9, wood: '#8b5d3d', planed: '#9a6a47', bark: '#3f3127', end: '#9b6a45', ring: '#6f4a2f' },
};
export const SPECIES_IDS = Object.keys(SPECIES);

export const BOARDS_PER_LOG = 6;         // una capa de tablas por tronco
export const LAYERS_PER_STACK = 6;       // una pila = 6 capas = 36 tablas
export const BOARDS_PER_STACK = BOARDS_PER_LOG * LAYERS_PER_STACK;

// ── Acabados (barniz) ────────────────────────────────────────────────────────
export const TONES = {
  natural: { name: 'Natural', color: null, mix: 0 },
  miel:    { name: 'Miel',    color: '#c0843f', mix: 0.55 },
  nogal:   { name: 'Nogal',   color: '#5e3b22', mix: 0.7 },
  blanco:  { name: 'Lacado blanco', color: '#efe9df', mix: 0.92 },
  negro:   { name: 'Lacado negro',  color: '#2a2522', mix: 0.92 },
};

// ── Estaciones de la línea (en orden de proceso) ─────────────────────────────
export const LINE_STATIONS = ['CEP', 'CNC', 'LIJ', 'ENS', 'BAR', 'PAL'];
export const ROBOT_CELLS = ['CNC', 'LIJ', 'ENS', 'BAR'];

// ── Productos ────────────────────────────────────────────────────────────────
// boards: tablas que consume · price: precio base (pino) · perPallet: unidades por palé
// work: contenido de trabajo en segundos-robot por celda (lo que tardaría un brazo solo)
// route: estaciones por defecto · optional: estaciones que se pueden quitar de la ruta
export const PRODUCTS = {
  tablon: {
    name: 'Lote de tablones', short: 'Tablones', unit: 'lotes', boards: 4, price: 30, perPallet: 6,
    work: { CNC: 0, LIJ: 44, ENS: 0, BAR: 50 },
    route: ['CEP', 'LIJ', 'PAL'], optional: ['LIJ', 'BAR'], icon: '▤',
  },
  silla: {
    name: 'Silla', short: 'Sillas', unit: 'sillas', boards: 2, price: 46, perPallet: 4,
    work: { CNC: 80, LIJ: 70, ENS: 130, BAR: 76 },
    route: ['CEP', 'CNC', 'LIJ', 'ENS', 'BAR', 'PAL'], optional: ['LIJ', 'BAR'], icon: '🪑',
  },
  mesa: {
    name: 'Mesa', short: 'Mesas', unit: 'mesas', boards: 4, price: 135, perPallet: 2,
    work: { CNC: 72, LIJ: 74, ENS: 120, BAR: 74 },
    route: ['CEP', 'CNC', 'LIJ', 'ENS', 'BAR', 'PAL'], optional: ['LIJ', 'BAR'], icon: '▭',
  },
  estanteria: {
    name: 'Estantería', short: 'Estanterías', unit: 'estanterías', boards: 3, price: 88, perPallet: 3,
    work: { CNC: 64, LIJ: 60, ENS: 110, BAR: 66 },
    route: ['CEP', 'CNC', 'LIJ', 'ENS', 'BAR', 'PAL'], optional: ['LIJ', 'BAR'], icon: '▥',
  },
};
export const PRODUCT_IDS = Object.keys(PRODUCTS);
export const CEP_TIME = 28;          // s por unidad en la cepilladora

/** Precio de venta de referencia de una unidad. */
export const unitPrice = (product, species) => Math.round(PRODUCTS[product].price * SPECIES[species].factor * 100) / 100;

// ── Funciones (roles) y turnos ───────────────────────────────────────────────
export const ROLES = {
  gerente:       { name: 'Gerente', short: 'Gerencia', admin: true, color: '#ffffff' },
  jefe:          { name: 'Jefe de turno', short: 'Jefatura', color: '#2f6bff' },
  comercial:     { name: 'Comercial', short: 'Comercial', color: '#9a6fc4' },
  aserrador:     { name: 'Aserrador', short: 'Aserradero', color: '#8c6b4a' },
  cepillador:    { name: 'Cepillador', short: 'Cepillado', color: '#2f6b4f' },
  mecanizado:    { name: 'Operador de mecanizado', short: 'Mecanizado', color: '#e0663a' },
  montaje:       { name: 'Operador de montaje y acabado', short: 'Montaje', color: '#4f86c6' },
  logistica:     { name: 'Operario de logística', short: 'Logística', color: '#f2b705' },
  mantenimiento: { name: 'Técnico de mantenimiento', short: 'Mantenimiento', color: '#3aa394' },
};

export const SHIFTS = {
  M: { name: 'Mañana', from: 6, to: 14 },
  T: { name: 'Tarde', from: 14, to: 22 },
  N: { name: 'Noche', from: 22, to: 6 },
  D: { name: 'Jornada partida (08–17)', from: 8, to: 17 },
};
export const hourOf = (t) => (t / 3600) % 24;
export function onShift(shift, t) {
  const h = hourOf(t), s = SHIFTS[shift];
  return s.from < s.to ? h >= s.from && h < s.to : h >= s.from || h < s.to;
}
export function currentShift(t) {
  const h = hourOf(t);
  return h >= 6 && h < 14 ? 'M' : h >= 14 && h < 22 ? 'T' : 'N';
}
/** Clave del turno en curso (día + turno), para contadores por turno. */
export function shiftKey(t) {
  const sh = currentShift(t);
  const day = Math.floor((t - (sh === 'N' && hourOf(t) < 6 ? 86400 : 0)) / 86400) + 1;
  return `${day}${sh}`;
}

/**
 * Puestos que hay que cubrir en cada turno. Si un puesto queda sin un trabajador de la
 * función adecuada en sus zonas, lo que controla se detiene.
 */
export const POSTS = [
  { id: 'ASE', name: 'Aserradero', role: 'aserrador', zones: ['ASE', 'KILN'], stops: 'sierra y pórticos' },
  { id: 'CEP', name: 'Cepilladora', role: 'cepillador', zones: ['CEP'], stops: 'entrada de la línea' },
  { id: 'MEC', name: 'Mecanizado (CNC + lijado)', role: 'mecanizado', zones: ['CNC', 'LIJ'], stops: 'celdas CNC y LIJ' },
  { id: 'MON', name: 'Montaje y acabado', role: 'montaje', zones: ['ENS', 'BAR'], stops: 'celdas ENS y BAR' },
  { id: 'LOG', name: 'Logística', role: 'logistica', zones: ['PAL', 'ALM', 'DOCK', 'AGVB'], stops: 'expedición de camiones' },
];

// ── Costes ───────────────────────────────────────────────────────────────────
export const COSTS = {
  wage: { gerente: 0, jefe: 28, comercial: 24, aserrador: 21, cepillador: 21, mecanizado: 23, montaje: 23, logistica: 20, mantenimiento: 26 },
  energy: { robot: 1.1, kiln: 16, saw: 7, line: 4, base: 6 },     // €/h (robot a ciclo 100 % y velocidad 100 %)
  maintPrev: 160,
  maintCorr: 2400,
  logTransport: 160,
  latePenalty: 0.25,
};

export const START_CASH = 60000;

export const CLIENTS = [
  'Muebles Ríos S.L.', 'Hogar Norte', 'Casa Olmo', 'Decora Sur', 'Interiores Vega', 'Mobiliario Duero',
  'Escuelas del Valle', 'Hostelería Brisa', 'Madera y Diseño', 'Oficinas Atlas', 'Bricolaje Centro', 'Cafetería La Plaza',
];

export const fmtEur = (v, d = 0) => `${v < 0 ? '−' : ''}${Math.abs(v).toLocaleString('es-ES', { minimumFractionDigits: d, maximumFractionDigits: d })} €`;
export function fmtClock(t, withDay = true) {
  const day = Math.floor(t / 86400) + 1;
  const h = Math.floor((t % 86400) / 3600);
  const m = Math.floor((t % 3600) / 60);
  return `${withDay ? `Día ${day} · ` : ''}${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}
export function fmtDur(s) {
  if (s < 0) return `−${fmtDur(-s)}`;
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
  return h ? `${h} h ${String(m).padStart(2, '0')} min` : `${m} min`;
}
