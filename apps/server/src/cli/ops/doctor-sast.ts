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
import {
  networkPolicyOf,
  unauditedDependenciesOf,
} from '../../api/pipeline/onboard-security-checks.js';
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

/**
 * W23-56: what the dependency audit can do for THIS project. A local-only
 * project has no advisory data, so `npm audit` never runs there: a ticket that
 * leaves every manifest and lockfile as its base had them needs no audit, and
 * one that changes them reports tool-deps NOT RUN — which blocks machine
 * acceptance unless the project has chosen otherwise. Doctor says which, and
 * how to change it, before a ticket sits in review to find out.
 */
export async function checkDependencyAudit(io: CliIO): Promise<DoctorCheck> {
  const [network, policy] = await Promise.all([
    networkPolicyOf(io.cwd),
    unauditedDependenciesOf(io.cwd),
  ]);
  if (network === 'network-allowed') {
    return {
      name: 'dependency-audit',
      status: 'ok',
      detail:
        'network allowed: npm audit reaches its registry, compared with each ticket base',
    };
  }
  const shape =
    'this project is local-only, so npm audit has no advisory data. A ticket that leaves ' +
    'every manifest and lockfile unchanged needs no audit;';
  if (policy === 'allow') {
    return {
      name: 'dependency-audit',
      status: 'warn',
      detail:
        `${shape} one that changes its dependencies is accepted without a dependency audit ` +
        '(security.unauditedDependencies is "allow" in .dokima/settings.json).',
    };
  }
  return {
    name: 'dependency-audit',
    status: 'warn',
    detail:
      `${shape} one that changes its dependencies reports tool-deps NOT RUN and waits for a ` +
      'person. To change that: allow the network for this project ("modelPolicy.localOnly": ' +
      'false), or accept such changes without an audit ("security.unauditedDependencies": ' +
      '"allow") in .dokima/settings.json. Offline advisory snapshots are not supported yet.',
  };
}
