// ─────────────────────────────────────────────────────────────────────────────
// Generador del modelo 3D del brazo robótico industrial de 6 ejes
//
//   node scripts/generate-robot-arm.mjs      (o:  npm run models:robot)
//
// Salida: public/models/robot_arm.glb
//
// Jerarquía de nodos (los nombres los usa AdvancedRobot.jsx para animar):
//
//   RobotArm                 (pedestal fijo)
//   └─ J0  base      · rot Y  · y = 1.4
//      └─ J1  hombro · rot Z  · y = +1.0
//         └─ J2  codo  · rot Z · y = +2.8   (brazo superior)
//            └─ J3  muñeca pitch · rot Z · y = +2.2  (antebrazo)
//               └─ J4  muñeca roll · rot Y · y = +0.45
//                  ├─ Finger_L   (pinza paralela, desliza en X)
//                  └─ Finger_R
//
// LED_0 … LED_5: indicadores de temperatura por articulación (material propio).
// Unidades = unidades de la escena (≈ 1 u = 0.25 m).
// ─────────────────────────────────────────────────────────────────────────────
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mergeGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

// ── Polyfill mínimo de FileReader para GLTFExporter en Node ──────────────────
globalThis.FileReader ??= class {
  readAsArrayBuffer(blob) {
    blob.arrayBuffer().then((buf) => { this.result = buf; this.onloadend?.(); });
  }
  readAsDataURL(blob) {
    blob.arrayBuffer().then((buf) => {
      this.result = `data:${blob.type || 'application/octet-stream'};base64,${Buffer.from(buf).toString('base64')}`;
      this.onloadend?.();
    });
  }
};

// ── Materiales ──────────────────────────────────────────────────────────────
const MAT = {
  body:   new THREE.MeshStandardMaterial({ name: 'Robot_Body',   color: '#ecebe6', metalness: 0.25, roughness: 0.42 }),
  joint:  new THREE.MeshStandardMaterial({ name: 'Robot_Joint',  color: '#1e2024', metalness: 0.75, roughness: 0.32 }),
  accent: new THREE.MeshStandardMaterial({ name: 'Robot_Accent', color: '#ff6a13', metalness: 0.2,  roughness: 0.45 }),
  steel:  new THREE.MeshStandardMaterial({ name: 'Robot_Steel',  color: '#a3a9b0', metalness: 1.0,  roughness: 0.28 }),
  rubber: new THREE.MeshStandardMaterial({ name: 'Robot_Rubber', color: '#111111', metalness: 0.0,  roughness: 0.9 }),
  base:   new THREE.MeshStandardMaterial({ name: 'Robot_Base',   color: '#3a3d42', metalness: 0.6,  roughness: 0.5 }),
};

// ── Helpers de geometría ────────────────────────────────────────────────────
const SEG = 40;

/** Cilindro con eje en Z, centrado en (x, y, z). */
function cylZ(r, len, x = 0, y = 0, z = 0, rTop = r) {
  const g = new THREE.CylinderGeometry(rTop, r, len, SEG);
  g.rotateX(Math.PI / 2);
  g.translate(x, y, z);
  return g;
}

/** Cilindro con eje en Y, de y0 a y1. */
function cylY(rBottom, rTop, y0, y1, x = 0, z = 0) {
  const g = new THREE.CylinderGeometry(rTop, rBottom, y1 - y0, SEG);
  g.translate(x, (y0 + y1) / 2, z);
  return g;
}

function rbox(w, h, d, r, x = 0, y = 0, z = 0) {
  const g = new RoundedBoxGeometry(w, h, d, 4, r);
  g.translate(x, y, z);
  return g;
}

/** Perfil por revolución (eje Y): pts = [[r, y], …] */
function lathe(pts) {
  return new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(r, y)), SEG);
}

/**
 * "Estadio" cónico: contorno exterior de dos círculos (r1 en y=0, r2 en y=L),
 * extruido en Z con bisel. Es la forma típica de los eslabones fundidos.
 */
