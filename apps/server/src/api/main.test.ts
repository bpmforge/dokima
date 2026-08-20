/**
 * W13-33. The bundle is a different program from the source, and this is the
 * only place that difference can be asserted.
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = path.dirname(fileURLToPath(import.meta.url));
const BUNDLE = path.join(here, '..', '..', 'dist', 'main.js');

describe('the packaged bundle has no run-if-main self-boot (W13-33)', () => {
  it(
    'RED FIXTURE: no bundled module compares process.argv[1] to import.meta.url. ' +
      'esbuild collapses every module into one file, so that comparison becomes ' +
      'TRUE for the bundle itself and fires on every invocation — which is how ' +
      '`dokima --help` came to bind a port and open a writable state.db in the ' +
      "user's working directory instead of printing usage",
    async () => {
      let bundle: string;
      try {
        bundle = await readFile(BUNDLE, 'utf8');
      } catch {
        // No build in this checkout: skip rather than fail. The gate that
        // matters runs `pnpm build` first (conductor.config.json), and a
        // source-only run has nothing to assert against.
        return;
      }
      expect(bundle).not.toMatch(/pathToFileURL\(process\.argv\[1\]\)\.href === import\.meta\.url/);
      expect(bundle).not.toMatch(/isMainModule/);
    },
  );
});
