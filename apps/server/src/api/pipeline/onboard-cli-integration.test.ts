/**
 * Covers the `dokima run start --mode onboard` call-site itself (W8-09
 * AC1) — that `cli/run-cmd.ts` really drives `runOnboardAnalysis` end to
 * end via env-resolved gateway config, not just that `runOnboardAnalysis`
 * works when called directly (already covered by `onboard-run.test.ts`).
 * Lives here rather than in `cli/run-cmd.test.ts` because this ticket's
 * `write_scope` only covers `apps/server/src/api/pipeline/**` +
 * `cli/run-cmd.ts` itself, not that file's test — importing `runCli` is
 * read-only, so it stays in scope while still exercising the real CLI path.
 */
import { promises as fs } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { listTickets } from '@dokima/tickets';
import { git } from '@dokima/git';
import { openWritableLog, resolveDbPath } from '../../cli/db.js';
import { runCli } from '../../cli/run.js';
import {
  collectIO,
  createTempProject,
  type TempProject,
} from '../../cli/test-helpers.js';
import { resetLoopModuleCacheForTests } from './onboard-dispatch-port.js';
import { startFakeGatewayServer, type FakeGatewayServer } from './test-fake-gateway.js';

const NOW = () => '2026-07-21T00:00:00.000Z';

describe('dokima run start --mode onboard (W8-09 — real gateway + real runSession, findings become board tickets)', () => {
  let project: TempProject;
  let server: FakeGatewayServer | undefined;
  const envKeysToRestore = [
    'DOKIMA_MODEL_BASE_URL',
    'DOKIMA_MODEL_API_KEY',
    'DOKIMA_MODEL_ID',
  ] as const;
  const savedEnv: Record<string, string | undefined> = {};

  afterEach(async () => {
    await project?.cleanup();
    await server?.close();
    server = undefined;
    resetLoopModuleCacheForTests();
    for (const key of envKeysToRestore) {
      if (savedEnv[key] === undefined) delete process.env[key];
      else process.env[key] = savedEnv[key];
      delete savedEnv[key];
    }
  });

  it('actually runs a real onboard/analysis run — real gateway + real runSession, findings become board tickets', async () => {
    project = await createTempProject();
    const cwd = project.cwd;
    await git(cwd, ['init', '-b', 'main']);
    await git(cwd, ['config', 'user.name', 'Dokima Test']);
    await git(cwd, ['config', 'user.email', 'test@dokima.invalid']);
    await fs.writeFile(`${cwd}/README.md`, '# fixture\n');
    await git(cwd, ['add', '--', 'README.md']);
    await git(cwd, ['commit', '-m', 'chore: initial commit']);

    server = await startFakeGatewayServer([
      JSON.stringify({
        summary: 'Reviewed.',
        findings: [
          {
            title: 'Missing docs',
            severity: 'MEDIUM',
            recommendation: 'Add docs.',
            verify: 'true',
          },
        ],
      }),
    ]);
    savedEnv.DOKIMA_MODEL_BASE_URL = process.env.DOKIMA_MODEL_BASE_URL;
    process.env.DOKIMA_MODEL_BASE_URL = server.url;

    const start = collectIO();
    const startCode = await runCli(
      [
        'run',
        'start',
        '--project',
        'proj-onboard',
        '--mode',
        'onboard',
        '--breakpoint',
        'never',
        '--actor',
        'operator-1',
      ],
      { cwd, now: NOW, ...start.io },
    );

    expect(startCode).toBe(0);
    expect(start.stdout[0]).toMatch(/^run-.* started -> running/);
    expect(start.stdout[1]).toMatch(
      /onboard analysis complete: 16 steps, 16 findings proposed, 16 accepted onto the board/,
    );
    expect(server.requests).toHaveLength(16);

    const log = openWritableLog(resolveDbPath(cwd));
    try {
      expect(listTickets(log)).toHaveLength(16);
    } finally {
      log.close();
    }
  });
});
