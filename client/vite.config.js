import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The API runs on PORT (default 3001). The dev server proxies API calls so the browser stays same-origin.
const apiTarget = process.env.VITE_API_TARGET || 'http://localhost:3001';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': apiTarget,
      '/health': apiTarget,
    },
  },
  test: {
    environment: 'jsdom',
  },
});
