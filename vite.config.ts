import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  // The CLI bridge (npm run bridge) that runs commands on the lab box.
  server: { proxy: { '/bridge': { target: 'http://127.0.0.1:8022', rewrite: (p) => p.replace(/^\/bridge/, '') } } },
});
