// Chapter of `validate-exports.mjs` (W22-02 split): turning source text into
// something a reference count can be trusted against.
//
// Everything here exists because the naive version of it was wrong twice. Read
// `stripComments`' own header before changing either function.
import path from 'node:path';
import ts from 'typescript';
import { REPO_ROOT, isBarrel, isTestFile } from './files.mjs';

/**
 * The same text with comments blanked out (W12-38).
 *
 * The reference count is a word-boundary text match, and the module doc-block
 * this validator lives beside says plainly that it OVER-counts: "a comment
 * mentioning a name reads as a use". That was an acceptable bias for the
 * barrel pass, and it is fatal for the buried one — `runEscalationPolicy`, the
 * instance that motivated this whole check, is named twice in a prose comment
 * in `loop-land-policy.ts` explaining why that loop deliberately does NOT call
 * it. Counting an explanation of why nothing calls a function as a call is the
 * exact inversion of what is being measured.
 *
 * Blanked, not removed: two identifiers either side of a stripped comment
 * must not glue into a third word that never existed. */
export function stripComments(text) {
  // PARSED, not pattern-matched — and it took two wrong versions to earn that.
  //
  // v1 was /\/\*[\s\S]*?\*\/|\/\/[^\n]*/. It could not tell a comment from a
  // comment DELIMITER INSIDE A STRING, and this repo writes globs in strings
  // constantly: `deliverable('src/**', ...)` in modes/feature.ts opened a
  // block comment that ran nineteen lines, blanking FEATURE_STEPS' only real
  // use so the symbol read as referenced by nothing at all.
  //
  // v2 was a hand-written scanner that understood strings — and not regex
  // literals. `if (!/[/*.]/.test(pattern))` in decompose/linter.ts contains
  // `/*`, so it opened the same phantom comment and buried lintDecomposition's
  // body, making three linter functions it calls look dead.
  //
  // Both bugs produced FALSE POSITIVES, the direction this validator's header
  // says it must never take, and both were invisible because a wrong answer
  // here looks exactly like the finding the check exists to produce. The
  // distinction v2 could not make — is this `/` a division, a regex, or a
  // comment? — is not decidable by scanning; it needs a parser. There is one
  // in this file already.
  //
  // So: parse once, ask the AST for every literal's extent, then blank
  // comments only OUTSIDE those extents, where `//` and `/*` are unambiguous.
  //
  // Blanked, not removed, per W12-38: two identifiers either side of a
  // stripped comment must not glue into a third word.
  const source = ts.createSourceFile('scan.tsx', text, ts.ScriptTarget.Latest, false, ts.ScriptKind.TSX);
  /** [start, end) of every string, template and regex literal in the file. */
  const literals = [];
  const collect = (node) => {
    if (
      ts.isStringLiteralLike(node) ||
      ts.isRegularExpressionLiteral(node) ||
      ts.isTemplateHead(node) ||
      ts.isTemplateMiddle(node) ||
      ts.isTemplateTail(node)
    ) {
      literals.push([node.getStart(source), node.end]);
    }
    ts.forEachChild(node, collect);
  };
  ts.forEachChild(source, collect);
  literals.sort((a, b) => a[0] - b[0]);

  let out = '';
  let i = 0;
  let next = 0;
  const n = text.length;
  while (i < n) {
    // Inside a literal: copy verbatim. Positions must not shift.
    while (next < literals.length && literals[next][1] <= i) next += 1;
    if (next < literals.length && i >= literals[next][0]) {
      const stop = literals[next][1];
      out += text.slice(i, stop);
      i = stop;
      continue;
    }
    const limit = next < literals.length ? literals[next][0] : n;
    const ch = text[i];
    if (ch === '/' && text[i + 1] === '/') {
      while (i < n && text[i] !== '\n') { out += ' '; i += 1; }
      continue;
    }
    if (ch === '/' && text[i + 1] === '*') {
      const found = text.indexOf('*/', i + 2);
      const stop = found === -1 ? n : found + 2;
      for (; i < stop; i += 1) out += text[i] === '\n' ? '\n' : ' ';
      continue;
    }
    // Nothing interesting until the next literal starts.
    const chunkEnd = Math.min(limit, n);
    const slashAt = text.indexOf('/', i + 1);
    const upto = slashAt === -1 || slashAt >= chunkEnd ? chunkEnd : slashAt;
    out += text.slice(i, Math.max(upto, i + 1));
    i = Math.max(upto, i + 1);
  }
  return out;
}

