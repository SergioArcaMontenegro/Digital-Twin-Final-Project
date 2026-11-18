// ─────────────────────────────────────────────────────────────────────────────
// Generador de los robots articulados del gemelo digital (planta de madera).
//
//   node scripts/generate-robots.mjs        (o:  npm run models:robots)
//
// Salida (public/models/):
//   robot_cnc.glb         6 ejes pesado + electrohusillo        (Fresado CNC)
//   robot_sanding.glb     6 ejes medio  + lijadora orbital      (Lijado)
//   robot_assembly.glb    6 ejes medio  + garra vacío/atornillador (Ensamblaje)
//   robot_varnish.glb     6 ejes pintura + pistola HVLP         (Barnizado, en techo)
//   robot_palletizer.glb  4 ejes paralelogramo + pinza horquilla (Paletizado)
//
// Jerarquía común (la usa src/components/Robot.jsx):
//   Robot › Pedestal, StatusRing, J1 › J2 › J3 › J4 › J5 › J6 › ToolChanger, Tool, TCP
//   Anclajes para piezas dinámicas: CB_A (J1) / CB_B (J2) equilibrador de muelle,
//   PR_A (J1) / PR_B (J3) biela del paralelogramo del paletizador.
//   Partes móviles de herramienta: Bit, Pad, Driver, Clamp_L, Clamp_R.
// Cotas en src/robots/robotSpecs.js (metros).
// ─────────────────────────────────────────────────────────────────────────────
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mergeGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { ROBOT_SPECS, TOOL_SPECS, ROBOT_MODELS } from '../src/robots/robotSpecs.js';

globalThis.FileReader ??= class {
  readAsArrayBuffer(blob) { blob.arrayBuffer().then((b) => { this.result = b; this.onloadend?.(); }); }
  readAsDataURL(blob) {
    blob.arrayBuffer().then((b) => {
      this.result = `data:${blob.type || 'application/octet-stream'};base64,${Buffer.from(b).toString('base64')}`;
      this.onloadend?.();
    });
  }
};

const SEG = 36;

// ── Primitivas ──────────────────────────────────────────────────────────────
const cylY = (rb, rt, y0, y1, x = 0, z = 0, seg = SEG) =>
  new THREE.CylinderGeometry(rt, rb, y1 - y0, seg).translate(x, (y0 + y1) / 2, z);
const cylX = (r0, r1, x0, x1, y = 0, z = 0, seg = SEG) =>
  new THREE.CylinderGeometry(r1, r0, x1 - x0, seg).rotateZ(-Math.PI / 2).translate((x0 + x1) / 2, y, z);
const cylZ = (r, len, x = 0, y = 0, z = 0, seg = SEG) =>
  new THREE.CylinderGeometry(r, r, len, seg).rotateX(Math.PI / 2).translate(x, y, z);
const rbox = (w, h, d, r, x = 0, y = 0, z = 0) =>
  new RoundedBoxGeometry(w, h, d, 3, Math.min(r, w / 2.01, h / 2.01, d / 2.01)).translate(x, y, z);
const lathe = (pts, seg = SEG) => new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(r, y)), seg);

function stadium(r1, r2, L, depth, z = 0, bevel = 0.02) {
  const R1 = r1 - bevel, R2 = r2 - bevel;
  const th = Math.asin((R1 - R2) / L);
  const s = new THREE.Shape();
  s.moveTo(R1 * Math.cos(th), R1 * Math.sin(th));
  s.lineTo(R2 * Math.cos(th), L + R2 * Math.sin(th));
  s.absarc(0, L, R2, th, Math.PI - th, false);
  s.lineTo(-R1 * Math.cos(th), R1 * Math.sin(th));
  s.absarc(0, 0, R1, Math.PI - th, 2 * Math.PI + th, false);
  const g = new THREE.ExtrudeGeometry(s, {
    depth: Math.max(0.002, depth - 2 * bevel), bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel,
    bevelSegments: 3, curveSegments: 40,
  });
  return g.translate(0, 0, z - Math.max(0.002, depth - 2 * bevel) / 2);
}

