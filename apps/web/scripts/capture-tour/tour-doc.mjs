/**
 * Renders `docs/tour/TOUR.md` from the two passes' captured steps and the
 * coverage tracker's final report (W10-37 AC4 — the sweep's own coverage,
 * not just the images).
 */

export function buildTourMarkdown(lightSteps, darkSteps, coverage) {
  const coverageTable = [
    '| State | Status | Notes |',
    '|---|---|---|',
    ...coverage.map(
      (c) =>
        `| \`${c.id}\` | ${c.status.toUpperCase()} | ${c.reason ? c.reason.replace(/\|/g, '\\|') : ''} |`,
    ),
  ].join('\n');

  return [
    '# Dokima — screenshot tour',
    '',
    'A scribe-style walkthrough of the shipped product, captured against the',
    'real server + real event log with zero mocks (Law 9 local-first: no',
    'network, throwaway `.dokima` home). Two independent passes — light theme',
    '(the main walkthrough below) and dark theme (`img/dark/`, a second fresh',
    'app instance) — plus every Settings tab in both themes. Regenerate any',
    'time with:',
    '',
    '```sh',
    'node apps/web/scripts/capture-tour/index.mjs   # always rebuilds dist/ first',
    '```',
    '',
    ...lightSteps.flatMap((s, i) => [
      `## Step ${i + 1} — ${s.title}`,
      '',
      s.caption,
      '',
      `![${s.title}](img/${s.file})`,
      '',
    ]),
    '## Dark theme & Settings sweep',
    '',
    'Independently verified in dark theme against a fresh app instance: the',
    'two states above whose emptiness matters (Fleet home, unseeded',
    'workspace) plus every Settings tab.',
    '',
    ...darkSteps.flatMap((s) => [
      `### ${s.title}`,
      '',
      s.caption,
      '',
      `![${s.title}](img/${s.file})`,
      '',
    ]),
    '## Coverage',
    '',
    'Every state this sweep declared it would cover, and what happened to it',
    '(W10-37 AC4 — a sweep that cannot report its own coverage cannot sign off',
    'UX_SPEC §2b). `WAIVED` states are real, tested components with no route',
    'that reaches them yet; see the reason column.',
    '',
    coverageTable,
    '',
  ].join('\n');
}
