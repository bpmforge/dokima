import { describe, expect, it } from 'vitest';
import {
  AGENT_RUNNER_SETTINGS_KEY,
  DEFAULT_AGENT_RUNNER_SETTING,
  EXTERNAL_AGENT_WARNING,
  parseAgentRunnerSetting,
  type AgentRunnerSetting,
} from './settings-types.js';

describe('AgentRunnerSetting (W11-04, FR-H6, D-023)', () => {
  it('defaults to the built-in agent, not a refusal', () => {
    expect(DEFAULT_AGENT_RUNNER_SETTING).toEqual({ kind: 'built-in' });
  });

  it('the settings key is the flat generic key every panel here reads/writes through', () => {
    expect(AGENT_RUNNER_SETTINGS_KEY).toBe('agentRunner');
  });

  it('external requires an explicit command — the type does not default one', () => {
    const external: AgentRunnerSetting = { kind: 'external', command: 'opencode -p' };
    expect(external.command).toBe('opencode -p');
  });

  it('the external-agent warning names every mechanism it bypasses (acceptance 2)', () => {
    expect(EXTERNAL_AGENT_WARNING).toMatch(/role.{0,10}model matrix/i);
    expect(EXTERNAL_AGENT_WARNING).toMatch(/escalation ladder/i);
    expect(EXTERNAL_AGENT_WARNING).toMatch(/budget breaker/i);
    expect(EXTERNAL_AGENT_WARNING).toMatch(/spend ledger/i);
    expect(EXTERNAL_AGENT_WARNING).toMatch(
      /tokens are spent somewhere Dokima cannot see/i,
    );
  });

  describe('parseAgentRunnerSetting', () => {
    it('RED FIXTURE: no stored value degrades to the built-in default, never a refusal', () => {
      expect(parseAgentRunnerSetting(undefined)).toEqual({ kind: 'built-in' });
    });

    it('a valid external row round-trips', () => {
      expect(
        parseAgentRunnerSetting({ kind: 'external', command: 'opencode -p' }),
      ).toEqual({
        kind: 'external',
        command: 'opencode -p',
      });
    });

    it('external with no command degrades to built-in — nothing was actually typed in', () => {
      expect(parseAgentRunnerSetting({ kind: 'external' })).toEqual({ kind: 'built-in' });
      expect(parseAgentRunnerSetting({ kind: 'external', command: '   ' })).toEqual({
        kind: 'built-in',
      });
    });

    it('malformed values (wrong kind, array, primitive) degrade to built-in rather than throwing', () => {
      expect(parseAgentRunnerSetting({ kind: 'bogus' })).toEqual({ kind: 'built-in' });
      expect(parseAgentRunnerSetting(['external'])).toEqual({ kind: 'built-in' });
      expect(parseAgentRunnerSetting('external')).toEqual({ kind: 'built-in' });
      expect(parseAgentRunnerSetting(null)).toEqual({ kind: 'built-in' });
    });
  });
});
