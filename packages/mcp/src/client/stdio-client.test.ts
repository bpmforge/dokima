import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { McpError } from '../errors.js';
import { spawnStdioMcpClient, type McpClient } from './stdio-client.js';

/**
 * W14-01. Law 9(a): every test here speaks to a LOCAL fixture child process
 * (fake-mcp-server.mjs) over stdio — no network, no live servers.
 */
const FIXTURE = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  'fixtures',
  'fake-mcp-server.mjs',
);

const clients: McpClient[] = [];
function client(mode?: string, deadlineMs = 5_000): McpClient {
  const c = spawnStdioMcpClient(
    {
      id: 'fake-1',
      command: process.execPath,
      args: mode ? [FIXTURE, mode] : [FIXTURE],
    },
    { requestDeadlineMs: deadlineMs },
  );
  clients.push(c);
  return c;
}

afterEach(() => {
  for (const c of clients.splice(0)) c.dispose();
});

describe('stdio MCP client (W14-01)', () => {
  it('initializes, discovers tools, and calls one end to end', async () => {
    const c = client();
    await c.initialize();
    const tools = await c.listTools();
    expect(tools.map((t) => t.name)).toEqual(['echo', 'boom']);

    const result = (await c.callTool('echo', { hello: 'world' })) as {
      content: { text: string }[];
    };
    expect(result.content[0]!.text).toBe('{"hello":"world"}');
  });

  it("RED FIXTURE: a tools/call error carries the server's own message, never a bare exit code (the W13-41 lesson)", async () => {
    const c = client();
    await c.initialize();
    await expect(c.callTool('boom', {})).rejects.toThrow(/boom exploded: the fixture says no/);
    await expect(c.callTool('boom', {})).rejects.toSatisfy(
      (err: unknown) => err instanceof McpError && err.code === 'TOOL_CALL_FAILED',
    );
  });

  it('RED FIXTURE: a server that never answers initialize is killed at the deadline, and the error names the server id', async () => {
    const c = client('--hang', 250);
    await expect(c.initialize()).rejects.toSatisfy(
      (err: unknown) =>
        err instanceof McpError &&
        err.code === 'SERVER_TIMEOUT' &&
        err.message.includes('fake-1') &&
        err.message.includes('initialize'),
    );
  });

  it('framing survives a server that emits non-JSON on stdout before behaving', async () => {
    const c = client('--garbage');
    await c.initialize();
    expect((await c.listTools()).length).toBe(2);
  });

  it('a request after dispose refuses instead of hanging', async () => {
    const c = client();
    await c.initialize();
    c.dispose();
    await expect(c.listTools()).rejects.toThrow(/disposed/);
  });
});
