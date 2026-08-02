import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CliIO } from '../../bootstrap/cli.js';
import {
  LAUNCHD_LABEL,
  SYSTEMD_UNIT_NAME,
  renderLaunchdPlist,
  renderSystemdUnit,
  runServiceCommand,
  type ExecResult,
} from './service.js';

const FAKE_TARGET = { command: '/usr/bin/node', args: ['/repo/cli-entry.mjs'] };

describe('renderLaunchdPlist', () => {
  it('includes the label, program arguments, RunAtLoad, and log paths', () => {
    const plist = renderLaunchdPlist(FAKE_TARGET, '/home/x/.dokima/logs');
    expect(plist).toContain(`<string>${LAUNCHD_LABEL}</string>`);
    expect(plist).toContain('<string>/usr/bin/node</string>');
    expect(plist).toContain('<string>/repo/cli-entry.mjs</string>');
    expect(plist).toContain('<key>RunAtLoad</key>');
    expect(plist).toContain('<true/>');
    expect(plist).toContain('/home/x/.dokima/logs/service.log');
  });
});

describe('renderSystemdUnit', () => {
  it('includes ExecStart, Restart, and WantedBy=default.target', () => {
    const unit = renderSystemdUnit(FAKE_TARGET, '/home/x/.dokima/logs');
    expect(unit).toContain('ExecStart=/usr/bin/node /repo/cli-entry.mjs');
    expect(unit).toContain('Restart=on-failure');
    expect(unit).toContain('WantedBy=default.target');
  });

  it('quotes arguments containing spaces', () => {
    const unit = renderSystemdUnit(
      { command: '/usr/bin/node', args: ['/path with spaces/cli-entry.mjs'] },
      '/home/x/.dokima/logs',
    );
    expect(unit).toContain('ExecStart=/usr/bin/node "/path with spaces/cli-entry.mjs"');
  });
});

describe('runServiceCommand', () => {
  const scratchDirs: string[] = [];

  afterEach(async () => {
    for (const dir of scratchDirs.splice(0)) {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  async function scratchIo(): Promise<CliIO> {
    const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'sw-service-cwd-'));
    scratchDirs.push(cwd);
    return { stdout: vi.fn(), stderr: vi.fn(), cwd, env: {} };
  }

  async function scratchHome(): Promise<string> {
    const home = await fs.mkdtemp(path.join(os.tmpdir(), 'sw-service-home-'));
    scratchDirs.push(home);
    return home;
  }

  describe('install (darwin)', () => {
    it('writes the plist and loads it via launchctl', async () => {
      const io = await scratchIo();
      const homedir = await scratchHome();
      const exec = vi
        .fn()
        .mockResolvedValue({ stdout: '', stderr: '', exitCode: 0 } as ExecResult);

      const code = await runServiceCommand('install', io, {
        platform: 'darwin',
        homedir,
        exec,
        target: FAKE_TARGET,
      });

      expect(code).toBe(0);
      const plistPath = path.join(
        homedir,
        'Library',
        'LaunchAgents',
        `${LAUNCHD_LABEL}.plist`,
      );
      const written = await fs.readFile(plistPath, 'utf8');
      expect(written).toContain(LAUNCHD_LABEL);
      expect(exec).toHaveBeenCalledWith('launchctl', ['load', '-w', plistPath]);
      expect(io.stdout).toHaveBeenCalledWith(
        expect.stringContaining('loaded it via launchctl'),
      );
    });

    it('reports failure when launchctl load fails, without throwing', async () => {
      const io = await scratchIo();
      const homedir = await scratchHome();
      const exec = vi
        .fn()
        .mockResolvedValue({
          stdout: '',
          stderr: 'permission denied',
          exitCode: 1,
        } as ExecResult);

      const code = await runServiceCommand('install', io, {
        platform: 'darwin',
        homedir,
        exec,
        target: FAKE_TARGET,
      });

      expect(code).toBe(1);
      expect(io.stderr).toHaveBeenCalledWith(
        expect.stringContaining('permission denied'),
      );
    });
  });

  describe('install (linux)', () => {
    it('writes the unit, reloads, and enables it via systemctl --user', async () => {
      const io = await scratchIo();
      const homedir = await scratchHome();
      const exec = vi
        .fn()
        .mockResolvedValue({ stdout: '', stderr: '', exitCode: 0 } as ExecResult);

      const code = await runServiceCommand('install', io, {
        platform: 'linux',
        homedir,
        exec,
        target: FAKE_TARGET,
      });

      expect(code).toBe(0);
      const unitPath = path.join(
        homedir,
        '.config',
        'systemd',
        'user',
        SYSTEMD_UNIT_NAME,
      );
      const written = await fs.readFile(unitPath, 'utf8');
      expect(written).toContain('ExecStart=/usr/bin/node /repo/cli-entry.mjs');
      expect(exec).toHaveBeenCalledWith('systemctl', ['--user', 'daemon-reload']);
      expect(exec).toHaveBeenCalledWith('systemctl', [
        '--user',
        'enable',
        '--now',
        SYSTEMD_UNIT_NAME,
      ]);
    });
  });

  describe('unsupported platform', () => {
    it('refuses cleanly on win32', async () => {
      const io = await scratchIo();
      const code = await runServiceCommand('install', io, { platform: 'win32' });
      expect(code).toBe(1);
      expect(io.stderr).toHaveBeenCalledWith(expect.stringContaining('not supported'));
    });
  });

  describe('status', () => {
    it('reports loaded on darwin when launchctl list succeeds', async () => {
      const io = await scratchIo();
      const exec = vi
        .fn()
        .mockResolvedValue({
          stdout: '{"PID"=123;}',
          stderr: '',
          exitCode: 0,
        } as ExecResult);

      const code = await runServiceCommand('status', io, { platform: 'darwin', exec });

      expect(code).toBe(0);
      expect(exec).toHaveBeenCalledWith('launchctl', ['list', LAUNCHD_LABEL]);
      expect(io.stdout).toHaveBeenCalledWith(expect.stringContaining('loaded'));
    });

    it('reports the active state on linux from systemctl is-active', async () => {
      const io = await scratchIo();
      const exec = vi
        .fn()
        .mockResolvedValue({ stdout: 'active\n', stderr: '', exitCode: 0 } as ExecResult);

      const code = await runServiceCommand('status', io, { platform: 'linux', exec });

      expect(code).toBe(0);
      expect(io.stdout).toHaveBeenCalledWith(expect.stringContaining('active'));
    });
  });

  describe('stop', () => {
    it('unloads via launchctl on darwin', async () => {
      const io = await scratchIo();
      const homedir = await scratchHome();
      const exec = vi
        .fn()
        .mockResolvedValue({ stdout: '', stderr: '', exitCode: 0 } as ExecResult);

      const code = await runServiceCommand('stop', io, {
        platform: 'darwin',
        homedir,
        exec,
      });

      expect(code).toBe(0);
      expect(exec).toHaveBeenCalledWith('launchctl', [
        'unload',
        path.join(homedir, 'Library', 'LaunchAgents', `${LAUNCHD_LABEL}.plist`),
      ]);
    });

    it('stops via systemctl on linux', async () => {
      const io = await scratchIo();
      const exec = vi
        .fn()
        .mockResolvedValue({ stdout: '', stderr: '', exitCode: 0 } as ExecResult);

      const code = await runServiceCommand('stop', io, { platform: 'linux', exec });

      expect(code).toBe(0);
      expect(exec).toHaveBeenCalledWith('systemctl', [
        '--user',
        'stop',
        SYSTEMD_UNIT_NAME,
      ]);
    });
  });
});
