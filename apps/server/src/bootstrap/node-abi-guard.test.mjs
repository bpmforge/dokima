import { describe, expect, it } from 'vitest';
import { checkNodeSupported, describeAbiMismatch } from './node-abi-guard.mjs';

/** The message Node itself prints — reproduced verbatim from a real failure. */
const REAL_ERROR = new Error(
  "The module '/…/better_sqlite3.node'\n" +
    'was compiled against a different Node.js version using\n' +
    'NODE_MODULE_VERSION 127. This version of Node.js requires\n' +
    'NODE_MODULE_VERSION 137. Please try re-compiling or re-installing\n' +
    'the module (for instance, using `npm rebuild` or `npm install`).',
);

describe('describeAbiMismatch (W12-24)', () => {
  it(
    'RED FIXTURE: turns the raw better-sqlite3 ABI error into a message naming the ' +
      'product, the supported Node line, the version actually running and the fix — ' +
      'the original names none of those',
    () => {
      const msg = describeAbiMismatch(REAL_ERROR, { engines: '22.x', running: '24.14.0' });
      expect(msg).toContain('dokima');
      expect(msg).toContain('Node 22.x');
      expect(msg).toContain('24.14.0');
      expect(msg).toContain('fnm use 22');
      expect(msg).toContain('nvm use 22');
    },
  );

  it(
    'reads BOTH ABI numbers out of the error rather than a Node-major table — a ' +
      'lookup table would be a second constant drifting from engines.node and would ' +
      'need editing on every Node release (W12-01 is on the board for that shape)',
    () => {
      const msg = describeAbiMismatch(REAL_ERROR, { engines: '22.x', running: '24.14.0' });
      expect(msg).toContain('ABI 127');
      expect(msg).toContain('ABI 137');
    },
  );

  it('derives the fix command from engines.node, so a future supported line needs no code change', () => {
    const msg = describeAbiMismatch(REAL_ERROR, { engines: '26.x', running: '28.0.0' });
    expect(msg).toContain('fnm use 26');
    expect(msg).toContain('Node 26.x');
  });

  it(
    'GUARD: an unrelated failure passes through untouched. Dressing an arbitrary ' +
      'crash up as a Node-version problem would be worse than the raw trace',
    () => {
      expect(describeAbiMismatch(new Error('ENOENT: no such file'))).toBeNull();
      expect(describeAbiMismatch(new Error('boom'))).toBeNull();
      expect(describeAbiMismatch(undefined)).toBeNull();
    },
  );

  it('still helps when the message shape changes and only the marker survives', () => {
    const vague = new Error('something about NODE_MODULE_VERSION went wrong');
    const msg = describeAbiMismatch(vague, { engines: '22.x', running: '24.0.0' });
    expect(msg).toContain('built for a different Node ABI');
    expect(msg).toContain('fnm use 22');
  });
});

describe('checkNodeSupported (W12-24, the guard that actually fires)', () => {
  it(
    'RED FIXTURE: refuses a Node major outside engines.node BEFORE anything native ' +
      'loads. The first version of this guard wrapped the bundle import instead, ' +
      'passed its tests, and let the raw trace through — better-sqlite3 loads ' +
      'lazily inside a command, long after the import resolves',
    () => {
      const msg = checkNodeSupported('22.x', '24.19.0');
      expect(msg).toContain('unsupported Node version');
      expect(msg).toContain('Node 22.x');
      expect(msg).toContain('24.19.0');
      expect(msg).toContain('fnm use 22');
    },
  );

  it('says nothing when the running major matches — no false refusal on a patch or minor bump', () => {
    expect(checkNodeSupported('22.x', '22.23.1')).toBeNull();
    expect(checkNodeSupported('22.x', '22.0.0')).toBeNull();
  });

  it('derives everything from engines.node, so bumping the supported line needs no code change', () => {
    expect(checkNodeSupported('26.x', '24.0.0')).toContain('fnm use 26');
  });

  it('stays silent when engines.node is absent rather than guessing a supported range', () => {
    expect(checkNodeSupported(undefined, '24.0.0')).toBeNull();
  });
});
