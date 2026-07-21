/**
 * Second-invocation core detection + opening the Canvas (DEPLOYMENT.md §1/§6):
 * "a second `shipwright` invocation detects the running core (port + healthz)
 * and opens the Canvas against it instead of double-binding."
 */

import { spawn, type ChildProcess } from 'node:child_process';

export interface DetectRunningCoreOptions {
  port: number;
  /** Injectable for tests — defaults to the global `fetch` (Node 22 built-in). */
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

/**
 * Probes `GET /healthz` on `port`. Any HTTP response (200 ok or 503
 * degraded) means a core already owns that port — only a connection
 * failure (nothing listening, or it timed out) means it's free to bind.
 */
export async function detectRunningCore(
  opts: DetectRunningCoreOptions,
): Promise<boolean> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 500);
  try {
    await fetchImpl(`http://127.0.0.1:${opts.port}/healthz`, {
      signal: controller.signal,
    });
    return true;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

export interface OpenCommand {
  command: string;
  args: string[];
}

/** Picks the OS-native "open a URL in the default browser" command (D-009: macOS/Linux first-class, WSL via xdg-open/wslview). */
export function resolveOpenCommand(
  url: string,
  platform: NodeJS.Platform = process.platform,
): OpenCommand {
  if (platform === 'darwin') return { command: 'open', args: [url] };
  if (platform === 'win32') return { command: 'cmd', args: ['/c', 'start', '""', url] };
  return { command: 'xdg-open', args: [url] };
}

export interface OpenBrowserOptions {
  platform?: NodeJS.Platform;
  spawnImpl?: typeof spawn;
}

/** Fire-and-forget: never blocks/throws on a headless box (no display, no xdg-open) — the server itself already booted. */
export function openBrowser(
  url: string,
  opts: OpenBrowserOptions = {},
): ChildProcess | null {
  const { command, args } = resolveOpenCommand(url, opts.platform ?? process.platform);
  const spawnImpl = opts.spawnImpl ?? spawn;
  try {
    const child = spawnImpl(command, args, { stdio: 'ignore', detached: true });
    child.on('error', () => {
      /* headless/no browser available — the server is up regardless */
    });
    child.unref();
    return child;
  } catch {
    return null;
  }
}
