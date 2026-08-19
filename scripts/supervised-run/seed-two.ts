/**
 * A THREE-ticket scratch project, to exercise what the single-ticket seed
 * cannot: dependency ordering, a second claim after a first close, and a
 * ticket that CANNOT pass so retry/park is real rather than assumed.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createIdentity, openEventLog } from '../../packages/events/src/index.js';
import { createTicket } from '../../packages/tickets/src/index.js';

const target = process.argv[2]!;
const git = (cwd: string, args: string[]) =>
  execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8' });

mkdirSync(join(target, 'src'), { recursive: true });
writeFileSync(join(target, 'src/math.mjs'), 'export function add(a, b) {\n  return a + b;\n}\n');
writeFileSync(
  join(target, 'src/check.mjs'),
  `import { add, subtract } from './math.mjs';
if (typeof subtract !== 'function') { console.log('subtract is not implemented'); process.exit(1); }
if (subtract(5, 3) !== 2) { console.log('subtract is wrong'); process.exit(1); }
console.log('OK');
`,
);
writeFileSync(
  join(target, 'src/check2.mjs'),
  `import { multiply, subtract } from './math.mjs';
if (typeof subtract !== 'function') { console.log('T-2 needs T-1 first'); process.exit(1); }
if (typeof multiply !== 'function') { console.log('multiply is not implemented'); process.exit(1); }
if (multiply(4, 3) !== 12) { console.log('multiply is wrong'); process.exit(1); }
console.log('OK');
`,
);
// Impossible on purpose: nothing an agent writes can make this exit 0.
writeFileSync(join(target, 'src/check3.mjs'), `console.log('this gate never passes'); process.exit(1);\n`);
writeFileSync(join(target, '.gitignore'), '.dokima/\n');
git(target, ['init', '-q', '-b', 'main']);
git(target, ['config', 'user.email', 'scratch@dokima.local']);
git(target, ['config', 'user.name', 'Scratch']);
git(target, ['add', '-A']);
git(target, ['commit', '-m', 'chore: two-ticket scratch project']);

mkdirSync(join(target, '.dokima'), { recursive: true });
const log = openEventLog(join(target, '.dokima', 'state.db'));
try {
  createIdentity(log, { id: 'worker-1', name: 'worker-1', kind: 'machine' });
  createIdentity(log, { id: 'reviewer-1', name: 'reviewer-1', kind: 'machine' });
  createTicket(log, 'worker-1', {
    id: 'T-1', type: 'task', title: 'Implement subtract(a, b) in src/math.mjs',
    lane: 'core', interface: 'export function subtract(a: number, b: number): number',
    writeScope: ['src/**'], verify: 'node src/check.mjs',
    acceptance: [{ id: 'AC-1', text: '`subtract` is exported from src/math.mjs and returns a - b.', done: false }],
  });
  createTicket(log, 'worker-1', {
    id: 'T-2', type: 'task', title: 'Implement multiply(a, b) in src/math.mjs',
    lane: 'core', interface: 'export function multiply(a: number, b: number): number',
    writeScope: ['src/**'], verify: 'node src/check2.mjs', dependsOn: ['T-1'],
    acceptance: [{ id: 'AC-1', text: '`multiply` is exported from src/math.mjs and returns a * b.', done: false }],
  });
} finally {
  log.close();
}
console.log('two-ticket scratch ready:', target);
