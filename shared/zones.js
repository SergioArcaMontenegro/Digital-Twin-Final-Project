// ─────────────────────────────────────────────────────────────────────────────
// Secciones (zonas) de la planta en coordenadas LOCALES.
//
// Cada zona tiene su origen en el centro de su huella y su eje +X local en el sentido
// del flujo (en las estaciones de la línea, la cinta entra por −X y sale por +X).
// La colocación (x, z, rot) se guarda aparte (layout.js), así que mover o girar una
// zona mueve todo lo que contiene: máquinas, robots, puertos de AGV y puestos.
//
// Convenio de rumbo h (como rotation.y de three.js): dirección = (cos h, −sin h).
//   h = 0 → +X · h = π/2 → −Z · h = π → −X · h = −π/2 → +Z
//
// ports: puntos de parada de los AGV { p:[x,z], h, approach, reachTo }
//   approach: el AGV llega por A* a p − dir·approach y entra en línea recta (p. ej. bajo
//             una pila); 0 = se llega directamente a p.
//   reachTo:  distancia desde el centro del AGV hasta la carga (horquillas).
// blocks: rectángulos [x0, z0, x1, z1] que los AGV no pueden pisar.
// ─────────────────────────────────────────────────────────────────────────────

export const LINE_Y = 0.75;          // cota superior de los rodillos
export const TRAY_H = 0.06;          // bandeja portapiezas
export const PIECE_Y = LINE_Y + TRAY_H;
export const BAR_BEAM_Y = 3.4;       // viga de los robots de barnizado (montaje en techo)
export const SIDE_RACK = { dz: 1.7, y: 1.0 };

const PI = Math.PI;
const CELL = [15, 11.5];
const full = (lx, lz) => [[-lx / 2, -lz / 2, lx / 2, lz / 2]];

