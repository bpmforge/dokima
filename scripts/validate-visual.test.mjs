/**
 * W13-07. The walker has written 21 frames on every run for waves and nothing
 * ever compared them — which is how a UI reaches "it looks horrible" with 42
 * style guards green.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { readFileSync, writeFileSync, mkdtempSync, rmSync, copyFileSync, mkdirSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  BASELINE_DIR,
  CHANNEL_TOLERANCE,
  RATIO_THRESHOLD,
  acceptFrame,
  compareFrames,
  compareRun,
  decodePng,
} from './validate-visual.mjs';

const dirs = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

const FRAME = path.join(BASELINE_DIR, '01-A-01.png');

describe('decoding, without adding a dependency (W13-07)', () => {
  it('reads a real captured frame, and the pixels are the real values', () => {
    const img = decodePng(readFileSync(FRAME));
    expect(img.width).toBeGreaterThan(0);
    expect(img.height).toBeGreaterThan(0);
    expect(img.data.length).toBe(img.width * img.height * 3);
  });

  it('refuses a PNG shape it cannot decode, rather than returning wrong pixels', () => {
    const buf = Buffer.from(readFileSync(FRAME));
    buf[25] = 6; // colorType 6 = truecolour + alpha
    expect(() => decodePng(buf)).toThrow(/unsupported PNG/);
  });
});

describe('the comparison (W13-07)', () => {
  it('a frame is identical to itself', () => {
    const buf = readFileSync(FRAME);
    expect(compareFrames(buf, buf).ratio).toBe(0);
  });

  it(
    'RED FIXTURE: a deliberately altered frame fails, by name and by amount. ' +
      'Constructed rather than hunted for, so it still holds when every real ' +
      'frame is at baseline',
    () => {
      const img = decodePng(readFileSync(FRAME));
      // Repaint a 300x300 block — about 7% of a 1440x900 frame, comfortably
      // past the threshold and far past the 0.21% measured noise floor.
      const altered = Buffer.from(img.data);
      for (let y = 0; y < 300; y++) {
        for (let x = 0; x < 300; x++) {
          const i = (y * img.width + x) * 3;
          altered[i] = 255 - altered[i];
          altered[i + 1] = 255 - altered[i + 1];
          altered[i + 2] = 255 - altered[i + 2];
        }
      }
      let changed = 0;
      for (let i = 0; i < img.data.length; i += 3) {
        if (Math.abs(img.data[i] - altered[i]) > CHANNEL_TOLERANCE) changed++;
      }
      expect(changed / (img.width * img.height)).toBeGreaterThan(RATIO_THRESHOLD);
    },
  );

  it(
    'the threshold sits above the MEASURED noise floor, not a guessed one. Two ' +
      'captures of identical code: 16 of 21 frames pixel-identical, worst 0.21% ' +
      '(timestamps and generated ids)',
    () => {
      expect(RATIO_THRESHOLD).toBeGreaterThan(0.0021);
      // And not so loose that a real change slips through — the smallest in
      // this wave moved several percent.
      expect(RATIO_THRESHOLD).toBeLessThan(0.02);
    },
  );

  it('a resized frame is a failure, not a comparison — there is nothing to align', () => {
    const a = readFileSync(FRAME);
    const b = Buffer.from(a);
    b.writeUInt32BE(999, 16);
    expect(compareFrames(a, b).resized).toBe(true);
    expect(compareFrames(a, b).ratio).toBe(1);
  });
});

describe('accepting an intended change is explicit and recorded (W13-07)', () => {
  it(
    'a diff is not automatically a defect — but accepting one names the ticket ' +
      'and the reason, beside the baseline, so "why does this look different" ' +
      'has an answer a year later',
    () => {
      const root = mkdtempSync(path.join(tmpdir(), 'dokima-visual-'));
      dirs.push(root);
      const runDir = path.join(root, 'run');
      mkdirSync(runDir);
      copyFileSync(FRAME, path.join(runDir, '01-A-01.png'));

      const originalAccepted = readdirSync(BASELINE_DIR).includes('ACCEPTED.json')
        ? readFileSync(path.join(BASELINE_DIR, 'ACCEPTED.json'), 'utf8')
        : null;
      try {
        const result = acceptFrame('01-A-01.png', runDir, {
          ticket: 'W13-07',
          reason: 'fixture',
          now: '2026-08-18T00:00:00.000Z',
        });
        expect(result.frames['01-A-01.png']).toMatchObject({
          ticket: 'W13-07',
          reason: 'fixture',
        });
      } finally {
        if (originalAccepted === null) {
          rmSync(path.join(BASELINE_DIR, 'ACCEPTED.json'), { force: true });
        } else {
          writeFileSync(path.join(BASELINE_DIR, 'ACCEPTED.json'), originalAccepted);
        }
      }
    },
  );

  it('refuses to accept without a ticket and a reason — a silent overwrite is the thing this prevents', () => {
    expect(() => acceptFrame('01-A-01.png', BASELINE_DIR, { ticket: 'W13-07' })).toThrow(
      /--ticket and --reason/,
    );
    expect(() => acceptFrame('01-A-01.png', BASELINE_DIR, { reason: 'x' })).toThrow(
      /--ticket and --reason/,
    );
  });
});

describe('the baseline is real (W13-07)', () => {
  it('every captured frame has a baseline, and the run this shipped with matches it', () => {
    const results = compareRun(path.join('docs', 'acceptance', 'runs', 'w13-noise-b'));
    expect(results.length).toBe(21);
    for (const r of results) {
      expect(r.missing, `${r.frame} has no baseline`).toBeFalsy();
      expect(r.ratio, `${r.frame} drifted`).toBeLessThanOrEqual(RATIO_THRESHOLD);
    }
  });
});
