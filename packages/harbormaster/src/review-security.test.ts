/**
 * W23-51 — what the reviewer is told about checks that did not run.
 *
 * RED fixture from the 2026-09-23 live review: tool-sast errored (the scanner
 * could not run), the prompt said only that "a tool that could not run is NOT
 * a clean result", and the reviewer answered CONTRADICTED 4/10 for a ticket
 * whose independent re-run passed. A scanner that did not run is missing
 * coverage — never a pass, and never evidence against the diff either.
 */

import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';
import {
  collectTicketSecurityChecks,
  securityChecksPayload,
  securityChecksSection,
} from './review-security.js';
import {
  checksPermitAutomaticCompletion,
  type CheckEvidence,
} from './security-checks.js';

const execFileAsync = promisify(execFile);

const row = (over: Partial<CheckEvidence>): CheckEvidence => ({
  checkId: 'tool-x',
  sourceDigest: 'sha256:head',
  inputDigest: 'sha256:in',
  toolVersion: null,
  ruleDigest: null,
  status: 'passed',
  exitCode: 0,
  artifactDigest: null,
  durationMs: 1,
  reason: null,
  findingCount: 0,
  ...over,
});

const LIVE_EVIDENCE: CheckEvidence[] = [
  row({
    checkId: 'tool-sast',
    status: 'error',
    exitCode: 2,
    reason:
      'semgrep exited 2 before scanning: Cannot create auto config when metrics are off',
  }),
  row({ checkId: 'tool-secrets' }),
  row({
    checkId: 'tool-deps',
    status: 'passed',
    exitCode: 1,
    reason:
      '14 finding(s) already present at base 0ac6e267f6d1; none introduced by this change',
    preexistingCount: 14,
    baselineRef: '0ac6e267f6d1e22674b14dbc1090dbc3f6895cdb',
  }),
];

describe('W23-51: a check that did not run is reported as NOT RUN', () => {
  const text = securityChecksSection({
    evidence: LIVE_EVIDENCE,
    eligible: false,
    blockedBy: ['tool-sast: error'],
  });

  it('RED: labels an errored or unavailable scanner NOT RUN, not ERROR', () => {
    expect(text).toMatch(/- tool-sast: NOT RUN \(exit 2\)/);
    expect(text).not.toMatch(/tool-sast: ERROR/);
  });

  it('RED: tells the reviewer it is neither a pass nor evidence against the change', () => {
    expect(text).toMatch(/do not treat it as a clean result/);
    expect(text).toMatch(/do not count it against this change/);
  });

  it('a pass that rests on pre-existing findings says so', () => {
    expect(text).toContain('- tool-deps: ' + 'PASSED (exit 1)');
    expect(text).toMatch(/14 finding\(s\) already present at base/);
  });

  it('introduced findings are named as the change’s own', () => {
    const findings = securityChecksSection({
      evidence: [
        row({ checkId: 'tool-sast', status: 'findings', exitCode: 1, findingCount: 2 }),
      ],
      eligible: false,
      blockedBy: ['tool-sast: findings'],
    });
    expect(findings).toMatch(/2 finding\(s\) introduced by this change/);
    expect(findings).toMatch(/weigh it as evidence about the diff/);
    expect(findings).not.toMatch(/NOT RUN/);
  });

  it('the event payload keeps the baseline facts and the rule digest', () => {
    const payload = securityChecksPayload({
      evidence: [
        ...LIVE_EVIDENCE.slice(1),
        row({ checkId: 'tool-sast', ruleDigest: 'sha256:rules' }),
      ],
      eligible: true,
      blockedBy: [],
    });
    expect(payload[1]).toMatchObject({
      preexistingCount: 14,
      baselineRef: expect.any(String),
    });
    expect(payload[2]).toMatchObject({ ruleDigest: 'sha256:rules' });
    expect(payload[0]).not.toHaveProperty('preexistingCount');
  });
});

/**
 * W23-56 — a local-only project and the dependency audit.
 *
 * `npm audit` needs an advisory database, a local-only project may not reach
 * one, and NOT RUN blocks machine acceptance — so before this no ticket in a
 * local-only project could ever be accepted without a person, including the
 * great majority that never touch a dependency. Two answers, both measured:
 * a change that leaves every manifest and lockfile identical to its fork point
 * cannot have introduced an advisory (W23-51 counts only introduced ones); a
 * change that did touch them is still NOT RUN, and the PROJECT's policy says
 * whether that blocks — default block, matching SAST.
 */
