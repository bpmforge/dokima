/**
 * W23-59 — the suite never reaches the developer's SAST ruleset.
 *
 * `resolveSastRules` falls back to HOME/.dokima/rules/sast. On the day the
 * founder linked a real ruleset there, every onboard and review test began
 * spawning a real opengrep scan (~5.5 s each), the full suite went from 180 s
 * to over ten minutes with 103 timeouts, and 11 orphaned scans kept running at
 * full CPU after their workers were killed. The machine's state must not leak
 * into the suite (W10-71, W23-52); `vitest.network-guard.ts` pins it.
 */

import { describe, expect, it } from 'vitest';
import { resolveSastRules, SAST_RULES_ENV } from './sast-rules.js';

describe('W23-59: no test inherits a real SAST ruleset', () => {
  it.skipIf(process.env.DOKIMA_TEST_REAL_SCANNERS === '1')(
    "RED: inside the suite the ruleset resolves to none, whatever the developer's HOME holds",
    async () => {
      expect(process.env[SAST_RULES_ENV]).toBeTruthy();
      expect(await resolveSastRules(process.env)).toBeNull();
    },
  );
});
