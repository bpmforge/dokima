// Fixture for rules/sast-baseline/js-code-injection.yaml. Deliberately unsafe; never run.
const vm = require('vm');

function handler(req) {
  // ruleid: js-eval-dynamic
  eval(req.body.expression);
  // ruleid: js-eval-dynamic
  eval('return ' + req.query.x);
  // ok: js-eval-dynamic
  eval('1 + 1');

  // ruleid: js-new-function-dynamic
  const f = new Function('a', req.body.code);
  // ok: js-new-function-dynamic
  const g = new Function('a', 'return a * 2');

  // ruleid: js-vm-run-dynamic
  vm.runInNewContext(req.body.script, {});
  // ok: js-vm-run-dynamic
  vm.runInNewContext('x + 1', { x: 1 });
  return [f, g];
}
module.exports = handler;
