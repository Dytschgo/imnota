import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    // The service uses node:test and its own Node/SQLite runtime, exercised separately in CI.
    exclude: ['**/node_modules/**', 'dist-electron/**', 'scripts/*.test.mjs', 'share-service/**'],
  },
});
