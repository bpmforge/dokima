import { describe, expect, it } from 'vitest';
import {
  AGENT_RUNNER_SETTINGS_KEY,
  DEFAULT_AGENT_RUNNER_SETTING,
  EXTERNAL_AGENT_WARNING,
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
});
