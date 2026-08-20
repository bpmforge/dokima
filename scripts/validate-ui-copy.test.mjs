/**
 * W13-56. The mechanical half of the design-review loop: contradictions a
 * product ships about itself, caught with no model at all.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  applyBaseline,
  extractInstructions,
  lexiconFromVocab,
  parseSettingsLabels,
  runChecks,
  scanForLexicon,
} from './validate-ui-copy.mjs';

const LABELS_SRC = `
const PROJECT_TABS = [
  { id: 'providers', label: 'Providers' },
  { id: 'autonomy-budget', label: 'Autonomy · Budget · Berths' },
];`;

describe('instruction ↔ surface (check 1)', () => {
  it('RED FIXTURE: an instruction naming a tab that does not exist is extracted intact', () => {
    // The two REAL shapes this check exists for, verbatim from the tree the
    // day it was written: W13-34's error copy and the wizard's tomorrow card.
    const src = `
      'no model is configured yet. Open Settings → Models to choose one'
      <p>(Settings → Autonomy dial). Tomorrow morning…</p>
      <p>finish this one in Settings → Providers, or pick another.</p>`;
    expect(extractInstructions(src)).toEqual([
      'Settings → Models',
      'Settings → Autonomy dial',
      'Settings → Providers',
    ].map((s) => s.replace('Settings → ', '')));
  });

  it('labels include each "·" first segment, so "Autonomy" is findable', () => {
    const labels = parseSettingsLabels(LABELS_SRC);
    expect(labels.has('Providers')).toBe(true);
    expect(labels.has('Autonomy · Budget · Berths')).toBe(true);
    expect(labels.has('Autonomy')).toBe(true);
    // But the internal name is NOT a label — the whole point.
    expect(labels.has('Autonomy dial')).toBe(false);
  });
});

describe('vocabulary law (check 2)', () => {
  const VOCAB = `
| Concept | Use | Not |
|---|---|---|
| A vertical grouping of tickets | **lane** | swimlane, track, column-group |
| The collection of projects | **Fleet** | dashboard, home, projects list |
| One pass of the agent working the board | **run** | session, job, execution |`;

  it('takes multiword phrases and safe singles; leaves ordinary words alone', () => {
    const lexicon = lexiconFromVocab(VOCAB);
    expect(lexicon).toContain('swimlane');
    expect(lexicon).toContain('column-group');
    expect(lexicon).toContain('projects list');
    expect(lexicon).toContain('dashboard');
    // "session"/"job"/"track"/"home" are ordinary words — a guard that flags
    // them gets deleted, not obeyed.
    expect(lexicon).not.toContain('session');
    expect(lexicon).not.toContain('home');
    expect(lexicon).not.toContain('track');
  });

  it('RED FIXTURE: a banned term in copy is caught; the same term in a comment is not', () => {
    const lexicon = lexiconFromVocab(VOCAB);
    expect(scanForLexicon(`<h2>Your swimlanes</h2>`, lexicon)).toEqual(['swimlane']);
    expect(scanForLexicon(`// swimlane is the banned word for lane`, lexicon)).toEqual([]);
  });
});

describe('baseline discipline', () => {
  it('a baselined violation passes, a new one fails, a stale entry fails', () => {
    const known = { check: 'vocabulary', value: 'swimlane', file: 'a.tsx' };
    const fresh = { check: 'vocabulary', value: 'dashboard', file: 'b.tsx' };
    const baseline = {
      entries: [known, { check: 'vocabulary', value: 'gone', file: 'c.tsx', ticket: 'W-X' }],
    };
    const result = applyBaseline([known, fresh], baseline);
    expect(result.fresh).toEqual([fresh]);
    expect(result.stale.map((e) => e.value)).toEqual(['gone']);
  });
});

describe('this repo', () => {
  it('every live violation is baselined with an owning ticket — new drift gates immediately', () => {
    const violations = runChecks();
    const baseline = JSON.parse(
      readFileSync(new URL('./ui-copy-baseline.json', import.meta.url), 'utf8'),
    );
    const { fresh, stale } = applyBaseline(violations, baseline);
    expect(fresh).toEqual([]);
    expect(stale).toEqual([]);
    for (const entry of baseline.entries) expect(entry.ticket).toMatch(/^W\d+-\d+$/);
  }, 30_000);
});
