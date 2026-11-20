// ─────────────────────────────────────────────────────────────────────────────
// Especificaciones de los robots articulados del gemelo digital (planta de madera).
//
// Lo comparten:
//   · scripts/generate-robots.mjs  → construye los .glb con estas cotas
//   · shared/ik.js                 → cinemática inversa con las mismas cotas
//
// Unidades: metros (1 unidad de escena = 1 m).
//
// Cadena cinemática (pose cero = brazo superior vertical, antebrazo horizontal +X):
//
//   Pedestal (fijo, altura baseH)
//   └─ J1  rot Y  · carrusel                      en (0, baseH, 0)
//      └─ J2  rot Z · hombro                      en (a1, d1 - baseH, 0)
//         └─ J3  rot Z · codo                     en (0, L2, 0)
//            └─ J4  rot X · giro antebrazo        en (L3·0.38, a3, 0)
//               └─ J5  rot Z · flexión muñeca     en (L3·0.62, 0, 0)
//                  └─ J6  rot X · brida           en (Lw, 0, 0)
//                     └─ Tool → TCP               en (tcp, 0, 0)
//
// El paletizador es de 4 ejes: misma cadena con J4 = 0 y J5 manteniendo la
// herramienta vertical (paralelogramo).
// ─────────────────────────────────────────────────────────────────────────────

export const ROBOT_SPECS = {
  // Robot de gran rigidez (clase 210 kg): fresado robótico de madera
  heavy: {
    kind: 'arm6', baseH: 0.45, d1: 0.8, a1: 0.35, L2: 1.15, a3: 0.2, L3: 1.25, Lw: 0.22,
    radius: { base: 0.5, turret: 0.44, upper: 0.24, fore: 0.17, wrist: 0.11 },
    colors: { body: '#f28c28', joint: '#2b2d31', accent: '#1c1d20', base: '#3a3d42' },
    counterbalance: true,
    model: 'IR-210 · 6 ejes · 210 kg · alcance 2,65 m',
  },
  // Robot de carga media: lijado y ensamblaje
  medium: {
    kind: 'arm6', baseH: 0.5, d1: 0.9, a1: 0.2, L2: 1.05, a3: 0.15, L3: 1.1, Lw: 0.16,
    radius: { base: 0.38, turret: 0.33, upper: 0.18, fore: 0.13, wrist: 0.09 },
    colors: { body: '#ecebe6', joint: '#1e2024', accent: '#ff6a13', base: '#3a3d42' },
    counterbalance: false,
    model: 'IR-60 · 6 ejes · 60 kg · alcance 2,25 m',
  },
  // Robot de pintura colgado del techo: barnizado (carcasa presurizada ATEX)
  paint: {
    kind: 'arm6', baseH: 0.32, d1: 0.62, a1: 0.18, L2: 1.0, a3: 0.12, L3: 1.25, Lw: 0.15,
    radius: { base: 0.32, turret: 0.3, upper: 0.16, fore: 0.115, wrist: 0.08 },
    colors: { body: '#f4f4f1', joint: '#8d949c', accent: '#5aa7d6', base: '#7d848c' },
    counterbalance: false,
    model: 'PR-15 · 6 ejes · ATEX · montaje en techo',
  },
  // Paletizador de 4 ejes con paralelogramo
  palletizer: {
    kind: 'pal4', baseH: 0.55, d1: 1.15, a1: 0.32, L2: 1.55, a3: 0.0, L3: 1.85, Lw: 0.3,
    radius: { base: 0.62, turret: 0.55, upper: 0.2, fore: 0.15, wrist: 0.12 },
    colors: { body: '#ffc21a', joint: '#24272b', accent: '#24272b', base: '#3a3d42' },
    counterbalance: false,
    model: 'PL-180 · 4 ejes · 180 kg · alcance 3,6 m',
  },
};

// Herramientas montadas en la brida (J6). `tcp` = distancia brida → punto de trabajo.
export const TOOL_SPECS = {
  spindle:  { tcp: 0.46, label: 'Electrohusillo 12 kW con fresa y campana de aspiración' },
  sander:   { tcp: 0.3,  label: 'Lijadora orbital con compensación de fuerza' },
  screwgrip:{ tcp: 0.36, label: 'Garra de vacío para tableros + atornillador' },
  spraygun: { tcp: 0.34, label: 'Pistola de barnizado HVLP' },
  clamp:    { tcp: 0.62, label: 'Pinza de horquilla para muebles embalados' },
};

// Combinaciones usadas en la planta (una por archivo .glb)
export const ROBOT_MODELS = {
  cnc:       { spec: 'heavy',      tool: 'spindle',   file: 'robot_cnc.glb' },
  sanding:   { spec: 'medium',     tool: 'sander',    file: 'robot_sanding.glb' },
  assembly:  { spec: 'medium',     tool: 'screwgrip', file: 'robot_assembly.glb' },
  varnish:   { spec: 'paint',      tool: 'spraygun',  file: 'robot_varnish.glb' },
  palletizer:{ spec: 'palletizer', tool: 'clamp',     file: 'robot_palletizer.glb' },
};

/** Distancia total brida-TCP de una combinación robot+herramienta. */
export function toolLength(modelKey) {
  const m = ROBOT_MODELS[modelKey];
  return ROBOT_SPECS[m.spec].Lw + TOOL_SPECS[m.tool].tcp;
}
