import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export interface TempProject {
  cwd: string;
  cleanup: () => Promise<void>;
}

/** A throwaway project directory (no `.dokima/` yet) for CLI integration tests. */
export async function createTempProject(): Promise<TempProject> {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'dokima-cli-test-'));
  return {
    cwd,
    cleanup: () => fs.rm(cwd, { recursive: true, force: true }),
  };
}

export function collectIO(): {
  stdout: string[];
  stderr: string[];
  io: {
    stdout: (line: string) => void;
    stderr: (line: string) => void;
    sleep: (ms: number) => Promise<void>;
  };
} {
  const stdout: string[] = [];
  const stderr: string[] = [];
  return {
    stdout,
    stderr,
    io: {
      stdout: (line: string) => stdout.push(line),
      stderr: (line: string) => stderr.push(line),
      // W23-50: a free infra retry backs off for seconds; fixtures do not wait.
      sleep: async () => {},
    },
  };
}
