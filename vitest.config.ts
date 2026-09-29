import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// Real filesystem tests (durable writes, journals, locks) usually finish in about a second, but
// on busy Windows runners antivirus scanning and file locks can stretch one to 5–15 s. A longer
// limit there is not a retry: a hung test still fails, and a genuine failure still reports.
const windows = process.platform === 'win32';

export default defineConfig({
  plugins: [react()],
  test: {
    testTimeout: windows ? 30_000 : 5_000,
    hookTimeout: windows ? 30_000 : 10_000,
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    // The service uses node:test and its own Node/SQLite runtime, exercised separately in CI.
    exclude: [
      '**/node_modules/**',
      '.claude/**',
      'dist-electron/**',
      'scripts/*.test.mjs',
      'share-service/**',
      'electron/hosted-share-contract.test.ts',
    ],
  },
});
