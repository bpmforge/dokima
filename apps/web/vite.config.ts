import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // The dev server is the one Dokima port that was never pinned: bare `vite`
  // takes 5173 and SILENTLY bumps to the next free port when something else
  // holds it, so it can land anywhere -- including on a port another project
  // is about to want. 4318 sits in Dokima's reserved 43xx/44xx block
  // (docs/DEPLOYMENT.md §6) next to the core's 4317, and strictPort makes a
  // collision an error instead of a silent move.
  server: { port: 4318, strictPort: true },
});
