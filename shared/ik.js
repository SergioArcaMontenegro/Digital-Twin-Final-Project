// Cinemática inversa analítica para los robots de 6 ejes (ver robotSpecs.js).
//
// Simplificación habitual en celdas de proceso: la herramienta trabaja en el plano
// vertical que contiene el eje J1 (J4 = 0). Así el problema se reduce a:
//   J1 = orientación radial, (J2, J3) = brazo plano de 2 eslabones (codo arriba),
//   J5 = ángulo de herramienta deseado γ, J6 = giro libre de la brida.

import { ROBOT_SPECS, ROBOT_MODELS, toolLength } from './robotSpecs.js';

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

/**
 * @param {string} modelKey   'cnc' | 'sanding' | 'assembly' | 'varnish' | 'palletizer'
 * @param {number[]} local    objetivo del TCP en coordenadas del robot [x, y, z]
 * @param {number} gamma      ángulo de la herramienta en el plano radial (0 = horizontal, -π/2 = hacia abajo)
 * @param {number} roll       giro de J6
 * @returns {number[]}        [q1..q6] en radianes
 */
export function solveIK(modelKey, local, gamma = -Math.PI / 2, roll = 0) {
  const S = ROBOT_SPECS[ROBOT_MODELS[modelKey].spec];
  const Lt = toolLength(modelKey);
  const [x, y, z] = local;

  // J1: girar la torreta hacia el objetivo (rotación +θ en Y lleva +X a (cosθ, 0, −sinθ))
  const q1 = Math.atan2(-z, x);

  // Coordenadas en el plano radial, referidas al eje del hombro
  const rT = Math.hypot(x, z);
  const rW = rT - Lt * Math.cos(gamma) - S.a1;
  const hW = y - Lt * Math.sin(gamma) - S.d1;

  const L2 = S.L2;
  const Lf = Math.hypot(S.L3, S.a3);
  const phi = Math.atan2(S.a3, S.L3);

  // Si el objetivo queda fuera de alcance se estira el brazo (D se recorta a [-1, 1])
  const D = clamp((rW * rW + hW * hW - L2 * L2 - Lf * Lf) / (2 * L2 * Lf), -1, 1);
  const delta = -Math.acos(D);                              // codo arriba
  const alpha = Math.atan2(hW, rW) - Math.atan2(Lf * Math.sin(delta), L2 + Lf * Math.cos(delta));

  const q2 = alpha - Math.PI / 2;
  const q3 = delta + Math.PI / 2 - phi;
  // El eje del antebrazo (J4→J5) forma q2+q3 con la horizontal; J5 completa hasta γ
  const q5 = gamma - (q2 + q3);

  return [q1, q2, q3, 0, q5, roll];
}

/**
 * Transforma un punto del mundo al sistema local de un robot.
 * Montaje en techo (inverted): la base está volteada 180° en X, así que la altura y la
 * coordenada Z locales cambian de signo antes de deshacer la guiñada.
 */
export function worldToRobot([wx, wy, wz], [bx, by, bz], yaw, inverted = false) {
  let dx = wx - bx, dy = wy - by, dz = wz - bz;
  if (inverted) { dy = -dy; dz = -dz; }
  const c = Math.cos(-yaw), s = Math.sin(-yaw);
  return [c * dx + s * dz, dy, -s * dx + c * dz];
}

/** IK de un punto de trabajo en coordenadas de mundo para un robot del layout. */
export function solveWorld(def, pt) {
  const local = worldToRobot(pt.p, def.pos, def.yaw, def.inverted);
  return solveIK(def.model, local, def.inverted ? -pt.g : pt.g);
}

/** Interpolación suave entre dos configuraciones articulares. */
export function lerpJoints(a, b, t, out = new Array(6)) {
  const k = t * t * (3 - 2 * t);
  for (let i = 0; i < 6; i++) out[i] = a[i] + (b[i] - a[i]) * k;
  return out;
}