const boltsY = (n, rad, y, r, h, cx = 0, cz = 0) => Array.from({ length: n }, (_, i) => {
  const a = (i / n) * Math.PI * 2;
  return new THREE.CylinderGeometry(r, r, h, 6).translate(cx + Math.cos(a) * rad, y + h / 2, cz + Math.sin(a) * rad);
});
const boltsZ = (n, rad, cx, cy, z, r, h) => Array.from({ length: n }, (_, i) => {
  const a = (i / n) * Math.PI * 2 + Math.PI / n;
  return cylZ(r, h, cx + Math.cos(a) * rad, cy + Math.sin(a) * rad, z, 8);
});
const boltsX = (n, rad, x, r, h) => Array.from({ length: n }, (_, i) => {
  const a = (i / n) * Math.PI * 2;
  return cylX(r, r, x, x + h, Math.cos(a) * rad, Math.sin(a) * rad, 8);
});
/** Aletas de refrigeración (anillos) a lo largo de X. */
const finsX = (r, x0, x1, n, t = 0.006) => Array.from({ length: n }, (_, i) => {
  const x = x0 + ((x1 - x0) * (i + 0.5)) / n;
  return cylX(r, r, x - t / 2, x + t / 2, 0, 0, 28);
});

function normalize(g) {
  for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal') g.deleteAttribute(k);
  g.morphAttributes = {};
  g.clearGroups();
  return mergeVertices(g, 1e-5);
}

function makeMaterials(colors) {
  const std = (name, color, metalness, roughness, extra = {}) =>
    new THREE.MeshStandardMaterial({ name, color, metalness, roughness, ...extra });
  return {
    body:   std('Body',   colors.body,   0.25, 0.42),
    joint:  std('Joint',  colors.joint,  0.7,  0.35),
    accent: std('Accent', colors.accent, 0.3,  0.45),
    base:   std('Base',   colors.base,   0.6,  0.5),
    steel:  std('Steel',  '#a6acb3',     1.0,  0.3),
    dark:   std('Dark',   '#3b3f45',     0.6,  0.45),
    rubber: std('Rubber', '#141414',     0.0,  0.9),
    brass:  std('Brass',  '#c9a245',     1.0,  0.35),
    tool:   std('Tool',   '#4a4f57',     0.65, 0.4),
    hose:   std('Hose',   '#25282d',     0.1,  0.7),
    blue:   std('Blue',   '#2f6db0',     0.4,  0.45),
    grit:   std('Grit',   '#8a5a32',     0.0,  1.0),
  };
}

function link(name, M, parts) {
  const g = new THREE.Group();
  g.name = name;
  for (const [key, geoms] of Object.entries(parts)) {
    if (!geoms?.length) continue;
    const merged = mergeGeometries(geoms.map(normalize), false);
    if (!merged) throw new Error(`No se pudo fusionar ${name}/${key}`);
    const mesh = new THREE.Mesh(merged, M[key]);
    mesh.name = `${name}_${key}`;
    g.add(mesh);
  }
  return g;
}
function node(name, x = 0, y = 0, z = 0) {
  const g = new THREE.Group();
  g.name = name;
  g.position.set(x, y, z);
  return g;
}

// ═════════════════════════════════════════════════════════════════════════════
// HERRAMIENTAS (sistema local de J6, eje de herramienta = +X, empiezan tras el cambiador)
// ═════════════════════════════════════════════════════════════════════════════
const TC = 0.06;   // espesor del cambiador rápido de herramienta

