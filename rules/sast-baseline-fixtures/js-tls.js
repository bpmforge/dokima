// Fixture for rules/sast-baseline/js-tls.yaml. Deliberately unsafe; never run.
const https = require('https');

// ruleid: js-tls-verification-disabled
const insecure = new https.Agent({ rejectUnauthorized: false });
// ruleid: js-tls-verification-disabled
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
// ok: js-tls-verification-disabled
const secure = new https.Agent({ rejectUnauthorized: true });
// ok: js-tls-verification-disabled
const pinned = new https.Agent({ ca: process.env.EXTRA_CA });

module.exports = { insecure, secure, pinned };
