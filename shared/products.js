// ─────────────────────────────────────────────────────────────────────────────
// Geometría de los productos y de sus piezas (coordenadas de la BANDEJA: origen en el
// centro de la bandeja, y = 0 en su superficie, X a lo largo de la cinta).
//
// Cada pieza tiene dos poses:
//   lay  → tumbada sobre la bandeja tal como sale del CNC
//   asm  → en su sitio en el mueble montado
// El robot de ensamblaje la coge en `lay` y la deja en `asm`; el visor interpola entre
// ambas mientras la pieza viaja en la herramienta. La lista está en orden de montaje.
// ─────────────────────────────────────────────────────────────────────────────
import { SPECIES, TONES } from './config.js';

const PI = Math.PI;
const H = PI / 2;

const part = (name, size, lay, layR, asm, asmR = [0, 0, 0]) => ({ name, size, lay: { p: lay, r: layR }, asm: { p: asm, r: asmR } });

export const PARTS = {
  silla: [
    part('Pata trasera', [0.04, 0.9, 0.04], [-0.42, 0.02, -0.36], [0, 0, H], [-0.19, 0.45, -0.19]),
    part('Pata trasera', [0.04, 0.9, 0.04], [-0.42, 0.02, -0.28], [0, 0, H], [0.19, 0.45, -0.19]),
    part('Pata delantera', [0.04, 0.43, 0.04], [0.42, 0.02, -0.36], [0, 0, H], [-0.19, 0.215, 0.19]),
    part('Pata delantera', [0.04, 0.43, 0.04], [0.42, 0.02, -0.28], [0, 0, H], [0.19, 0.215, 0.19]),
    part('Travesaño', [0.34, 0.04, 0.02], [0.42, 0.01, 0.05], [H, 0, 0], [0, 0.2, 0.19]),
    part('Asiento', [0.44, 0.03, 0.44], [-0.55, 0.015, 0.15], [0, 0, 0], [0, 0.445, 0]),
    part('Respaldo', [0.38, 0.18, 0.02], [0.0, 0.01, 0.12], [H, 0, 0], [0, 0.78, -0.19]),
  ],
  mesa: [
    part('Pata', [0.06, 0.7, 0.06], [0.36, 0.03, 0], [H, 0, 0], [-0.48, 0.35, -0.28]),
    part('Pata', [0.06, 0.7, 0.06], [0.46, 0.03, 0], [H, 0, 0], [0.48, 0.35, -0.28]),
    part('Pata', [0.06, 0.7, 0.06], [0.56, 0.03, 0], [H, 0, 0], [-0.48, 0.35, 0.28]),
    part('Pata', [0.06, 0.7, 0.06], [0.66, 0.03, 0], [H, 0, 0], [0.48, 0.35, 0.28]),
    part('Faldón', [0.9, 0.08, 0.025], [0.79, 0.04, 0], [0, H, 0], [0, 0.66, -0.26]),
    part('Faldón', [0.9, 0.08, 0.025], [0.86, 0.04, 0], [0, H, 0], [0, 0.66, 0.26]),
    part('Tablero', [1.1, 0.035, 0.7], [-0.33, 0.0175, 0], [0, 0, 0], [0, 0.7175, 0]),
  ],
  // La estantería se monta tumbada sobre su trasera (como en fábrica): alto a lo largo de X
  estanteria: [
    part('Lateral', [0.02, 1.2, 0.3], [-0.3, 0.01, -0.28], [0, 0, H], [0, 0.15, -0.39], [H, 0, H]),
    part('Lateral', [0.02, 1.2, 0.3], [-0.3, 0.01, 0.1], [0, 0, H], [0, 0.15, 0.39], [H, 0, H]),
    part('Balda', [0.76, 0.02, 0.3], [0.62, 0.01, 0], [0, H, 0], [-0.54, 0.15, 0], [H, 0, H]),
    part('Balda', [0.76, 0.02, 0.3], [0.62, 0.03, 0], [0, H, 0], [-0.18, 0.15, 0], [H, 0, H]),
    part('Balda', [0.76, 0.02, 0.3], [0.62, 0.05, 0], [0, H, 0], [0.2, 0.15, 0], [H, 0, H]),
    part('Balda', [0.76, 0.02, 0.3], [0.62, 0.07, 0], [0, H, 0], [0.59, 0.15, 0], [H, 0, H]),
  ],
  tablon: [
    part('Tablón', [1.8, 0.035, 0.2], [0, 0.0175, -0.33], [0, 0, 0], [0, 0.0175, -0.33]),
    part('Tablón', [1.8, 0.035, 0.2], [0, 0.0175, -0.11], [0, 0, 0], [0, 0.0175, -0.11]),
    part('Tablón', [1.8, 0.035, 0.2], [0, 0.0175, 0.11], [0, 0, 0], [0, 0.0175, 0.11]),
    part('Tablón', [1.8, 0.035, 0.2], [0, 0.0175, 0.33], [0, 0, 0], [0, 0.0175, 0.33]),
  ],
};

