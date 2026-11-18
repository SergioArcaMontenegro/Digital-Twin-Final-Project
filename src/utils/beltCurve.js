// Belt Curve utility — defines the U-shaped conveyor path
// Upper straight: z=+5, x: -12 → +12
// Semicircle: center (12, 0), radius 5, from z=+5 to z=-5 (going through x=17)
// Lower straight: z=-5, x: +12 → -12

const STRAIGHT_LEN = 24;
const RADIUS = 5;
export const SEMI_LEN = Math.PI * RADIUS;
export const TOTAL_LEN = STRAIGHT_LEN + SEMI_LEN + STRAIGHT_LEN;
export const BELT_Y = 1.12; // height of belt surface

/**
 * Returns the 3D world position on the belt for a given normalized parameter t ∈ [0,1]
 */
export function getBeltPosition(t) {
  const dist = ((t % 1) + 1) % 1 * TOTAL_LEN;

  if (dist <= STRAIGHT_LEN) {
    // Upper straight: x from -12 to +12, z = 5
    const x = -12 + dist;
    return [x, BELT_Y, 5];
  } else if (dist <= STRAIGHT_LEN + SEMI_LEN) {
    // Semicircle: center at (12, _, 0), sweeps from z=5 to z=-5
    const progress = (dist - STRAIGHT_LEN) / SEMI_LEN; // 0→1
    const theta = progress * Math.PI; // 0→π
    const x = 12 + RADIUS * Math.sin(theta);
    const z = RADIUS * Math.cos(theta); // 5→-5
    return [x, BELT_Y, z];
  } else {
    // Lower straight: x from +12 to -12, z = -5
    const progress = (dist - STRAIGHT_LEN - SEMI_LEN) / STRAIGHT_LEN;
    const x = 12 - progress * STRAIGHT_LEN;
    return [x, BELT_Y, -5];
  }
}

/**
 * Returns the t parameter for a given position on a straight section
 */
export function getTForPosition(x, zSide) {
  if (zSide > 0) {
    // Upper straight
    const dist = x + 12;
    return Math.max(0, Math.min(dist / TOTAL_LEN, STRAIGHT_LEN / TOTAL_LEN));
  } else {
    // Lower straight
    const dist = STRAIGHT_LEN + SEMI_LEN + (12 - x);
    return Math.max(0, Math.min(dist / TOTAL_LEN, 1));
  }
}

// Station trigger t-values (where pieces stop for each robot)
export const STATION_T = [
  getTForPosition(-6, 5),   // Robot 0 — upper belt, x=-6
  getTForPosition(0, 5),    // Robot 1 — upper belt, x=0
  getTForPosition(7, 5),    // Robot 2 — upper belt, x=7
  getTForPosition(7, -5),   // Robot 3 — lower belt, x=7
  getTForPosition(0, -5),   // Robot 4 — lower belt, x=0
  getTForPosition(-6, -5),  // Robot 5 — lower belt, x=-6
];