/**
 * References to `name` in PRODUCTION source anywhere in the repo — including
 * the declaring package, which an earlier draft of this validator wrongly
 * excluded. Excluding it reported 245 symbols, most of them functions used
 * heavily inside their own package and merely re-exported for API
 * completeness; that is not dead code and reporting it is how a check gets
 * waived. What is left is the real class: exported, tested, and called from
 * NOWHERE that ships.
 *
 * Excluded: the declaration's own file (it necessarily contains the name),
 * every barrel (re-export plumbing is not use), and every test (a test
 * exercising an otherwise-uncalled mechanism is precisely the disguise this
 * defect class wears — W11-04's `secretValues` had tests and no callers).
 */
export function countReferences(name, files, contentsByFile, declFile, cache = new Map()) {
  // STRIPPING LIVES HERE, not in the caller (W12-39). It was in
  // `findUnreferencedExports` first, which meant the guarantee "a comment is
  // not a caller" held only as long as every future caller remembered to
  // pre-strip — and a fixture written against this function passed while
  // proving nothing. Cached so the work is still done once per file per run.
  const code = (file) => {
    if (!cache.has(file)) cache.set(file, stripComments(contentsByFile.get(file) ?? ''));
    return cache.get(file);
  };
  const pattern = new RegExp(`\\b${name}\\b`);
  let production = 0;
  // Split out so the report can tell "nothing calls this" from "nothing
  // OUTSIDE its own file calls this" (W22-02). The second is a weaker finding
  // — the code is used — but an export nobody imports is still surface that
  // does not need to be public. `production` stays inFile + external so every
  // existing caller and both calibrated baselines are unaffected.
  let inFile = 0;
  let external = 0;
  let tests = 0;
  const testFiles = [];
  const globalPattern = new RegExp(`\\b${name}\\b`, 'g');
  for (const file of files) {
    if (declFile && path.resolve(file) === path.resolve(declFile)) {
      // NOT skipped outright — that was the systematic false positive. A
      // symbol whose only production consumer is a sibling factory in its own
      // file (`createMacKeychainCredentialStore`, called by
      // `resolveCredentialStore` beside it) is used, not dead. The
      // declaration itself accounts for exactly one occurrence, so more than
      // one means something in the file actually calls it.
      const occurrences = (code(file).match(globalPattern) ?? []).length;
      if (occurrences > 1) {
        production++;
        inFile++;
      }
      continue;
    }
    if (isBarrel(file)) continue;
    if (!pattern.test(code(file))) continue;
    if (isTestFile(file)) {
      tests++;
      testFiles.push(path.relative(REPO_ROOT, file));
    } else {
      production++;
      external++;
    }
  }
  return { production, tests, testFiles, inFile, external };
}

/**
 * Value symbols a MODULE exports that its package barrel does not (W12-38).
 *
 * THE BLIND SPOT THIS CLOSES, in the shape of the check's own defect class:
 * `exportsOfBarrel` sees only what a barrel publishes, so a complete, tested
 * engine never added to the barrel is invisible. The instance that exposed it
 * is `runEscalationPolicy` — the D-024 option (b) state machine, tested, with
 * no caller anywhere, absent from every report while the validator printed 43
 * gaps. That is the WORSE case, not a lesser one: an uncalled export is
 * reachable and unused, while an unexported implementation cannot be adopted
 * without a separate barrel change — how W12-04's packer sat dormant.
 *
 * Parsed, not type-checked: this needs the names a file declares with
 * `export`, which `ts.createSourceFile` gives for the price of a parse. There
 * is no `export *` to resolve here — that is the barrel pass's job.
 */
