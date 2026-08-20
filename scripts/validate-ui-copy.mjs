#!/usr/bin/env node
/**
 * validate-ui-copy.mjs — mechanical comprehension checks (W13-56).
 *
 * Layer 1 of docs/design/DESIGN_REVIEW_LOOP.md: the audit findings that need
 * no judgment must never spend a model. Two checks:
 *
 * CHECK 1 — instruction ↔ surface. Every string of the form "Settings → X"
 * in shipped source must name a Settings tab that exists. This class shipped
 * twice before it had a guard: W13-34 wrote "Settings → Models" (the tab is
 * "Model Matrix"), and the first run of THIS validator found a second the
 * manual audit missed — "Settings → Autonomy dial" against a tab labeled
 * "Autonomy · Budget · Berths". An instruction the product contradicts is
 * worse than no instruction.
 *
 * CHECK 2 — the vocabulary law. VOCABULARY.md's "Not" column is parsed into
 * a forbidden lexicon over apps/web source (comments stripped, so a doc
 * comment may still *discuss* a banned word). v1 enforces only terms that
 * cannot be legitimate in user copy — multiword phrases plus a safe singles
 * list — because a lexicon that cries wolf gets deleted, not obeyed.
 *
 * Baseline (`scripts/ui-copy-baseline.json`), history-secrets style: known
 * violations are named with their owning ticket so main stays green while
 * the debt is visible and NEW drift gates immediately. A baseline entry that
 * no longer matches anything fails the run — stale baselines rot into
 * permission slips.
 *
 * Contract: validate-exports.mjs precedent — pure functions exported for
 * tests, main() prints human lines plus one JSON line, exit 0/1.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { stripComments } from './validate-exports.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SETTINGS_PAGE = 'apps/web/src/settings/SettingsPage.tsx';
const VOCAB = 'docs/design/VOCABULARY.md';
const BASELINE = 'scripts/ui-copy-baseline.json';
const SCAN_ROOTS = ['apps/web/src', 'apps/server/src'];

/** Trailing words that are prose continuation, not part of a tab name ("Settings → Models to choose one"). */
const STOP_WORDS = new Set(['to', 'and', 'or', 'for', 'in', 'the', 'a', 'so', 'first']);

/**
 * Forbidden single words safe to enforce: distinctive enough that any
 * occurrence in web source is the banned sense. Deliberately NOT every
 * single-word "Not" entry — "run"/"log"/"record" are ordinary words and a
 * guard that flags them would be deleted within a week.
 */
const SAFE_SINGLES = new Set(['swimlane', 'kanban', 'dashboard']);

/** Tab labels, plus each label's first "·"-segment ("Autonomy · Budget · Berths" is findable as "Autonomy"). */
export function parseSettingsLabels(source) {
  const labels = new Set();
  for (const match of source.matchAll(/label:\s*'([^']+)'/g)) {
    labels.add(match[1]);
    const first = match[1].split('·')[0].trim();
    if (first) labels.add(first);
  }
  return labels;
}

/** Every "Settings → X" / "Settings -> X" target in a source text, prose tails trimmed. */
export function extractInstructions(text) {
  const out = [];
  for (const match of text.matchAll(/Settings (?:→|->) ([A-Za-z][A-Za-z ·]*)/g)) {
    const words = match[1].trim().split(/\s+/);
    // Cut at the FIRST stop-word: "Models to choose one" is the instruction
    // "Models" plus prose. Trailing-only trimming was the first version and
    // this file's own red fixture caught it — the real tree happened to pass
    // because string concatenation ended the literal right after "to".
    const kept = [];
    for (const word of words) {
      if (kept.length > 0 && STOP_WORDS.has(word)) break;
      kept.push(word);
    }
    out.push(kept.join(' ').replace(/[.,]$/, ''));
  }
  return out;
}

