/**
 * W12-27. The type surface only — `createPluginContext` and
 * `authorizeWithPlugin` were written, tested, and withheld (see types.ts):
 * they have no caller until a loader exists, and the export ratchet refused
 * them for exactly the reason this repo keeps needing to relearn.
 *
 * What IS asserted here is the part a future loader must not be free to get
 * wrong: the two refusals carry the identity of what was refused, and say why.
 */
import { describe, expect, it } from 'vitest';
import { PluginFailedError, PluginScopeError } from './types.js';

describe('plugin seam contract (W12-27)', () => {
  it(
    'a scope refusal names the plugin AND the ref, because the operator needs ' +
      'to know which installed plugin reached outside its entry',
    () => {
      const err = new PluginScopeError('claude-sub-auth', 'openai-key');
      expect(err.pluginId).toBe('claude-sub-auth');
      expect(err.ref).toBe('openai-key');
      expect(err.message).toMatch(/scoped to one entry/);
      expect(err.name).toBe('PluginScopeError');
    },
  );

  it(
    'a failure refusal states that the provider is unavailable and NOT retried ' +
      'unauthenticated — the rule the whole seam rests on (PLUGIN_SEAM.md §5)',
    () => {
      const err = new PluginFailedError('claude-sub-auth', 'no refresh token');
      expect(err.message).toMatch(/no refresh token/);
      expect(err.message).toMatch(/NOT retried without credentials/);
      expect(err.name).toBe('PluginFailedError');
    },
  );

});
