import { create } from 'zustand';
import { engine } from '../sim/engine';

// La escena 3D lee el motor directamente en cada frame (engine.*).
// La interfaz se suscribe a una instantánea que se refresca ~5 veces por segundo.
export const useTwinStore = create((set) => ({
  snap: engine.snapshot(),
  selectedRobot: null,
  focusCell: null,
  showLabels: true,

  refresh: () => set({ snap: engine.snapshot() }),
  selectRobot: (id) => set((s) => ({ selectedRobot: s.selectedRobot === id ? null : id })),
  setFocus: (cellId) => set({ focusCell: cellId }),
  toggleLabels: () => set((s) => ({ showLabels: !s.showLabels })),

  // Acciones que pasan por el motor y refrescan la instantánea al momento
  act: (fn) => { fn(engine); set({ snap: engine.snapshot() }); },
}));
