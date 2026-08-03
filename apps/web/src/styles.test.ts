/**
 * W9-04: unify control styling — every plain `<button>` across the app
 * (forms, drawer, trace, plans, settings, etc.) should share ONE styled
 * treatment, matching the header's existing `.theme-toggle` pill, in both
 * themes.
 *
 * W10-06 adds the design-token gate below. jsdom doesn't run a real CSS
 * cascade (default `test.css: false` here — no vite/postcss pass over
 * stylesheet imports), so `getComputedStyle` can't see rules from
 * `styles.css` and would be a tautology. Instead this guards the textual
 * contract directly, same technique as `board/Lane.test.tsx`'s W9-05
 * edge-fade check: read the raw stylesheets and assert on their source.
 */
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const testDir = path.dirname(fileURLToPath(import.meta.url));
const css = readFileSync(path.join(testDir, 'styles.css'), 'utf-8');

function ruleBody(selector: string): string {
  const start = css.indexOf(`${selector} {`);
  expect(start, `expected to find a "${selector}" rule in styles.css`).toBeGreaterThan(
    -1,
  );
  const end = css.indexOf('}', start);
  return css.slice(start, end + 1);
}

describe('shared button treatment (W9-04)', () => {
  it('gives every plain <button> the header pill styling by default', () => {
    const buttonRule = ruleBody('button');
    expect(buttonRule).toMatch(
      /border:\s*var\(--sw-border-width\) solid var\(--sw-border\)/,
    );
    expect(buttonRule).toMatch(/background:\s*transparent/);
    expect(buttonRule).toMatch(/color:\s*var\(--sw-fg\)/);
    // W10-06: was a literal `6px`. The repo's only design assertion used
    // to pin a magic number, which meant the radius scale could drift
    // from the one value a test claimed to protect.
    expect(buttonRule).toMatch(/border-radius:\s*var\(--sw-radius-md\)/);
    expect(buttonRule).toMatch(/cursor:\s*pointer/);
  });

  it('gives disabled buttons a visibly distinct (but not hidden) state', () => {
    const disabledRule = ruleBody('button:disabled');
    expect(disabledRule).toMatch(/opacity:/);
    expect(disabledRule).toMatch(/cursor:\s*not-allowed/);
  });

  it('matches the header theme-toggle pill exactly — one treatment, not two', () => {
    const buttonRule = ruleBody('button');
    const themeToggleRule = ruleBody('.theme-toggle');
    for (const prop of [
      'border',
      'background',
      'color',
      'border-radius',
      'padding',
      'cursor',
    ]) {
      const buttonDecl = buttonRule.match(new RegExp(`${prop}:[^;]+;`))?.[0];
      const toggleDecl = themeToggleRule.match(new RegExp(`${prop}:[^;]+;`))?.[0];
      expect(buttonDecl, `button rule missing "${prop}"`).toBeDefined();
      expect(toggleDecl, `.theme-toggle rule missing "${prop}"`).toBeDefined();
      expect(buttonDecl).toBe(toggleDecl);
    }
  });

  it('is theme-safe: driven only by --sw-* tokens, no hardcoded colors', () => {
    const buttonRule = ruleBody('button');
    const disabledRule = ruleBody('button:disabled');
    expect(buttonRule).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(disabledRule).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    // The tokens the button rule leans on both flip under
    // :root[data-theme='dark'] — confirms both themes are covered by
    // construction, not by eyeballing a screenshot.
    expect(css).toMatch(/:root\[data-theme='dark'\][^}]*--sw-border:/s);
    expect(css).toMatch(/:root\[data-theme='dark'\][^}]*--sw-fg:/s);
  });
});

/* ── W10-06: the design-token gate ───────────────────────────────────
   A raw hex in a feature stylesheet cannot respond to the `data-theme`
   flip — it is frozen to whichever theme its author happened to be
   looking at. That is not hypothetical: this gate was written against
   54 such declarations across 14 files, six of which were live WCAG AA
   contrast failures in the dark theme.

   So: hex colours are legal ONLY on a `--sw-*` token definition line in
   `styles.css`. Everywhere else, zero — no allowlist, nothing to argue
   about. Raw px is legal in the same place, plus a short list of
   properties below where a px really is geometry rather than a design
   value.
   ──────────────────────────────────────────────────────────────────── */

