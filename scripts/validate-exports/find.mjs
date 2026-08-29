// Chapter of `validate-exports.mjs` (W22-02 split): the two passes and the
// four degrees of "unreached" they sort every export into.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { REPO_ROOT, SCAN_ROOTS, isBarrel, isTestFile, isTestSupportFile, walkSourceFiles } from './files.mjs';
import { countReferences } from './strip.mjs';
import { exportsOfBarrel, moduleExports, unreachedMarkers } from './symbols.mjs';

export function findUnreferencedExports({ packagesDir = path.join(REPO_ROOT, 'packages') } = {}) {
  const files = SCAN_ROOTS.flatMap((root) => walkSourceFiles(path.join(REPO_ROOT, root)));
  const contentsByFile = new Map();
  for (const file of files) {
    try {
      contentsByFile.set(file, readFileSync(file, 'utf8'));
    } catch {
      contentsByFile.set(file, '');
    }
  }

  /** One strip per file for the whole run, shared by both passes. */
  const stripCache = new Map();
  // Markers are read from the RAW text, not the stripped copy — they live in
  // comments, which is the only place they could live.
  const suppressions = new Map();
  const malformedMarkers = [];
  for (const [file, text] of contentsByFile) {
    // A marker in a test file suppresses nothing: a test cannot be the reason
    // production code is allowed to have no caller.
    if (isTestFile(file)) continue;
    const { markers, malformed } = unreachedMarkers(text);
    const rel = path.relative(REPO_ROOT, file);
    for (const [symbol, reason] of markers) suppressions.set(symbol, { reason, file: rel });
    for (const symbol of malformed) malformedMarkers.push({ symbol, file: rel });
  }
  const suppressed = [];
  /** Referenced by NOTHING — not even a test. Reported apart from the tested-but-uncalled set. */
  const unreferenced = [];
  /** Used only inside its own declaring file: real code, unnecessary export. */
  const moduleLocal = [];
  const findings = [];
  /** Names the barrel pass already judged — the buried pass must not re-report them. */
  const published = new Set();
  const packages = readdirSync(packagesDir).filter((entry) => {
    try {
      return statSync(path.join(packagesDir, entry, 'src', 'index.ts')).isFile();
    } catch {
      return false;
    }
  });

  for (const pkg of packages) {
    const barrel = path.join(packagesDir, pkg, 'src', 'index.ts');
    for (const { name, declFile } of exportsOfBarrel(barrel)) {
      const { production, tests, testFiles, external } = countReferences(
        name,
        files,
        contentsByFile,
        declFile,
        stripCache,
      );
      published.add(name);
      const mark = suppressions.get(name);
      if (mark && (production === 0 || external === 0)) {
        suppressed.push({ package: pkg, symbol: name, reason: mark.reason, at: mark.file });
        continue;
      }
      // TESTED BUT NEVER CALLED — the signal, and the reason this is narrower
      // than "referenced nowhere" (135 symbols, with visible false positives
      // from sibling factories in a symbol's own file). A symbol with tests
      // proving it works and NO production caller is a mechanism someone
      // built, verified, and never wired — exactly W11-04, W11-16, W12-04
      // and W12-05.
      if (production === 0 && tests > 0) {
        findings.push({ package: pkg, symbol: name, tests, testFiles });
      } else if (production === 0 && tests === 0) {
        // NO CALLER ANYWHERE (W22-02, criterion 4). Kept out of `findings` on
        // purpose: the baselines above are calibrated on the tested-but-
        // uncalled set, and folding a new category into them would move a
        // number two gates depend on. Reported, not gated — for now.
        unreferenced.push({ package: pkg, symbol: name, scope: 'published' });
      } else if (external === 0) {
        // NO CALLER OUTSIDE ITS OWN FILE. The code is used, so this is the
        // weakest of the three; it says the export is unnecessary, not that
        // the work is dead.
        moduleLocal.push({ package: pkg, symbol: name, scope: 'published' });
      }
    }
  }

  // W12-38: the same test, one layer deeper — module exports the barrel never
  // published. Reported SEPARATELY rather than folded into `findings`, because
  // the two have different remedies (wire it up vs. wire it up AND export it)
  // and because merging them would silently move the calibrated 43 baseline.
  const buried = [];
  for (const file of files) {
    if (isTestFile(file) || isBarrel(file) || isTestSupportFile(file)) continue;
    const rel = path.relative(REPO_ROOT, file);
    if (!rel.startsWith(`packages${path.sep}`)) continue;
    const pkg = rel.split(path.sep)[1];
    for (const name of moduleExports(file, contentsByFile.get(file))) {
      // Already judged by the barrel pass; reporting it twice would double-count
      // the debt and make the two numbers impossible to read against each other.
      if (published.has(name)) continue;
      const { production, tests, external } = countReferences(name, files, contentsByFile, file, stripCache);
      const mark = suppressions.get(name);
      if (mark && (production === 0 || external === 0)) {
        suppressed.push({ package: pkg, symbol: name, reason: mark.reason, at: mark.file });
        continue;
      }
      if (production === 0 && tests > 0) buried.push({ package: pkg, symbol: name, file: rel });
      else if (production === 0 && tests === 0) unreferenced.push({ package: pkg, symbol: name, file: rel, scope: 'module' });
      else if (external === 0) moduleLocal.push({ package: pkg, symbol: name, file: rel, scope: 'module' });
    }
  }

  return {
    findings,
    buried,
    unreferenced,
    moduleLocal,
    suppressed,
    malformedMarkers,
    scanned: files.length,
    packages: packages.length,
  };
}