function buildTool(kind, M) {
  const tool = node('Tool', TC, 0, 0);
  const tcp = TOOL_SPECS[kind].tcp - TC;

  if (kind === 'spindle') {
    tool.add(link('Spindle', M, {
      dark: [rbox(0.05, 0.26, 0.2, 0.012, 0.025, 0, 0)],                      // placa soporte
      body: [cylX(0.088, 0.088, 0.05, 0.27)],                                   // motor
      steel: [...finsX(0.094, 0.06, 0.26, 9), cylX(0.06, 0.04, 0.27, 0.32)],   // aletas + nariz
      blue: [cylX(0.089, 0.089, 0.1, 0.115)],
      hose: [cylX(0.022, 0.022, 0.03, 0.27, 0.12, 0), cylY(0.022, 0.022, 0.0, 0.12, 0.27, 0)],
      // Campana de aspiración con faldón de cepillo
      rubber: [lathe([[0.075, 0], [0.115, 0.07], [0.12, 0.1]], 32).rotateZ(-Math.PI / 2).translate(0.31, 0, 0)],
    }));
    const bit = node('Bit', 0.32, 0, 0);
    bit.add(link('BitMesh', M, {
      steel: [cylX(0.02, 0.02, 0, 0.03), cylX(0.011, 0.011, 0.03, tcp - 0.32 - 0.01)],
      brass: [cylX(0.011, 0.002, tcp - 0.32 - 0.012, tcp - 0.32), rbox(0.05, 0.004, 0.026, 0.001, tcp - 0.32 - 0.04, 0, 0)],
    }));
    tool.add(bit);
  }

  if (kind === 'sander') {
    tool.add(link('Sander', M, {
      accent: [cylX(0.08, 0.08, 0, 0.035)],                                    // brida de compensación de fuerza
      steel: [...finsX(0.072, 0.035, 0.07, 3, 0.004)],
      body: [cylX(0.07, 0.065, 0.07, 0.19), rbox(0.08, 0.06, 0.06, 0.01, 0.13, 0.08, 0)],
      hose: [cylX(0.02, 0.02, 0.0, 0.19, -0.09, 0), cylY(0.02, 0.02, -0.09, 0.0, 0.19, 0)],
    }));
    const pad = node('Pad', 0.19, 0, 0);
    pad.add(link('PadMesh', M, {
      dark: [cylX(0.11, 0.115, 0, 0.035, 0, 0, 40)],
      grit: [cylX(0.115, 0.115, 0.035, tcp - 0.19, 0, 0, 40)],
      steel: [rbox(0.004, 0.02, 0.2, 0.002, tcp - 0.19 + 0.001, 0, 0)],     // marca para ver la oscilación
    }));
    tool.add(pad);
  }

  if (kind === 'screwgrip') {
    const cups = [[0.12, 0.17], [-0.12, 0.17], [0.12, -0.17], [-0.12, -0.17]];
    tool.add(link('ScrewGripper', M, {
      steel: [cylX(0.07, 0.07, 0, 0.03)],
      dark: [rbox(0.035, 0.34, 0.48, 0.01, 0.12, 0, 0), rbox(0.09, 0.06, 0.06, 0.01, 0.07, 0, 0)],
      tool: cups.map(([y, z]) => cylX(0.01, 0.01, 0.135, tcp - 0.03, y, z, 10)),
      rubber: cups.map(([y, z]) => lathe([[0.01, 0], [0.025, 0.01], [0.045, 0.028], [0.043, 0.03]], 20)
        .rotateZ(-Math.PI / 2).translate(tcp - 0.032, y, z)),
      blue: [rbox(0.2, 0.07, 0.07, 0.015, 0.2, 0.24, 0)],                     // atornillador
      hose: [cylX(0.014, 0.014, 0.0, 0.12, 0.08, 0.1)],
    }));
    const drv = node('Driver', 0.3, 0.24, 0);
    drv.add(link('DriverMesh', M, { steel: [cylX(0.01, 0.006, 0, tcp - 0.3 - 0.01)], brass: [cylX(0.006, 0.002, tcp - 0.31, tcp - 0.3)] }));
    tool.add(drv);
  }

  if (kind === 'spraygun') {
    tool.add(link('SprayGun', M, {
      steel: [cylX(0.065, 0.065, 0, 0.03), cylX(0.022, 0.016, 0.21, tcp - 0.012)],
      body: [rbox(0.1, 0.13, 0.08, 0.02, 0.09, 0, 0)],
      tool: [rbox(0.08, 0.07, 0.06, 0.015, 0.17, 0.0, 0), cylX(0.03, 0.03, 0.12, 0.2, -0.03, 0)],
      accent: [cylX(0.03, 0.03, tcp - 0.02, tcp, 0, 0, 20), rbox(0.012, 0.075, 0.016, 0.004, tcp - 0.008, 0, 0)],   // cabeza de aire
      hose: [cylX(0.014, 0.014, 0.0, 0.14, 0.075, 0.02), cylX(0.012, 0.012, 0.0, 0.14, 0.075, -0.025)],
    }));
  }

  if (kind === 'clamp') {
    tool.add(link('ClampHead', M, {
      steel: [cylX(0.12, 0.12, 0, 0.04)],
      dark: [rbox(0.08, 0.16, 0.8, 0.02, 0.09, 0, 0)],                        // viga transversal
      body: [rbox(0.06, 0.1, 0.84, 0.015, 0.16, 0, 0)],
      tool: [rbox(0.03, 0.04, 0.78, 0.01, 0.2, 0, 0)],                         // guía de las mordazas
    }));
    for (const [name, z] of [['Clamp_L', -0.36], ['Clamp_R', 0.36]]) {
      const c = node(name, 0, 0, z);
      c.add(link(`${name}_Mesh`, M, {
        dark: [rbox(tcp - 0.18, 0.5, 0.035, 0.008, (tcp + 0.18) / 2, 0, 0)],
        rubber: [rbox(tcp - 0.26, 0.42, 0.012, 0.004, (tcp + 0.22) / 2, 0, z < 0 ? 0.022 : -0.022)],
        steel: [rbox(0.03, 0.46, 0.09, 0.006, tcp - 0.01, 0, z < 0 ? 0.04 : -0.04)],   // uña inferior
      }));
      tool.add(c);
    }
  }
  return tool;
}