/**
 * Properties whose px values are geometry, not a spacing/type/radius
 * choice, and so are exempt from the px rule. Each entry needs a reason
 * — an allowlist nobody has to justify is how a gate becomes theatre.
 */
const PX_EXEMPT_PROPERTIES: Record<string, string> = {
  // Blur radius and offsets of a drop shadow: not a spacing step.
  'box-shadow': 'shadow blur/offset geometry',
  // The W9-05 scroll-shadow: gradient widths in px, asserted verbatim by
  // board/Lane.test.tsx. Tokenising these would break that contract for
  // no design benefit — they are the size of a fade, not a gap.
  'background-size': 'scroll-shadow gradient geometry (W9-05)',
  // NOTE: `background-position` is deliberately NOT exempt. It sits beside
  // background-size in the same rule and looks like it belongs here, but
  // its value is `0 0, 100% 0, ...` — no px at all. An exemption nothing
  // needs is the first crack in an allowlist.
};

function cssFiles(): string[] {
  return readdirSync(testDir, { recursive: true, encoding: 'utf-8' })
    .filter((f) => f.endsWith('.css'))
    .map((f) => path.join(testDir, f))
    .sort();
}

interface Declaration {
  prop: string;
  value: string;
  file: string;
  line: number;
}

/**
 * Splits a stylesheet into `prop: value` declarations with source lines.
 *
 * Deliberately not line-based: `background-image`'s gradient list and
 * the `font-family` stack both span several lines, and a line-based
 * scan would read their continuations as separate declarations. Splits
 * on `;` instead, then keeps only what follows the last `{` in each
 * chunk (which drops selectors, so `#id` selectors can never be
 * mistaken for a hex colour).
 */
function declarations(file: string): Declaration[] {
  const source = readFileSync(file, 'utf-8');
  const stripped = source.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));
  const out: Declaration[] = [];
  let offset = 0;
  for (const chunk of stripped.split(';')) {
    const afterBrace = chunk.lastIndexOf('{');
    const text = afterBrace === -1 ? chunk : chunk.slice(afterBrace + 1);
    const match = /^\s*(--[\w-]+|[a-zA-Z-]+)\s*:\s*([\s\S]+)$/.exec(text);
    const [, prop, value] = match ?? [];
    if (prop && value) {
      const indexInChunk = chunk.length - text.length + text.indexOf(prop);
      const absolute = offset + indexInChunk;
      out.push({
        prop,
        value,
        file,
        line: stripped.slice(0, absolute).split('\n').length,
      });
    }
    offset += chunk.length + 1;
  }
  return out;
}

/** A `--sw-*` definition in styles.css — the one place raw values live. */
function isTokenDefinition(d: Declaration): boolean {
  return d.prop.startsWith('--sw-') && path.basename(d.file) === 'styles.css';
}

function describeAll(violations: Declaration[]): string {
  return violations
    .map(
      (v) =>
        `  ${path.relative(testDir, v.file)}:${v.line}  ${v.prop}: ${v.value.trim().replace(/\s+/g, ' ')}`,
    )
    .join('\n');
}

