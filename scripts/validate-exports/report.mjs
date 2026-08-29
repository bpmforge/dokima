// Chapter of `validate-exports.mjs` (W22-02 split): the two calibrated
// ratchets, the report categories that deliberately gate nothing, and the CLI.
import { findUnreferencedExports } from './find.mjs';

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

/** W12-38's own baseline. Separate flag, separate number: the two passes have different remedies and merging them would silently move the calibrated 43. */
export const BURIED_BASELINE_FLAG = '--max-buried';

export function main() {
  const jsonOnly = process.argv.includes('--json');
  const maxIndex = process.argv.indexOf(BASELINE_FLAG);
  const max = maxIndex === -1 ? null : Number(process.argv[maxIndex + 1]);
  const buriedIndex = process.argv.indexOf(BURIED_BASELINE_FLAG);
  const maxBuried = buriedIndex === -1 ? null : Number(process.argv[buriedIndex + 1]);
  const { findings, buried, unreferenced, moduleLocal, suppressed, malformedMarkers, scanned, packages } =
    findUnreferencedExports();

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
    const buriedByPackage = new Map();
    for (const finding of buried) {
      if (!buriedByPackage.has(finding.package)) buriedByPackage.set(finding.package, []);
      buriedByPackage.get(finding.package).push(`${finding.symbol}  (${finding.file})`);
    }
    for (const [pkg, symbols] of [...buriedByPackage].sort()) {
      console.log(`  ${pkg}: ${symbols.length} module export(s) the barrel never published`);
      for (const symbol of symbols.sort()) console.log(`    - ${symbol}`);
    }
    // NO CALLER ANYWHERE — named in full. Measured at 4, small enough that a
    // name is more useful than a count, and the purest form of the class:
    // nothing calls it and no test claims it works.
    if (unreferenced.length) {
      console.log(`  ${unreferenced.length} export(s) referenced by NOTHING — not even a test:`);
      for (const u of [...unreferenced].sort((a, b) => `${a.package}${a.symbol}`.localeCompare(`${b.package}${b.symbol}`))) {
        console.log(`    - ${u.package}: ${u.symbol}${u.file ? `  (${u.file})` : '  (published by the barrel)'}`);
      }
    }
    // NO CALLER OUTSIDE ITS OWN FILE — a COUNT, deliberately. Measured at 182:
    // the code is used, so this says an export is unnecessary rather than that
    // work is dead, and 182 names would drown the two categories that matter.
    // `--json` carries them for anyone actually working the list.
    if (moduleLocal.length) {
      console.log(
        `  ${moduleLocal.length} export(s) with no caller outside their own file ` +
          `(used, but need not be exported; names in --json)`,
      );
    }
    if (suppressed.length) {
      console.log(`  ${suppressed.length} export(s) deliberately unreached, with a recorded reason:`);
      for (const sup of suppressed) console.log(`    - ${sup.package}: ${sup.symbol} — ${sup.reason}`);
    }
    console.log(
      `Inventory: ${packages} package barrels - ${scanned} source files scanned - ` +
        `${findings.length} export(s) with no non-test caller outside their own package - ` +
        `${buried.length} tested module export(s) with no caller AND no barrel entry`,
    );
  }
  const over = max !== null && Number.isFinite(max) && findings.length > max;
  const overBuried =
    maxBuried !== null && Number.isFinite(maxBuried) && buried.length > maxBuried;
  console.log(
    JSON.stringify({
      validator: 'validate-exports',
      gaps: findings.length,
      buried: buried.length,
      exit: over || overBuried ? 1 : 0,
      items: findings.map((f) => `${f.package}: ${f.symbol}`),
      buriedItems: buried.map((f) => `${f.package}: ${f.symbol}`),
      unreferenced: unreferenced.map((f) => `${f.package}: ${f.symbol}`),
      moduleLocal: moduleLocal.map((f) => `${f.package}: ${f.symbol}`),
      suppressed: suppressed.map((f) => `${f.package}: ${f.symbol} — ${f.reason}`),
    }),
  );
  // A MALFORMED MARKER FAILS, and this is a safe thing to fail on in the same
  // change that introduces the marker: there are zero of them today, so it
  // cannot make an existing gate red. `@unreached Foo` with no reason is
  // someone reaching for the suppression and not finishing the sentence —
  // exactly the prose-intent-as-control this validator replaces.
  if (malformedMarkers.length) {
    console.error(
      `FAIL: ${malformedMarkers.length} @unreached marker(s) carry no reason: ` +
        malformedMarkers.map((m) => `${m.symbol} (${m.file})`).join(', ') +
        `. Write "@unreached <Symbol>: <why nothing calls it>" — a suppression ` +
        `with no recorded reason is indistinguishable from an accident.`,
    );
    process.exit(1);
  }
  if (overBuried) {
    console.error(
      `FAIL: ${buried.length} module export(s) are tested, called by no production ` +
        `code, and absent from their package barrel, over the baseline of ` +
        `${maxBuried}. That is the WORSE shape of the defect: not merely unused, ` +
        `but unreachable without a separate barrel change — how W12-04's packer ` +
        `and W12-09's code index each stayed dormant for waves. Wire it up, or ` +
        `stop exporting it; do not raise the baseline.`,
    );
    process.exit(1);
  }
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