// ═════════════════════════════════════════════════════════════════════════════
// ROBOT DE 6 EJES (esqueleto mejorado)
// ═════════════════════════════════════════════════════════════════════════════
function pedestal(S, M, square = false) {
  const R = S.radius, { baseH } = S;
  return link('Pedestal', M, {
    base: [
      rbox(R.base * 2.5, 0.05, R.base * 2.5, 0.02, 0, 0.025, 0),             // placa de anclaje
      lathe([[0, 0.05], [R.base * 1.04, 0.05], [R.base * 1.0, 0.11], [R.base * 0.84, 0.3],
        [R.base * 0.82, baseH - 0.06], [0, baseH - 0.06]]),
      rbox(0.13, 0.22, 0.28, 0.02, -R.base * 0.92, 0.22, 0),                  // caja de conectores
      ...(square ? [rbox(R.base * 1.9, baseH * 0.5, R.base * 1.9, 0.04, 0, baseH * 0.3, 0)] : []),
    ],
    steel: [
      ...[[-1, -1], [1, -1], [-1, 1], [1, 1], [0, -1], [0, 1], [-1, 0], [1, 0]].map(([a, b]) =>
        cylY(0.024, 0.024, 0.05, 0.08, a * R.base * 1.08, b * R.base * 1.08, 6)),
      cylX(0.032, 0.032, -R.base * 1.08, -R.base * 0.98, 0.25, 0.07, 12),
      cylX(0.032, 0.032, -R.base * 1.08, -R.base * 0.98, 0.25, -0.07, 12),
    ],
    hose: [cylX(0.03, 0.03, -R.base * 1.6, -R.base * 1.08, 0.25, 0.07, 10).translate(0, -0.12, 0)],
    joint: [cylY(R.base * 0.87, R.base * 0.87, baseH - 0.06, baseH)],
  });
}

function statusRing(S) {
  const R = S.radius;
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(R.base * 0.85, 0.018, 10, 48).rotateX(Math.PI / 2),
    new THREE.MeshStandardMaterial({ name: 'StatusRing', color: '#29d36a', emissive: '#29d36a', emissiveIntensity: 1.4 }),
  );
  ring.name = 'StatusRing';
  ring.position.y = S.baseH * 0.8;
  return ring;
}

