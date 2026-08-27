import { execa } from 'execa';

export interface GitResult {
  stdout: string;
  stderr: string;
}

export interface GitOptions {
  /**
   * Extra environment for this invocation, merged over the process env.
   *
   * W21-54: added for `commit-tree`, which takes its author and committer
   * dates from the environment and from nowhere else. A composed base ref has
   * to be a pure function of its inputs, and a wall-clock timestamp is the one
   * thing that stops it being one.
   */
  readonly env?: Readonly<Record<string, string>>;
}

export async function git(
  cwd: string,
  args: string[],
  opts: GitOptions = {},
): Promise<GitResult> {
  const result = await execa('git', args, {
    cwd,
    ...(opts.env ? { env: { ...process.env, ...opts.env } } : {}),
  });
  return { stdout: result.stdout, stderr: result.stderr };
}
