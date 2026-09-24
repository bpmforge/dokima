// Fixture for rules/sast-baseline/js-command-injection.yaml (TypeScript, ESM). Deliberately unsafe; never run.
import { exec, execFileSync } from 'node:child_process';
import * as cp from 'child_process';

export function run(branch: string): void {
  // ruleid: js-child-process-shell-dynamic
  exec(`git checkout ${branch}`);
  // ruleid: js-child-process-shell-dynamic
  cp.execSync('git branch -D ' + branch);
  // ok: js-child-process-shell-dynamic
  execFileSync('git', ['checkout', branch]);
  // ok: js-child-process-shell-dynamic
  exec('git fetch --all');
}
