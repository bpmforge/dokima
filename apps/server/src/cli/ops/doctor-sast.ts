/**
 * The `sast` doctor check (W23-51), a chapter of `doctor.ts` split out under
 * the 400-line CODE_BOOK_PROTOCOL cap.
 */

import {
  executableIsInstalled,
  resolveSastRules,
  sastRulesFix,
  sastRulesLocation,
  type SastRuleset,
} from '@dokima/harbormaster';
import type { CliIO } from '../../bootstrap/cli.js';
import type { DoctorCheck } from './doctor.js';

export type SastProbe = (env: NodeJS.ProcessEnv) => Promise<{
  readonly opengrepInstalled: boolean;
  readonly rules: SastRuleset | null;
}>;

/** The engine's own installer, as its README gives it (and attest's SETUP.md records). */
export const OPENGREP_INSTALL_FIX =
  'curl -fsSL https://raw.githubusercontent.com/opengrep/opengrep/main/install.sh | bash';

/**
 * W23-51: the machine review's SAST check runs Opengrep over a pinned local
 * ruleset — never registry rules. Missing either one, every review reports
 * tool-sast as NOT RUN and no ticket can be accepted without a person, so
 * doctor says which is missing and what fixes it. A warning, not a failure:
 * everything else still works, with that coverage named.
 */
export async function checkSast(
  io: CliIO,
  deps: { readonly sastProbe?: SastProbe },
): Promise<DoctorCheck> {
  const probe =
    deps.sastProbe ??
    (async (env: NodeJS.ProcessEnv) => ({
      opengrepInstalled: executableIsInstalled('opengrep'),
      rules: await resolveSastRules(env),
    }));
  const { opengrepInstalled, rules } = await probe(io.env);
  const problems: string[] = [];
  if (!opengrepInstalled) {
    problems.push(
      `opengrep is not installed — install it with its official installer: ${OPENGREP_INSTALL_FIX}`,
    );
  }
  if (!rules) {
    problems.push(
      `no SAST ruleset at ${sastRulesLocation(io.env).dir} — ${sastRulesFix()}`,
    );
  }
  if (problems.length > 0 || !rules) {
    return {
      name: 'sast',
      status: 'warn',
      detail:
        `${problems.join('; ')}. Until then every machine review reports tool-sast ` +
        `as NOT RUN, and no ticket is accepted without a person.`,
    };
  }
  return {
    name: 'sast',
    status: 'ok',
    detail: `opengrep installed; ${rules.ruleFileCount} rule file(s) from ${rules.root} (${rules.digest.slice(0, 19)})`,
  };
}
