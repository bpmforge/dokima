import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createFileStopSwitch } from './loop-killswitch.js';

describe('createFileStopSwitch', () => {
  let dir: string | undefined;

  afterEach(async () => {
    if (dir) await fs.rm(dir, { recursive: true, force: true });
    dir = undefined;
  });

  it('does not stop when neither file exists', async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'shipwright-killswitch-test-'));
    const stopSwitch = createFileStopSwitch({
      killFilePath: path.join(dir, 'KILL'),
      pauseFilePath: path.join(dir, 'PAUSE'),
    });
    expect(await stopSwitch()).toBe(false);
  });

  it('stops when the kill-file exists', async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'shipwright-killswitch-test-'));
    const killFilePath = path.join(dir, 'KILL');
    await fs.writeFile(killFilePath, '');
    const stopSwitch = createFileStopSwitch({
      killFilePath,
      pauseFilePath: path.join(dir, 'PAUSE'),
    });
    expect(await stopSwitch()).toBe(true);
  });

  it('stops when the pause-file exists', async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'shipwright-killswitch-test-'));
    const pauseFilePath = path.join(dir, 'PAUSE');
    await fs.writeFile(pauseFilePath, '');
    const stopSwitch = createFileStopSwitch({
      killFilePath: path.join(dir, 'KILL'),
      pauseFilePath,
    });
    expect(await stopSwitch()).toBe(true);
  });
});
