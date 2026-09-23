import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { writeFileAtomic } from './atomic-write.js';

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(
    dirs.splice(0).map((d) => fs.rm(d, { recursive: true, force: true })),
  );
});

async function tmp(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'dokima-atomic-write-'));
  dirs.push(dir);
  return dir;
}

describe('writeFileAtomic (W23-46)', () => {
  it('replaces the file, and a racing reader only ever sees a whole version', async () => {
    const dir = await tmp();
    const target = path.join(dir, 'state.json');
    await writeFileAtomic(target, JSON.stringify({ v: 0, pad: 'x'.repeat(50_000) }));
    const torn: string[] = [];
    for (let v = 1; v <= 100; v += 1) {
      const [, raw] = await Promise.all([
        writeFileAtomic(target, JSON.stringify({ v, pad: 'x'.repeat(50_000) })),
        fs.readFile(target, 'utf8'),
      ]);
      try {
        JSON.parse(raw);
      } catch {
        torn.push(raw.slice(0, 20));
      }
    }
    expect(torn).toEqual([]);
    expect(JSON.parse(await fs.readFile(target, 'utf8')).v).toBe(100);
  });

  it('leaves no temp file behind — on success, and when the write fails', async () => {
    const dir = await tmp();
    await writeFileAtomic(path.join(dir, 'a.json'), '{}');
    await expect(
      writeFileAtomic(path.join(dir, 'missing-dir', 'b.json'), '{}'),
    ).rejects.toThrow();
    expect(await fs.readdir(dir)).toEqual(['a.json']);
  });
});