function stadium(r1, r2, L, depth, z = 0, bevel = 0.05) {
  const R1 = r1 - bevel, R2 = r2 - bevel;
  const th = Math.asin((R1 - R2) / L);
  const s = new THREE.Shape();
  s.moveTo(R1 * Math.cos(th), R1 * Math.sin(th));
  s.lineTo(R2 * Math.cos(th), L + R2 * Math.sin(th));
  s.absarc(0, L, R2, th, Math.PI - th, false);
  s.lineTo(-R1 * Math.cos(th), R1 * Math.sin(th));
  s.absarc(0, 0, R1, Math.PI - th, 2 * Math.PI + th, false);
  const g = new THREE.ExtrudeGeometry(s, {
    depth: depth - 2 * bevel, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel,
    bevelSegments: 4, curveSegments: 48,
  });
  g.translate(0, 0, z - (depth - 2 * bevel) / 2);
  return g;
}

/** Anillo de tornillos en el plano XZ (eje Y). */
function boltRingY(n, radius, y, r = 0.045, h = 0.06) {
  const parts = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const g = new THREE.CylinderGeometry(r, r, h, 6);
    g.translate(Math.cos(a) * radius, y + h / 2, Math.sin(a) * radius);
    parts.push(g);
  }
  return parts;
}

/** Anillo de tornillos sobre una cara perpendicular a Z. */
function boltRingZ(n, radius, cx, cy, z, r = 0.035, h = 0.05) {
  const parts = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + Math.PI / n;
    parts.push(cylZ(r, h, cx + Math.cos(a) * radius, cy + Math.sin(a) * radius, z));
  }
  return parts;
}

/** Normaliza atributos (solo position/normal, indexada y soldada) para poder fusionarlas. */
function normalize(g) {
  for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal') g.deleteAttribute(k);
  g.morphAttributes = {};
  g.clearGroups();
  return mergeVertices(g, 1e-4);
}

/** Construye un eslabón: fusiona la geometría por material → pocas draw calls. */
function link(name, partsByMat) {
  const group = new THREE.Group();
  group.name = name;
  for (const [key, geoms] of Object.entries(partsByMat)) {
    if (!geoms.length) continue;
    const merged = mergeGeometries(geoms.map(normalize), false);
    if (!merged) throw new Error(`No se pudo fusionar ${name}/${key}`);
    const mesh = new THREE.Mesh(merged, MAT[key]);
    mesh.name = `${name}_${key}`;
    group.add(mesh);
  }
  return group;
}

/** LED de temperatura: material propio para poder colorearlo en tiempo real. */
function led(i, x, y, z) {
  const m = new THREE.Mesh(
    new THREE.SphereGeometry(0.05, 12, 8),
    new THREE.MeshStandardMaterial({ name: `LED_${i}`, color: '#00ff44', emissive: '#00ff44', emissiveIntensity: 1 }),
  );
  m.name = `LED_${i}`;
  m.position.set(x, y, z);
  return m;
}

// ── Dimensiones de la cadena cinemática (iguales a las de la simulación) ─────
const BASE_H = 1.4;     // altura del eje J0
const SHOULDER_H = 1.0; // J1 sobre J0
const UPPER = 2.8;      // J1 → J2
const FORE = 2.2;       // J2 → J3
const WRIST = 0.45;     // J3 → J4

// ═════════════════════════════════════════════════════════════════════════════
// PEDESTAL (fijo)
// ═════════════════════════════════════════════════════════════════════════════
const root = new THREE.Group();
root.name = 'RobotArm';

root.add(link('Pedestal', {
  base: [
    cylY(1.3, 1.3, 0, 0.2),                                   // placa de anclaje
    lathe([[0, 0.2], [1.02, 0.2], [1.0, 0.32], [0.86, 1.1], [0.86, BASE_H - 0.12], [0, BASE_H - 0.12]]),
    rbox(0.32, 0.5, 0.62, 0.06, -0.92, 0.55, 0),              // caja de conectores
  ],
  steel: [
    ...boltRingY(8, 1.12, 0.2, 0.06, 0.07),                   // pernos al suelo
    ...[0.15, -0.15].map((z) => {                             // conectores de cable
      const g = new THREE.CylinderGeometry(0.08, 0.08, 0.16, 16);
      g.rotateZ(Math.PI / 2);
      g.translate(-1.12, 0.66, z);
      return g;
    }),
  ],
  accent: [
    cylY(0.875, 0.875, 1.12, 1.2),                            // franja naranja
  ],
  joint: [
    cylY(0.9, 0.9, BASE_H - 0.12, BASE_H),                    // rodamiento J0
  ],
}));

