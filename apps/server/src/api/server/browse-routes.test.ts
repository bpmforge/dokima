/**
 * W12-42. The picker's server half: bounded roots, and every failure mode
 * named rather than collapsed into "could not list".
 */
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { registerProject } from '../projects.js';
import { buildApiServer, type ApiServer } from '../server.js';
import { browseDirectory, browseRoots, isWithin } from './browse-routes.js';

const TOKEN = 'test-token-0123456789abcdef';
const PORT = 4409;

describe('browse routes (W12-42)', () => {
  const dirs: string[] = [];
  let active: ApiServer | undefined;

  afterEach(async () => {
    await active?.app.close();
    active = undefined;
    await Promise.all(dirs.splice(0).map((d) => fs.rm(d, { recursive: true, force: true })));
  });

  async function boot() {
    const fleetHome = await fs.mkdtemp(path.join(os.tmpdir(), 'dokima-browse-fleet-'));
    const homeDir = await fs.mkdtemp(path.join(os.tmpdir(), 'dokima-browse-home-'));
    dirs.push(fleetHome, homeDir);
    const server = await buildApiServer({
      token: TOKEN,
      port: PORT,
      isDbOpen: () => true,
      logger: false,
      fleetHome,
    });
    active = server;
    return {
      app: server.app,
      fleetHome,
      homeDir,
      h: { host: `127.0.0.1:${PORT}`, authorization: `Bearer ${TOKEN}` },
    };
  }

  describe('containment', () => {
    it('does not treat a sibling with a shared prefix as contained', () => {
      // `/home/bob` must not contain `/home/bobby`. A bare startsWith does.
      expect(isWithin('/home/bob', '/home/bobby')).toBe(false);
      expect(isWithin('/home/bob', '/home/bob/p')).toBe(true);
      expect(isWithin('/home/bob', '/home/bob')).toBe(true);
    });

    it(
      'RESOLVES SYMLINKS BEFORE CHECKING. A directory inside an allowed root ' +
        'that links out of it would otherwise pass a string test and enumerate ' +
        'the whole disk — the specific reason the check is on the real path',
      async () => {
        const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dokima-browse-root-'));
        const outside = await fs.mkdtemp(path.join(os.tmpdir(), 'dokima-browse-out-'));
        dirs.push(root, outside);
        await fs.mkdir(path.join(outside, 'secrets'));
        await fs.symlink(outside, path.join(root, 'escape'));

        const result = await browseDirectory({
          target: path.join(root, 'escape'),
          roots: [{ path: root, label: 'root' }],
          registeredPaths: new Set(),
        });
        expect('refusal' in result && result.refusal).toBe('outside-allowed-roots');
      },
    );
  });

  describe('failure modes are named', () => {
    it('a path that does not exist', async () => {
      const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dokima-browse-root-'));
      dirs.push(root);
      const result = await browseDirectory({
        target: path.join(root, 'nope'),
        roots: [{ path: root, label: 'root' }],
        registeredPaths: new Set(),
      });
      expect('refusal' in result && result.refusal).toBe('no-such-directory');
    });

    it('a path that is a file rather than a directory', async () => {
      const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dokima-browse-root-'));
      dirs.push(root);
      const file = path.join(root, 'README.md');
      await fs.writeFile(file, '# hi\n');
      const result = await browseDirectory({
        target: file,
        roots: [{ path: root, label: 'root' }],
        registeredPaths: new Set(),
      });
      expect('refusal' in result && result.refusal).toBe('not-a-directory');
    });

    it('a path outside every allowed root, with the bound explained', async () => {
      const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dokima-browse-root-'));
      const other = await fs.mkdtemp(path.join(os.tmpdir(), 'dokima-browse-other-'));
      dirs.push(root, other);
      const result = await browseDirectory({
        target: other,
        roots: [{ path: root, label: 'root' }],
        registeredPaths: new Set(),
      });
      expect('refusal' in result && result.refusal).toBe('outside-allowed-roots');
      // Names the bound and what to do about it, not just "denied".
      expect('detail' in result && result.detail).toMatch(/workspace root/);
    });

    it('a directory that exists but cannot be read', async () => {
      if (process.getuid?.() === 0) return; // root can read anything
      const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dokima-browse-root-'));
      dirs.push(root);
      const locked = path.join(root, 'locked');
      await fs.mkdir(locked);
      await fs.chmod(locked, 0o000);
      try {
        const result = await browseDirectory({
          target: locked,
          roots: [{ path: root, label: 'root' }],
          registeredPaths: new Set(),
        });
        expect('refusal' in result && result.refusal).toBe('not-readable');
      } finally {
        await fs.chmod(locked, 0o755);
      }
    });
  });

  describe('listing', () => {
    it('returns directories only, sorted, without dot-directories', async () => {
      const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dokima-browse-root-'));
      dirs.push(root);
      await fs.mkdir(path.join(root, 'zebra'));
      await fs.mkdir(path.join(root, 'alpha'));
      await fs.mkdir(path.join(root, '.git'));
      await fs.writeFile(path.join(root, 'notes.txt'), 'x');

      const result = await browseDirectory({
        target: root,
        roots: [{ path: root, label: 'root' }],
        registeredPaths: new Set(),
      });
      expect('entries' in result && result.entries.map((e) => e.name)).toEqual([
        'alpha',
        'zebra',
      ]);
    });

    it('marks an already-registered directory, which is a dead end for onboard', async () => {
      const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dokima-browse-root-'));
      dirs.push(root);
      const taken = path.join(root, 'taken');
      await fs.mkdir(taken);
      const result = await browseDirectory({
        target: root,
        roots: [{ path: root, label: 'root' }],
        registeredPaths: new Set([taken]),
      });
      expect('entries' in result && result.entries[0]?.registered).toBe(true);
    });

    it('reports no parent at a root — an "up" the next request would refuse', async () => {
      const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dokima-browse-root-'));
      dirs.push(root);
      await fs.mkdir(path.join(root, 'child'));
      const atRoot = await browseDirectory({
        target: root,
        roots: [{ path: root, label: 'root' }],
        registeredPaths: new Set(),
      });
      expect('parent' in atRoot && atRoot.parent).toBeNull();

      const inChild = await browseDirectory({
        target: path.join(root, 'child'),
        roots: [{ path: root, label: 'root' }],
        registeredPaths: new Set(),
      });
      expect('parent' in inChild && inChild.parent).toBe(await fs.realpath(root));
    });
  });

  describe('roots — the common case in two clicks', () => {
    it('opens at the workspace root and home, never at /', async () => {
      const fleetHome = await fs.mkdtemp(path.join(os.tmpdir(), 'dokima-browse-fleet-'));
      dirs.push(fleetHome);
      const roots = await browseRoots({
        registryPath: path.join(fleetHome, 'fleet.json'),
        homeDir: '/home/u',
        workspaceRoot: '/home/u/Dokima',
      });
      expect(roots.map((r) => r.path)).toEqual(['/home/u/Dokima', '/home/u']);
      expect(roots.some((r) => r.path === '/')).toBe(false);
    });

    it(
      'includes the PARENT of a registered project: someone whose work lives in ' +
        '~/Code said so by registering there and should not repeat it every time',
      async () => {
        const fleetHome = await fs.mkdtemp(path.join(os.tmpdir(), 'dokima-browse-fleet-'));
        const projectDir = await fs.mkdtemp(path.join(os.tmpdir(), 'dokima-browse-proj-'));
        dirs.push(fleetHome, projectDir);
        await registerProject(path.join(fleetHome, 'fleet.json'), {
          path: projectDir,
          mode: 'new',
          name: 'p',
        });
        const roots = await browseRoots({
          registryPath: path.join(fleetHome, 'fleet.json'),
          homeDir: '/home/u',
          workspaceRoot: '/home/u/Dokima',
        });
        expect(roots.map((r) => r.path)).toContain(path.dirname(projectDir));
      },
    );
  });

  describe('over HTTP', () => {
    it('GET /browse/roots answers without the caller knowing any path', async () => {
      const { app, h } = await boot();
      const res = await app.inject({ method: 'GET', url: '/api/v1/browse/roots', headers: h });
      expect(res.statusCode).toBe(200);
      expect(Array.isArray(res.json().roots)).toBe(true);
      expect(res.json().roots.length).toBeGreaterThan(0);
    });

    it('GET /browse without a path is a named 400, not an empty listing', async () => {
      const { app, h } = await boot();
      const res = await app.inject({ method: 'GET', url: '/api/v1/browse', headers: h });
      expect(res.statusCode).toBe(400);
    });

    it('GET /browse outside the roots is a 409 carrying the rule', async () => {
      const { app, h } = await boot();
      const outside = await fs.mkdtemp(path.join(os.tmpdir(), 'dokima-browse-out-'));
      dirs.push(outside);
      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/browse?path=${encodeURIComponent(outside)}`,
        headers: h,
      });
      expect(res.statusCode).toBe(409);
      expect(res.json().rule).toBe('outside-allowed-roots');
    });

    it('GET /browse lists a directory under an allowed root', async () => {
      const { app, h, fleetHome } = await boot();
      // Register a project so its parent becomes a root, which is the path a
      // real onboard takes.
      const projectDir = await fs.mkdtemp(path.join(os.tmpdir(), 'dokima-browse-proj-'));
      dirs.push(projectDir);
      await registerProject(path.join(fleetHome, 'fleet.json'), {
        path: projectDir,
        mode: 'new',
        name: 'p',
      });
      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/browse?path=${encodeURIComponent(path.dirname(projectDir))}`,
        headers: h,
      });
      expect(res.statusCode).toBe(200);
      // Compared against the REAL path: entries are resolved, deliberately. On
      // macOS `/tmp` is a symlink, and returning the unresolved spelling would
      // let the same directory be registered twice under two names.
      const realProject = await fs.realpath(projectDir);
      expect(
        res.json().entries.some((e: { path: string }) => e.path === realProject),
      ).toBe(true);
    });
  });
});
