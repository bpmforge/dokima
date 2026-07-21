/**
 * Ripgrep wrapper (FR-M4 "ripgrep wrapper for exact search"). `rg` is a
 * subprocess tool (docs/TECH_STACK.md "OK — subprocess or vendored"), not an
 * npm dependency — invoked via `node:child_process` (builtin, no
 * `package.json` edit needed, which this ticket's write_scope can't make
 * anyway). Argv arrays only, never a shell string: the query/path arguments
 * are caller/user-controlled and must never be interpolated into a shell
 * command. Also doubles as the project file walker (`rg --files` already
 * respects `.gitignore`, so `indexer.ts` doesn't need its own ignore-file
 * parser).
 *
 * `null` return means "ripgrep binary not found" (ENOENT) — distinct from
 * an empty match/file list, same honest-absent convention as
 * `store/embeddings.ts`'s `NoopEmbeddingProvider` and the palette's
 * `queryCodeIndex` (never fabricate a result when the underlying capability
 * is simply unavailable).
 */
import { execFile } from 'node:child_process';

export interface ExecFileResult {
  readonly stdout: string;
  readonly stderr: string;
}

export interface ExecFileError extends Error {
  readonly code?: string | number;
}

/** Injectable so tests can simulate "rg missing" / "rg errored" without depending on the host's PATH. */
export type ExecFileFn = (
  command: string,
  args: readonly string[],
  cwd: string,
) => Promise<ExecFileResult>;

const MAX_BUFFER = 16 * 1024 * 1024;
/** Belt-and-suspenders against a hung subprocess (e.g. a future call site forgetting a path arg, which makes rg block on stdin). */
const TIMEOUT_MS = 30_000;

export const defaultExecFile: ExecFileFn = (command, args, cwd) =>
  new Promise((resolve, reject) => {
    execFile(
      command,
      args as string[],
      { cwd, maxBuffer: MAX_BUFFER, timeout: TIMEOUT_MS },
      (error, stdout, stderr) => {
        if (error) {
          reject(error);
          return;
        }
        resolve({ stdout, stderr });
      },
    );
  });

export interface RipgrepOptions {
  readonly execFileImpl?: ExecFileFn;
}

/** rg exit code 2 signals a real error (bad pattern, unreadable path, ...). */
function isRealError(error: ExecFileError): boolean {
  return error.code !== 1;
}

function isMissingBinary(error: ExecFileError): boolean {
  return error.code === 'ENOENT';
}

/** Passing an explicit `.` path (see below) makes rg prefix every result with `./`; strip it for a clean relative path. */
function stripLeadingDotSlash(relativePath: string): string {
  return relativePath.startsWith('./') ? relativePath.slice(2) : relativePath;
}

/** `rg --files`, already `.gitignore`-aware — the project file walker `indexer.ts` uses. */
export async function listProjectFiles(
  rootDir: string,
  options: RipgrepOptions = {},
): Promise<string[] | null> {
  const run = options.execFileImpl ?? defaultExecFile;
  try {
    const { stdout } = await run('rg', ['--files', '.'], rootDir);
    return stdout
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .map(stripLeadingDotSlash);
  } catch (error) {
    const err = error as ExecFileError;
    if (isMissingBinary(err)) {
      return null;
    }
    if (!isRealError(err)) {
      return [];
    }
    throw err;
  }
}

export interface RipgrepMatch {
  readonly path: string;
  readonly line: number;
  readonly text: string;
}

interface RipgrepJsonMatch {
  type: string;
  data: {
    path: { text: string };
    line_number: number;
    lines: { text: string };
  };
}

/** Exact (literal/regex) search via `rg --json`, scoped to `rootDir`. */
export async function ripgrepSearch(
  rootDir: string,
  pattern: string,
  options: RipgrepOptions = {},
): Promise<RipgrepMatch[] | null> {
  const run = options.execFileImpl ?? defaultExecFile;
  try {
    // Explicit '.' path (not just relying on cwd): without a path argument rg
    // treats piped-in stdin (execFile always pipes stdin) as its input source
    // and blocks forever waiting for it to close, instead of searching cwd.
    const { stdout } = await run('rg', ['--json', '--', pattern, '.'], rootDir);
    const matches: RipgrepMatch[] = [];
    for (const line of stdout.split('\n')) {
      if (line.length === 0) continue;
      const parsed = JSON.parse(line) as RipgrepJsonMatch;
      if (parsed.type !== 'match') continue;
      matches.push({
        path: stripLeadingDotSlash(parsed.data.path.text),
        line: parsed.data.line_number,
        text: parsed.data.lines.text.replace(/\n$/, ''),
      });
    }
    return matches;
  } catch (error) {
    const err = error as ExecFileError;
    if (isMissingBinary(err)) {
      return null;
    }
    if (!isRealError(err)) {
      return [];
    }
    throw err;
  }
}
