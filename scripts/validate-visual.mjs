#!/usr/bin/env node
/**
 * validate-visual.mjs — the captured frames finally get compared (W13-07).
 *
 * `apps/web/scripts/capture-acceptance.mjs` has written 21 screenshots on every
 * run for waves, and NOTHING has ever looked at them. That is how a UI reaches
 * "it looks horrible" with 42 style guards green: the guards check
 * declarations, the frames checked nothing, and no gate closed the loop.
 *
 * Worse, and found while building this: the walker itself had been broken since
 * W12-36 renamed "New Product", and again by W12-41's form change. A capture
 * script nothing runs stops working and says nothing — the same defect one
 * layer up.
 *
 * NO NEW DEPENDENCY. Playwright emits 8-bit truecolour, non-interlaced PNG
 * (verified from the IHDR of a real capture), which `node:zlib` plus the five
 * PNG filters decodes in about sixty lines. Adding pixelmatch + pngjs for this
 * would be a TECH_STACK decision; this repo ships five runtime dependencies on
 * purpose.
 */
import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync, copyFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateSync } from 'node:zlib';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(HERE, '..');
export const BASELINE_DIR = path.join(REPO_ROOT, 'docs', 'acceptance', 'baseline');
export const ACCEPTED_FILE = path.join(BASELINE_DIR, 'ACCEPTED.json');

/**
 * Per-channel slack, for font hinting and anti-aliasing. Deliberately small:
 * the measurement below showed it barely matters (2.85% -> 2.70% on a pair
 * that had genuinely changed), so it is not doing the work — the ratio is.
 */
export const CHANNEL_TOLERANCE = 8;

/**
 * MEASURED, NOT GUESSED. Two captures of identical code: 16 of 21 frames are
 * pixel-identical, and the worst is 0.21% — timestamps and generated project
 * ids, which are per-run by nature. 0.5% is ~2.4x that floor, which absorbs
 * the ids while still failing on anything structural: the smallest real change
 * in this wave (the Fleet card's readouts) moved several percent.
 */
export const RATIO_THRESHOLD = 0.005;

