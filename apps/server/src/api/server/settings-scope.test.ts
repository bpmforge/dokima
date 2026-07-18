import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { listEvents, openEventLog } from '@shipwright/events';
import { computeShipwrightHome } from '@shipwright/shared';
import {
  getEffectiveProjectSettings,
  getGlobalSettings,
  getProjectSettings,
  putGlobalSetting,
  putProjectSetting,
} from './settings-scope.js';
import { stateDbPath } from './settings-db.js';

async function tmpProjectDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'shipwright-settings-scope-'));
}

describe('settings-scope', () => {
  const dirs: string[] = [];
  const homes: string[] = [];

  afterEach(async () => {
    await Promise.all(
      [...dirs.splice(0), ...homes.splice(0)].map((d) =>
        fs.rm(d, { recursive: true, force: true }),
      ),
    );
  });

  it('project setting write is readable back and audited as a settings.changed event', async () => {
    const dir = await tmpProjectDir();
    dirs.push(dir);

    await putProjectSetting(dir, 'autonomy', 'auto');
    expect(await getProjectSettings(dir)).toEqual({ autonomy: 'auto' });

    const log = openEventLog(stateDbPath(dir));
    try {
      const events = listEvents(log);
      expect(events).toHaveLength(1);
      expect(events[0]?.eventType).toBe('settings.changed');
      const payload = events[0]?.payload as {
        scope: string;
        key: string;
        nextValue: unknown;
      };
      expect(payload.scope).toBe('project');
      expect(payload.key).toBe('autonomy');
      expect(payload.nextValue).toBe('auto');
    } finally {
      log.close();
    }
  });

  it('global setting write with no logging project is unaudited but still persisted', async () => {
    const home = await fs.mkdtemp(path.join(os.tmpdir(), 'shipwright-home-'));
    homes.push(home);
    expect(computeShipwrightHome({ SHIPWRIGHT_HOME: home })).toBe(home);
    process.env.SHIPWRIGHT_HOME = home;
    try {
      await putGlobalSetting('defaultPreset', 'hybrid');
      expect(await getGlobalSettings()).toEqual({ defaultPreset: 'hybrid' });
    } finally {
      delete process.env.SHIPWRIGHT_HOME;
    }
  });

  it('effective settings resolution names the winning scope and lists overrides (FR-S1)', async () => {
    const dir = await tmpProjectDir();
    dirs.push(dir);
    await putProjectSetting(dir, 'berths', 2);

    const effective = await getEffectiveProjectSettings(dir, { berths: 4 });
    expect(effective.berths).toEqual({
      value: 4,
      winningScope: 'run',
      overridden: [{ scope: 'project', value: 2 }],
    });
  });
});
