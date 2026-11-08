import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  // The CLI bridge (npm run bridge) to the lab box; its terminals are WebSockets. Only its endpoints: src/l0.ts imports
  // bridge/tables.mjs, which Vite has to serve itself.
  server: {
    proxy: {
      '^/bridge/(status|state|connect|disconnect|wiring|pull|term|shell)\\b': {
        target: 'http://127.0.0.1:8022', ws: true, rewrite: (p) => p.replace(/^\/bridge/, ''),
      },
    },
  },
});
