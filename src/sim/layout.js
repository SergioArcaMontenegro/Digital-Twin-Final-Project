// ─────────────────────────────────────────────────────────────────────────────
// Layout de la planta de transformación de madera (1 unidad = 1 m).
//
// Flujo en U (vista en planta, X → derecha, Z → hacia el espectador):
//
//   ┌──────────────────────── fondo (z −30) ────────────────────────┐
//   │ SECADERO │ CEP → CNC → LIJ → ENS → BAR → │ PALETIZADO           │
//   │          │       (línea de mecanizado, z = −17)                │
//   │   ↑ AGV-B                                     ↓ carretilla AGV-C│
//   │  ─────────────── pasillos AGV (z −4 … 7) ─────────────────────  │
//   │   ↑ AGV-A                                     ↓ carretilla AGV-D│
//   │ PATIO TRONCOS → ASERRADERO → APILADOR │ SALA │ ALMACÉN → MUELLE  │
//   └──────────────────────── frente (z +30) ───────────────────────┘
// ─────────────────────────────────────────────────────────────────────────────

export const HALL = { x0: -68, x1: 68, z0: -30, z1: 30, h: 12 };

// ── Línea de mecanizado ─────────────────────────────────────────────────────
export const LINE_Z = -17;
export const LINE_Y = 0.75;          // cota superior del transportador
export const TRAY_H = 0.06;          // bandeja portapiezas
export const PIECE_Y = LINE_Y + TRAY_H;
export const LINE_X0 = -45.5;
export const LINE_X1 = 37.8;
export const ENTRY_X = -45;          // carga de tablas desde la pila seca
export const OUT_X = 37.2;           // punto de recogida del paletizador

export const TAKT_TARGET = 60;       // s
export const TRANSFER_TIME = 6;      // s

// Estaciones de la línea. Las que tienen W son celdas robóticas redundantes del gemelo.
// W = contenido de trabajo en segundos-robot (lo que haría un brazo solo):
//   celdas de 2 brazos con W ≤ takt − transferencia → el monobrazo es viable;
//   celdas de 3 brazos con W > takt → con un brazo parado se reparte entre dos.
export const STATIONS = [
  { id: 'CEP', name: 'Cepillado y moldurado', x: -40, fixed: 30, color: '#8d6e4f' },
  { id: 'CNC', name: 'Fresado CNC robótico', short: 'Fresado CNC', x: -24, model: 'cnc', W: 50, color: '#e0663a' },
  { id: 'LIJ', name: 'Lijado robótico', short: 'Lijado', x: -8, model: 'sanding', W: 46, color: '#c9a227' },
  { id: 'ENS', name: 'Ensamblaje y atornillado', short: 'Ensamblaje', x: 8, model: 'assembly', W: 92, color: '#4f86c6' },
  { id: 'BAR', name: 'Cabina de barnizado', short: 'Barnizado', x: 24, model: 'varnish', W: 48, color: '#3aa394', ceiling: true },
];
export const CELLS = STATIONS.filter((s) => s.W);
export const CELL_LEN = 15;
export const CELL_W = 11.5;

// Brazos de cada celda: [dx, dz] respecto al centro de la celda
const ROBOT_SLOTS = {
  CNC: [[-1.4, 2.0], [1.4, -2.0]],
  LIJ: [[-1.1, 1.7], [1.1, -1.7]],
  ENS: [[-1.1, 1.6], [1.1, 1.6], [0, -1.6]],
  BAR: [[-0.9, 1.7], [0.9, -1.7]],
};
export const BAR_BEAM_Y = 3.4;        // viga aérea de los robots de barnizado

// Desgaste inicial idéntico dentro de cada celda (instalados y revisados a la vez)
const INITIAL_WEAR = { CNC: 0.8, LIJ: 0.55, ENS: 0.76, BAR: 0.5 };

