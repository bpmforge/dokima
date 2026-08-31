/**
 * Build-time seam assertion engine (P3-02).
 *
 * THE GAP THIS CLOSES: `decompose`'s `findUnownedInterfaces` is plan-time
 * only — it checks that SOME ticket declares itself owner of an interface's
 * re-export, but a ticket can DECLARE `providesInterfaces` and never write
 * the export, and lint stays green. `assertSeams` runs against the BUILT
 * head: every seam's `wiring_evidence` is a deterministic file/content check,
 * so a declared-but-unwritten export fails here with a reason naming the
 * file and the export.
 *
 * The fs is injected (`readFile`/`fileExists`) so tests are hermetic and the
 * conductor bridge can bind real fs rooted at a worktree. Both callbacks may
 * be sync or async.
 */

import type { GenericEvidence, Seam, SeamAssertion } from './types.js';

export interface SeamFs {
  /** Read a file's text. Only called after fileExists(file) returned true. */
  readonly readFile: (file: string) => string | Promise<string>;
  readonly fileExists: (file: string) => boolean | Promise<boolean>;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Does `content` export `name`? Deterministic source-text check covering
 * declarations (`export const|let|var|function|class|interface|type|enum|
 * async function name`) and brace re-exports (`export { name }`,
 * `export { other as name }`, `export type { name }`).
 */
export function containsExport(content: string, name: string): boolean {
  const n = escapeRegExp(name);
  const decl = new RegExp(
    `export\\s+(?:default\\s+)?(?:abstract\\s+)?(?:async\\s+)?` +
      `(?:const|let|var|function\\*?|class|interface|type|enum)\\s+${n}\\b`,
  );
  if (decl.test(content)) return true;
  const braces = /export\s+(?:type\s+)?\{([^}]*)\}/g;
  for (const match of content.matchAll(braces)) {
    const names = (match[1] ?? '').split(',').map((entry) => {
      const parts = entry.trim().split(/\s+as\s+/);
      return (parts[parts.length - 1] ?? '').trim();
    });
    if (names.includes(name)) return true;
  }
  return false;
}

/** A regex evidence pattern that does not compile is a spec defect — report
 * it as a failed assertion, never a crash mid-wave. */
function compilePattern(source: string): RegExp | string {
  try {
    return new RegExp(source, 'm');
  } catch (err) {
    return `pattern ${JSON.stringify(source)} is not a valid regex (${String(err)})`;
  }
}

async function assertPatternEvidence(
  ev: GenericEvidence,
  fs: SeamFs,
  what: string,
): Promise<string | undefined> {
  if (!(await fs.fileExists(ev.file))) {
    return `${ev.file} does not exist (${what})`;
  }
  if (ev.pattern === undefined) return undefined;
  const re = compilePattern(ev.pattern);
  if (typeof re === 'string') return re;
  const content = await fs.readFile(ev.file);
  if (!re.test(content)) {
    return `${ev.file} exists but pattern ${JSON.stringify(ev.pattern)} does not match (${what})`;
  }
  return undefined;
}

/** Why one seam's evidence fails, or undefined when it is wired. */
async function seamFailure(seam: Seam, fs: SeamFs): Promise<string | undefined> {
  if (seam.kind === 'export') {
    const { file, exportName } = seam.wiring_evidence;
    if (!(await fs.fileExists(file))) {
      return `${file} does not exist — export ${exportName} was declared but never written`;
    }
    const content = await fs.readFile(file);
    if (!containsExport(content, exportName)) {
      return (
        `${file} exists but does not export ${exportName} — ` +
        `the seam was declared and never wired`
      );
    }
    return undefined;
  }
  if (seam.kind === 'route') {
    return assertPatternEvidence(
      seam.wiring_evidence,
      fs,
      `route ${seam.method} ${seam.path}`,
    );
  }
  return assertPatternEvidence(seam.wiring_evidence, fs, `${seam.kind} seam`);
}

/**
 * Assert every seam's wiring evidence (plus its optional contract_test)
 * against the built head the injected fs exposes. One result per seam;
 * `reason` names the file and what was missing.
 */
export async function assertSeams(
  seams: readonly Seam[],
  fs: SeamFs,
): Promise<SeamAssertion[]> {
  const results: SeamAssertion[] = [];
  for (const seam of seams) {
    let reason = await seamFailure(seam, fs);
    if (!reason && seam.contract_test && !(await fs.fileExists(seam.contract_test))) {
      reason = `contract test ${seam.contract_test} does not exist`;
    }
    results.push(
      reason === undefined
        ? { seamId: seam.id, ok: true }
        : { seamId: seam.id, ok: false, reason },
    );
  }
  return results;
}
