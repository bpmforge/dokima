// Fixture for rules/sast-baseline/js-command-injection.yaml. Deliberately unsafe; never run.
const cp = require('child_process');
const { execSync, execFile, spawn } = require('child_process');

function run(req) {
  // ruleid: js-child-process-shell-dynamic
  cp.exec('ls ' + req.query.dir);
  // ruleid: js-child-process-shell-dynamic
  execSync(`git log ${req.query.ref}`);
  // ruleid: js-child-process-shell-dynamic
  require('child_process').exec(req.body.cmd);
  // ok: js-child-process-shell-dynamic
  execSync('git status --short');
  // ok: js-child-process-shell-dynamic
  execFile('git', ['log', req.query.ref]);
  // ok: js-child-process-shell-dynamic
  /a(b)/.exec(req.query.dir);

  // ruleid: js-spawn-shell-true-dynamic
  spawn('tar -xf ' + req.query.file, [], { shell: true });
  // ok: js-spawn-shell-true-dynamic
  spawn('tar', ['-xf', req.query.file], { shell: false });
  // ok: js-spawn-shell-true-dynamic
  spawn('npm test', [], { shell: true });
}
module.exports = run;
