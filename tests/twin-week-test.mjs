// Criterio de aceptación 1: una semana simulada sin gemelo provoca paradas no programadas
// (y simultáneas); con el gemelo activo, ninguna. También comprueba que la caja cuadra.
import { World } from '../shared/sim/world.js';
import { fmtEur } from '../shared/config.js';
const days = +(process.argv[2] || 7);
const res = {};
for (const twin of [true, false]) {
  const w = new World();
  w.settings.twinEnabled = twin;
  w.run(days * 86400, 0.5);
  const ledger = Object.values(w.eco.days).reduce((a, d) => a + Object.values(d).reduce((x, y) => x + y, 0), 0);
  const produced = Object.values(w.kpi.produced).reduce((a, b) => a + b, 0);
  res[twin ? 'con gemelo' : 'sin gemelo'] = { paradas: w.kpi.unplanned, simultaneas: w.kpi.simultaneous, preventivos: w.kpi.maint, producidas: produced, caja: fmtEur(w.eco.cash), cuadra: Math.abs(60000 + ledger - w.eco.cash) < 1 };
}
console.table(res);
const ok = res['con gemelo'].paradas === 0 && res['sin gemelo'].paradas > 0 && res['con gemelo'].cuadra && res['sin gemelo'].cuadra;
console.log(ok ? 'OK' : 'FALLO');
process.exit(ok ? 0 : 1);
