import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { resolve } from 'node:path';

// Tres aplicaciones: visor 3D (/), administración (/admin/) y app móvil (/app/).
// En desarrollo, `npm run dev` arranca el servidor con Vite en modo middleware
// (mismo puerto para las páginas y el WebSocket /ws).
export default defineConfig({
  plugins: [react()],
  resolve: {
    dedupe: ['react', 'react-dom', 'three', '@react-three/fiber', '@react-three/drei'],
  },
  optimizeDeps: {
    include: ['react', 'react-dom', 'three', 'zustand'],
  },
  server: {
    proxy: { '/ws': { target: 'ws://localhost:8080', ws: true } },
  },
  build: {
    chunkSizeWarningLimit: 1600,
    rollupOptions: {
      input: {
        main: resolve(import.meta.dirname, 'index.html'),
        admin: resolve(import.meta.dirname, 'admin/index.html'),
        app: resolve(import.meta.dirname, 'app/index.html'),
      },
    },
  },
});
