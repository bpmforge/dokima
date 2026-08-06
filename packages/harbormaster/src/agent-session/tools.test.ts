import { describe, expect, it } from 'vitest';
import { AGENT_SESSION_TOOL_NAMES, AGENT_SESSION_TOOL_SCHEMAS } from './tools.js';

describe('agent-session tools (SC-18 closed set)', () => {
  it('declares exactly seven tools: read, list, search, write, edit, commit, verify', () => {
    expect([...AGENT_SESSION_TOOL_NAMES].sort()).toEqual(
      ['commit', 'edit', 'list', 'read', 'search', 'verify', 'write'].sort(),
    );
  });

  it('has one schema per declared tool name, with no free-form shell/network/install tool', () => {
    expect(AGENT_SESSION_TOOL_SCHEMAS.map((tool) => tool.name).sort()).toEqual(
      [...AGENT_SESSION_TOOL_NAMES].sort(),
    );
    for (const forbidden of [
      'shell',
      'exec',
      'bash',
      'fetch',
      'http',
      'install',
      'npm',
    ]) {
      expect(AGENT_SESSION_TOOL_NAMES).not.toContain(forbidden);
    }
  });

  it('commit and write require their explicit-path fields (no wildcard shape)', () => {
    const commit = AGENT_SESSION_TOOL_SCHEMAS.find((tool) => tool.name === 'commit')!;
    expect((commit.parameters as { required: string[] }).required).toEqual([
      'files',
      'message',
    ]);
  });
});