function buildArm6(modelKey) {
  const { spec: specKey, tool: toolKind } = ROBOT_MODELS[modelKey];
  const S = ROBOT_SPECS[specKey];
  const R = S.radius;
  const M = makeMaterials(S.colors);
  const { baseH, d1, a1, L2, a3, L3, Lw } = S;
  const shoulderH = d1 - baseH;

  const root = node('Robot');
  root.add(pedestal(S, M));
  root.add(statusRing(S));

  // ── J1 · carrusel ────────────────────────────────────────────────────────
  const j1 = node('J1', 0, baseH, 0);
  root.add(j1);
  const shW = R.upper * 2.3;
  const foreW = R.fore * 3.0;
  const uaDepth = R.upper * 1.25;
  const uaZ = Math.max(shW, foreW) / 2 + uaDepth / 2 + 0.006;
  const cbZ = uaZ + uaDepth / 2 + 0.085;                                       // plano del equilibrador
  j1.add(link('Link1', M, {
    body: [
      lathe([[0, 0], [R.turret, 0], [R.turret, 0.06], [R.turret * 0.92, 0.12], [R.turret * 0.78, 0.17], [0, 0.17]]),
      rbox(a1 + R.upper * 2.5, shoulderH * 0.82, shW, 0.07, a1 * 0.42, shoulderH * 0.47, 0),
      cylZ(R.upper * 1.32, shW, a1, shoulderH, 0),
      rbox(R.turret * 0.7, shoulderH * 0.5, shW * 0.9, 0.05, -R.turret * 0.35, shoulderH * 0.3, 0),   // trasera
      ...(S.counterbalance ? [rbox(0.16, 0.14, cbZ - shW / 2 + 0.05, 0.02, a1 - 0.42, shoulderH * 0.62, (cbZ + shW / 2) / 2)] : []),
    ],
    joint: [
      cylZ(R.upper * 0.82, R.upper * 1.3, a1, shoulderH, -shW / 2 - R.upper * 0.65),   // motor J2
      cylY(R.turret * 0.42, R.turret * 0.42, 0.17, 0.17 + R.turret * 0.95, -R.turret * 0.62, 0), // motor J1
      cylZ(R.upper * 0.5, 0.05, a1, shoulderH, shW / 2 + 0.02),
    ],
    steel: [
      cylZ(R.upper * 0.72, 0.022, a1, shoulderH, -shW / 2 - R.upper * 1.31),
      ...boltsZ(6, R.upper * 0.56, a1, shoulderH, -shW / 2 - R.upper * 1.33, 0.012, 0.02),
      cylY(R.turret * 0.3, R.turret * 0.3, 0.17 + R.turret * 0.95, 0.19 + R.turret * 0.95, -R.turret * 0.62, 0),
      ...boltsY(12, R.turret * 0.93, 0.06, 0.012, 0.012),
    ],
    accent: [rbox(0.02, shoulderH * 0.35, shW * 0.6, 0.006, a1 * 0.42 + (a1 + R.upper * 2.5) / 2, shoulderH * 0.47, 0)],
    hose: [
      cylY(0.032, 0.032, 0.0, shoulderH * 0.9, -R.turret * 0.95, 0.12, 12),   // paquete de cables hacia el brazo
    ],
  }));
  if (S.counterbalance) j1.add(node('CB_A', a1 - 0.42, shoulderH * 0.62, cbZ));

  // ── J2 · brazo superior (lado +Z) con cajeados ───────────────────────────
  const j2 = node('J2', a1, shoulderH, 0);
  j1.add(j2);
  const face = uaZ + uaDepth / 2;
  const pocket = (side) => stadium(R.upper * 0.78, R.upper * 0.58, L2 * 0.62, 0.012, 0, 0.004)
    .translate(0, L2 * 0.19, uaZ + side * (uaDepth / 2 + 0.002));
  j2.add(link('Link2', M, {
    body: [stadium(R.upper * 1.25, R.upper * 0.95, L2, uaDepth, uaZ)],
    joint: [
      cylZ(R.upper * 1.1, 0.026, 0, 0, face + 0.012),
      cylZ(R.upper * 0.86, 0.026, 0, L2, face + 0.012),
      cylZ(R.upper * 1.1, 0.026, 0, 0, uaZ - uaDepth / 2 - 0.012),
    ],
    accent: [pocket(1), pocket(-1)],
    steel: [
      ...boltsZ(8, R.upper * 0.86, 0, 0, face + 0.027, 0.012, 0.016),
      cylZ(R.upper * 0.3, 0.02, 0, 0, face + 0.032),
      ...[0.3, 0.55, 0.8].map((t) => rbox(0.05, 0.03, 0.08, 0.008, -R.upper * 1.2, L2 * t, uaZ)),   // abrazaderas
    ],
    hose: [cylY(0.034, 0.034, 0.12, L2 - 0.1, -R.upper * 1.28, uaZ, 12)],
  }));
  if (S.counterbalance) {
    j2.add(node('CB_B', -0.02, L2 * 0.42, cbZ));
    j2.add(link('CBLug', M, { joint: [rbox(0.1, 0.12, cbZ - face + 0.03, 0.02, -0.02, L2 * 0.42, (cbZ + face) / 2)] }));
  }

  // ── J3 · codo + carcasa del antebrazo con paquete de motores ─────────────
  const j3 = node('J3', 0, L2, 0);
  j2.add(j3);
  const j4x = L3 * 0.38;
  const back = R.fore * 2.6;
  j3.add(link('Link3', M, {
    body: [
      cylZ(R.fore * 1.55, foreW, 0, 0, 0),
      rbox(back + j4x, a3 + R.fore * 2.3, foreW * 0.92, 0.05, (j4x - back) / 2, a3 * 0.55, 0),
    ],
    joint: [
      cylZ(R.fore * 1.12, 0.022, 0, 0, -foreW / 2 - 0.011),
      cylZ(R.fore * 0.75, R.fore * 1.0, 0, 0, -foreW / 2 - R.fore * 0.5),           // motor J3
      // motores J4/J5/J6 en la trasera (contrapeso)
      cylX(R.fore * 0.44, R.fore * 0.44, -back - R.fore * 1.0, -back + 0.02, a3 * 0.55 + R.fore * 0.45, R.fore * 0.6),
      cylX(R.fore * 0.44, R.fore * 0.44, -back - R.fore * 1.0, -back + 0.02, a3 * 0.55 + R.fore * 0.45, -R.fore * 0.6),
      cylX(R.fore * 0.44, R.fore * 0.44, -back - R.fore * 0.85, -back + 0.02, a3 * 0.55 - R.fore * 0.5, 0),
    ],
    steel: [
      ...boltsZ(6, R.fore * 0.82, 0, 0, -foreW / 2 - 0.024, 0.01, 0.012),
      ...[[R.fore * 0.45, R.fore * 0.6], [R.fore * 0.45, -R.fore * 0.6], [-R.fore * 0.5, 0]].map(([dy, dz]) =>
        cylX(R.fore * 0.3, R.fore * 0.3, -back - R.fore * 1.04, -back - R.fore * 0.98, a3 * 0.55 + dy, dz)),
    ],
    accent: [rbox(0.008, a3 + R.fore * 1.2, foreW * 0.5, 0.003, j4x + 0.002, a3 * 0.55, 0)],
    hose: [cylX(0.03, 0.03, -back * 0.6, j4x, a3 + R.fore * 1.2, 0, 12)],
  }));

  // ── J4 · antebrazo (rot X) ───────────────────────────────────────────────
  const j4 = node('J4', j4x, a3, 0);
  j3.add(j4);
  const j5x = L3 - j4x;
  const forkW = R.wrist * 1.15;
  j4.add(link('Link4', M, {
    body: [
      cylX(R.fore, R.fore * 0.82, 0, j5x - R.wrist * 1.4),
      rbox(R.wrist * 2.3, R.wrist * 2.3, 0.04, 0.012, j5x - R.wrist * 0.3, 0, forkW + 0.02),
      rbox(R.wrist * 2.3, R.wrist * 2.3, 0.04, 0.012, j5x - R.wrist * 0.3, 0, -forkW - 0.02),
      rbox(0.08, R.wrist * 2.3, forkW * 2 + 0.08, 0.012, j5x - R.wrist * 1.4, 0, 0),
    ],
    accent: [cylX(R.fore * 1.01, R.fore * 1.0, 0.04, 0.09)],
    joint: [cylX(R.fore * 1.05, R.fore * 1.05, 0, 0.03), cylX(R.fore * 0.86, R.fore * 0.86, (j5x - R.wrist * 1.4) * 0.6, (j5x - R.wrist * 1.4) * 0.6 + 0.025)],
    hose: [cylX(0.022, 0.022, 0.05, j5x - R.wrist * 1.6, R.fore * 1.1, 0, 10)],
  }));

  // ── J5 · muñeca (rot Z) ──────────────────────────────────────────────────
  const j5 = node('J5', j5x, 0, 0);
  j4.add(j5);
  j5.add(link('Link5', M, {
    joint: [cylZ(R.wrist * 1.05, forkW * 2, 0, 0, 0)],
    body: [cylX(R.wrist * 0.86, R.wrist * 0.8, 0, Lw - 0.03)],
    steel: [cylZ(R.wrist * 0.45, forkW * 2 + 0.1, 0, 0, 0, 20)],
  }));

  // ── J6 · brida + cambiador rápido + herramienta ──────────────────────────
  const j6 = node('J6', Lw, 0, 0);
  j5.add(j6);
  j6.add(link('Flange', M, {
    steel: [cylX(R.wrist * 0.8, R.wrist * 0.8, -0.03, 0.0), ...boltsX(6, R.wrist * 0.55, -0.002, 0.007, 0.006)],
  }));
  j6.add(link('ToolChanger', M, {
    dark: [cylX(R.wrist * 0.85, R.wrist * 0.85, 0, TC * 0.5)],
    accent: [cylX(R.wrist * 0.8, R.wrist * 0.8, TC * 0.5, TC)],
    brass: [rbox(0.02, 0.03, 0.03, 0.004, TC * 0.5, R.wrist * 0.85, 0)],
  }));
  j6.add(buildTool(toolKind, M));
  j6.add(node('TCP', TOOL_SPECS[toolKind].tcp, 0, 0));
  return root;
}

