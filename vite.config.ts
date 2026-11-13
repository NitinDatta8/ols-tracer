import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  // The CLI bridge (npm run bridge, or BRIDGE_URL) to the lab box; its terminals are WebSockets. Only its endpoints, each
  // as a whole name (/bridge/state, never a file such as /bridge/state.mjs): the app imports bridge/*.mjs, which Vite
  // serves itself.
  server: {
    proxy: {
      '^/bridge/(status|state|connect|disconnect|wiring|pull|term|shell|procedure)(?=[/?]|$)': {
        target: process.env.BRIDGE_URL ?? 'http://127.0.0.1:8022', ws: true, rewrite: (p) => p.replace(/^\/bridge/, ''),
      },
    },
  },
});
