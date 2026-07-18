import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';
import { createIdentity, mintReceipt, openEventLog } from '@shipwright/events';
import { registerProject } from '../projects.js';
import { buildApiServer, type ApiServer } from '../server.js';

const execFileAsync = promisify(execFile);
const TOKEN = 'test-token-0123456789abcdef';
const SIGNING_KEY = 'test-minting-secret';

async function tmpDir(prefix: string): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix));
}

async function git(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync('git', args, { cwd });
  return stdout.trim();
}

async function initGitProject(dir: string): Promise<void> {
  await git(dir, ['init', '-q']);
  await git(dir, ['config', 'user.email', 'test@example.com']);
  await git(dir, ['config', 'user.name', 'Test']);
  await git(dir, ['checkout', '-q', '-b', 'main']);
}

async function writeAndCommit(
  dir: string,
  relPath: string,
  content: string,
  message: string,
) {
  const full = path.join(dir, relPath);
  await fs.mkdir(path.dirname(full), { recursive: true });
  await fs.writeFile(full, content, 'utf8');
  await git(dir, ['add', relPath]);
  await git(dir, ['commit', '-q', '-m', message]);
  return git(dir, ['rev-parse', 'HEAD']);
}

describe('artifact routes — buildApiServer integration', () => {
  const dirs: string[] = [];
  let active: ApiServer | undefined;

  afterEach(async () => {
    await active?.app.close();
    active = undefined;
    await Promise.all(
      dirs.splice(0).map((d) => fs.rm(d, { recursive: true, force: true })),
    );
  });

  async function boot(): Promise<{ app: ApiServer['app']; fleetHome: string }> {
    const fleetHome = await tmpDir('shipwright-fleet-artifacts-');
    dirs.push(fleetHome);
    const server = await buildApiServer({
      token: TOKEN,
      port: 4401,
      isDbOpen: () => true,
      logger: false,
      fleetHome,
    });
    active = server;
    return { app: server.app, fleetHome };
  }

  function authHeaders() {
    return { host: '127.0.0.1:4401', authorization: `Bearer ${TOKEN}` };
  }

  async function registerGitProject(fleetHome: string, name: string) {
    const projectDir = await tmpDir(`shipwright-project-${name}-`);
    dirs.push(projectDir);
    await initGitProject(projectDir);
    const registryPath = path.join(fleetHome, 'fleet.json');
    const record = await registerProject(registryPath, {
      path: projectDir,
      mode: 'import',
      name,
    });
    return { projectDir, projectId: record.id };
  }

  it('GET /artifacts is empty for a project with no docs/ dir', async () => {
    const { app, fleetHome } = await boot();
    const { projectId } = await registerGitProject(fleetHome, 'no-docs');
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/projects/${projectId}/artifacts`,
      headers: authHeaders(),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ items: [] });
  });

  it('GET /artifacts lists a committed markdown doc with its heading as title', async () => {
    const { app, fleetHome } = await boot();
    const { projectDir, projectId } = await registerGitProject(fleetHome, 'with-docs');
    await writeAndCommit(
      projectDir,
      'docs/SRS.md',
      '# Software Requirements\n\nv1',
      'v1',
    );

    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/projects/${projectId}/artifacts`,
      headers: authHeaders(),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      items: [{ path: 'docs/SRS.md', title: 'Software Requirements' }],
    });
  });

  it('GET /artifacts/doc returns content and version history, newest first', async () => {
    const { app, fleetHome } = await boot();
    const { projectDir, projectId } = await registerGitProject(fleetHome, 'versions');
    const rev1 = await writeAndCommit(projectDir, 'docs/SRS.md', '# SRS\n\nv1', 'v1');
    const rev2 = await writeAndCommit(projectDir, 'docs/SRS.md', '# SRS\n\nv2', 'v2');

    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/projects/${projectId}/artifacts/doc?path=docs/SRS.md`,
      headers: authHeaders(),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.content).toBe('# SRS\n\nv2');
    expect(body.versions.map((v: { rev: string }) => v.rev)).toEqual([rev2, rev1]);

    const oldRes = await app.inject({
      method: 'GET',
      url: `/api/v1/projects/${projectId}/artifacts/doc?path=docs/SRS.md&rev=${rev1}`,
      headers: authHeaders(),
    });
    expect(oldRes.json().content).toBe('# SRS\n\nv1');
  });

  it('GET /artifacts/doc 404s for an unknown path', async () => {
    const { app, fleetHome } = await boot();
    const { projectId } = await registerGitProject(fleetHome, 'missing-doc');
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/projects/${projectId}/artifacts/doc?path=docs/NOPE.md`,
      headers: authHeaders(),
    });
    expect(res.statusCode).toBe(404);
  });

  it('GET /artifacts/doc rejects a path-traversal attempt with 400', async () => {
    const { app, fleetHome } = await boot();
    const { projectId } = await registerGitProject(fleetHome, 'traversal');
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/projects/${projectId}/artifacts/doc?path=${encodeURIComponent('../../etc/passwd')}`,
      headers: authHeaders(),
    });
    expect(res.statusCode).toBe(400);
  });

  it('GET /artifacts/doc refuses a dot-prefixed path (state.db / .env leak) with 400', async () => {
    const { app, fleetHome } = await boot();
    const { projectId } = await registerGitProject(fleetHome, 'dotleak');
    for (const leak of ['.shipwright/state.db', '.env', '.git/config']) {
      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/projects/${projectId}/artifacts/doc?path=${encodeURIComponent(leak)}`,
        headers: authHeaders(),
      });
      expect(res.statusCode, `leak path ${leak} must be refused`).toBe(400);
    }
  });

  it('GET /artifacts/doc refuses a docs/ symlink that resolves to .shipwright/state.db (W1-07-class symlink escape)', async () => {
    const { app, fleetHome } = await boot();
    const { projectDir, projectId } = await registerGitProject(
      fleetHome,
      'symlink-escape',
    );
    // Not git-committed on purpose: the vulnerable code path is the live
    // working-tree read (readWorkingTree), which never goes through git at
    // all — a symlink dropped straight on disk is the realistic attack
    // surface for an untrusted agent session (CLAUDE.md law #4).
    await fs.mkdir(path.join(projectDir, 'docs'), { recursive: true });
    await fs.symlink(
      path.join('..', '.shipwright', 'state.db'),
      path.join(projectDir, 'docs', 'leak.md'),
    );

    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/projects/${projectId}/artifacts/doc?path=${encodeURIComponent('docs/leak.md')}`,
      headers: authHeaders(),
    });
    expect([400, 404]).toContain(res.statusCode);
    expect(res.body).not.toContain('SQLite format 3');
  });

  it('GET /artifacts/diff 404s when the ticket has no branch', async () => {
    const { app, fleetHome } = await boot();
    const { projectDir, projectId } = await registerGitProject(fleetHome, 'no-branch');
    await writeAndCommit(projectDir, 'docs/SRS.md', '# SRS\n\nbase', 'base');

    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/projects/${projectId}/artifacts/diff?path=docs/SRS.md&ticket=W9-99`,
      headers: authHeaders(),
    });
    expect(res.statusCode).toBe(404);
  });

  it('GET /artifacts/diff renders branch-vs-base content for a ticket branch (FR-C3)', async () => {
    const { app, fleetHome } = await boot();
    const { projectDir, projectId } = await registerGitProject(fleetHome, 'diff');
    await writeAndCommit(projectDir, 'docs/SRS.md', '# SRS\n\nbase text', 'base');
    await git(projectDir, ['checkout', '-q', '-b', 'sw/w4-05-artifact-viewer']);
    await writeAndCommit(
      projectDir,
      'docs/SRS.md',
      '# SRS\n\nticket text',
      'ticket edit',
    );

    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/projects/${projectId}/artifacts/diff?path=docs/SRS.md&ticket=W4-05`,
      headers: authHeaders(),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.branch).toBe('sw/w4-05-artifact-viewer');
    expect(body.base).toBe('main');
    expect(body.oldContent).toBe('# SRS\n\nbase text');
    expect(body.newContent).toBe('# SRS\n\nticket text');
  });

  it('GET /artifacts/doc-diff diffs one path across two revisions directly (FR-C8)', async () => {
    const { app, fleetHome } = await boot();
    const { projectDir, projectId } = await registerGitProject(fleetHome, 'doc-diff');
    const rev1 = await writeAndCommit(projectDir, 'docs/SRS.md', '# SRS\n\nv1', 'v1');
    await writeAndCommit(projectDir, 'docs/SRS.md', '# SRS\n\nv2', 'v2');

    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/projects/${projectId}/artifacts/doc-diff?path=docs/SRS.md&from=${rev1}`,
      headers: authHeaders(),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.from).toBe(rev1);
    expect(body.to).toBe('HEAD');
    expect(body.oldContent).toBe('# SRS\n\nv1');
    expect(body.newContent).toBe('# SRS\n\nv2');
  });

  it('GET /artifacts/doc-diff accepts an explicit "to" revision', async () => {
    const { app, fleetHome } = await boot();
    const { projectDir, projectId } = await registerGitProject(fleetHome, 'doc-diff-to');
    const rev1 = await writeAndCommit(projectDir, 'docs/SRS.md', '# SRS\n\nv1', 'v1');
    const rev2 = await writeAndCommit(projectDir, 'docs/SRS.md', '# SRS\n\nv2', 'v2');
    await writeAndCommit(projectDir, 'docs/SRS.md', '# SRS\n\nv3', 'v3');

    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/projects/${projectId}/artifacts/doc-diff?path=docs/SRS.md&from=${rev1}&to=${rev2}`,
      headers: authHeaders(),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.to).toBe(rev2);
    expect(body.oldContent).toBe('# SRS\n\nv1');
    expect(body.newContent).toBe('# SRS\n\nv2');
  });

  it('GET /artifacts/doc-diff 404s when "from" doesn\'t resolve', async () => {
    const { app, fleetHome } = await boot();
    const { projectDir, projectId } = await registerGitProject(
      fleetHome,
      'doc-diff-missing',
    );
    await writeAndCommit(projectDir, 'docs/SRS.md', '# SRS\n\nv1', 'v1');

    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/projects/${projectId}/artifacts/doc-diff?path=docs/SRS.md&from=deadbeef`,
      headers: authHeaders(),
    });
    expect(res.statusCode).toBe(404);
  });

  it('POST /artifacts/comments appends a comment; no revision.requested without a gate receipt', async () => {
    const { app, fleetHome } = await boot();
    const { projectDir, projectId } = await registerGitProject(
      fleetHome,
      'comment-ungated',
    );
    await writeAndCommit(projectDir, 'docs/SRS.md', '# SRS\n\nv1', 'v1');

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/projects/${projectId}/artifacts/comments`,
      headers: authHeaders(),
      payload: { path: 'docs/SRS.md', body: 'Clarify FR-C3.', versionRef: 'HEAD' },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().revisionRequested).toBe(false);

    const listRes = await app.inject({
      method: 'GET',
      url: `/api/v1/projects/${projectId}/artifacts/comments?path=docs/SRS.md`,
      headers: authHeaders(),
    });
    const items = listRes.json().items;
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ body: 'Clarify FR-C3.', revisionRequested: false });
  });

  it('POST /artifacts/comments on a gated (receipted) ticket emits revision.requested (FR-C8)', async () => {
    const { app, fleetHome } = await boot();
    const { projectDir, projectId } = await registerGitProject(
      fleetHome,
      'comment-gated',
    );
    await writeAndCommit(projectDir, 'docs/SRS.md', '# SRS\n\nv1', 'v1');

    // Seed a gate receipt for ticket W4-05 directly against the project's state.db.
    const dbPath = path.join(projectDir, '.shipwright', 'state.db');
    const log = openEventLog(dbPath);
    createIdentity(log, { id: 'maker-1', name: 'Maker', kind: 'machine' });
    mintReceipt(
      log,
      {
        id: 'rcpt-gate-1',
        kind: 'gate',
        projectId,
        ticketId: 'W4-05',
        validators: [{ name: 'validate-plan', exitCode: 0, gapCount: 0 }],
        inputFiles: [{ path: 'docs/SRS.md', content: 'v1' }],
        actorId: 'maker-1',
      },
      { signingKey: SIGNING_KEY },
    );
    log.close();

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/projects/${projectId}/artifacts/comments`,
      headers: authHeaders(),
      payload: {
        path: 'docs/SRS.md',
        body: 'This needs a revision.',
        versionRef: 'HEAD',
        ticketId: 'W4-05',
      },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().revisionRequested).toBe(true);

    const listRes = await app.inject({
      method: 'GET',
      url: `/api/v1/projects/${projectId}/artifacts/comments?path=docs/SRS.md`,
      headers: authHeaders(),
    });
    expect(listRes.json().items[0]).toMatchObject({ revisionRequested: true });
  });

  it('404s for an unknown project id on every artifact route', async () => {
    const { app } = await boot();
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/projects/nope/artifacts',
      headers: authHeaders(),
    });
    expect(res.statusCode).toBe(404);
  });
});
