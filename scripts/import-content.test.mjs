// import-content.test.mjs — W10-50. The importer writes the signed content
// library the product executes, so its failure modes matter more than its
// happy path: a wrong source root must be a named refusal, and a local patch
// must never be clobbered silently.
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  LOCAL_OVERRIDES,
  UPSTREAM_REPO_ALIAS,
  UPSTREAM_REPO_NAME,
  readUpstreamVersion,
  resolveSourceRoot,
  rewriteHostPaths,
} from './import-content.mjs';

const scratch = [];
afterEach(async () => {
  for (const dir of scratch.splice(0)) await fs.rm(dir, { recursive: true, force: true });
});

async function fakeUpstream({ withAgents = true, version = '9.9.9' } = {}) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'dokima-upstream-'));
  scratch.push(dir);
  if (withAgents) await fs.mkdir(path.join(dir, 'agents'), { recursive: true });
  await fs.writeFile(path.join(dir, 'package.json'), JSON.stringify({ version }));
  return dir;
}

describe('resolveSourceRoot (W10-50)', () => {
  it('RED FIXTURE: a missing source root is a NAMED refusal, not an ENOENT stack', () => {
    // The real defect: sourceRoot was hardcoded to .../bpm-opencode-experts,
    // which stopped existing when upstream renamed. readdirSync threw a raw
    // ENOENT naming a repo nobody would recognise, with no hint of the rename.
    expect(() => resolveSourceRoot(['--source=/nope/definitely/not/here'], {})).toThrow(
      /upstream checkout not found/,
    );
    try {
      resolveSourceRoot(['--source=/nope/definitely/not/here'], {});
    } catch (err) {
      // The message has to carry the fix, not just the failure.
      expect(err.message).toContain('/nope/definitely/not/here');
      expect(err.message).toContain(UPSTREAM_REPO_ALIAS);
      expect(err.message).toContain(UPSTREAM_REPO_NAME);
      expect(err.message).toContain('--source=');
    }
  });

  it('a directory that exists but is not an upstream checkout is refused too', async () => {
    const notUpstream = await fakeUpstream({ withAgents: false });
    expect(() => resolveSourceRoot([`--source=${notUpstream}`], {})).toThrow(/no agents\/ directory/);
  });

  it('accepts a real checkout, and prefers the flag over the env var', async () => {
    const viaFlag = await fakeUpstream();
    const viaEnv = await fakeUpstream();
    expect(resolveSourceRoot([`--source=${viaFlag}`], { DOKIMA_CONTENT_SOURCE: viaEnv })).toBe(viaFlag);
    expect(resolveSourceRoot([], { DOKIMA_CONTENT_SOURCE: viaEnv })).toBe(viaEnv);
  });

  it('records the upstream version actually imported', async () => {
    expect(readUpstreamVersion(await fakeUpstream({ version: '3.1.24' }))).toBe('3.1.24');
    // A checkout with no readable package.json must not crash the import.
    expect(readUpstreamVersion('/nope')).toBe('unknown');
  });
});

describe('rewriteHostPaths (W10-50)', () => {
  it('rewrites every host-install shape to a content-relative one', () => {
    expect(rewriteHostPaths('see ~/.config/opencode/agents/shared/MICRO_LOOP.md')).toBe(
      'see content/protocols/MICRO_LOOP.md',
    );
    expect(rewriteHostPaths('bash ~/.config/opencode/scripts/validators/validate-scope.sh')).toBe(
      'bash content/validators/validate-scope.sh',
    );
    expect(rewriteHostPaths('~/.config/opencode/agents/code-reviewer.md')).toBe(
      'content/experts/code-reviewer.md',
    );
    // The catch-all must not swallow the more specific cases above it.
    expect(rewriteHostPaths('~/.config/opencode/other/thing')).toBe('content/other/thing');
  });

  it('leaves unrelated tildes and paths alone', () => {
    const untouched = 'cd ~/Code/attest && cat ~/.ssh/config # ~/.config/other/x';
    expect(rewriteHostPaths(untouched)).toBe(untouched);
  });

  it('is idempotent — re-importing already-rewritten content changes nothing', () => {
    const once = rewriteHostPaths('~/.config/opencode/agents/shared/X.md');
    expect(rewriteHostPaths(once)).toBe(once);
  });
});

describe('local-override registry (W10-50)', () => {
  it('registers the one file Dokima has actually patched, with the reason', () => {
    // Silent clobber is the failure mode: validators are shell scripts the
    // product executes and the pack is signed, so an unnoticed overwrite is a
    // supply-chain event rather than a merge conflict.
    expect(Object.keys(LOCAL_OVERRIDES)).toContain('validators/validate-mermaid.sh');
    for (const [rel, why] of Object.entries(LOCAL_OVERRIDES)) {
      expect(rel, 'override keys are content-relative paths').not.toMatch(/^\/|^content\//);
      expect(why.length, `${rel} must say WHY it is overridden`).toBeGreaterThan(30);
    }
  });
});
