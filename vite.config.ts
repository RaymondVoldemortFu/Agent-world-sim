import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
export default defineConfig({
  root: 'frontend',
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
    proxy: { '/api': 'http://127.0.0.1:8000', '/continuous-api': 'http://127.0.0.1:8001',
      '/chat-api': { target: 'http://127.0.0.1:8002', rewrite: path => path.replace(/^\/chat-api/, '') } },
  },
  build: {
    outDir: '../dist',
    emptyOutDir: true,
    rollupOptions: {
      output: {
        manualChunks: { charts: ['recharts'], storage: ['dexie'], scene: ['three'] },
      },
    },
  },
  test: { include: ['tests/**/*.test.ts'] },
});