export const ZONES = {
  ASE: {
    name: 'Patio de troncos y aserradero', short: 'Aserradero', color: '#8c6b4a', size: [42, 17], movable: true,
    geo: {
      pileX: -13, pileZ: { pino: -6.6, haya: -3.4, roble: -0.2, nogal: 3.0 },
      truck: { x0: -20, x1: -9, z: 6.9 },
      logGantry: { x0: -21, x1: -1, z: 8.1, railY: 7.6 },
      saw: { deckX: -3.2, headX: 1.8, outX: 6.5, z: 0, y: 0.85 },
      stacker: { x0: 4, x1: 19.5, z0: -8.1, z1: 2.4, railY: 5.2 },
      pad: [16.8, -5.4],
      dust: [1.8, 1.6],
    },
    ports: { pad: { p: [16.8, -5.4], h: PI, approach: 5.6 } },
    blocks: [[-21, -8.5, 14.4, 8.5], [14.4, -3.6, 21, 8.5], [14.4, -8.5, 21, -7.3]],
    spots: { aserrador: [-4.2, -3.2] },
  },
  KILN: {
    name: 'Secadero', short: 'Secadero', color: '#b5653b', size: [16, 18], movable: true,
    geo: { chamber: [-8, -9, 8, 2], doors: [-4, 4], height: 7 },
    ports: {
      in: { p: [-4, -1.8], h: PI / 2, approach: 6.5 },
      out: { p: [4, -1.8], h: PI / 2, approach: 6.5 },
    },
    blocks: [[-8, -9, 8, 2]],
    spots: {},
  },
  CEP: {
    name: 'Cepillado y encolado', short: 'Cepillado', color: '#2f6b4f', size: [10, 8], movable: true, station: true,
    line: { in: [-5, 0], out: [5, 0], work: [0, 0] },
    geo: { pad: [-1.6, 2.7], dust: [0, 0] },
    ports: { pad: { p: [-1.6, 2.7], h: 0, approach: 5.6 } },
    blocks: [[-2.4, -1.4, 2.4, 1.4], [-3.8, 2.0, 0.6, 3.4]],
    spots: { cepillador: [-3.4, -2.4] },
  },
  CNC: {
    name: 'Fresado CNC robótico', short: 'Fresado CNC', color: '#e0663a', size: CELL, movable: true, station: true, cell: true,
    model: 'cnc', line: { in: [-7.5, 0], out: [7.5, 0], work: [0, 0] },
    robots: [[0, 1.5], [0, -1.5]], geo: { dust: [0, 0] },
    ports: {}, blocks: full(...CELL), spots: { mecanizado: [-5.6, -4.4] },
  },
  LIJ: {
    name: 'Lijado robótico', short: 'Lijado', color: '#c9a227', size: CELL, movable: true, station: true, cell: true,
    model: 'sanding', line: { in: [-7.5, 0], out: [7.5, 0], work: [0, 0] },
    robots: [[0, 1.4], [0, -1.4]], geo: { dust: [0, 0] },
    ports: {}, blocks: full(...CELL), spots: { mecanizado: [-5.6, -4.4] },
  },
  ENS: {
    name: 'Ensamblaje y atornillado', short: 'Ensamblaje', color: '#4f86c6', size: CELL, movable: true, station: true, cell: true,
    model: 'assembly', line: { in: [-7.5, 0], out: [7.5, 0], work: [0, 0] },
    robots: [[-0.85, 1.35], [0.85, 1.35], [0, -1.35]], geo: {},
    ports: {}, blocks: full(...CELL), spots: { montaje: [-5.6, -4.4] },
  },
  BAR: {
    name: 'Cabina de barnizado', short: 'Barnizado', color: '#3aa394', size: CELL, movable: true, station: true, cell: true,
    model: 'varnish', ceiling: true, line: { in: [-7.5, 0], out: [7.5, 0], work: [0, 0] },
    robots: [[-0.9, 1.7], [0.9, -1.7]], geo: { booth: [14, 8.8, 4.8] },
    ports: {}, blocks: full(...CELL), spots: { montaje: [-4.4, -5.1] },
  },
  PAL: {
    name: 'Paletizado y enfardado', short: 'Paletizado', color: '#c4793a', size: [12, 11.5], movable: true, station: true,
    line: { in: [-6, 0], out: [-2.6, 0], work: [-3.2, 0] },
    // dos puestos de palé: mientras el AGV retira uno, el robot llena el otro
    geo: { robot: [0, 0], pallet: [0, 3.1], pallets: [[0, 3.1, 0], [3.4, 0, 1]], empties: [2.6, -3.3] },
    ports: {
      pallet: { p: [0, 5.35], h: PI / 2, approach: 4.2, reachTo: 2.25 },
      palletB: { p: [5.65, 0], h: PI, approach: 4.2, reachTo: 2.25 },
    },
    blocks: [[-6, -5.75, 6, -1.1], [-6, -1.1, 3.9, 3.6], [3.9, 1.1, 6, 3.6], [-6, 3.6, -1.1, 5.75], [1.1, 3.6, 6, 5.75]],
    spots: { logistica: [-4.6, 4.4] },
  },
  ALM: {
    name: 'Almacén de producto terminado', short: 'Almacén', color: '#2f6db0', size: [24, 8.4], movable: true,
    geo: { bays: [-9, -6, -3, 0, 3, 6, 9], rowZ: [-3.0, 3.0], levels: [0.12, 1.75, 3.38] },
    ports: {},               // se generan abajo (un puerto por hueco)
    exclusive: [-12, -2.4, 12, 2.4],
    blocks: [[-10.6, -4.2, 10.6, -2.4], [-10.6, 2.4, 10.6, 4.2]],
    spots: { logistica: [-11.2, 3.4] },
  },
  DOCK: {
    name: 'Muelle de expedición', short: 'Muelle', color: '#5b6670', size: [6, 6], movable: false,
    geo: { truckX: 9.6 },
    ports: { load: { p: [-0.6, 0], h: 0, approach: 3.6, reachTo: 3.3 } },
    blocks: [[2.6, -3, 3, -1.8], [2.6, 1.8, 3, 3]],
    spots: {},
  },
  AGVB: {
    name: 'Base y carga de AGVs', short: 'Base AGV', color: '#2f8cff', size: [13, 4.5], movable: true,
    geo: { chargers: [-4.5, -1.5, 1.5, 4.5] },
    ports: {},               // chg_0 … chg_3
    blocks: [-4.5, -1.5, 1.5, 4.5].map((x) => [x - 0.35, -2.25, x + 0.35, -1.6]),
    spots: {},
  },
  CTRL: {
    name: 'Sala de control', short: 'Control', color: '#59626b', size: [9, 7], movable: true,
    geo: { floorY: 3.2 },
    ports: {}, blocks: full(9, 7),
    spots: { jefe: [-1.2, -0.6], comercial: [1.4, -0.6], gerente: [0.1, 1.2] },
    elevated: 3.2,
  },
  MANT: {
    name: 'Taller de mantenimiento', short: 'Taller', color: '#3aa394', size: [7, 5], movable: true,
    geo: {},
    ports: {}, blocks: [[-3.5, -2.5, 3.5, -1.4]],
    spots: { mantenimiento: [0, 0.5] },
  },
};

