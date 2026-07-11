import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createInMemorySettingsEventSink } from './events.js';
import { resolveEffectiveValue } from './settings.js';
import { loadGlobalConfig, loadProjectSettings } from './settings-files.js';
import {
  getEffectiveSettings,
  writeGlobalSetting,
  writeProjectSetting,
} from './settings-service.js';

let tmpDirs: string[] = [];

async function mkTmp(prefix: string): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  tmpDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(tmpDirs.map((dir) => fs.rm(dir, { recursive: true, force: true })));
  tmpDirs = [];
});

describe('writeGlobalSetting / writeProjectSetting', () => {
  it('persists the value and emits a settings.changed event with old->new (FR-S3)', async () => {
    const home = await mkTmp('shipwright-config-test-');
    const env = { SHIPWRIGHT_HOME: home };
    const sink = createInMemorySettingsEventSink();

    await writeGlobalSetting(
      { key: 'matrix.preset', value: 'all-local', actorId: 'human:brad', sink },
      env,
    );

    expect(await loadGlobalConfig(env)).toEqual({ 'matrix.preset': 'all-local' });
    expect(sink.events).toEqual([
      {
        type: 'settings.changed',
        scope: 'global',
        key: 'matrix.preset',
        previousValue: undefined,
        nextValue: 'all-local',
        actorId: 'human:brad',
        occurredAt: expect.any(String),
      },
    ]);

    await writeGlobalSetting(
      { key: 'matrix.preset', value: 'hybrid', actorId: 'human:brad', sink },
      env,
    );
    expect(sink.events).toHaveLength(2);
    expect(sink.events[1]).toMatchObject({
      previousValue: 'all-local',
      nextValue: 'hybrid',
    });
  });

  it('writing undefined removes the key and records nextValue undefined', async () => {
    const projectDir = await mkTmp('shipwright-project-test-');
    const sink = createInMemorySettingsEventSink();

    await writeProjectSetting(projectDir, {
      key: 'autonomy.dial',
      value: 'guided',
      actorId: 'machine:reviewer-1',
      sink,
    });
    await writeProjectSetting(projectDir, {
      key: 'autonomy.dial',
      value: undefined,
      actorId: 'machine:reviewer-1',
      sink,
    });

    expect(await loadProjectSettings(projectDir)).toEqual({});
    expect(sink.events[1]).toMatchObject({
      previousValue: 'guided',
      nextValue: undefined,
    });
  });

  it('does not require a sink (audit trail is opt-in at this layer, mandatory at the wiring layer)', async () => {
    const home = await mkTmp('shipwright-config-test-');
    const env = { SHIPWRIGHT_HOME: home };
    await expect(
      writeGlobalSetting({ key: 'a', value: 1, actorId: 'human:brad' }, env),
    ).resolves.toBeUndefined();
  });
});

describe('getEffectiveSettings + resolveEffectiveValue integration', () => {
  it('resolves run > project > global end to end', async () => {
    const home = await mkTmp('shipwright-config-test-');
    const projectDir = await mkTmp('shipwright-project-test-');
    const env = { SHIPWRIGHT_HOME: home };

    await writeGlobalSetting({ key: 'berths', value: 1, actorId: 'human:brad' }, env);
    await writeProjectSetting(projectDir, {
      key: 'berths',
      value: 2,
      actorId: 'human:brad',
    });

    const withoutRun = await getEffectiveSettings({ env, projectDir });
    expect(resolveEffectiveValue('berths', withoutRun)).toEqual({
      value: 2,
      scope: 'project',
    });

    const withRun = await getEffectiveSettings({ env, projectDir, run: { berths: 3 } });
    expect(resolveEffectiveValue('berths', withRun)).toEqual({ value: 3, scope: 'run' });
  });

  it('project scope is omitted (not an empty object) when no projectDir is given', async () => {
    const home = await mkTmp('shipwright-config-test-');
    const env = { SHIPWRIGHT_HOME: home };
    const resolved = await getEffectiveSettings({ env });
    expect(resolved.project).toBeUndefined();
  });
});
