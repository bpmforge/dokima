// Fixture for rules/sast-baseline/js-hardcoded-secret.yaml. Deliberately unsafe; never run.
// The values are made up and match no real credential format.

// ruleid: js-hardcoded-credential
const dbPassword = 'Tr0ub4dor&3.horse';
// ruleid: js-hardcoded-credential
const config = { apiKey: 'q8Zr2xLm.fixture.9Kp' };
// ruleid: js-hardcoded-credential
config.clientSecret = 'fixture-0c7e1b5a9d';

// ok: js-hardcoded-credential
const password = process.env.DB_PASSWORD;
// ok: js-hardcoded-credential
const PASSWORD_ENV = 'DOKIMA_DB_PASSWORD';
// ok: js-hardcoded-credential
const apiKeyPlaceholder = { apiKey: '<your-api-key>' };
// ok: js-hardcoded-credential
const secret = 'short';
// ok: js-hardcoded-credential
const passwordLabel = 'Enter your password';

module.exports = { dbPassword, config, password, PASSWORD_ENV, apiKeyPlaceholder, secret, passwordLabel };
