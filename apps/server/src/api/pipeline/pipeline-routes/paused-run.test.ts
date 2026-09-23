/**
 * W23-46: a poll must never catch the run record mid-write.
 *
 * FOUND IN THE NIGHTLY. Every red nightly since 2026-09-16 was one of two
 * e2e specs — W13-39's mid-run rejoin and the guided sample — and both showed
 * the same client symptom: a 404 from `GET /pipeline/runs/:runId`, which
 * `pollPipelineRun` treats as fatal. The run existed the whole time. The
 * record was written with `fs.writeFile`, which truncates the file and then
 * writes it, and `loadRunRecord` maps an unreadable or unparseable file to
 * "no such run" — so a poll that landed between the truncate and the write
 * reported a live run as absent.
 */
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import {
  listRunRecords,
  loadRunRecord,
  patchRunRecord,
  saveRunRecord,
  type RunRecord,
} from './paused-run.js';

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(
    dirs.splice(0).map((d) => fs.rm(d, { recursive: true, force: true })),
  );
});

async function project(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'dokima-run-record-'));
  dirs.push(dir);
  return dir;
}

function record(runId: string, phases: number): RunRecord {
  const at = '2026-09-23T00:00:00.000Z';
  return {
    runId,
    blueprintTitle: 'Torn reads',
    status: 'running',
    startedAt: at,
    updatedAt: at,
    // A realistic-sized record: the blueprint input is the bulk of a real one,
    // and a bigger write is a wider window for a reader to land inside.
    phases: Array.from({ length: phases }, (_, i) => ({ name: `stage-${i}`, at })),
    blueprintInput: {
      sections: Array.from({ length: 200 }, (_, i) => ({
        heading: `Section ${i}`,
        body: 'x'.repeat(400),
      })),
      openQuestions: [],
    } as unknown as RunRecord['blueprintInput'],
  };
}

describe('run records are written atomically (W23-46)', () => {
  it('RED FIXTURE: a reader racing the writer always sees a whole record — never the 404 a torn read became', async () => {
    const dir = await project();
    const runId = randomUUID();
    await saveRunRecord(dir, record(runId, 0));

    let missing = 0;
    for (let i = 1; i <= 150; i += 1) {
      const [, , seen] = await Promise.all([
        saveRunRecord(dir, record(runId, i)),
        loadRunRecord(dir, runId),
        loadRunRecord(dir, runId),
      ]);
      if (seen === undefined) missing += 1;
    }
    expect(missing).toBe(0);
  });

  it('a patch racing a poll never drops the patch or the run', async () => {
    const dir = await project();
    const runId = randomUUID();
    await saveRunRecord(dir, record(runId, 0));
    for (let i = 0; i < 50; i += 1) {
      const [patched, seen] = await Promise.all([
        patchRunRecord(dir, runId, (current) => ({
          ...current,
          phases: [...current.phases, { name: `p${i}`, at: current.updatedAt }],
        })),
        loadRunRecord(dir, runId),
      ]);
      expect(patched).toBeDefined();
      expect(seen).toBeDefined();
    }
    expect((await loadRunRecord(dir, runId))?.phases).toHaveLength(50);
  });

  it('leaves no temp file behind, and the listing never picks one up', async () => {
    const dir = await project();
    const runId = randomUUID();
    await saveRunRecord(dir, record(runId, 3));
    await saveRunRecord(dir, record(runId, 4));
    const names = await fs.readdir(path.join(dir, '.dokima', 'runs'));
    expect(names).toEqual([`${runId}.json`]);
    expect((await listRunRecords(dir)).map((r) => r.runId)).toEqual([runId]);
  });
});
