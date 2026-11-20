// Cambia la distribución a mitad de simulación (posiciones aleatorias válidas) y comprueba
// que la planta sigue produciendo y que ningún AGV se queda atascado.
import { World } from '../shared/sim/world.js';
import { buildPlant } from '../shared/layout.js';
import { ZONES, ZONE_IDS, DEFAULT_PLACEMENTS } from '../shared/zones.js';
let seed = 7; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
function randomLayout() {
  for (let tries = 0; tries < 4000; tries++) {
    const p = structuredClone(DEFAULT_PLACEMENTS);
    const n = 1 + Math.floor(rnd() * 3);
    for (let k = 0; k < n; k++) {
      const id = ZONE_IDS.filter((z) => ZONES[z].movable)[Math.floor(rnd() * 12)];
      if (!id) continue;
      p[id] = { x: Math.round(p[id].x + (rnd() - 0.5) * 24), z: Math.round(p[id].z + (rnd() - 0.5) * 16), rot: rnd() < 0.3 ? Math.floor(rnd() * 4) : p[id].rot };
    }
    const pl = buildPlant(p);
    if (pl.valid) return p;
  }
  return null;
}
let fails = 0;
for (let k = 0; k < 6; k++) {
  const w = new World();
  w.run(3 * 3600);
  const before = Object.values(w.kpi.produced).reduce((a, b) => a + b, 0);
  const lay = randomLayout();
  if (!lay) { console.log('no layout'); continue; }
  const r = w.applyLayout(lay);
  let stuck = 0;
  for (let i = 0; i < 5 * 3600 / 30; i++) { w.run(30); for (const a of w.logistics.agvs) if (a.wait === 'Sin ruta disponible') stuck++; }
  const after = Object.values(w.kpi.produced).reduce((a, b) => a + b, 0);
  const moved = ZONE_IDS.filter((z) => JSON.stringify(lay[z]) !== JSON.stringify(DEFAULT_PLACEMENTS[z]));
  const ok = r.ok && after - before > 40 && stuck < 5;
  if (!ok) fails++;
  console.log(ok ? 'OK ' : 'FAIL', moved.join(','), 'unidades en 5 h:', after - before, 'stuck', stuck, w.line.blocked, w.logistics.agvs.map((a) => a.mission).join(' | '));
}
process.exit(fails ? 1 : 0);
