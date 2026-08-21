import { describe, expect, it } from 'vitest';
import { McpError } from '../errors.js';
import {
  createStdioToolExecutor,
  discoveredToolDefinitions,
  externalToolId,
} from './executor.js';
import type { McpClient } from './stdio-client.js';
import type { McpServerDefinition, McpToolDefinition } from '../types.js';

const SERVER: McpServerDefinition = {
  id: 'srv-1',
  name: 'Fake',
  transport: 'stdio',
  command: 'node',
  args: [],
  url: null,
  description: null,
};

const TOOL: McpToolDefinition = {
  id: 'srv-1.echo',
  serverId: 'srv-1',
  name: 'echo',
  description: null,
  requiresApproval: true,
};

function fakeClient(calls: { name: string; args: unknown }[]): McpClient {
  return {
    serverId: 'srv-1',
    initialize: async () => {},
    listTools: async () => [],
    callTool: async (name, args) => {
      calls.push({ name, args });
      return { echoed: args };
    },
    dispose: () => {},
  };
}

describe('external tool ids and definitions (W14-01)', () => {
  it('namespaces ids as <serverId>.<tool>, so externals can never collide with the closed agent-session set', () => {
    expect(externalToolId('srv-1', 'read')).toBe('srv-1.read');
    const defs = discoveredToolDefinitions('srv-1', [
      { name: 'read', description: 'their read, not ours' },
    ]);
    expect(defs[0]!.id).toBe('srv-1.read');
    expect(defs[0]!.id).not.toBe('agent-session.read');
  });

  it("RED FIXTURE: every discovered external tool defaults requiresApproval: true — a stranger's tools are side-effectful until a person says otherwise (SC-12)", () => {
    const defs = discoveredToolDefinitions('srv-1', [
      { name: 'echo', description: null },
      { name: 'deploy', description: null },
    ]);
    expect(defs.every((d) => d.requiresApproval === true)).toBe(true);
  });
});

describe('createStdioToolExecutor (W14-01)', () => {
  it('routes a cleared call to the live client for its server', async () => {
    const calls: { name: string; args: unknown }[] = [];
    const executor = createStdioToolExecutor(new Map([['srv-1', fakeClient(calls)]]));
    const outcome = await executor({ server: SERVER, tool: TOOL, args: { a: 1 } });
    expect(calls).toEqual([{ name: 'echo', args: { a: 1 } }]);
    expect(outcome.result).toEqual({ echoed: { a: 1 } });
  });

  it('a registered server with no live client refuses with a reason, pointing at the ledger', async () => {
    const executor = createStdioToolExecutor(new Map());
    await expect(executor({ server: SERVER, tool: TOOL, args: {} })).rejects.toSatisfy(
      (err: unknown) =>
        err instanceof McpError &&
        err.code === 'SERVER_NOT_FOUND' &&
        err.message.includes('srv-1') &&
        err.message.includes('ledger'),
    );
  });
});