// ═════════════════════════════════════════════════════════════════════════════
// J0 — TORRETA (gira en Y)
// ═════════════════════════════════════════════════════════════════════════════
const j0 = new THREE.Group();
j0.name = 'J0';
j0.position.set(0, BASE_H, 0);
root.add(j0);

j0.add(link('Link1', {
  body: [
    lathe([[0, 0], [0.9, 0], [0.88, 0.18], [0.72, 0.42], [0, 0.42]]),       // carcasa giratoria
    rbox(1.05, 0.75, 0.62, 0.14, 0.0, 0.62, 0.0),                           // soporte del hombro
    cylZ(0.56, 0.62, 0, SHOULDER_H, 0),                                     // alojamiento del eje J1
  ],
  joint: [
    cylZ(0.34, 0.5, 0, SHOULDER_H, -0.55),                                  // motor J1
    cylZ(0.4, 0.06, 0, SHOULDER_H, -0.33),
  ],
  steel: [
    cylZ(0.3, 0.06, 0, SHOULDER_H, -0.83),                                  // tapa del motor
    ...boltRingZ(6, 0.24, 0, SHOULDER_H, -0.87),
  ],
  accent: [
    rbox(0.5, 0.2, 0.04, 0.02, 0, 0.62, 0.32),                              // placa frontal
  ],
}));
j0.add(led(0, 0.0, 0.62, 0.36));

// ═════════════════════════════════════════════════════════════════════════════
// J1 — BRAZO SUPERIOR (gira en Z)  · montado lateralmente (z ≈ +0.5)
// ═════════════════════════════════════════════════════════════════════════════
const j1 = new THREE.Group();
j1.name = 'J1';
j1.position.set(0, SHOULDER_H, 0);
j0.add(j1);

const UA_Z = 0.5;
j1.add(link('Link2', {
  body: [
    stadium(0.5, 0.4, UPPER, 0.44, UA_Z),
  ],
  joint: [
    cylZ(0.44, 0.06, 0, 0, UA_Z + 0.25),                                    // tapa hombro
    cylZ(0.34, 0.06, 0, UPPER, UA_Z + 0.25),                                // tapa codo
  ],
  steel: [
    ...boltRingZ(8, 0.34, 0, 0, UA_Z + 0.28),
    cylZ(0.12, 0.05, 0, 0, UA_Z + 0.29),
  ],
  accent: [
    (() => { const g = stadium(0.3, 0.24, UPPER - 1.2, 0.04, 0, 0.015); g.translate(0, 0.6, UA_Z + 0.235); return g; })(),
  ],
}));
j1.add(led(1, 0, 0, UA_Z + 0.32));

// ═════════════════════════════════════════════════════════════════════════════
// J2 — CODO + ANTEBRAZO (gira en Z)
// ═════════════════════════════════════════════════════════════════════════════
const j2 = new THREE.Group();
j2.name = 'J2';
j2.position.set(0, UPPER, 0);
j1.add(j2);

