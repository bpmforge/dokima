import type { McpToolDefinition } from './types.js';

/** A caller-supplied policy for `'dynamic'` tools (SC-12: "dynamic classification for shell"). */
export type DynamicApprovalPolicy = (tool: McpToolDefinition, args: unknown) => boolean;

const DESTRUCTIVE_SHELL_PATTERNS: readonly RegExp[] = [
  /\brm\s+(-\w*\s+)*-\w*[rR]\w*/, // rm -rf and permutations
  /\bsudo\b/,
  /\bmkfs\b/,
  /\bdd\s+if=/,
  />\s*\/dev\/sd/,
  /\bshutdown\b/,
  /\breboot\b/,
  /\bcurl\b[^|]*\|\s*(sudo\s+)?(ba)?sh\b/,
  /\bwget\b[^|]*\|\s*(sudo\s+)?(ba)?sh\b/,
  /:\(\)\s*\{[^}]*;\s*\}\s*;\s*:/, // fork bomb
  /\bgit\s+push\s+(--force|-f)\b/,
  /\bdrop\s+table\b/i,
  /\bchmod\s+-R\s+777\b/,
];

/**
 * Default heuristic for shell-type tools (THREAT_MODEL T-14 "side-effectful
 * tool invoked without consent"): a command is flagged as requiring approval
 * when it matches a known-destructive pattern, OR when the args are not a
 * recognizable shell command at all — fail-closed, not fail-open. Callers
 * may supply their own `DynamicApprovalPolicy` instead (e.g. a real
 * allow/deny command list); this default exists so "dynamic for shell" is a
 * real, testable behavior rather than a stub that always requires approval.
 */
export function defaultShellApprovalPolicy(
  _tool: McpToolDefinition,
  args: unknown,
): boolean {
  const command = extractCommand(args);
  if (command === null) return true;
  return DESTRUCTIVE_SHELL_PATTERNS.some((pattern) => pattern.test(command));
}

function extractCommand(args: unknown): string | null {
  if (typeof args === 'string') return args;
  if (
    args !== null &&
    typeof args === 'object' &&
    'command' in args &&
    typeof (args as { command: unknown }).command === 'string'
  ) {
    return (args as { command: string }).command;
  }
  return null;
}

/**
 * Resolves whether one call needs an approval card. `true`/`false` tools are
 * static; `'dynamic'` tools defer to `dynamicPolicy` (falling back to
 * `defaultShellApprovalPolicy`) — fail closed (require approval) whenever
 * that policy can't make a confident call.
 */
export function resolveRequiresApproval(
  tool: McpToolDefinition,
  args: unknown,
  dynamicPolicy?: DynamicApprovalPolicy,
): boolean {
  if (tool.requiresApproval === true) return true;
  if (tool.requiresApproval === false) return false;
  const policy = dynamicPolicy ?? defaultShellApprovalPolicy;
  return policy(tool, args);
}