// ═════════════════════════════════════════════════════════════════════════════
// PALETIZADOR DE 4 EJES (paralelogramo)
// ═════════════════════════════════════════════════════════════════════════════
function buildPalletizer(modelKey) {
  const { spec: specKey, tool: toolKind } = ROBOT_MODELS[modelKey];
  const S = ROBOT_SPECS[specKey];
  const R = S.radius;
  const M = makeMaterials(S.colors);
  const { baseH, d1, a1, L2, L3, Lw } = S;
  const shoulderH = d1 - baseH;
  const root = node('Robot');
  root.add(pedestal(S, M, true));
  root.add(statusRing(S));

  const j1 = node('J1', 0, baseH, 0);
  root.add(j1);
  const w = R.upper * 2.4;
  j1.add(link('Link1', M, {
    body: [
      lathe([[0, 0], [R.turret, 0], [R.turret, 0.08], [R.turret * 0.9, 0.16], [0, 0.16]]),
      rbox(0.24, shoulderH, 0.08, 0.02, a1, shoulderH / 2, w / 2 + 0.06),        // torre (dos placas)
      rbox(0.24, shoulderH, 0.08, 0.02, a1, shoulderH / 2, -w / 2 - 0.06),
      cylZ(R.upper * 1.1, w + 0.28, a1, shoulderH, 0),
    ],
    dark: [rbox(0.55, 0.45, w + 0.2, 0.04, -R.turret * 0.7, 0.4, 0)],          // contrapeso de fundición
    joint: [
      cylZ(R.upper * 0.8, 0.3, a1, shoulderH, -w / 2 - 0.25),
      cylY(R.turret * 0.32, R.turret * 0.32, 0.16, 0.75, -R.turret * 0.15, w / 2 + 0.22),
    ],
    steel: [...boltsY(14, R.turret * 0.93, 0.08, 0.012, 0.012)],
    hose: [cylY(0.04, 0.04, 0.1, shoulderH, -0.1, -w / 2 - 0.12, 12)],
  }));
  j1.add(node('PR_A', a1 - 0.42, shoulderH, w / 2 + 0.16));

  const j2 = node('J2', a1, shoulderH, 0);
  j1.add(j2);
  j2.add(link('Link2', M, {
    body: [rbox(0.26, L2 + 0.2, w * 0.9, 0.04, 0, L2 / 2, 0)],
    accent: [rbox(0.27, L2 * 0.55, 0.012, 0.005, 0, L2 / 2, w * 0.45 + 0.006), rbox(0.27, L2 * 0.55, 0.012, 0.005, 0, L2 / 2, -w * 0.45 - 0.006)],
    joint: [cylZ(R.upper * 0.95, w + 0.04, 0, L2, 0)],
    hose: [cylY(0.035, 0.035, 0.15, L2 - 0.15, -0.16, 0, 12)],
  }));

  const j3 = node('J3', 0, L2, 0);
  j2.add(j3);
  const j4x = L3 * 0.38;
  j3.add(link('Link3', M, {
    body: [rbox(j4x + 0.5, 0.24, w * 0.7, 0.04, (j4x - 0.5) / 2, 0, 0)],
    joint: [cylZ(R.fore * 1.2, w * 0.95, 0, 0, 0), cylX(R.fore * 0.6, R.fore * 0.6, -0.72, -0.48, 0, 0)],
  }));
  j3.add(node('PR_B', -0.42, 0, w / 2 + 0.16));

  const j4 = node('J4', j4x, 0, 0);
  j3.add(j4);
  const j5x = L3 - j4x;
  j4.add(link('Link4', M, {
    body: [rbox(j5x - 0.12, 0.2, w * 0.6, 0.04, (j5x - 0.12) / 2, 0, 0)],
    accent: [rbox(0.04, 0.21, w * 0.61, 0.01, 0.05, 0, 0)],
    joint: [rbox(0.16, 0.26, w * 0.75, 0.03, j5x - 0.06, 0, 0)],
  }));

  const j5 = node('J5', j5x, 0, 0);
  j4.add(j5);
  j5.add(link('Link5', M, {
    joint: [cylZ(R.wrist * 1.1, w * 0.78, 0, 0, 0)],
    body: [cylX(R.wrist, R.wrist * 0.9, 0, Lw - 0.03)],
  }));
  const j6 = node('J6', Lw, 0, 0);
  j5.add(j6);
  j6.add(link('Flange', M, { steel: [cylX(R.wrist, R.wrist, -0.03, 0.0)] }));
  j6.add(link('ToolChanger', M, { dark: [cylX(R.wrist, R.wrist, 0, TC * 0.5)], accent: [cylX(R.wrist * 0.95, R.wrist * 0.95, TC * 0.5, TC)] }));
  j6.add(buildTool(toolKind, M));
  j6.add(node('TCP', TOOL_SPECS[toolKind].tcp, 0, 0));
  return root;
}

// ═════════════════════════════════════════════════════════════════════════════
const here = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.resolve(here, '../public/models');
fs.mkdirSync(outDir, { recursive: true });

for (const [key, def] of Object.entries(ROBOT_MODELS)) {
  const S = ROBOT_SPECS[def.spec];
  const robot = S.kind === 'pal4' ? buildPalletizer(key) : buildArm6(key);
  robot.userData = { model: key, spec: def.spec, tool: def.tool, label: S.model };
  const scene = new THREE.Scene();
  scene.add(robot);
  const glb = await new GLTFExporter().parseAsync(scene, { binary: true });
  fs.writeFileSync(path.join(outDir, def.file), Buffer.from(glb));
  let tris = 0;
  robot.traverse((o) => { if (o.isMesh) tris += (o.geometry.index?.count ?? o.geometry.attributes.position.count) / 3; });
  console.log(`✔ ${def.file.padEnd(22)} ${(glb.byteLength / 1024).toFixed(0).padStart(5)} KB  ${tris.toFixed(0)} tri  (${S.model})`);
}