j2.add(link('Link3', {
  body: [
    cylZ(0.42, 0.62, 0, 0, 0),                                              // alojamiento del codo
    rbox(0.62, 0.75, 0.6, 0.14, 0, -0.32, 0),                               // carcasa motores muñeca (contrapeso)
    cylY(0.29, 0.21, 0.3, FORE - 0.22),                                     // antebrazo cónico
    rbox(0.5, 0.32, 0.5, 0.1, 0, FORE - 0.3, 0),                            // transición a horquilla
    rbox(0.32, 0.5, 0.09, 0.04, 0, FORE - 0.1, 0.2),                        // horquilla +Z
    rbox(0.32, 0.5, 0.09, 0.04, 0, FORE - 0.1, -0.2),                       // horquilla -Z
  ],
  joint: [
    cylZ(0.3, 0.06, 0, 0, -0.33),                                           // tapa codo
    cylZ(0.18, 0.36, 0, -0.55, 0.0),                                        // motores de muñeca
  ],
  steel: [
    ...boltRingZ(6, 0.22, 0, 0, -0.37),
    cylZ(0.16, 0.04, 0, -0.55, 0.2),
    cylZ(0.16, 0.04, 0, -0.55, -0.2),
  ],
  accent: [
    cylY(0.275, 0.27, 0.55, 0.68),                                          // anillo naranja
  ],
}));
j2.add(led(2, 0, 0, -0.38));

// ═════════════════════════════════════════════════════════════════════════════
// J3 — MUÑECA PITCH (gira en Z)
// ═════════════════════════════════════════════════════════════════════════════
const j3 = new THREE.Group();
j3.name = 'J3';
j3.position.set(0, FORE, 0);
j2.add(j3);

j3.add(link('Link4', {
  joint: [
    cylZ(0.2, 0.32, 0, 0, 0),                                               // eje de muñeca
  ],
  body: [
    cylY(0.17, 0.16, 0.0, WRIST - 0.04),                                    // cuerpo de muñeca
  ],
  steel: [
    cylZ(0.1, 0.5, 0, 0, 0),                                                // bulón que asoma por la horquilla
  ],
}));
j3.add(led(3, 0, 0, 0.27));

// ═════════════════════════════════════════════════════════════════════════════
// J4 — MUÑECA ROLL (gira en Y) + PINZA
// ═════════════════════════════════════════════════════════════════════════════
const j4 = new THREE.Group();
j4.name = 'J4';
j4.position.set(0, WRIST, 0);
j3.add(j4);

j4.add(link('Link5', {
  steel: [
    cylY(0.16, 0.16, -0.04, 0.04),                                          // brida ISO
    ...boltRingY(6, 0.12, 0.04, 0.02, 0.02),
  ],
  joint: [
    rbox(0.52, 0.22, 0.32, 0.05, 0, 0.15, 0),                               // cuerpo de la pinza
    rbox(0.5, 0.06, 0.12, 0.02, 0, 0.27, 0),                                // guía de los dedos
  ],
  accent: [
    rbox(0.3, 0.08, 0.02, 0.01, 0, 0.15, 0.165),
  ],
}));
j4.add(led(4, 0.2, 0.15, 0.17));
j4.add(led(5, -0.2, 0.15, 0.17));

for (const side of [-1, 1]) {
  const f = new THREE.Group();
  f.name = side < 0 ? 'Finger_L' : 'Finger_R';
  f.position.set(side * 0.2, 0.27, 0);      // posición "abierta"; la app la desplaza en X
  f.add(link(`${f.name}_Mesh`, {
    steel: [rbox(0.08, 0.44, 0.18, 0.025, 0, 0.24, 0)],
    rubber: [rbox(0.03, 0.2, 0.15, 0.01, -side * 0.05, 0.34, 0)],
  }));
  j4.add(f);
}

// ═════════════════════════════════════════════════════════════════════════════
// EXPORTAR
// ═════════════════════════════════════════════════════════════════════════════
const here = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.resolve(here, '../public/models');
fs.mkdirSync(outDir, { recursive: true });
const outFile = path.join(outDir, 'robot_arm.glb');

const scene = new THREE.Scene();
scene.add(root);
const glb = await new GLTFExporter().parseAsync(scene, { binary: true });
fs.writeFileSync(outFile, Buffer.from(glb));

let tris = 0;
root.traverse((o) => { if (o.isMesh) tris += (o.geometry.index?.count ?? o.geometry.attributes.position.count) / 3; });
console.log(`✔ ${path.relative(process.cwd(), outFile)}  (${(glb.byteLength / 1024).toFixed(0)} KB, ${tris.toFixed(0)} triángulos)`);
