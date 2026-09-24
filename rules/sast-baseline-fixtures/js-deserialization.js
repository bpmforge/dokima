// Fixture for rules/sast-baseline/js-deserialization.yaml. Deliberately unsafe; never run.
const serialize = require('node-serialize');

function load(req) {
  // ruleid: js-unsafe-deserialization
  const a = serialize.unserialize(req.cookies.profile);
  // ok: js-unsafe-deserialization
  const b = JSON.parse(req.cookies.profile);
  // ok: js-unsafe-deserialization
  const c = serialize.serialize({ ok: true });
  return [a, b, c];
}
module.exports = load;
