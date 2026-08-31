// conductor/remediate.mjs — bounded mechanical remediation (P2-03, incident
// review Stage 3). A formatter/autofix-class failure is a code failure, but
// it is not a NEW-SESSION failure: regenerating a whole candidate because a
// linter wanted `--fix` consumed a full attempt in the founding incident and
// added review churn without adding safety. One bounded pass, deterministic
// tool only, in scope only, then the original command re-runs from scratch.
//
// Never: security waivers, test deletion, assertion weakening, out-of-scope
// edits. The pass runs ONCE per ticket — a second mechanical failure means
// the tool disagrees with itself, which is a real defect, not formatting.

import { execFileSync } from 'node:child_process';

/**
 * Decide whether a failed receipt is mechanically remediable: EVERY failed
 * command must have a configured autofix. One unmatched failure disqualifies
 * the whole receipt — half-fixing hides the unfixed half behind a rerun.
 *
 * cfg.mechanicalFix: [{ match: "pnpm lint", cmd: ["pnpm", ["lint", "--fix"]] }]
 *
 * @returns {null | Array<[string, string[]]>} the fix commands to run, or null
 */
export function remediablePlan(receipt, mechanicalFix = []) {
  const failed = (receipt?.commands ?? []).filter((c) => c.exitCode !== 0);
  if (failed.length === 0) return null;
  const plan = [];
  for (const c of failed) {
    const rule = mechanicalFix.find((r) => String(c.command).startsWith(r.match));
    if (!rule) return null; // an unfixable failure is present — no remediation
    plan.push(rule.cmd);
  }
  return plan;
}

/**
 * Every path the fix touched must be inside the ticket's write scope (or the
 * shared-infra allowlist). An autofix that reaches an out-of-scope file is
 * REJECTED whole — the diff is reverted by the caller, and the failure goes
 * back to the normal attempt ladder.
 */
export function outOfScopeFixes(changedFiles, scopeRes, alwaysOkRes = []) {
  return changedFiles.filter(
    (f) => !scopeRes.some((r) => r.test(f)) && !alwaysOkRes.some((r) => r.test(f)),
  );
}

/**
 * Apply the plan in the worktree, commit the amendment, and report what
 * changed. Injected `sh` keeps this testable without a real toolchain.
 *
 * @returns {{applied: boolean, changed: string[], rejected: string[], error?: string}}
 */
export function applyRemediation({
  wt,
  ticketId,
  plan,
  scopeRes,
  alwaysOkRes,
  sh = defaultSh,
  timeoutMin = 10,
}) {
  for (const [cmd, args = []] of plan) {
    try {
      sh(cmd, args, { cwd: wt, timeout: timeoutMin * 60_000 });
    } catch (e) {
      // The FIXER failing is not formatting — surface it, change nothing.
      return {
        applied: false,
        changed: [],
        rejected: [],
        error: `autofix ${cmd} ${args.join(' ')} failed: ${String(e.stdout || e.message).slice(-300)}`,
      };
    }
  }
  const changed = sh('git', ['diff', '--name-only'], { cwd: wt })
    .split('\n')
    .filter(Boolean);
  if (changed.length === 0) {
    return {
      applied: false,
      changed: [],
      rejected: [],
      error: 'autofix produced no diff — the failure is not mechanical',
    };
  }
  const rejected = outOfScopeFixes(changed, scopeRes, alwaysOkRes);
  if (rejected.length) {
    sh('git', ['checkout', '--', '.'], { cwd: wt }); // revert the whole pass
    return { applied: false, changed, rejected };
  }
  sh('git', ['add', '-A'], { cwd: wt });
  sh(
    'git',
    [
      'commit',
      '-q',
      '-m',
      `chore(${ticketId}): bounded mechanical remediation (approved autofix; no coding attempt consumed)`,
    ],
    { cwd: wt },
  );
  return { applied: true, changed, rejected: [] };
}

function defaultSh(cmd, args, opts = {}) {
  return execFileSync(cmd, args, {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
    ...opts,
  });
}
