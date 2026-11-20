// Comprueba con cinemática directa que todos los puntos de todos los productos son alcanzables
import * as THREE from 'three';
import { ROBOT_SPECS, ROBOT_MODELS, TOOL_SPECS } from '../shared/robotSpecs.js';
import { cellPlan } from '../shared/timeline.js';
import { robotsOfCell } from '../shared/zones.js';
import { PRODUCT_IDS } from '../shared/config.js';
function chain(model){
  const S=ROBOT_SPECS[ROBOT_MODELS[model].spec], tcp=TOOL_SPECS[ROBOT_MODELS[model].tool].tcp;
  const n=(x,y,z,p)=>{const g=new THREE.Group(); g.position.set(x,y,z); p&&p.add(g); return g};
  const root=n(0,0,0), j1=n(0,S.baseH,0,root), j2=n(S.a1,S.d1-S.baseH,0,j1), j3=n(0,S.L2,0,j2),
   j4=n(S.L3*0.38,S.a3,0,j3), j5=n(S.L3*0.62,0,0,j4), j6=n(S.Lw,0,0,j5), t=n(tcp,0,0,j6);
  return {root,J:[j1,j2,j3,j4,j5,j6],t};
}
let worst=0, bad=0, total=0;
for (const cell of ['CNC','LIJ','ENS','BAR']) for (const prod of PRODUCT_IDS) {
  const rs = robotsOfCell(cell);
  for (const active of [rs.map(r=>({index:r.index, share:1/rs.length})), [{index:0,share:1}], [{index:rs.length-1, share:1}]]) {
    const plan = cellPlan(cell, prod, active);
    for (const a of active) {
      const r = rs[a.index]; const c = chain(r.model);
      c.root.position.set(...r.local); c.root.rotation.set(r.inverted?Math.PI:0, r.yaw, 0);
      for (const w of [...plan.byRobot[a.index], plan.home[a.index]]) {
        const q=w.q; c.J[0].rotation.y=q[0]; c.J[1].rotation.z=q[1]; c.J[2].rotation.z=q[2]; c.J[3].rotation.x=q[3]; c.J[4].rotation.z=q[4]; c.J[5].rotation.x=q[5];
        c.root.updateMatrixWorld(true); const p=new THREE.Vector3(); c.t.getWorldPosition(p);
        const e=p.distanceTo(new THREE.Vector3(...w.p)); worst=Math.max(worst,e); total++;
        if(e>0.02){ bad++; if(bad<15) console.log(cell, prod, 'robot', a.index, w.kind, w.p.map(v=>v.toFixed(2)).join(','), 'err', e.toFixed(3)); }
      }
    }
  }
}
console.log('points', total, 'unreachable', bad, 'worst', worst.toFixed(3));