describe('design tokens (W10-06)', () => {
  const all = cssFiles().flatMap(declarations);

  it('finds the stylesheets it is supposed to be guarding', () => {
    // Guards the guard: a bad glob would make every assertion below
    // vacuously pass, which is the classic way a lint rule dies quietly.
    expect(cssFiles().length).toBeGreaterThanOrEqual(15);
    expect(all.length).toBeGreaterThan(500);
  });

  it('declares no hex colour outside the styles.css token block', () => {
    const violations = all.filter(
      (d) => !isTokenDefinition(d) && /#[0-9a-fA-F]{3,8}\b/.test(d.value),
    );
    expect(
      violations,
      `A hex colour outside the token block cannot follow the data-theme flip.\n` +
        `Use a semantic --sw-* role (danger/warning/success/fg-muted/on-accent):\n` +
        describeAll(violations),
    ).toEqual([]);
  });

  it('declares no raw px outside the token block and the geometry allowlist', () => {
    const violations = all.filter(
      (d) =>
        !isTokenDefinition(d) &&
        !(d.prop in PX_EXEMPT_PROPERTIES) &&
        /\b[0-9]*\.?[0-9]+px\b/.test(d.value),
    );
    expect(
      violations,
      `Raw px bypasses the spacing/type/radius scale. Use a --sw-space-*,\n` +
        `--sw-text-*, --sw-radius-* or --sw-border-width token:\n` +
        describeAll(violations),
    ).toEqual([]);
  });

  it('resolves every --sw-* token it references, with no hex fallbacks', () => {
    // Before W10-06 eight tokens were referenced with a hex fallback and
    // never defined anywhere — `var(--sw-success, #2ecc71)` always took
    // the fallback, so the code looked tokenised while rendering a
    // frozen literal. A fallback is where that hides; ban it outright.
    const defined = new Set(
      all.filter((d) => d.prop.startsWith('--')).map((d) => d.prop),
    );
    const referenced = new Set<string>();
    const withFallback: Declaration[] = [];
    for (const d of all) {
      for (const match of d.value.matchAll(/var\(\s*(--[\w-]+)\s*(,[^)]*)?\)/g)) {
        const [, name, fallback] = match;
        if (!name) continue;
        referenced.add(name);
        if (fallback) withFallback.push(d);
      }
    }
    expect(
      [...referenced].filter((name) => !defined.has(name)).sort(),
      'referenced but never defined — the fallback silently wins',
    ).toEqual([]);
    expect(
      withFallback,
      `var() fallbacks hide undefined tokens. Define the token instead:\n` +
        describeAll(withFallback),
    ).toEqual([]);
  });

  it('keeps the two dark-theme blocks identical, so first paint cannot flash', () => {
    // ThemeProvider sets data-theme in an effect; until it runs, the
    // prefers-color-scheme block is what paints. If the two disagree on
    // any token the user sees a colour change on load.
    const body = (start: string): string => {
      const at = css.indexOf(start);
      expect(at, `expected "${start}" in styles.css`).toBeGreaterThan(-1);
      const open = css.indexOf('{', at);
      return css
        .slice(open + 1, css.indexOf('}', open))
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .split(';')
        .map((s) => s.trim())
        .filter(Boolean)
        .sort()
        .join(';');
    };
    expect(body(':root:not([data-theme])')).toBe(body(":root[data-theme='dark']"));
  });
});

/* ── W10-30: the missing-declaration gate ────────────────────────────
   The hex/px scan above only fires on a value that is PRESENT — it is
   structurally blind to a role that is never styled at all, which is
   exactly how anchors shipped with zero colour rule anywhere in any
   feature stylesheet and fell back to the UA default (#0000EE, 1.95:1
   against --sw-bg in the dark theme, below the 4.5:1 AA floor).

   This guards the missing case directly, for every element that can
   reproduce that failure shape: bare inline text with no widget
   background of its own, so a missing colour rule silently inherits
   the *browser's* default instead of the app's theme. Every helper
   below takes an explicit `source` string rather than closing over the
   real stylesheet, so the gate-integrity tests can feed synthetic CSS
   through the exact same check the real one runs. */

