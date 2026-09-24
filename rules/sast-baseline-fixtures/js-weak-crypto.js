// Fixture for rules/sast-baseline/js-weak-crypto.yaml. Deliberately unsafe; never run.
const crypto = require('crypto');

function digest(data, key, iv) {
  // ruleid: js-weak-hash
  const a = crypto.createHash('md5').update(data).digest('hex');
  // ruleid: js-weak-hash
  const b = crypto.createHash('sha1').update(data).digest('hex');
  // ok: js-weak-hash
  const ws = crypto.createHash('sha1').update(data + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
  // ok: js-weak-hash
  const c = crypto.createHash('sha256').update(data).digest('hex');

  // ruleid: js-weak-cipher
  const d = crypto.createCipher('aes-256-cbc', key);
  // ruleid: js-weak-cipher
  const e = crypto.createCipheriv('des-ede3-cbc', key, iv);
  // ruleid: js-weak-cipher
  const f = crypto.createCipheriv('aes-128-ecb', key, null);
  // ok: js-weak-cipher
  const g = crypto.createCipheriv('aes-256-gcm', key, iv);
  return [a, b, ws, c, d, e, f, g];
}
module.exports = digest;
