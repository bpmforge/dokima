import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    // W10-71: pins DOKIMA_HOME to a throwaway directory so no test reads the
    // developer's real ~/.dokima/config.json. See vitest.setup.ts for why that
    // stopped being harmless once the global settings scope became resolvable.
    setupFiles: ['./vitest.setup.ts', '../../vitest.network-guard.ts'],
  },
});
