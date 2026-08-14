/**
 * scripts/supervised-run/seed.ts — build a scratch project for a SUPERVISED
 * run against a real model (W11 exit criteria 2 and 3).
 *
 * Why this exists: exits 2 and 3 have never been demonstrated. Everything the
 * agent loop is made of has been proven against fixtures, a fake shell agent
 * and a `node:http` stub — all correct under law 9a, and none of it the same
 * as watching a real model finish a real ticket. The setup friction is what
 * has kept that from happening, so this removes it.
 *
 * The seeded ticket is deliberately small but genuinely RED: `src/check.mjs`
 * fails until `subtract` exists. A run that "passes" without the agent writing
 * anything is therefore impossible, and the close gate re-runs the same
 * command out-of-session (SC-02) rather than trusting the agent's word.
 *
 * Usage:
 *   pnpm exec tsx scripts/supervised-run/seed.ts [targetDir]
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
// Relative source imports, not workspace specifiers: `scripts/` is not a
// workspace package, so it has no node_modules link for `@dokima/*`. tsx
// resolves the `.js` specifier back to the `.ts` source.
import { createIdentity, openEventLog } from '../../packages/events/src/index.js';
import { createTicket } from '../../packages/tickets/src/index.js';

const MATH_SRC = `export function add(a, b) {
  return a + b;
}
`;

const CHECK_SRC = `// Namespace import on purpose: a NAMED import of a missing export throws a
// SyntaxError at module load, which tells the agent far less than a plain
// "subtract is not implemented" line it can act on.
import * as math from './math.mjs';

const { add, subtract } = math;

if (add(2, 3) !== 5) {
  console.error('add is broken');
  process.exit(1);
}
if (typeof subtract !== 'function') {
  console.error('subtract is not implemented');
  process.exit(1);
}
if (subtract(5, 3) !== 2) {
  console.error('subtract returned the wrong value');
  process.exit(1);
}
console.log('OK');
`;

function git(cwd: string, args: string[]): void {
  execFileSync('git', args, { cwd, stdio: 'pipe' });
}

function main(): void {
  const target = resolve(
    process.argv[2] ?? join(tmpdir(), `dokima-supervised-${Date.now()}`),
  );
  mkdirSync(join(target, 'src'), { recursive: true });

  writeFileSync(join(target, 'src', 'math.mjs'), MATH_SRC);
  writeFileSync(join(target, 'src', 'check.mjs'), CHECK_SRC);
  writeFileSync(
    join(target, 'CLAUDE.md'),
    [
      '# Scratch project — supervised run',
      '',
      'Rules:',
      '- Only edit files under `src/`.',
      '- `node src/check.mjs` must print OK and exit 0.',
      '- Commit your work before reporting completion.',
      '',
    ].join('\n'),
  );

  git(target, ['init', '-b', 'main']);
  git(target, ['config', 'user.email', 'supervised@dokima.local']);
  git(target, ['config', 'user.name', 'Supervised Run']);
  git(target, ['add', '-A']);
  git(target, ['commit', '-m', 'chore: scratch project with a failing check']);

  mkdirSync(join(target, '.dokima'), { recursive: true });
  const log = openEventLog(join(target, '.dokima', 'state.db'));
  try {
    createIdentity(log, { id: 'worker-1', name: 'worker-1', kind: 'machine' });
    createIdentity(log, { id: 'reviewer-1', name: 'reviewer-1', kind: 'machine' });
    createTicket(log, 'worker-1', {
      id: 'T-1',
      type: 'task',
      title: 'Implement subtract(a, b) in src/math.mjs',
      lane: 'core',
      interface: 'export function subtract(a: number, b: number): number',
      writeScope: ['src/**'],
      verify: 'node src/check.mjs',
      acceptance: [
        {
          id: 'AC-1',
          text: '`subtract` is exported from src/math.mjs and returns a - b.',
          done: false,
        },
        {
          id: 'AC-2',
          text: '`node src/check.mjs` exits 0 and prints OK.',
          done: false,
        },
      ],
    });
  } finally {
    log.close();
  }

  process.stdout.write(
    [
      '',
      `Scratch project ready: ${target}`,
      '',
      '  Ticket T-1 is claimable and the verify command is RED right now',
      '  (subtract does not exist yet), so nothing can pass without real work.',
      '',
      'Next: see docs/work/SUPERVISED_RUN.md',
      '',
    ].join('\n'),
  );
}

main();