export const ROBOTS = CELLS.flatMap((cell) =>
  ROBOT_SLOTS[cell.id].map(([dx, dz], i) => {
    const inverted = !!cell.ceiling;
    const side = dz > 0 ? 1 : -1;
    return {
      id: `${cell.id}-${i + 1}`,
      cellId: cell.id,
      index: i,
      model: cell.model,
      pos: [cell.x + dx, inverted ? BAR_BEAM_Y : 0, LINE_Z + dz],
      inverted,
      // +X local del robot mirando a la línea (en invertidos el volteo en X cambia el signo)
      yaw: inverted ? -side * Math.PI / 2 : side * Math.PI / 2,
      side,
      wear0: INITIAL_WEAR[cell.id] + (i - 1) * 0.004,
      rth: 0.42 + ((i * 37 + Math.abs(cell.x)) % 5) * 0.006,    // R_th calibrada (K/W)
    };
  }),
);

export const stationOf = (id) => STATIONS.find((s) => s.id === id);
export const cellOf = (id) => CELLS.find((c) => c.id === id);
export const robotsOf = (cellId) => ROBOTS.filter((r) => r.cellId === cellId);

// ── Pieza en la línea ───────────────────────────────────────────────────────
export const PANEL = { lx: 1.6, ly: 0.04, lz: 0.8 };            // tablero cepillado
export const CABINET = { lx: 0.62, ly: 0.75, lz: 0.5 };         // módulo ensamblado
export const SIDE_RACK = { dz: 1.7, y: 1.0 };                    // racks de laterales en ENS

// ─────────────────────────────────────────────────────────────────────────────
// Puntos de trabajo de los brazos (mundo). { p, g, kind }:
//   p = TCP, g = ángulo de herramienta en el plano radial (0 horizontal, −π/2 abajo)
// ─────────────────────────────────────────────────────────────────────────────
const DOWN = -Math.PI / 2;

export function workPointsFor(robot) {
  const cell = cellOf(robot.cellId);
  const cx = cell.x, z0 = LINE_Z, s = robot.side;
  const rx = robot.pos[0] - cx;
  const top = PIECE_Y + PANEL.ly;
  const pts = [];

  if (robot.cellId === 'CNC') {
    // Fresado del canto (perfil) y taladros en la mitad del tablero de su lado
    const hx = PANEL.lx / 2 - 0.05, hz = PANEL.lz / 2 - 0.05;
    const x0 = rx < 0 ? -hx : hx, x1 = rx < 0 ? 0.05 : -0.05;
    pts.push({ p: [cx + x0, top - 0.01, z0 + s * hz], g: DOWN, kind: 'mill' });
    pts.push({ p: [cx + x1, top - 0.01, z0 + s * hz], g: DOWN, kind: 'mill' });
    pts.push({ p: [cx + x1, top - 0.01, z0], g: DOWN, kind: 'mill' });
    pts.push({ p: [cx + x0, top - 0.01, z0], g: DOWN, kind: 'mill' });
    pts.push({ p: [cx + x0 * 0.6, top - 0.03, z0 + s * 0.2], g: DOWN, kind: 'drill' });
    pts.push({ p: [cx + x0 * 0.3, top - 0.03, z0 + s * 0.2], g: DOWN, kind: 'drill' });
  }

  if (robot.cellId === 'LIJ') {
    // Pasadas en serpentina sobre la mitad del tablero de su lado
    const hx = PANEL.lx / 2 - 0.12;
    const xs = rx < 0 ? [-hx, -0.05] : [hx, 0.05];
    [0.28, 0.12, -0.04].forEach((dz, k) => {
      const a = k % 2 ? xs[1] : xs[0], b = k % 2 ? xs[0] : xs[1];
      pts.push({ p: [cx + a, top, z0 + s * dz], g: DOWN, kind: 'sand' });
      pts.push({ p: [cx + b, top, z0 + s * dz], g: DOWN, kind: 'sand' });
    });
  }

  if (robot.cellId === 'ENS') {
    // Coger lateral/trasera del rack → colocarlo en el módulo → atornillar
    const rack = [robot.pos[0] + (robot.index === 2 ? 0.8 : 0), SIDE_RACK.y + 0.3, robot.pos[2] + s * SIDE_RACK.dz];
    const sides = robot.index === 2 ? [-1, 1] : [rx < 0 ? -1 : 1];
    sides.forEach((sx) => {
      pts.push({ p: rack, g: DOWN, kind: 'pick' });
      pts.push({ p: [cx + sx * 0.25, PIECE_Y + CABINET.ly + 0.06, z0 + s * 0.12], g: DOWN, kind: 'place' });
      pts.push({ p: [cx + sx * 0.12, PIECE_Y + 0.25, z0 + s * (CABINET.lz / 2 + 0.02)], g: 0, kind: 'screw' });
      pts.push({ p: [cx + sx * 0.12, PIECE_Y + 0.55, z0 + s * (CABINET.lz / 2 + 0.02)], g: 0, kind: 'screw' });
    });
  }

  if (robot.cellId === 'BAR') {
    // Robots colgados: pasada superior y laterales del módulo de su lado
    const hx = CABINET.lx / 2 + 0.25, yTop = PIECE_Y + CABINET.ly + 0.35;
    const zf = z0 + s * (CABINET.lz / 2 + 0.38);
    pts.push({ p: [cx - hx, yTop, z0 + s * 0.12], g: DOWN, kind: 'spray' });
    pts.push({ p: [cx + hx, yTop, z0 + s * 0.12], g: DOWN, kind: 'spray' });
    pts.push({ p: [cx + hx, PIECE_Y + 0.6, zf], g: 0, kind: 'spray' });
    pts.push({ p: [cx - hx, PIECE_Y + 0.6, zf], g: 0, kind: 'spray' });
    pts.push({ p: [cx - hx, PIECE_Y + 0.25, zf], g: 0, kind: 'spray' });
    pts.push({ p: [cx + hx, PIECE_Y + 0.25, zf], g: 0, kind: 'spray' });
  }
  return pts;
}

