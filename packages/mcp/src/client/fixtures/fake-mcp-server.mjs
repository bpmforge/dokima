#!/usr/bin/env node
/**
 * Fake MCP server fixture (W14-01, Law 9a): a LOCAL child process speaking
 * newline-delimited JSON-RPC over stdio — tests exercise the real client
 * against this, never a live server or the network.
 *
 * Modes (argv):
 *   (none)    healthy: initialize, tools/list (echo + boom), tools/call
 *   --hang    never answers anything (the red fixture: killed at deadline)
 *   --garbage emits a non-JSON line before behaving, proving framing survives
 */
const mode = process.argv[2] ?? 'healthy';

const send = (msg) => process.stdout.write(`${JSON.stringify(msg)}\n`);

if (mode === '--garbage') {
  process.stdout.write('starting fake server, please hold\n');
}

let buffer = '';
process.stdin.on('data', (chunk) => {
  if (mode === '--hang') return;
  buffer += chunk.toString();
  let nl = buffer.indexOf('\n');
  while (nl !== -1) {
    const line = buffer.slice(0, nl).trim();
    buffer = buffer.slice(nl + 1);
    if (line) handle(JSON.parse(line));
    nl = buffer.indexOf('\n');
  }
});

function handle(msg) {
  if (msg.id === undefined) return; // notification
  if (msg.method === 'initialize') {
    send({
      jsonrpc: '2.0',
      id: msg.id,
      result: {
        protocolVersion: msg.params?.protocolVersion ?? '2025-06-18',
        capabilities: { tools: {} },
        serverInfo: { name: 'fake-mcp-server', version: '0' },
      },
    });
    return;
  }
  if (msg.method === 'tools/list') {
    send({
      jsonrpc: '2.0',
      id: msg.id,
      result: {
        tools: [
          { name: 'echo', description: 'echoes its arguments back' },
          { name: 'boom', description: 'always errors' },
        ],
      },
    });
    return;
  }
  if (msg.method === 'tools/call') {
    const name = msg.params?.name;
    if (name === 'echo') {
      send({
        jsonrpc: '2.0',
        id: msg.id,
        result: {
          content: [{ type: 'text', text: JSON.stringify(msg.params?.arguments ?? null) }],
        },
      });
      return;
    }
    send({
      jsonrpc: '2.0',
      id: msg.id,
      error: { code: -32000, message: 'boom exploded: the fixture says no' },
    });
    return;
  }
  send({
    jsonrpc: '2.0',
    id: msg.id,
    error: { code: -32601, message: `method not found: ${msg.method}` },
  });
}
