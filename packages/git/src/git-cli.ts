import { execa } from 'execa';

export interface GitResult {
  stdout: string;
  stderr: string;
}

export async function git(cwd: string, args: string[]): Promise<GitResult> {
  const result = await execa('git', args, { cwd });
  return { stdout: result.stdout, stderr: result.stderr };
}
