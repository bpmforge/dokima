import { existsSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openReadOnlyLog, openWritableLog, resolveDbPath } from './db.js';
import { createTempProject, type TempProject } from './test-helpers.js';

describe('resolveDbPath', () => {
  it('defaults to .shipwright/state.db under the project cwd', () => {
    expect(resolveDbPath('/repo')).toBe(path.join('/repo', '.shipwright', 'state.db'));
  });

  it('resolves an override relative to cwd', () => {
    expect(resolveDbPath('/repo', 'custom/state.db')).toBe(
      path.join('/repo', 'custom/state.db'),
    );
  });

  it('leaves an absolute override untouched', () => {
    expect(resolveDbPath('/repo', '/elsewhere/state.db')).toBe('/elsewhere/state.db');
  });
});

describe('openWritableLog', () => {
  let project: TempProject;

  afterEach(async () => {
    await project?.cleanup();
  });

  it('creates .shipwright/ on first use', async () => {
    project = await createTempProject();
    const dbPath = resolveDbPath(project.cwd);
    expect(existsSync(path.dirname(dbPath))).toBe(false);

    const log = openWritableLog(dbPath);
    expect(existsSync(dbPath)).toBe(true);
    log.close();
  });
});

describe('openReadOnlyLog', () => {
  let project: TempProject;

  afterEach(async () => {
    await project?.cleanup();
  });

  it('throws when no log exists yet rather than conjuring one', async () => {
    project = await createTempProject();
    const dbPath = resolveDbPath(project.cwd);
    expect(() => openReadOnlyLog(dbPath)).toThrow();
  });

  it('reads a log created by openWritableLog', async () => {
    project = await createTempProject();
    const dbPath = resolveDbPath(project.cwd);
    openWritableLog(dbPath).close();

    const log = openReadOnlyLog(dbPath);
    expect(log.path).toBe(dbPath);
    log.close();
  });
});