/** 8-bit truecolour, non-interlaced — the only shape the walker produces. */
export function decodePng(buf) {
  if (buf.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') throw new Error('not a PNG');
  const width = buf.readUInt32BE(16);
  const height = buf.readUInt32BE(20);
  if (buf[24] !== 8 || buf[25] !== 2 || buf[28] !== 0) {
    throw new Error(`unsupported PNG (bitDepth ${buf[24]}, colorType ${buf[25]}, interlace ${buf[28]})`);
  }
  const idat = [];
  let off = 8;
  while (off < buf.length) {
    const len = buf.readUInt32BE(off);
    if (buf.subarray(off + 4, off + 8).toString('latin1') === 'IDAT') {
      idat.push(buf.subarray(off + 8, off + 8 + len));
    }
    off += 12 + len;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const bpp = 3;
  const stride = width * bpp;
  const data = Buffer.alloc(height * stride);
  let p = 0;
  for (let y = 0; y < height; y++) {
    const filter = raw[p++];
    const line = raw.subarray(p, p + stride);
    p += stride;
    const cur = data.subarray(y * stride, (y + 1) * stride);
    const prev = y > 0 ? data.subarray((y - 1) * stride, y * stride) : null;
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? cur[x - bpp] : 0;
      const b = prev ? prev[x] : 0;
      const c = prev && x >= bpp ? prev[x - bpp] : 0;
      let v = line[x];
      if (filter === 1) v += a;
      else if (filter === 2) v += b;
      else if (filter === 3) v += (a + b) >> 1;
      else if (filter === 4) {
        const pa = Math.abs(b - c);
        const pb = Math.abs(a - c);
        const pc = Math.abs(a + b - 2 * c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      cur[x] = v & 0xff;
    }
  }
  return { width, height, data };
}

export function compareFrames(aBuf, bBuf, tolerance = CHANNEL_TOLERANCE) {
  const a = decodePng(aBuf);
  const b = decodePng(bBuf);
  if (a.width !== b.width || a.height !== b.height) {
    return { ratio: 1, changed: -1, total: 0, resized: true };
  }
  let changed = 0;
  for (let i = 0; i < a.data.length; i += 3) {
    if (
      Math.abs(a.data[i] - b.data[i]) > tolerance ||
      Math.abs(a.data[i + 1] - b.data[i + 1]) > tolerance ||
      Math.abs(a.data[i + 2] - b.data[i + 2]) > tolerance
    ) {
      changed++;
    }
  }
  const total = a.width * a.height;
  return { ratio: changed / total, changed, total, resized: false };
}

export function readAccepted() {
  if (!existsSync(ACCEPTED_FILE)) return { frames: {} };
  return JSON.parse(readFileSync(ACCEPTED_FILE, 'utf8'));
}

/**
 * A DIFF IS NOT AUTOMATICALLY A DEFECT, and accepting one is not a silent
 * overwrite: the ticket and the reason are recorded beside the baseline, so
 * "why does this screen look different" has an answer a year later.
 */
export function acceptFrame(frame, runDir, { ticket, reason, now }) {
  if (!ticket || !reason) throw new Error('--accept needs --ticket and --reason');
  mkdirSync(BASELINE_DIR, { recursive: true });
  copyFileSync(path.join(runDir, frame), path.join(BASELINE_DIR, frame));
  const accepted = readAccepted();
  accepted.frames[frame] = { ticket, reason, acceptedAt: now };
  writeFileSync(ACCEPTED_FILE, JSON.stringify(accepted, null, 2) + '\n');
  return accepted;
}

export function compareRun(runDir, baselineDir = BASELINE_DIR) {
  const frames = readdirSync(baselineDir).filter((f) => f.endsWith('.png')).sort();
  return frames.map((frame) => {
    const runFrame = path.join(runDir, frame);
    if (!existsSync(runFrame)) return { frame, missing: true, ratio: 1 };
    return { frame, ...compareFrames(readFileSync(path.join(baselineDir, frame)), readFileSync(runFrame)) };
  });
}

function main() {
  const args = process.argv.slice(2);
  const flag = (name) => {
    const i = args.indexOf(name);
    return i === -1 ? undefined : args[i + 1];
  };
  const runDir = flag('--run');
  if (!runDir) {
    console.error('usage: validate-visual.mjs --run <dir> [--accept <frame|all> --ticket W --reason "…"]');
    process.exit(2);
  }
  const accept = flag('--accept');
  if (accept) {
    const frames = accept === 'all'
      ? readdirSync(runDir).filter((f) => f.endsWith('.png'))
      : [accept];
    for (const f of frames) {
      acceptFrame(f, runDir, { ticket: flag('--ticket'), reason: flag('--reason'), now: flag('--now') ?? '' });
    }
    console.log(`accepted ${frames.length} frame(s) into the baseline`);
    return;
  }

  const results = compareRun(runDir);
  const failed = results.filter((r) => r.missing || r.ratio > RATIO_THRESHOLD);
  for (const r of results) {
    if (r.ratio > 0) {
      console.log(`  ${r.frame}: ${(r.ratio * 100).toFixed(4)}%${r.missing ? ' (missing)' : ''}`);
    }
  }
  console.log(
    JSON.stringify({
      validator: 'validate-visual',
      frames: results.length,
      changed: failed.length,
      threshold: RATIO_THRESHOLD,
      exit: failed.length > 0 ? 1 : 0,
      items: failed.map((r) => `${r.frame}: ${(r.ratio * 100).toFixed(4)}%`),
    }),
  );
  if (failed.length > 0) {
    console.error(
      `FAIL: ${failed.length} frame(s) changed beyond ${(RATIO_THRESHOLD * 100).toFixed(2)}% and no ` +
        `ticket claimed it. If the change is intended, accept it BY NAME:\n` +
        `  node scripts/validate-visual.mjs --run <dir> --accept <frame> --ticket W00-00 --reason "…"\n` +
        `That records who changed the screen and why, beside the baseline.`,
    );
    process.exit(1);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) main();
