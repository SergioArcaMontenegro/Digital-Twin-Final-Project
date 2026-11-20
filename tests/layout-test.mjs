import { buildPlant } from '../shared/layout.js';
import { DEFAULT_PLACEMENTS, ZONE_IDS, ZONES } from '../shared/zones.js';
let t=performance.now();
const P = buildPlant(DEFAULT_PLACEMENTS);
console.log('ms', (performance.now()-t).toFixed(1), 'valid', P.valid, P.errors);
console.log('conveyor', P.conveyor.pts.map(p=>p.map(v=>+v.toFixed(2)).join(',')).join(' | '), 'len', P.conveyor.length.toFixed(1));
console.log('stations s', P.stations.map(s=>s.id+':'+s.s.toFixed(1)).join(' '));
// test path
for (const [a,b] of [['AGVB.chg_0','ASE.pad'],['ASE.pad','KILN.in'],['KILN.out','CEP.pad'],['AGVB.chg_2','PAL.pallet'],['PAL.pallet','ALM.rack_0_3'],['ALM.rack_1_6','DOCK.load']]) {
  const A=P.ports[a],B=P.ports[b]; t=performance.now();
  const path=P.nav.findPath(A.ax,A.az,B.ax,B.az);
  console.log(a,'->',b, path? path.length+' pts '+path.map(p=>p.map(v=>v.toFixed(1)).join(',')).join(' ') : 'NULL', (performance.now()-t).toFixed(1)+'ms');
}
// rotated / moved
const Q = {...DEFAULT_PLACEMENTS, LIJ:{x:-10,z:-8,rot:1}, ENS:{x:2,z:-8,rot:3}};
const P2=buildPlant(Q); console.log('moved valid', P2.valid, P2.errors.map(e=>e.msg));
const Q2 = {...DEFAULT_PLACEMENTS, ENS:{x:6,z:-2,rot:0}};
const P3=buildPlant(Q2); console.log('ENS displaced', P3.valid, P3.errors.map(e=>e.msg), P3.conveyor.pts.length);