/** Tablero encolado del que el CNC corta las piezas (centro y tamaño). */
export const BLANK = {
  silla: { p: [-0.11, 0.02, -0.01], size: [1.58, 0.04, 0.82] },
  mesa: { p: [0, 0.02, 0], size: [1.8, 0.04, 0.9] },
  estanteria: { p: [0, 0.02, 0], size: [1.8, 0.04, 0.9] },
  tablon: null,
};

/** Caja envolvente del producto terminado [ancho X, alto, fondo Z]. */
export const DIMS = {
  silla: [0.44, 0.9, 0.42],
  mesa: [1.1, 0.735, 0.7],
  estanteria: [1.2, 0.3, 0.8],
  tablon: [1.8, 0.035, 0.86],
};

/** Posiciones en el palé (x, y, z) sobre su superficie; el producto mantiene su orientación. */
export const PALLET_PATTERN = {
  silla: [[-0.28, 0, -0.24], [0.28, 0, -0.24], [-0.28, 0, 0.24], [0.28, 0, 0.24]],
  mesa: [[0, 0, 0], [0, 0.74, 0]],
  estanteria: [[0, 0, 0], [0, 0.31, 0], [0, 0.62, 0]],
  tablon: [0, 1, 2, 3, 4, 5].map((k) => [0, k * 0.036, 0]),
};
export const PALLET_TOP = 0.14;

/** Semiejes (x, y, z) de una caja de tamaño `size` girada `r` (giros de 90°). */
export function halfExtents(size, r) {
  let [x, y, z] = size;
  // Euler 'XYZ' de three.js: el vector se gira primero en Z, luego en Y y por último en X
  if (Math.abs(Math.abs(r[2]) - H) < 1e-3) [x, y] = [y, x];
  if (Math.abs(Math.abs(r[1]) - H) < 1e-3) [x, z] = [z, x];
  if (Math.abs(Math.abs(r[0]) - H) < 1e-3) [y, z] = [z, y];
  return [x / 2, y / 2, z / 2];
}

/** Cota superior de una pieza en una pose. */
export const topOf = (pt, pose) => pt[pose].p[1] + halfExtents(pt.size, pt[pose].r)[1];

// ── Colores ──────────────────────────────────────────────────────────────────
const hexToRgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const rgbToHex = (c) => `#${c.map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('')}`;
export const mixHex = (a, b, t) => { const A = hexToRgb(a), B = hexToRgb(b); return rgbToHex(A.map((v, i) => v + (B[i] - v) * t)); };

/** Color de la madera en cada fase. stage: 'rough' | 'planed' | 'sanded' | 'finished' */
export function woodColor(species, stage, tone = 'natural') {
  const S = SPECIES[species] || SPECIES.pino;
  if (stage === 'rough') return mixHex(S.wood, '#5b4a3a', 0.45);
  if (stage === 'planed') return S.planed;
  if (stage === 'sanded') return mixHex(S.planed, '#ffffff', 0.12);
  const T = TONES[tone] || TONES.natural;
  const base = mixHex(S.planed, '#000000', 0.06);
  return T.color ? mixHex(base, T.color, T.mix) : base;
}
