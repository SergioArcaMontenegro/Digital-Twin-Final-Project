// Estado de la interfaz del visor (selección, vistas, modo edición).
import { create } from 'zustand';

export const useUI = create((set) => ({
  selected: null,           // id de robot, AGV, zona o persona
  select: (id) => set({ selected: id }),
  showLabels: true,
  toggleLabels: () => set((s) => ({ showLabels: !s.showLabels })),
  focus: null,              // { pos, target } de cámara
  setFocus: (focus) => set({ focus }),
  // ── modo edición ──
  edit: false,
  draft: null,              // colocaciones en edición
  editZone: null,           // zona seleccionada en edición
  dragging: false,
  setEdit: (edit, placements) => set({ edit, draft: edit ? structuredClone(placements) : null, editZone: null }),
  setDraft: (draft) => set({ draft }),
  setEditZone: (editZone) => set({ editZone }),
  setDragging: (dragging) => set({ dragging }),
  loginOpen: false,
  setLoginOpen: (loginOpen) => set({ loginOpen }),
}));