function relativeLuminance([r, g, b]: [number, number, number]): number {
  const channel = (c: number) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function hexToRgb(hex: string): [number, number, number] {
  const clean = hex.replace('#', '');
  const full = clean.length === 3 ? clean.replace(/./g, (c) => c + c) : clean;
  return [
    parseInt(full.slice(0, 2), 16),
    parseInt(full.slice(2, 4), 16),
    parseInt(full.slice(4, 6), 16),
  ];
}

function contrastRatio(fg: string, bg: string): number {
  const l1 = relativeLuminance(hexToRgb(fg));
  const l2 = relativeLuminance(hexToRgb(bg));
  const [hi, lo] = l1 > l2 ? [l1, l2] : [l2, l1];
  return (hi + 0.05) / (lo + 0.05);
}

/** A bare top-level `selector { ... }` rule — never a combinator like `.foo a {`. Null if absent. */
function topLevelRuleBody(source: string, selector: string): string | null {
  const opening = new RegExp(`(?:^|[}\\n])\\s*${selector}\\s*\\{`).exec(source);
  if (!opening) return null;
  const start = opening.index + opening[0].length - 1;
  const end = source.indexOf('}', start);
  return source.slice(start, end + 1);
}

/** The `--sw-*` token a rule's `color` resolves through, or null (missing rule, raw hex, anything but a bare `var(--sw-*)`). */
function colorToken(ruleBody: string): string | null {
  return /color:\s*var\((--sw-[\w-]+)\)/.exec(ruleBody)?.[1] ?? null;
}

/** `--sw-NAME` hex value under `:root` (light) and `:root[data-theme='dark']`. Null if either is undefined. */
function tokenHexPair(
  source: string,
  token: string,
): { light: string; dark: string } | null {
  const light = new RegExp(`:root\\s*\\{[^}]*${token}:\\s*(#[0-9a-fA-F]{3,8})`, 's').exec(
    source,
  );
  const dark = new RegExp(
    `:root\\[data-theme='dark'\\][^}]*${token}:\\s*(#[0-9a-fA-F]{3,8})`,
    's',
  ).exec(source);
  if (!light || !dark) return null;
  return { light: light[1]!, dark: dark[1]! };
}

/**
 * Elements this app renders as bare text with no UA-painted background of
 * their own, so a missing colour rule inherits the browser default rather
 * than the theme — the exact shape of the anchor bug. `a` is the only one
 * in that category the app actually uses: `mark` never appears anywhere
 * in apps/web/src (grepped), `button` already has its own gate above
 * (W9-04), and every `input`/`select`/`textarea` in the app paints its
 * own UA widget background box — a missing colour there is a different,
 * separate failure mode this gate does not claim to cover.
 */
const BACKGROUNDLESS_TEXT_ROLES = ['a'];

describe('backgroundless text roles resolve a themed colour (W10-30)', () => {
  for (const selector of BACKGROUNDLESS_TEXT_ROLES) {
    it(`"${selector}" declares a colour via a --sw-* token, not the UA default`, () => {
      const rule = topLevelRuleBody(css, selector);
      expect(
        rule,
        `expected a top-level "${selector}" rule in styles.css — without one, ` +
          `"${selector}" falls back to the UA default colour, which is how the ` +
          `anchor 1.95:1 AA failure survived`,
      ).not.toBeNull();
      expect(
        colorToken(rule!),
        `"${selector}" rule must set color via a --sw-* token (found: ${rule})`,
      ).not.toBeNull();
    });

    it(`"${selector}"'s colour clears WCAG AA (4.5:1) against --sw-bg in both themes`, () => {
      const rule = topLevelRuleBody(css, selector)!;
      const token = colorToken(rule)!;
      const linkColor = tokenHexPair(css, token)!;
      const bg = tokenHexPair(css, '--sw-bg')!;

      expect(
        contrastRatio(linkColor.light, bg.light),
        `light theme: ${token} (${linkColor.light}) on --sw-bg (${bg.light})`,
      ).toBeGreaterThanOrEqual(4.5);
      expect(
        contrastRatio(linkColor.dark, bg.dark),
        `dark theme: ${token} (${linkColor.dark}) on --sw-bg (${bg.dark})`,
      ).toBeGreaterThanOrEqual(4.5);
    });
  }
});

/* Proves the checks above can actually fail (docs/TESTING.md §6): a gate
   that never goes red isn't a gate. Each case feeds a synthetic
   stylesheet through the same parameterized helpers the real gate uses,
   reproducing one way the old, hex-scanning-only gate stayed green while
   this bug shipped. */
describe('gate integrity: the missing-declaration check can fail (W10-30 red fixture)', () => {
  const TOKENS = `
:root { --sw-bg: #ffffff; --sw-accent: #2e6bff; --sw-low-contrast: #eeeeee; }
:root[data-theme='dark'] { --sw-bg: #10151a; --sw-accent: #6ea0ff; --sw-low-contrast: #1c2229; }
`;

  it('catches an `a` rule that is missing entirely', () => {
    expect(topLevelRuleBody(TOKENS, 'a')).toBeNull();
  });

  it('catches an `a` rule that sets a raw hex colour instead of a token', () => {
    const source = `${TOKENS}\na { color: #0000ee; }\n`;
    const rule = topLevelRuleBody(source, 'a');
    expect(rule).not.toBeNull();
    expect(colorToken(rule!)).toBeNull();
  });

  it('catches a token-based colour that still fails AA contrast', () => {
    const source = `${TOKENS}\na { color: var(--sw-low-contrast); }\n`;
    const rule = topLevelRuleBody(source, 'a')!;
    const token = colorToken(rule)!;
    const linkColor = tokenHexPair(source, token)!;
    const bg = tokenHexPair(source, '--sw-bg')!;

    expect(contrastRatio(linkColor.light, bg.light)).toBeLessThan(4.5);
    expect(contrastRatio(linkColor.dark, bg.dark)).toBeLessThan(4.5);
  });
});
