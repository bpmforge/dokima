#!/usr/bin/env node
// validate-exports.mjs — the no-callers validator (W12-10).
//
// THE DEFECT CLASS: a mechanism lands complete, tested, with a documented
// contract and NO production caller, and stays green forever because nothing
// in the gate can see an exported interface that nothing calls. Six shipped
// instances by 2026-08-13 (W11-04 `RunSessionInput.secretValues`, W11-16's
// wrap-`spawn`, W12-08's `HandoffBuilder` override, W12-04's `packer/`
// barrel, W12-05's `anchors.ts`, the 93-expert roster) — three of them in a
// single dependency chain, and two SELF-DOCUMENTED with a "a future ticket
// wires this up" comment against a ticket that did not exist. Prose intent
// is not a control; this is.
//
// Exports are enumerated through the TypeScript checker (not a regex over
// barrel files) because every package barrel re-exports with `export * from`,
// so the symbol names do not appear in the barrel's own text at all.
//
// References are counted by word-boundary text match, which is a heuristic
// and is stated as one: it OVER-counts (a comment mentioning a name reads as
// a use), so a symbol this validator reports as unreferenced is unreferenced
// under a deliberately generous test. False NEGATIVES are the acceptable
// direction here; false positives would get the whole check waived.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(HERE, '..');

const SOURCE_EXTENSIONS = ['.ts', '.tsx', '.mts', '.mjs'];
const SCAN_ROOTS = ['apps', 'packages', 'scripts'];
const IGNORED_DIRS = new Set(['node_modules', 'dist', 'build', '.git', 'coverage']);

/** A file whose only purpose is to exercise code cannot establish that the code is used. */
export function isTestFile(file) {
  return /\.(test|spec)\.(ts|tsx|mts|mjs)$/.test(file) || /(^|\/)e2e\//.test(file);
}

/** A barrel re-export is plumbing, never evidence of a consumer. */
export function isBarrel(file) {
  return /(^|\/)index\.ts$/.test(file);
}

export function walkSourceFiles(root, acc = []) {
  let entries;
  try {
    entries = readdirSync(root);
  } catch {
    return acc;
  }
  for (const entry of entries) {
    if (IGNORED_DIRS.has(entry)) continue;
    const full = path.join(root, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) walkSourceFiles(full, acc);
    else if (SOURCE_EXTENSIONS.includes(path.extname(entry))) acc.push(full);
  }
  return acc;
}

/**
 * Public surface of one package: the symbols a consumer can actually import.
 * Resolved through the checker so `export * from './packer/index.js'` yields
 * the symbols behind it — the exact case W12-04 turned on.
 */