describe('W23-56: tool-deps under local-only', () => {
  const dirs: string[] = [];
  afterEach(async () => {
    await Promise.all(
      dirs.splice(0).map((d) => fs.rm(d, { recursive: true, force: true })),
    );
  });

  async function repo(
    change: Record<string, string>,
  ): Promise<{ dir: string; base: string }> {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'dokima-deps-offline-'));
    dirs.push(dir);
    const git = (...args: string[]) =>
      execFileAsync('git', [
        '-C',
        dir,
        '-c',
        'user.name=t',
        '-c',
        'user.email=t@t',
        ...args,
      ]);
    await git('init', '-q');
    await fs.writeFile(
      path.join(dir, 'package.json'),
      '{"name":"p","dependencies":{"a":"1.0.0"}}\n',
    );
    await fs.writeFile(path.join(dir, 'package-lock.json'), '{"lockfileVersion":3}\n');
    await fs.writeFile(path.join(dir, 'index.js'), 'export {};\n');
    await git('add', '.');
    await git('commit', '-qm', 'base');
    const base = (await git('rev-parse', 'HEAD')).stdout.trim();
    for (const [name, body] of Object.entries(change)) {
      await fs.writeFile(path.join(dir, name), body);
    }
    await git('add', '.');
    await git('commit', '-qm', 'ticket');
    return { dir, base };
  }

  const collect = (
    dir: string,
    base: string | null,
    over: Partial<Parameters<typeof collectTicketSecurityChecks>[0]> = {},
  ) =>
    collectTicketSecurityChecks({
      worktreePath: dir,
      sourceDigest: 'sha256:head',
      networkPolicy: 'local-only',
      baseCommit: base,
      ...over,
    });
  const deps = (c: { evidence: readonly CheckEvidence[] }) =>
    c.evidence.find((e) => e.checkId === 'tool-deps')!;

  it('RED: a ticket that changed no manifest or lockfile is NOT_APPLICABLE, with the measured reason', async () => {
    const { dir, base } = await repo({ 'index.js': 'export const x = 1;\n' });
    const d = deps(await collect(dir, base));
    expect(d.status).toBe('not_applicable');
    expect(d.reason).toMatch(/identical to the ticket.s base/);
  });

  it('NEGATIVE: a ticket that changed the lockfile is still NOT RUN, and blocks by default', async () => {
    const { dir, base } = await repo({
      'package-lock.json': '{"lockfileVersion":3,"x":1}\n',
    });
    const checks = await collect(dir, base);
    expect(deps(checks).status).toBe('unavailable');
    expect(deps(checks).waived).toBeUndefined();
    expect(checks.blockedBy.join(' ')).toMatch(/tool-deps/);
  });

  it('NEGATIVE: an unknown fork point never reads as unchanged', async () => {
    const { dir } = await repo({ 'index.js': 'export const x = 1;\n' });
    expect(deps(await collect(dir, null)).status).toBe('unavailable');
    expect(deps(await collect(dir, 'deadbeef'.repeat(5))).status).toBe('unavailable');
  });

  it('RED: with the project policy "allow", a changed-dependency NOT RUN is waived — recorded, and no longer blocking', async () => {
    const { dir, base } = await repo({
      'package.json': '{"name":"p","dependencies":{"b":"2.0.0"}}\n',
    });
    const checks = await collect(dir, base, { unauditedDependencies: 'allow' });
    const d = deps(checks);
    expect(d.status).toBe('unavailable');
    expect(d.waived).toMatch(/security\.unauditedDependencies/);
    expect(checks.blockedBy.join(' ')).not.toMatch(/tool-deps/);
    expect(
      securityChecksPayload(checks).find((p) => p.checkId === 'tool-deps'),
    ).toMatchObject({
      waived: expect.stringMatching(/unauditedDependencies/),
    });
  });

  it('"allow" waives nothing else: dependency FINDINGS on a networked project still block', async () => {
    const evidence = [row({ checkId: 'tool-deps', status: 'findings', findingCount: 2 })];
    expect(checksPermitAutomaticCompletion(evidence).eligible).toBe(false);
    expect(
      checksPermitAutomaticCompletion([
        row({ checkId: 'tool-sast', status: 'unavailable', waived: 'forged' }),
      ]).eligible,
    ).toBe(false);
  });
});