/** Pose de reposo (TCP). */
export function homePointFor(robot) {
  const s = robot.side;
  if (robot.inverted) return { p: [robot.pos[0], BAR_BEAM_Y - 1.5, robot.pos[2] - s * 0.6], g: DOWN };
  return { p: [robot.pos[0], 1.6, robot.pos[2] - s * 1.0], g: DOWN };
}

// ═════════════════════════════════════════════════════════════════════════════
// ZONA DE ASERRADO Y SECADO
// ═════════════════════════════════════════════════════════════════════════════
export const LOG_YARD = { x0: -66, x1: -47, z0: 12.5, z1: 28, pileX: -57, rows: [15.5, 19.5, 23.5, 27] };
export const LOG_GANTRY = { x0: -66, x1: -36, z0: 11, z1: 29, railY: 8.2 };
export const SAW = { z: 20, deckX: -41, headX: -35, outX: -28, y: 0.85 };
export const STACKER = { x0: -32, x1: -14, z0: 12, z1: 23, railY: 5.2 };
export const SAW_PAD = [-19, 15];                         // pila verde para el AGV-A
export const KILN = { x0: -66, x1: -50, z0: -28, z1: -10, inX: -62, outX: -54 };
export const PLANER_PAD = [-47, LINE_Z];                  // pila seca junto a la cepilladora

// ═════════════════════════════════════════════════════════════════════════════
// PALETIZADO, ALMACÉN Y MUELLE
// ═════════════════════════════════════════════════════════════════════════════
export const PALLETIZER = { pos: [40.4, 0, LINE_Z], yaw: 0, pallet: [40.4, -13.9], wrapper: [42.4, -13.9] };
export const RACK = { xs: [26, 30, 34, 38, 42, 46], rowZ: [13.1, 18.9], aisleZ: 16, levels: [0.12, 1.75] };
export const DOCK = { x: 64.5, z: 16, truckX: 74 };

