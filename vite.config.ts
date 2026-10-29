import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  // The CLI bridge (npm run bridge) to the lab box; its terminal is a WebSocket.
  server: { proxy: { '/bridge': { target: 'http://127.0.0.1:8022', ws: true, rewrite: (p) => p.replace(/^\/bridge/, '') } } },
});