export function exportsOfBarrel(barrelPath) {
  const program = ts.createProgram([barrelPath], {
    allowJs: false,
    noEmit: true,
    module: ts.ModuleKind.NodeNext,
    moduleResolution: ts.ModuleResolutionKind.NodeNext,
    target: ts.ScriptTarget.ES2022,
    skipLibCheck: true,
  });
  const checker = program.getTypeChecker();
  const source = program.getSourceFile(barrelPath);
  if (!source) return [];
  const moduleSymbol = checker.getSymbolAtLocation(source);
  if (!moduleSymbol) return [];
  return checker
    .getExportsOfModule(moduleSymbol)
    .filter((symbol) => {
      // VALUE EXPORTS ONLY, and this is the calibration that makes the check
      // usable rather than noise. The first run reported 529 findings —
      // instantly waivable, which is how a validator dies. The overwhelming
      // majority were interfaces and type aliases, and a type nobody names is
      // harmless: it costs nothing at runtime and disappears at compile time.
      // A FUNCTION nobody calls is dead code. That is the defect class, so
      // that is what this reports. `ts.SymbolFlags.Value` is the distinction,
      // taken from the checker rather than guessed from the name.
      const flags = symbol.getFlags();
      const resolved =
        flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol;
      return (resolved.getFlags() & ts.SymbolFlags.Value) !== 0;
    })
    .map((symbol) => {
      const resolved =
        symbol.getFlags() & ts.SymbolFlags.Alias
          ? checker.getAliasedSymbol(symbol)
          : symbol;
      const declaration = resolved.declarations?.[0];
      return {
        name: symbol.getName(),
        declFile: declaration ? declaration.getSourceFile().fileName : null,
      };
    })
    .filter(
      (entry) =>
        entry.name !== 'default' &&
        // Every package declares one as a scaffold marker; being uncalled is
        // its entire nature, so reporting all twelve is pure noise.
        entry.name !== 'PACKAGE_NAME' &&
        /^[A-Za-z_$][\w$]*$/.test(entry.name),
    );
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
function countReferences(name, files, contentsByFile, declFile) {
  const pattern = new RegExp(`\\b${name}\\b`);
  let production = 0;
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
      const occurrences = (contentsByFile.get(file).match(globalPattern) ?? []).length;
      if (occurrences > 1) production++;
      continue;
    }
    if (isBarrel(file)) continue;
    if (!pattern.test(contentsByFile.get(file))) continue;
    if (isTestFile(file)) {
      tests++;
      testFiles.push(path.relative(REPO_ROOT, file));
    } else {
      production++;
    }
  }
  return { production, tests, testFiles };
}

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

  const findings = [];
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
      const { production, tests, testFiles } = countReferences(
        name,
        files,
        contentsByFile,
        declFile,
      );
      // TESTED BUT NEVER CALLED — the signal, and the reason this is narrower
      // than "referenced nowhere" (135 symbols, with visible false positives
      // from sibling factories in a symbol's own file). A symbol nothing
      // references at all is unused API surface: harmless, and too noisy to
      // gate on. A symbol with tests proving it works and NO production
      // caller is a mechanism someone built, verified, and never wired —
      // exactly W11-04, W11-16, W12-04 and W12-05.
      if (production === 0 && tests > 0) {
        findings.push({ package: pkg, symbol: name, tests, testFiles });
      }
    }
  }
  return { findings, scanned: files.length, packages: packages.length };
}

/**
 * A RATCHET, not a clean-zero gate. The measured baseline is real debt this
 * repo already carries; failing every ticket for it is the mistake
 * `conductor.config.json`'s own `repoWide` note warns about ("only honest
 * while it reports ZERO — otherwise every ticket fails for debt it did not
 * create"). A baseline the count may not EXCEED gives the property that
 * actually matters: the next mechanism wired to nothing fails the gate that
 * files it, while the existing backlog stays visible and non-blocking.
 * Lower it whenever the count drops; never raise it to make a ticket pass.
 */
export const BASELINE_FLAG = '--max';

function main() {
  const jsonOnly = process.argv.includes('--json');
  const maxIndex = process.argv.indexOf(BASELINE_FLAG);
  const max = maxIndex === -1 ? null : Number(process.argv[maxIndex + 1]);
  const { findings, scanned, packages } = findUnreferencedExports();

  if (!jsonOnly) {
    const byPackage = new Map();
    for (const finding of findings) {
      if (!byPackage.has(finding.package)) byPackage.set(finding.package, []);
      byPackage.get(finding.package).push(finding.symbol);
    }
    for (const [pkg, symbols] of [...byPackage].sort()) {
      console.log(`  ${pkg}: ${symbols.length} unreferenced export(s)`);
      for (const symbol of symbols.sort()) console.log(`    - ${symbol}`);
    }
    console.log(
      `Inventory: ${packages} package barrels - ${scanned} source files scanned - ` +
        `${findings.length} export(s) with no non-test caller outside their own package`,
    );
  }
  const over = max !== null && Number.isFinite(max) && findings.length > max;
  console.log(
    JSON.stringify({
      validator: 'validate-exports',
      gaps: findings.length,
      exit: over ? 1 : 0,
      items: findings.map((f) => `${f.package}: ${f.symbol}`),
    }),
  );
  if (over) {
    console.error(
      `FAIL: ${findings.length} exported symbol(s) are tested but called from no ` +
        `production code, over the baseline of ${max}. Something was built, ` +
        `verified, and wired to nothing — the defect class W12-10 exists to catch. ` +
        `Wire it up or stop exporting it; do not raise the baseline.`,
    );
    process.exit(1);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) main();