// ═════════════════════════════════════════════════════════════════════════════
// RED DE CAMINOS DE LOS AGVs (nodos = cruces y puntos de parada)
// Los carriles son de sentido único; los cruces y confluencias son nodos, y el
// gestor de tráfico concede cada nodo a un único AGV (reserva de nodos).
// ═════════════════════════════════════════════════════════════════════════════
const N = {};
const add = (id, x, z) => { N[id] = [x, z]; };
// Oeste: carril z = 4 (sentido oeste) y z = −4 (sentido este)
add('A_home', -27.5, 9.5); add('B_home', -39, 9.5);   // entre pilares de los pórticos
add('padApp', -19, 9.5); add('sawPad', SAW_PAD[0], SAW_PAD[1]);
for (const x of [-19, -24, -30, -39, -47, -54, -62]) add(`w4_${x}`, x, 4);
for (const x of [-62, -54, -47, -39, -30, -24]) add(`wm4_${x}`, x, -4);
add('kilnIn', KILN.inX, -7.5); add('kilnOut', KILN.outX, -7.5);
add('planSp', -47, -11); add('planPad', PLANER_PAD[0], PLANER_PAD[1]);
// Este: carril z = 4 (sentido este), z = 7 (sentido oeste) y pasillo z = 16 (sentido este)
add('C_home', 32, 9.5); add('D_home', 36, 9.5);
for (const x of [32, 40.4, 48]) add(`e4_${x}`, x, 4);
for (const x of [56, 48, 40, 36, 32, 24, 20]) add(`e7_${x}`, x, 7);
add('palSp', 40.4, -4); add('palPick', PALLETIZER.pallet[0], -11.2);
add('aisleIn', 20, RACK.aisleZ);
for (const x of RACK.xs) add(`ai_${x}`, x, RACK.aisleZ);
add('ai_50', 50, RACK.aisleZ); add('ai_56', 56, RACK.aisleZ); add('ai_60', 60, RACK.aisleZ);
add('dock', DOCK.x, DOCK.z);
export const NODES = N;

const seq = (...ids) => ids;
/** Rutas (listas de nodos) por misión. Las de almacén insertan el nodo del hueco. */
export const ROUTES = {
  // AGV-A: pila verde del aserradero → secadero → vuelta a su base
  A_toPad: seq('A_home', 'padApp', 'sawPad'),
  A_toKiln: seq('sawPad', 'padApp', 'w4_-19', 'w4_-24', 'w4_-30', 'w4_-39', 'w4_-47', 'w4_-54', 'w4_-62', 'wm4_-62', 'kilnIn'),
  A_home: seq('kilnIn', 'wm4_-62', 'wm4_-54', 'wm4_-47', 'wm4_-39', 'wm4_-30', 'wm4_-24', 'w4_-24', 'A_home'),
  // AGV-B: secadero (pila seca) → cepilladora → base
  B_toKiln: seq('B_home', 'w4_-39', 'w4_-47', 'w4_-54', 'wm4_-54', 'kilnOut'),
  B_toPlaner: seq('kilnOut', 'wm4_-54', 'wm4_-47', 'planSp', 'planPad'),
  B_home: seq('planPad', 'planSp', 'wm4_-47', 'wm4_-39', 'w4_-39', 'B_home'),
  // Carretilla AGV-C: palé enfardado → hueco libre del almacén → base
  C_toPallet: seq('C_home', 'e7_32', 'e4_32', 'e4_40.4', 'palSp', 'palPick'),
  C_toRack: (x) => seq('palPick', 'palSp', 'e4_40.4', 'e4_48', 'e7_48', 'e7_40', 'e7_36', 'e7_32', 'e7_24', 'e7_20', 'aisleIn',
    ...RACK.xs.filter((v) => v <= x).map((v) => `ai_${v}`)),
  C_home: (x) => seq(`ai_${x}`, ...RACK.xs.filter((v) => v > x).map((v) => `ai_${v}`), 'ai_50', 'ai_56', 'e7_56', 'e7_48', 'e7_40', 'e7_36', 'e7_32', 'C_home'),
  // Carretilla AGV-D: hueco del almacén → camión en el muelle → base
  D_toRack: (x) => seq('D_home', 'e7_36', 'e7_32', 'e7_24', 'e7_20', 'aisleIn', ...RACK.xs.filter((v) => v <= x).map((v) => `ai_${v}`)),
  D_toDock: (x) => seq(`ai_${x}`, ...RACK.xs.filter((v) => v > x).map((v) => `ai_${v}`), 'ai_50', 'ai_56', 'ai_60', 'dock'),
  D_home: seq('dock', 'ai_60', 'ai_56', 'e7_56', 'e7_48', 'e7_40', 'e7_36', 'D_home'),
};

export const SILO = { x: -75, z: 2, r: 3.2, h: 13 };
export const CONTROL_ROOM = { x: 3, z: 20 };
