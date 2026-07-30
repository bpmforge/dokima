/**
 * `shipwright service install|status|stop` (DEPLOYMENT.md §6): "writes a
 * user unit — launchd agent (macOS) or systemd user unit (Linux/WSL) — so
 * autorun survives logout of the terminal." Process execution (`launchctl`/
 * `systemctl`) is injectable so tests never touch the real service manager;
 * `homedir` is injectable so tests never write into the real user's
 * `~/Library/LaunchAgents` or `~/.config/systemd/user`.
 */

import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { resolveAsset } from '@shipwright/shared';
import { promisify } from 'node:util';
import type { CliIO } from '../../bootstrap/cli.js';

const execFileAsync = promisify(execFile);

export const LAUNCHD_LABEL = 'com.shipwright.core';
export const SYSTEMD_UNIT_NAME = 'shipwright.service';

export interface ServiceCommandTarget {
  command: string;
  args: string[];
}

/** The packaged runtime's own entry point — invoking it directly works whether shipwright was installed globally or run from a local checkout (DEPLOYMENT.md §1). */
export function defaultServiceCommand(): ServiceCommandTarget {
  // Anchored to the distribution root; the bin shim ships at this same
  // repo-relative path inside the package, so one expression serves both
  // a source checkout and an installed copy (W9-13).
  const cliEntry = resolveAsset('apps', 'server', 'src', 'bootstrap', 'cli-entry.mjs');
  return { command: process.execPath, args: [cliEntry] };
}

export interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

async function defaultExec(command: string, args: string[]): Promise<ExecResult> {
  try {
    const { stdout, stderr } = await execFileAsync(command, args);
    return { stdout, stderr, exitCode: 0 };
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string; code?: number; message: string };
    return {
      stdout: e.stdout ?? '',
      stderr: e.stderr ?? e.message,
      exitCode: typeof e.code === 'number' ? e.code : 1,
    };
  }
}

export interface ServiceDeps {
  platform?: NodeJS.Platform;
  homedir?: string;
  exec?: (command: string, args: string[]) => Promise<ExecResult>;
  target?: ServiceCommandTarget;
}

function launchdPlistPath(homedir: string): string {
  return path.join(homedir, 'Library', 'LaunchAgents', `${LAUNCHD_LABEL}.plist`);
}

function systemdUnitPath(homedir: string): string {
  return path.join(homedir, '.config', 'systemd', 'user', SYSTEMD_UNIT_NAME);
}

