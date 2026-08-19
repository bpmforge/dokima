import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    setupFiles: ['../vitest.network-guard.ts'],
    name: 'scripts',
    environment: 'node',
  },
});
