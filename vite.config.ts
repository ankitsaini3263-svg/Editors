import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 3000,
  },
  assetsInclude: ['**/*.wgsl'],
  test: {
    // Explicit rather than default so nested root-level suites (`__tests__/core`, `__tests__/engine`)
    // are not silently dropped when the repo grows a second tests directory.
    include: ['src/**/*.{test,spec}.{ts,tsx}', '__tests__/**/*.{test,spec}.{ts,tsx,mjs}'],
  },
});