function xmlEscape(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Renders a launchd user-agent plist (RunAtLoad + KeepAlive, matching DEPLOYMENT.md §6's "autorun survives logout"). */
export function renderLaunchdPlist(target: ServiceCommandTarget, logDir: string): string {
  const programArgs = [target.command, ...target.args]
    .map((arg) => `    <string>${xmlEscape(arg)}</string>`)
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LAUNCHD_LABEL}</string>
  <key>ProgramArguments</key>
  <array>
${programArgs}
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>${xmlEscape(path.join(logDir, 'service.log'))}</string>
  <key>StandardErrorPath</key>
  <string>${xmlEscape(path.join(logDir, 'service.error.log'))}</string>
</dict>
</plist>
`;
}

/** Renders a systemd user unit (WantedBy=default.target so `systemctl --user enable` autoruns on next login). */
export function renderSystemdUnit(target: ServiceCommandTarget, logDir: string): string {
  const execStart = [target.command, ...target.args]
    .map((part) => (part.includes(' ') ? `"${part}"` : part))
    .join(' ');
  return `[Unit]
Description=Shipwright core (night-shift mode)

[Service]
ExecStart=${execStart}
Restart=on-failure
StandardOutput=append:${path.join(logDir, 'service.log')}
StandardError=append:${path.join(logDir, 'service.error.log')}

[Install]
WantedBy=default.target
`;
}

function resolvePlatform(deps: ServiceDeps): NodeJS.Platform {
  return deps.platform ?? process.platform;
}

function resolveHomedir(deps: ServiceDeps): string {
  return deps.homedir ?? os.homedir();
}

function resolveExec(
  deps: ServiceDeps,
): (command: string, args: string[]) => Promise<ExecResult> {
  return deps.exec ?? defaultExec;
}

function resolveTarget(deps: ServiceDeps): ServiceCommandTarget {
  return deps.target ?? defaultServiceCommand();
}

export class UnsupportedPlatformError extends Error {
  constructor(platform: string) {
    super(
      `shipwright service is not supported on platform "${platform}" — macOS (launchd) and Linux/WSL (systemd user units) only (DEPLOYMENT.md §6, D-009)`,
    );
    this.name = 'UnsupportedPlatformError';
  }
}

async function installLaunchd(
  io: CliIO,
  homedir: string,
  exec: (command: string, args: string[]) => Promise<ExecResult>,
  target: ServiceCommandTarget,
): Promise<number> {
  const plistPath = launchdPlistPath(homedir);
  const logDir = path.join(homedir, '.shipwright', 'logs');
  await fs.mkdir(path.dirname(plistPath), { recursive: true });
  await fs.mkdir(logDir, { recursive: true });
  await fs.writeFile(plistPath, renderLaunchdPlist(target, logDir));

  const result = await exec('launchctl', ['load', '-w', plistPath]);
  if (result.exitCode !== 0) {
    io.stderr(`service install refused: launchctl load failed: ${result.stderr}`);
    return 1;
  }
  io.stdout(`service install: wrote ${plistPath} and loaded it via launchctl`);
  return 0;
}

async function installSystemd(
  io: CliIO,
  homedir: string,
  exec: (command: string, args: string[]) => Promise<ExecResult>,
  target: ServiceCommandTarget,
): Promise<number> {
  const unitPath = systemdUnitPath(homedir);
  const logDir = path.join(homedir, '.shipwright', 'logs');
  await fs.mkdir(path.dirname(unitPath), { recursive: true });
  await fs.mkdir(logDir, { recursive: true });
  await fs.writeFile(unitPath, renderSystemdUnit(target, logDir));

  const reload = await exec('systemctl', ['--user', 'daemon-reload']);
  if (reload.exitCode !== 0) {
    io.stderr(
      `service install refused: systemctl daemon-reload failed: ${reload.stderr}`,
    );
    return 1;
  }
  const enable = await exec('systemctl', [
    '--user',
    'enable',
    '--now',
    SYSTEMD_UNIT_NAME,
  ]);
  if (enable.exitCode !== 0) {
    io.stderr(`service install refused: systemctl enable --now failed: ${enable.stderr}`);
    return 1;
  }
  io.stdout(`service install: wrote ${unitPath} and enabled it via systemctl --user`);
  return 0;
}

export async function runServiceInstall(
  io: CliIO,
  deps: ServiceDeps = {},
): Promise<number> {
  const platform = resolvePlatform(deps);
  const homedir = resolveHomedir(deps);
  const exec = resolveExec(deps);
  const target = resolveTarget(deps);
  if (platform === 'darwin') return installLaunchd(io, homedir, exec, target);
  if (platform === 'linux') return installSystemd(io, homedir, exec, target);
  io.stderr(new UnsupportedPlatformError(platform).message);
  return 1;
}

export async function runServiceStatus(
  io: CliIO,
  deps: ServiceDeps = {},
): Promise<number> {
  const platform = resolvePlatform(deps);
  const exec = resolveExec(deps);
  if (platform === 'darwin') {
    const result = await exec('launchctl', ['list', LAUNCHD_LABEL]);
    if (result.exitCode !== 0) {
      io.stdout('service status: not loaded');
      return 1;
    }
    io.stdout(`service status: loaded\n${result.stdout}`);
    return 0;
  }
  if (platform === 'linux') {
    const result = await exec('systemctl', ['--user', 'is-active', SYSTEMD_UNIT_NAME]);
    const state = result.stdout.trim() || result.stderr.trim() || 'unknown';
    io.stdout(`service status: ${state}`);
    return state === 'active' ? 0 : 1;
  }
  io.stderr(new UnsupportedPlatformError(platform).message);
  return 1;
}

export async function runServiceStop(io: CliIO, deps: ServiceDeps = {}): Promise<number> {
  const platform = resolvePlatform(deps);
  const homedir = resolveHomedir(deps);
  const exec = resolveExec(deps);
  if (platform === 'darwin') {
    const result = await exec('launchctl', ['unload', launchdPlistPath(homedir)]);
    if (result.exitCode !== 0) {
      io.stderr(`service stop refused: launchctl unload failed: ${result.stderr}`);
      return 1;
    }
    io.stdout('service stop: unloaded');
    return 0;
  }
  if (platform === 'linux') {
    const result = await exec('systemctl', ['--user', 'stop', SYSTEMD_UNIT_NAME]);
    if (result.exitCode !== 0) {
      io.stderr(`service stop refused: systemctl stop failed: ${result.stderr}`);
      return 1;
    }
    io.stdout('service stop: stopped');
    return 0;
  }
  io.stderr(new UnsupportedPlatformError(platform).message);
  return 1;
}

export async function runServiceCommand(
  subcommand: 'install' | 'status' | 'stop',
  io: CliIO,
  deps: ServiceDeps = {},
): Promise<number> {
  switch (subcommand) {
    case 'install':
      return runServiceInstall(io, deps);
    case 'status':
      return runServiceStatus(io, deps);
    case 'stop':
      return runServiceStop(io, deps);
  }
}
