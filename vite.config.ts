import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
export default defineConfig({
  root: 'frontend',
  plugins: [react()],
  server: { port: 5173, strictPort: true, proxy: { '/api': 'http://127.0.0.1:8000' } },
  build: {
    outDir: '../dist',
    emptyOutDir: true,
    rollupOptions: {
      output: {
        manualChunks: { charts: ['recharts'], storage: ['dexie'] },
      },
    },
  },
  test: { include: ['tests/**/*.test.ts'] },
});
