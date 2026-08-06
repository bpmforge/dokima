import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  assertRealWithinWorktree,
  editTool,
  isUnsafeSearchPattern,
  listTool,
  normalizeRelPath,
  readTool,
  resolveWithinWorktree,
  searchTool,
  writeTool,
  ToolPathEscapeError,
} from './fs-tools.js';

describe('agent-session fs-tools', () => {
  let cwd: string | undefined;
  let extraTempDirs: string[] = [];

  afterEach(async () => {
    if (cwd) await fs.rm(cwd, { recursive: true, force: true });
    cwd = undefined;
    await Promise.all(
      extraTempDirs.map((dir) => fs.rm(dir, { recursive: true, force: true })),
    );
    extraTempDirs = [];
  });

  async function tmpWorktree(): Promise<string> {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'dokima-agent-fs-'));
    cwd = dir;
    return dir;
  }

  it('resolveWithinWorktree accepts a nested relative path and refuses a `..` escape', () => {
    expect(resolveWithinWorktree('/tmp/worktree', 'src/a.ts')).toBe(
      '/tmp/worktree/src/a.ts',
    );
    expect(() => resolveWithinWorktree('/tmp/worktree', '../outside.ts')).toThrow(
      ToolPathEscapeError,
    );
  });

  it('write then read round-trips file content', async () => {
    const dir = await tmpWorktree();
    const written = (await writeTool(dir, ['**'], {
      path: 'src/a.ts',
      content: 'export const x = 1;\n',
    })) as { ok: boolean };
    expect(written.ok).toBe(true);

    const read = (await readTool(dir, { path: 'src/a.ts' })) as {
      ok: boolean;
      content: string;
    };
    expect(read.ok).toBe(true);
    expect(read.content).toBe('export const x = 1;\n');
  });

  it('read reports a missing file without throwing', async () => {
    const dir = await tmpWorktree();
    const result = (await readTool(dir, { path: 'nope.ts' })) as {
      ok: boolean;
      status: string;
    };
    expect(result).toEqual({ ok: false, status: 'missing', path: 'nope.ts' });
  });

  it('normalizeRelPath strips a leading ./ and normalizes backslash separators', () => {
    expect(normalizeRelPath('./packages/example/file.ts')).toBe(
      'packages/example/file.ts',
    );
    expect(normalizeRelPath('packages/example/file.ts')).toBe('packages/example/file.ts');
  });

  it('write refuses through a symlinked ancestor that escapes the worktree (SC-01 symlink-escape, the fourth Verify case)', async () => {
    const dir = await tmpWorktree();
    const outsideDir = await fs.mkdtemp(
      path.join(os.tmpdir(), 'dokima-agent-fs-outside-'),
    );
    extraTempDirs.push(outsideDir);
    await fs.symlink(outsideDir, path.join(dir, 'evil'));

    const result = (await writeTool(dir, ['**'], {
      path: 'evil/leak.ts',
      content: 'exfiltrated',
    })) as { ok: boolean };

    expect(result.ok).toBe(false);
    await expect(fs.stat(path.join(outsideDir, 'leak.ts'))).rejects.toThrow();
  });

  it('edit refuses through a symlinked ancestor that escapes the worktree (SC-01 symlink-escape)', async () => {
    const dir = await tmpWorktree();
    const outsideDir = await fs.mkdtemp(
      path.join(os.tmpdir(), 'dokima-agent-fs-outside-'),
    );
    extraTempDirs.push(outsideDir);
    await fs.writeFile(path.join(outsideDir, 'leak.ts'), 'original\n');
    await fs.symlink(outsideDir, path.join(dir, 'evil'));

    const result = (await editTool(dir, ['**'], {
      path: 'evil/leak.ts',
      oldString: 'original',
      newString: 'tampered',
    })) as { ok: boolean };

    expect(result.ok).toBe(false);
    await expect(fs.readFile(path.join(outsideDir, 'leak.ts'), 'utf8')).resolves.toBe(
      'original\n',
    );
  });

  it(
    '(W11-02 acceptance 2, SC-18) assertRealWithinWorktree refuses a pre-existing LEAF ' +
      'symlink pointing outside the worktree — the leaf itself, not a symlinked ' +
      'ancestor directory (the case attempt 1 already covered); realpathOfNearestAncestor ' +
      'only ever resolved the nearest ANCESTOR, never the leaf, so this was ALLOWED before ' +
      'this fix',
    async () => {
      const dir = await tmpWorktree();
      const outsideDir = await fs.mkdtemp(
        path.join(os.tmpdir(), 'dokima-agent-fs-outside-'),
      );
      extraTempDirs.push(outsideDir);
      await fs.writeFile(path.join(outsideDir, 'leak.txt'), 'secret\n');
      await fs.symlink(path.join(outsideDir, 'leak.txt'), path.join(dir, 'evil.txt'));

      await expect(assertRealWithinWorktree(dir, 'evil.txt')).rejects.toThrow(
        ToolPathEscapeError,
      );
    },
  );

  it(
    '(W11-02 acceptance 2) write refuses through a pre-existing leaf symlink pointing ' +
      "outside the worktree, and never touches the symlink's target",
    async () => {
      const dir = await tmpWorktree();
      const outsideDir = await fs.mkdtemp(
        path.join(os.tmpdir(), 'dokima-agent-fs-outside-'),
      );
      extraTempDirs.push(outsideDir);
      await fs.writeFile(path.join(outsideDir, 'leak.txt'), 'secret\n');
      await fs.symlink(path.join(outsideDir, 'leak.txt'), path.join(dir, 'evil.txt'));

      const result = (await writeTool(dir, ['**'], {
        path: 'evil.txt',
        content: 'exfiltrated',
      })) as { ok: boolean };

      expect(result.ok).toBe(false);
      await expect(fs.readFile(path.join(outsideDir, 'leak.txt'), 'utf8')).resolves.toBe(
        'secret\n',
      );
    },
  );

  it(
    '(W11-02 acceptance 2) edit refuses through a pre-existing leaf symlink pointing ' +
      "outside the worktree, and never touches the symlink's target",
    async () => {
      const dir = await tmpWorktree();
      const outsideDir = await fs.mkdtemp(
        path.join(os.tmpdir(), 'dokima-agent-fs-outside-'),
      );
      extraTempDirs.push(outsideDir);
      await fs.writeFile(path.join(outsideDir, 'leak.txt'), 'original\n');
      await fs.symlink(path.join(outsideDir, 'leak.txt'), path.join(dir, 'evil.txt'));

      const result = (await editTool(dir, ['**'], {
        path: 'evil.txt',
        oldString: 'original',
        newString: 'tampered',
      })) as { ok: boolean };

      expect(result.ok).toBe(false);
      await expect(fs.readFile(path.join(outsideDir, 'leak.txt'), 'utf8')).resolves.toBe(
        'original\n',
      );
    },
  );

  it(
    '(W11-02 acceptance 2) write refuses through a DANGLING leaf symlink (target does ' +
      'not exist) pointing outside the worktree — falling back to ancestor-only ' +
      'resolution here would silently ignore the symlink, since the ancestor walk ' +
      "never follows it, and `fs.writeFile` still creates a new file at the symlink's " +
      'target through its default (non-O_NOFOLLOW) open()',
    async () => {
      const dir = await tmpWorktree();
      const outsideDir = await fs.mkdtemp(
        path.join(os.tmpdir(), 'dokima-agent-fs-outside-'),
      );
      extraTempDirs.push(outsideDir);
      const outsideTarget = path.join(outsideDir, 'leak.txt');
      await fs.symlink(outsideTarget, path.join(dir, 'evil.txt'));

      const result = (await writeTool(dir, ['**'], {
        path: 'evil.txt',
        content: 'exfiltrated',
      })) as { ok: boolean };

      expect(result.ok).toBe(false);
      await expect(fs.stat(outsideTarget)).rejects.toThrow();
    },
  );

  it(
    '(W11-02 acceptance 2) list refuses a symlinked directory escaping the worktree ' +
      '(the same containment gap, applied to a read-side tool in the same file)',
    async () => {
      const dir = await tmpWorktree();
      const outsideDir = await fs.mkdtemp(
        path.join(os.tmpdir(), 'dokima-agent-fs-outside-'),
      );
      extraTempDirs.push(outsideDir);
      await fs.writeFile(path.join(outsideDir, 'secret.txt'), 'top secret\n');
      await fs.symlink(outsideDir, path.join(dir, 'evil'));

      const result = (await listTool(dir, { path: 'evil' })) as {
        ok: boolean;
        reason?: string;
      };
      expect(result.ok).toBe(false);
    },
  );

  it(
    '(W11-02 acceptance 2) search refuses a symlinked directory escaping the worktree ' +
      '(same containment gap, read-side)',
    async () => {
      const dir = await tmpWorktree();
      const outsideDir = await fs.mkdtemp(
        path.join(os.tmpdir(), 'dokima-agent-fs-outside-'),
      );
      extraTempDirs.push(outsideDir);
      await fs.writeFile(path.join(outsideDir, 'secret.txt'), 'NEEDLE\n');
      await fs.symlink(outsideDir, path.join(dir, 'evil'));

      const result = (await searchTool(dir, { pattern: 'NEEDLE', path: 'evil' })) as {
        ok: boolean;
      };
      expect(result.ok).toBe(false);
    },
  );

  it('write refuses a direct `.git` write (hard-excluded, SC-01)', async () => {
    const dir = await tmpWorktree();
    const result = (await writeTool(dir, ['**'], {
      path: '.git/config',
      content: 'evil',
    })) as { ok: boolean; refused?: boolean };
    expect(result.ok).toBe(false);
    await expect(fs.stat(path.join(dir, '.git', 'config'))).rejects.toThrow();
  });

  describe('(W11-03, FR-H6/SC-17) write_scope is matched at the tool boundary, before the tool executes', () => {
    const AGENT_SESSION_SCOPE = ['packages/harbormaster/src/agent-session/**'];

    it('write refuses an ordinary in-worktree path that simply falls outside write_scope (the new check — not hard-excluded, not a symlink, not a `..` escape)', async () => {
      const dir = await tmpWorktree();
      const result = (await writeTool(dir, AGENT_SESSION_SCOPE, {
        path: 'packages/other-package/file.ts',
        content: 'sneaky',
      })) as { ok: boolean; reason?: string };
      expect(result.ok).toBe(false);
      expect(result.reason).toContain('write_scope');
      await expect(
        fs.stat(path.join(dir, 'packages/other-package/file.ts')),
      ).rejects.toThrow();
    });

    it('edit refuses an existing file outside write_scope, and never touches its content', async () => {
      const dir = await tmpWorktree();
      await writeTool(dir, ['**'], {
        path: 'packages/other-package/config.ts',
        content: 'original\n',
      });
      const result = (await editTool(dir, AGENT_SESSION_SCOPE, {
        path: 'packages/other-package/config.ts',
        oldString: 'original',
        newString: 'tampered',
      })) as { ok: boolean; reason?: string };
      expect(result.ok).toBe(false);
      expect(result.reason).toContain('write_scope');
      await expect(
        fs.readFile(path.join(dir, 'packages/other-package/config.ts'), 'utf8'),
      ).resolves.toBe('original\n');
    });

    it('(escape shape) write refuses `../outside`, before it executes', async () => {
      const dir = await tmpWorktree();
      const result = (await writeTool(dir, AGENT_SESSION_SCOPE, {
        path: '../outside.ts',
        content: 'exfiltrated',
      })) as { ok: boolean };
      expect(result.ok).toBe(false);
      await expect(fs.stat(path.join(path.dirname(dir), 'outside.ts'))).rejects.toThrow();
    });

    it('(escape shape) write refuses `.github/workflows/ci.yml` (hard-excluded, SC-01)', async () => {
      const dir = await tmpWorktree();
      const result = (await writeTool(dir, AGENT_SESSION_SCOPE, {
        path: '.github/workflows/ci.yml',
        content: 'evil: true',
      })) as { ok: boolean };
      expect(result.ok).toBe(false);
      await expect(
        fs.stat(path.join(dir, '.github', 'workflows', 'ci.yml')),
      ).rejects.toThrow();
    });

    it('(escape shape) write refuses `.dokima/state.db` (hard-excluded, SC-01)', async () => {
      const dir = await tmpWorktree();
      const result = (await writeTool(dir, AGENT_SESSION_SCOPE, {
        path: '.dokima/state.db',
        content: 'tampered',
      })) as { ok: boolean };
      expect(result.ok).toBe(false);
      await expect(fs.stat(path.join(dir, '.dokima', 'state.db'))).rejects.toThrow();
    });

    it(
      '(escape shape) write refuses a symlink pointing out of the worktree even when the ' +
        'literal path DOES match write_scope — containment is checked independently of ' +
        'the glob match, so a grant can never launder an escape',
      async () => {
        const dir = await tmpWorktree();
        const outsideDir = await fs.mkdtemp(
          path.join(os.tmpdir(), 'dokima-agent-fs-outside-'),
        );
        extraTempDirs.push(outsideDir);
        await fs.symlink(outsideDir, path.join(dir, 'evil'));

        const result = (await writeTool(dir, ['evil/**'], {
          path: 'evil/leak.ts',
          content: 'exfiltrated',
        })) as { ok: boolean };

        expect(result.ok).toBe(false);
        await expect(fs.stat(path.join(outsideDir, 'leak.ts'))).rejects.toThrow();
      },
    );
  });

  it('edit refuses when oldString is not found', async () => {
    const dir = await tmpWorktree();
    await writeTool(dir, ['**'], { path: 'a.ts', content: 'const x = 1;\n' });
    const result = (await editTool(dir, ['**'], {
      path: 'a.ts',
      oldString: 'const y',
      newString: 'const z',
    })) as { ok: boolean; reason: string };
    expect(result).toEqual({
      ok: false,
      reason: 'oldString not found',
      occurrences: 0,
      path: 'a.ts',
    });
  });

  it('edit refuses an ambiguous (non-unique) oldString', async () => {
    const dir = await tmpWorktree();
    await writeTool(dir, ['**'], { path: 'a.ts', content: 'x\nx\n' });
    const result = (await editTool(dir, ['**'], {
      path: 'a.ts',
      oldString: 'x',
      newString: 'y',
    })) as { ok: boolean; reason: string; occurrences: number };
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('oldString is not unique');
    expect(result.occurrences).toBe(2);
  });

  it('edit replaces a unique occurrence', async () => {
    const dir = await tmpWorktree();
    await writeTool(dir, ['**'], { path: 'a.ts', content: 'const x = 1;\n' });
    const result = (await editTool(dir, ['**'], {
      path: 'a.ts',
      oldString: 'const x = 1;',
      newString: 'const x = 2;',
    })) as { ok: boolean };
    expect(result.ok).toBe(true);
    const content = await fs.readFile(path.join(dir, 'a.ts'), 'utf8');
    expect(content).toBe('const x = 2;\n');
  });

  it('list returns immediate directory entries', async () => {
    const dir = await tmpWorktree();
    await writeTool(dir, ['**'], { path: 'src/a.ts', content: '' });
    await writeTool(dir, ['**'], { path: 'b.ts', content: '' });
    const result = (await listTool(dir, {})) as {
      ok: boolean;
      entries: { name: string; type: string }[];
    };
    expect(result.ok).toBe(true);
    const names = result.entries.map((e) => e.name).sort();
    expect(names).toEqual(['b.ts', 'src']);
  });

  it('search finds a literal substring across files', async () => {
    const dir = await tmpWorktree();
    await writeTool(dir, ['**'], {
      path: 'src/a.ts',
      content: 'export const NEEDLE = 1;\n',
    });
    await writeTool(dir, ['**'], {
      path: 'src/b.ts',
      content: 'export const other = 2;\n',
    });
    const result = (await searchTool(dir, { pattern: 'NEEDLE' })) as {
      ok: boolean;
      matches: { file: string; line: number }[];
    };
    expect(result.ok).toBe(true);
    expect(result.matches).toHaveLength(1);
    expect(result.matches[0]!.file).toBe('src/a.ts');
    expect(result.matches[0]!.line).toBe(1);
  });

  it('search excludes .git from its walk', async () => {
    const dir = await tmpWorktree();
    await fs.mkdir(path.join(dir, '.git'), { recursive: true });
    await fs.writeFile(path.join(dir, '.git', 'HEAD'), 'NEEDLE\n');
    const result = (await searchTool(dir, { pattern: 'NEEDLE' })) as {
      matches: unknown[];
    };
    expect(result.matches).toHaveLength(0);
  });

  it(
    "search reports matchMode so a refused pattern's empty result isn't " +
      'indistinguishable from a genuine no-match (honest-degrade, never ' +
      'silent) — a real regex reports "regex", a refused/invalid pattern ' +
      'falling back to literal-substring reports "literal"',
    async () => {
      const dir = await tmpWorktree();
      await writeTool(dir, ['**'], { path: 'src/a.ts', content: 'foo123bar\n' });

      const real = (await searchTool(dir, { pattern: '\\d+' })) as { matchMode: string };
      expect(real.matchMode).toBe('regex');

      const refused = (await searchTool(dir, { pattern: '(a+)+$' })) as {
        matchMode: string;
      };
      expect(refused.matchMode).toBe('literal');
    },
  );

  it(
    'search reports skippedLongLines rather than silently omitting lines ' +
      'past the regex-only length cap',
    async () => {
      const dir = await tmpWorktree();
      const longLine = `${'x'.repeat(4000)}NEEDLE${'x'.repeat(100)}`;
      await writeTool(dir, ['**'], { path: 'src/a.ts', content: `${longLine}\n` });

      const result = (await searchTool(dir, { pattern: '\\d+' })) as {
        matches: unknown[];
        skippedLongLines: number;
      };
      expect(result.matches).toHaveLength(0);
      expect(result.skippedLongLines).toBe(1);
    },
  );

  describe('isUnsafeSearchPattern (ReDoS static heuristic)', () => {
    it('flags a nested-quantifier group as unsafe', () => {
      expect(isUnsafeSearchPattern('(a+)+$')).toBe(true);
      expect(isUnsafeSearchPattern('(a*)*')).toBe(true);
      expect(isUnsafeSearchPattern('(a{2,}){2,}')).toBe(true);
    });

    it('flags an overlapping-alternation group as unsafe', () => {
      expect(isUnsafeSearchPattern('(a|a)+$')).toBe(true);
    });

    it('flags an oversized pattern as unsafe', () => {
      expect(isUnsafeSearchPattern('a'.repeat(500))).toBe(true);
    });

    it(
      'flags adjacent, ungrouped unbounded quantifiers as unsafe — a ' +
        'polynomial-backtracking shape a purely group-nested check misses ' +
        'entirely (measured: /.*.*.*.*.*=/ has no groups at all, yet is ' +
        'multi-second against inputs well under a few hundred characters)',
      () => {
        expect(isUnsafeSearchPattern('.*.*.*.*.*=')).toBe(true);
        expect(isUnsafeSearchPattern('.*.*.*=')).toBe(true);
      },
    );

    it('does not flag ordinary search patterns', () => {
      expect(isUnsafeSearchPattern('NEEDLE')).toBe(false);
      expect(isUnsafeSearchPattern('TODO:.*')).toBe(false);
      expect(isUnsafeSearchPattern('export (const|function)')).toBe(false);
      expect(isUnsafeSearchPattern('\\(a\\+\\)\\+')).toBe(false);
      expect(isUnsafeSearchPattern('[a-z]+\\d+')).toBe(false);
    });
  });

  it(
    'search stays fast against a classic catastrophic-backtracking pattern ' +
      '(ReDoS: a hung regex would block the whole harbormaster event loop, ' +
      'not just this call)',
    async () => {
      const dir = await tmpWorktree();
      const adversarialLine = `${'a'.repeat(40)}!`;
      await writeTool(dir, ['**'], { path: 'src/a.ts', content: `${adversarialLine}\n` });

      const start = Date.now();
      const result = (await searchTool(dir, { pattern: '(a+)+$' })) as {
        ok: boolean;
        matches: unknown[];
      };
      const elapsedMs = Date.now() - start;

      expect(elapsedMs).toBeLessThan(1000);
      expect(result.ok).toBe(true);
      expect(result.matches).toHaveLength(0);
    },
  );

  it('search falls back to literal-substring matching for an unsafe pattern', async () => {
    const dir = await tmpWorktree();
    await writeTool(dir, ['**'], {
      path: 'src/a.ts',
      content: 'the literal text (a+)+$ appears here\n',
    });
    const result = (await searchTool(dir, { pattern: '(a+)+$' })) as {
      matches: { file: string; line: number }[];
    };
    expect(result.matches).toHaveLength(1);
    expect(result.matches[0]!.file).toBe('src/a.ts');
  });

  it(
    'search stays fast against a long line for a polynomial-backtracking ' +
      'pattern that has no groups at all (adjacent unbounded quantifiers): ' +
      'measured at ~11s against a single 4000-char line before the ' +
      'regex-only line-length cap existed',
    async () => {
      const dir = await tmpWorktree();
      const adversarialLine = `${'a'.repeat(4000)}!`;
      await writeTool(dir, ['**'], { path: 'src/a.ts', content: `${adversarialLine}\n` });

      const start = Date.now();
      const result = (await searchTool(dir, { pattern: '.*.*=' })) as {
        ok: boolean;
        matches: unknown[];
      };
      const elapsedMs = Date.now() - start;

      expect(elapsedMs).toBeLessThan(1000);
      expect(result.ok).toBe(true);
    },
  );

  it(
    'search still runs a real (allowed) regex against lines within the ' + 'length cap',
    async () => {
      const dir = await tmpWorktree();
      await writeTool(dir, ['**'], { path: 'src/a.ts', content: 'foo123bar\n' });
      const result = (await searchTool(dir, { pattern: '\\d+' })) as {
        matches: { file: string; line: number; text: string }[];
      };
      expect(result.matches).toHaveLength(1);
      expect(result.matches[0]!.text).toBe('foo123bar');
    },
  );

  it(
    "search's line-length cap only applies to a real regex — the literal-" +
      'substring fallback for a refused pattern still finds a match past ' +
      'MAX_MATCH_LINE_LENGTH (literal .includes() is always linear, so ' +
      'capping it costs precision for no safety benefit)',
    async () => {
      const dir = await tmpWorktree();
      const longLine = `${'x'.repeat(4000)}(a+)+$${'x'.repeat(100)}`;
      await writeTool(dir, ['**'], { path: 'src/a.ts', content: `${longLine}\n` });
      const result = (await searchTool(dir, { pattern: '(a+)+$' })) as {
        matches: { file: string; line: number }[];
      };
      expect(result.matches).toHaveLength(1);
    },
  );
});
