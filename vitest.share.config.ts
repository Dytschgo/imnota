import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['electron/hosted-share-contract.test.ts'],
  },
});
