import { World } from '../shared/sim/world.js';
import { fmtClock, fmtEur } from '../shared/config.js';
const days = +(process.argv[2] || 1), twin = process.argv[3] !== 'off';
const w = new World();
w.settings.twinEnabled = twin;
let errs = 0;
w.onEvent((e) => { if (['err', 'warn'].includes(e.level)) { errs++; if (errs < 60) console.log(fmtClock(e.t), e.level, e.msg); } });
const t0 = Date.now();
let lastH = -1;
for (let s = 0; s < days * 86400; s += 60) {
  w.run(60, 0.5);
  const h = Math.floor(w.t / 3600);
  if (h % 4 === 0 && h !== lastH) {
    lastH = h;
    const L = w.logistics;
    console.log(fmtClock(w.t), 'caja', fmtEur(w.eco.cash), 'prod', JSON.stringify(w.kpi.produced), 'line', w.line.blocked || '-', 'trays', w.line.slots.filter(Boolean).length,
      'yard', JSON.stringify(L.yard), 'dry', L.dryPad.species, L.dryPad.boards, 'kiln', L.kiln.stacks.length, 'AGV', L.agvs.map((a) => `${a.id}:${a.state}:${a.mission}`).join(' | '));
  }
}
console.log('time', Date.now() - t0, 'ms', 'kpi', JSON.stringify(w.kpi));
console.log('orders', w.eco.orders.map((o) => `${o.id}:${o.status}:${o.shipped}/${o.qty}`).join(' '));
console.log('wear', Object.values(w.twin.robots).map((r) => `${r.id}:${r.wear.toFixed(2)}:${r.temp.toFixed(0)}`).join(' '));
const js = JSON.stringify(w.serialize()); console.log('save bytes', js.length);
const w2 = new World(JSON.parse(js)); w2.run(3600); console.log('reload ok', fmtClock(w2.t), fmtEur(w2.eco.cash));
console.log('tick bytes', JSON.stringify(w.tick()).length, 'state bytes', JSON.stringify(w.state()).length);
