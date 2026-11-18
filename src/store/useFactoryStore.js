import { create } from 'zustand';
import { getBeltPosition, STATION_T, TOTAL_LEN } from '../utils/beltCurve';

// ─── Station definitions ───────────────────────────────────────────────────
// Each station has: robot base position, pickup point, work position, which side of belt
export const STATIONS = [
  { id: 0, robotPos: [-6, 0,  8.5], pickupPos: [-6,  1.1,  5], workPos: [-6, 4, 10], beltSide: 'upper', name: 'Estación 1 – Soldadura'        },
  { id: 1, robotPos: [ 0, 0,  8.5], pickupPos: [ 0,  1.1,  5], workPos: [ 0, 4, 10], beltSide: 'upper', name: 'Estación 2 – Montaje Superior'   },
  { id: 2, robotPos: [ 7, 0,  8.5], pickupPos: [ 7,  1.1,  5], workPos: [ 7, 4, 10], beltSide: 'upper', name: 'Estación 3 – Componentes Lat.'   },
  { id: 3, robotPos: [ 7, 0, -8.5], pickupPos: [ 7,  1.1, -5], workPos: [ 7, 4,-10], beltSide: 'lower', name: 'Estación 4 – Pintura'            },
  { id: 4, robotPos: [ 0, 0, -8.5], pickupPos: [ 0,  1.1, -5], workPos: [ 0, 4,-10], beltSide: 'lower', name: 'Estación 5 – Acabado'            },
  { id: 5, robotPos: [-6, 0, -8.5], pickupPos: [-6,  1.1, -5], workPos: [-6, 4,-10], beltSide: 'lower', name: 'Estación 6 – Inspección Final'   },
];

// Phase names (transformation of the piece at each station)
export const PHASES = [
  { name: 'Chasis Base',          color: '#7a7a7a', emissive: '#111' },
  { name: 'Estructura Superior',  color: '#4a4a5a', emissive: '#111' },
  { name: 'Componentes Lat.',     color: '#3a5a7a', emissive: '#112233' },
  { name: 'Pintura',              color: '#c0392b', emissive: '#220000' },
  { name: 'Acabado Final',        color: '#e74c3c', emissive: '#330000' },
  { name: 'Inspeccionado ✓',      color: '#27ae60', emissive: '#003311' },
];

// Robot state machine states
export const ROBOT_STATES = [
  'IDLE', 'REACHING', 'GRIPPING', 'LIFTING', 'WORKING', 'LOWERING', 'RELEASING', 'RETRACTING'
];

const NUM_PIECES = 3;
const NUM_JOINTS = 6;

function makeRobot(id) {
  return {
    id,
    state: 'IDLE',
    stateTimer: 0,
    jointAngles:  Array(NUM_JOINTS).fill(0).map((_, i) => [0, -0.4, 0.8, -0.4, 0, 0][i] ?? 0),
    targetAngles: Array(NUM_JOINTS).fill(0).map((_, i) => [0, -0.4, 0.8, -0.4, 0, 0][i] ?? 0),
    temperatures: Array(NUM_JOINTS).fill(25),     // °C
    gripperOpen: true,
    heldPieceId: null,
    cyclesCompleted: 0,
    lastEventTime: 0,
  };
}

function makePiece(id) {
  return {
    id,
    t: id / NUM_PIECES,       // parametric position on belt (0-1)
    phase: 0,
    heldByRobot: null,
    worldPos: getBeltPosition(id / NUM_PIECES),
  };
}

export const useFactoryStore = create((set, get) => ({
  // ─── Control ──────────────────────────────────────────────────────────────
  running: true,
  beltSpeed: 1.5,   // belt speed (units/s)  
  armSpeed: 1.0,    // arm interpolation multiplier
  
  // ─── State ────────────────────────────────────────────────────────────────
  robots: Array.from({ length: 6 }, (_, i) => makeRobot(i)),
  pieces: Array.from({ length: NUM_PIECES }, (_, i) => makePiece(i)),
  events: [],
  totalPiecesCompleted: 0,
  uptime: 0,

  // ─── Actions ──────────────────────────────────────────────────────────────
  setBeltSpeed: (v) => set({ beltSpeed: Number(v) }),
  setArmSpeed:  (v) => set({ armSpeed:  Number(v) }),
  setRunning:   (v) => set({ running: v }),

  addEvent: (msg) => set((s) => ({
    events: [{ time: new Date().toLocaleTimeString(), msg }, ...s.events].slice(0, 60),
  })),

  updateRobot: (id, patch) => set((s) => ({
    robots: s.robots.map((r) => r.id === id ? { ...r, ...patch } : r),
  })),

  updatePiece: (id, patch) => set((s) => ({
    pieces: s.pieces.map((p) => p.id === id ? { ...p, ...patch } : p),
  })),

  tickUptime: (delta) => set((s) => ({ uptime: s.uptime + delta })),
  
  incrementCompleted: () => set((s) => ({ totalPiecesCompleted: s.totalPiecesCompleted + 1 })),

  // Selected robot for camera zoom & detail view
  selectedRobot: null,
  setSelectedRobot: (id) => set((s) => ({ selectedRobot: s.selectedRobot === id ? null : id })),
}));
