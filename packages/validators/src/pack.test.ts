import { promises as fs } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadValidatorPack, UnknownValidatorSelectionError } from './pack.js';
import { createTempDir, writeScript, type TempDir } from './test-helpers.js';

describe('loadValidatorPack', () => {
  let temp: TempDir;

  afterEach(async () => {
    await temp?.cleanup();
  });

  it('discovers validate-*.sh and run-*.sh, excluding the shared _lib*.sh files', async () => {
    temp = await createTempDir('pack-discover');
    await writeScript(temp.dir, 'validate-foo.sh', '#!/bin/bash\nexit 0\n');
    await writeScript(temp.dir, 'run-bar.sh', '#!/bin/bash\nexit 0\n');
    await writeScript(temp.dir, '_lib.sh', '#!/bin/bash\n');
    await writeScript(temp.dir, '_lib_sdlc_config.sh', '#!/bin/bash\n');
    await fs.writeFile(path.join(temp.dir, 'README.md'), 'not a validator');

    const specs = await loadValidatorPack({ contentDir: temp.dir });
    expect(specs.map((s) => s.name).sort()).toEqual(['run-bar', 'validate-foo']);
  });

  it('applies FR-S1 per-project selection, in the requested order', async () => {
    temp = await createTempDir('pack-select');
    await writeScript(temp.dir, 'validate-a.sh', '#!/bin/bash\nexit 0\n');
    await writeScript(temp.dir, 'validate-b.sh', '#!/bin/bash\nexit 0\n');
    await writeScript(temp.dir, 'validate-c.sh', '#!/bin/bash\nexit 0\n');

    const specs = await loadValidatorPack({
      contentDir: temp.dir,
      select: ['validate-c', 'validate-a'],
    });
    expect(specs.map((s) => s.name)).toEqual(['validate-c', 'validate-a']);
  });

  it('throws on an unknown selection name rather than silently skipping it', async () => {
    temp = await createTempDir('pack-unknown');
    await writeScript(temp.dir, 'validate-a.sh', '#!/bin/bash\nexit 0\n');

    await expect(
      loadValidatorPack({
        contentDir: temp.dir,
        select: ['validate-a', 'validate-nope'],
      }),
    ).rejects.toThrow(UnknownValidatorSelectionError);
  });
});