/** Rows of VOCABULARY.md's table -> forbidden terms (multiword, or safe singles). */
export function lexiconFromVocab(markdown) {
  const lexicon = [];
  for (const line of markdown.split('\n')) {
    const cells = line.split('|').map((c) => c.trim());
    // | Concept | Use | Not | -> 5 cells with empty ends; skip header/divider.
    if (cells.length < 5 || cells[3] === 'Not' || cells[3].startsWith('---')) continue;
    for (const raw of cells[3].split(',')) {
      const term = raw.trim().toLowerCase();
      if (!term) continue;
      if (term.includes(' ') || term.includes('-') || SAFE_SINGLES.has(term)) {
        lexicon.push(term);
      }
    }
  }
  return lexicon;
}

/** Case-insensitive whole-word occurrences of lexicon terms in comment-stripped source. */
export function scanForLexicon(text, lexicon) {
  const stripped = stripComments(text);
  const hits = [];
  for (const term of lexicon) {
    // Optional plural: "Your swimlanes" is the banned word wearing an s.
    const re = new RegExp(`\\b${term.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&')}s?\\b`, 'gi');
    if (re.test(stripped)) hits.push(term);
  }
  return hits;
}

function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === 'node_modules' || entry === 'dist') continue;
      yield* walk(full);
    } else if (/\.(ts|tsx)$/.test(entry) && !/\.test\./.test(entry)) {
      yield full;
    }
  }
}

export function runChecks(root = REPO_ROOT) {
  const labels = parseSettingsLabels(readFileSync(path.join(root, SETTINGS_PAGE), 'utf8'));
  const lexicon = lexiconFromVocab(readFileSync(path.join(root, VOCAB), 'utf8'));
  const violations = [];

  for (const scanRoot of SCAN_ROOTS) {
    for (const file of walk(path.join(root, scanRoot))) {
      const rel = path.relative(root, file);
      const text = readFileSync(file, 'utf8');
      for (const target of extractInstructions(stripComments(text))) {
        if (!labels.has(target)) {
          violations.push({
            check: 'instruction-surface',
            value: `Settings → ${target}`,
            file: rel,
          });
        }
      }
      // Vocabulary is a UI law; enforce it where users read — the web tree.
      if (scanRoot === 'apps/web/src') {
        for (const term of scanForLexicon(text, lexicon)) {
          violations.push({ check: 'vocabulary', value: term, file: rel });
        }
      }
    }
  }
  return violations;
}

export function applyBaseline(violations, baseline) {
  const keyOf = (v) => `${v.check}|${v.value}|${v.file}`;
  const live = new Set(violations.map(keyOf));
  const baselined = new Set(baseline.entries.map((e) => `${e.check}|${e.value}|${e.file}`));
  const fresh = violations.filter((v) => !baselined.has(keyOf(v)));
  const stale = baseline.entries.filter(
    (e) => !live.has(`${e.check}|${e.value}|${e.file}`),
  );
  return { fresh, stale };
}

function main() {
  const violations = runChecks();
  const baseline = JSON.parse(readFileSync(path.join(REPO_ROOT, BASELINE), 'utf8'));
  const { fresh, stale } = applyBaseline(violations, baseline);

  for (const v of fresh) {
    console.log(`  [${v.check}] "${v.value}" — ${v.file}`);
  }
  for (const e of stale) {
    console.log(
      `  [stale-baseline] "${e.value}" (${e.file}) no longer occurs — remove its entry (${e.ticket})`,
    );
  }
  const exit = fresh.length > 0 || stale.length > 0 ? 1 : 0;
  console.log(
    exit === 0
      ? `OK: ui-copy — ${violations.length} known (baselined), 0 new`
      : `FAIL: ui-copy — ${fresh.length} new violation(s), ${stale.length} stale baseline entr(ies)`,
  );
  console.log(
    JSON.stringify({ validator: 'validate-ui-copy', fresh: fresh.length, stale: stale.length, baselined: violations.length - fresh.length, exit }),
  );
  process.exit(exit);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main();
}
