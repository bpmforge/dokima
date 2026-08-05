/**
 * The closed, least-privilege tool set for Dokima's own agent session
 * (SC-18, D-023): read, list, search, write, edit, commit, and the
 * ticket's own declared verify — nothing that can run a free-form
 * process, install a dependency, or open a socket. This is the ONLY
 * place the tool SET is defined; the model chooses tool CALLS against
 * these schemas, never the set itself (mcp-wiring.ts registers exactly
 * these seven with `packages/mcp` and nothing else).
 */

import type { ToolSchema } from './gateway-tool-types.js';

export const TOOL_READ = 'read';
export const TOOL_LIST = 'list';
export const TOOL_SEARCH = 'search';
export const TOOL_WRITE = 'write';
export const TOOL_EDIT = 'edit';
export const TOOL_COMMIT = 'commit';
export const TOOL_VERIFY = 'verify';

export const AGENT_SESSION_TOOL_NAMES = [
  TOOL_READ,
  TOOL_LIST,
  TOOL_SEARCH,
  TOOL_WRITE,
  TOOL_EDIT,
  TOOL_COMMIT,
  TOOL_VERIFY,
] as const;

export type AgentSessionToolName = (typeof AGENT_SESSION_TOOL_NAMES)[number];

export const AGENT_SESSION_TOOL_SCHEMAS: readonly ToolSchema[] = [
  {
    name: TOOL_READ,
    description: "Read a file's contents from the ticket worktree.",
    parameters: {
      type: 'object',
      properties: { path: { type: 'string', description: 'Worktree-relative path.' } },
      required: ['path'],
    },
  },
  {
    name: TOOL_LIST,
    description: 'List directory entries under a path in the ticket worktree.',
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: "Worktree-relative directory path. Defaults to '.'.",
        },
      },
    },
  },
  {
    name: TOOL_SEARCH,
    description:
      'Search file contents in the ticket worktree for a literal substring or regular expression.',
    parameters: {
      type: 'object',
      properties: {
        pattern: {
          type: 'string',
          description: 'Literal substring or JS regular expression.',
        },
        path: {
          type: 'string',
          description:
            "Worktree-relative directory to scope the search to. Defaults to '.'.",
        },
      },
      required: ['pattern'],
    },
  },
  {
    name: TOOL_WRITE,
    description: 'Create or overwrite one file in the ticket worktree.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Worktree-relative path.' },
        content: { type: 'string', description: 'Full file content.' },
      },
      required: ['path', 'content'],
    },
  },
  {
    name: TOOL_EDIT,
    description:
      'Replace one exact, unique occurrence of oldString with newString in an existing file.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Worktree-relative path.' },
        oldString: { type: 'string' },
        newString: { type: 'string' },
      },
      required: ['path', 'oldString', 'newString'],
    },
  },
  {
    name: TOOL_COMMIT,
    description:
      'Commit explicit files on the ticket branch. Refused wholesale if any path falls ' +
      "outside the ticket's write_scope, is hard-excluded, or escapes the worktree via a symlink.",
    parameters: {
      type: 'object',
      properties: {
        files: {
          type: 'array',
          items: { type: 'string' },
          description: 'Explicit worktree-relative paths to stage. Never a wildcard.',
        },
        message: { type: 'string' },
      },
      required: ['files', 'message'],
    },
  },
  {
    name: TOOL_VERIFY,
    description: "Run the ticket's own declared verify command in the worktree.",
    parameters: { type: 'object', properties: {} },
  },
];
