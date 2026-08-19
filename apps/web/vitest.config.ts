import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    setupFiles: ['../../vitest.network-guard.ts'],
    environment: 'node',
    // *.spec.ts under e2e/ are Playwright specs, not vitest — vitest's
    // default include pattern matches both *.test.ts and *.spec.ts, so
    // without this it tries (and fails) to run Playwright's test()/
    // describe() outside the Playwright runner. `exclude` replaces (not
    // merges with) vitest's defaults, so spread them back in.
    exclude: [...configDefaults.exclude, 'e2e/**/*.spec.ts'],
  },
});
