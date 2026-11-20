// Reloj de la simulación en el visor y utilidades de interpolación entre instantáneas.
import { live } from '../net/client.js';

/** Tiempo de simulación estimado ahora mismo (extrapola desde la última instantánea). */
export function simNow() {
  const k = live.tick;
  if (!k) return 0;
  if (!k.running) return k.t;
  const el = Math.min(0.35, (performance.now() - live.at) / 1000);
  return k.t + el * k.speed;
}

/** Factor 0..1 para interpolar entre la instantánea anterior y la actual. */
export function tickAlpha() {
  if (!live.prev || !live.tick) return 1;
  const span = Math.max(30, live.at - live.prevAt);
  return Math.min(1, (performance.now() - live.at) / span);
}

export const lerp = (a, b, k) => a + (b - a) * k;
export function lerpAngle(a, b, k) {
  let d = b - a;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  return a + d * k;
}
