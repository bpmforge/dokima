// conductor/wave-seams.mjs — bridge the packages/pipeline seam-assertion
// engine into the wave gate (P3-02, Law L4). The union, parser, and
// assertion engine live and are tested in @dokima/pipeline's seams chapter;
// this file is only the call site: bind real fs rooted at the wave's
// worktree, run the deterministic evidence checks, and turn failures into
// Tier-D blocking gap strings attributed to the seam's consumer ticket.
// The orchestrator wires seamGapsForWave() into wave.mjs at landing — this
// file deliberately does not touch the wave flow itself.
//
// Node ≥22.18 type-stripping loads the .ts sources directly. The import is
// LAZY and survivable, mirroring heal.mjs: a conductor vendored into a
// foreign repo (the W9-12 two-file contract) has no packages/pipeline —
// there the engine reports itself unavailable ONCE, loudly, as a single
// Tier-D gap (fail-closed: an unchecked seam is not a passed seam), rather
// than an import crash taking the whole harness down.

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

// Individual modules, NOT the seams barrel: type-stripping does not rewrite
// the barrel's runtime `.js` re-export specifiers, while assert.ts/parse.ts
// have only type-only relative imports — the same reason heal.mjs imports
// the three loop-policy modules one by one.
async function defaultLoader() {
  const [assert, parse, adapter] = await Promise.all([
    import('../../packages/pipeline/src/seams/assert.ts'),
    import('../../packages/pipeline/src/seams/parse.ts'),
    import('../../packages/pipeline/src/seams/adapter.ts'),
  ]);
  return {
    assertSeams: assert.assertSeams,
    parseSeams: parse.parseSeams,
    fromInterfaceRef: adapter.fromInterfaceRef,
  };
}

let engine; // module bundle | 'unavailable' (cache for the default loader only)
async function loadEngine(loader) {
  if (loader) {
    try {
      return normalizeEngine(await loader());
    } catch {
      return 'unavailable';
    }
  }
  if (engine) return engine;
  try {
    engine = normalizeEngine(await defaultLoader());
  } catch {
    engine = 'unavailable';
  }
  return engine;
}

function normalizeEngine(mod) {
  const { assertSeams, parseSeams, fromInterfaceRef } = mod ?? {};
  if (typeof assertSeams !== 'function' || typeof parseSeams !== 'function') {
    throw new Error('seam engine module missing assertSeams/parseSeams');
  }
  return { assertSeams, parseSeams, fromInterfaceRef };
}

const UNAVAILABLE_GAP =
  'Tier-D seams: assertion engine unavailable (vendored install without ' +
  'packages/pipeline) — NO seam was checked, and an unchecked seam is not a ' +
  'passed seam. Vendor packages/pipeline/src/seams (and its decompose types) ' +
  'to enable seam gating, or clear the seam list for this board.';

/** `(consumer W1-02) ` when the seam carries one, else ''. */
function attribution(seam) {
  return seam?.consumer_ticket ? ` (consumer ${seam.consumer_ticket})` : '';
}

/**
 * Back-compat lift at the board plane: a row still shaped like decompose's
 * `providesInterfaces`/`consumesInterfaces` data — `{interface_ref:
 * {packageName, exportName}, owner_pkg}` — becomes an export-kind seam via
 * the engine's fromInterfaceRef, so existing decompose output joins the
 * gate with no edits. Rows already in union shape pass through untouched;
 * a lift row missing owner_pkg is left for parseSeams to reject by name.
 */
function liftLegacyRows(rows, eng) {
  return rows.map((row) => {
    const ref = row?.interface_ref;
    if (!ref || typeof row.owner_pkg !== 'string' || !eng.fromInterfaceRef) return row;
    return eng.fromInterfaceRef(ref, row.owner_pkg, {
      providerTicket: row.provider_ticket,
      consumerTicket: row.consumer_ticket,
    });
  });
}

/**
 * Assert a wave's seams against the built head in `wtPath` and return
 * Tier-D blocking gap strings — empty array means the gate is green.
 *
 * @param seams  raw seam rows (board-plane JSON; validated by parseSeams)
 * @param wtPath worktree root every evidence path is resolved under
 * @param loader test-only injection: async () => engine module (point it at a
 *               bogus path to exercise the unavailable path hermetically)
 * @returns {Promise<string[]>}
 */
export async function seamGapsForWave({ seams, wtPath, loader }) {
  const rows = Array.isArray(seams) ? seams : [];
  if (rows.length === 0) return [];
  const eng = await loadEngine(loader);
  if (eng === 'unavailable') return [UNAVAILABLE_GAP];

  const parsed = eng.parseSeams(liftLegacyRows(rows, eng));
  const gaps = parsed.errors.map((err) => `Tier-D seam spec invalid: ${err}`);

  const results = await eng.assertSeams(parsed.seams, {
    readFile: (file) => readFileSync(join(wtPath, file), 'utf8'),
    fileExists: (file) => existsSync(join(wtPath, file)),
  });
  const byId = new Map(parsed.seams.map((s) => [s.id, s]));
  for (const r of results) {
    if (r.ok) continue;
    const seam = byId.get(r.seamId);
    gaps.push(`Tier-D seam gap [${r.seamId}]${attribution(seam)}: ${r.reason}`);
  }
  return gaps;
}