// Puertos generados
ZONES.ALM.geo.bays.forEach((x, b) => ZONES.ALM.geo.rowZ.forEach((z, row) => {
  ZONES.ALM.ports[`rack_${row}_${b}`] = { p: [x, 0], h: row === 0 ? PI / 2 : -PI / 2, approach: 0, reachTo: Math.abs(z) };
}));
ZONES.AGVB.geo.chargers.forEach((x, i) => { ZONES.AGVB.ports[`chg_${i}`] = { p: [x, 0.15], h: PI / 2, approach: 0 }; });

export const ZONE_IDS = Object.keys(ZONES);

/** Colocación por defecto (centro de la zona en el mundo y giro en cuartos de vuelta). */
export const DEFAULT_PLACEMENTS = {
  ASE: { x: -46, z: 19.5, rot: 0 },
  KILN: { x: -58, z: -19, rot: 0 },
  CEP: { x: -40, z: -17, rot: 0 },
  CNC: { x: -26, z: -17, rot: 0 },
  LIJ: { x: -10, z: -17, rot: 0 },
  ENS: { x: 6, z: -17, rot: 0 },
  BAR: { x: 22, z: -17, rot: 0 },
  PAL: { x: 36, z: -17, rot: 0 },
  ALM: { x: 36, z: 16, rot: 0 },
  DOCK: { x: 65, z: 16, rot: 0 },
  AGVB: { x: -4, z: 7.5, rot: 0 },
  CTRL: { x: 8, z: 22, rot: 0 },
  MANT: { x: -14, z: 24, rot: 0 },
};

// ── Robots de las celdas (definidos en coordenadas locales de su zona) ────────
// Desgaste inicial idéntico dentro de cada celda (se instalaron y revisaron a la vez):
// es la situación de partida que provocaba fallos simultáneos.
const INITIAL_WEAR = { CNC: [0.66, 0.47], LIJ: [0.42, 0.3], ENS: [0.63, 0.52, 0.41], BAR: [0.38, 0.27] };

export const CELL_ROBOTS = ['CNC', 'LIJ', 'ENS', 'BAR'].flatMap((cellId) =>
  ZONES[cellId].robots.map(([dx, dz], i) => {
    const inverted = !!ZONES[cellId].ceiling;
    const side = dz > 0 ? 1 : -1;
    return {
      id: `${cellId}-${i + 1}`, cellId, index: i, model: ZONES[cellId].model,
      local: [dx, inverted ? BAR_BEAM_Y : 0, dz],
      inverted, side,
      // +X local del robot mirando a la línea (en invertidos el volteo en X cambia el signo)
      yaw: inverted ? -side * PI / 2 : side * PI / 2,
      wear0: INITIAL_WEAR[cellId][i] ?? 0.3,
      rth: 0.42 + ((i * 37 + cellId.charCodeAt(0)) % 5) * 0.006,
    };
  }),
);
export const robotsOfCell = (cellId) => CELL_ROBOTS.filter((r) => r.cellId === cellId);
