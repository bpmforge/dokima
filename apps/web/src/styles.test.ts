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
  // W12-33: a focus ring is geometry, not a spacing step, and its THICKNESS
  // is an accessibility property — WCAG 2.2's focus-appearance criterion is
  // about how visible the indicator is, so snapping it to a spacing token
  // would let a layout scale change quietly thin the only affordance a
  // keyboard user has. Exempt for the same reason box-shadow is, and no
  // wider: `outline-color` still has to come from a token.
  outline: 'focus-ring geometry (WCAG 2.2 focus appearance)',
  'outline-offset': 'focus-ring geometry (WCAG 2.2 focus appearance)',
  // NOTE: `background-position` is deliberately NOT exempt. It sits beside
  // background-size in the same rule and looks like it belongs here, but
  // its value is `0 0, 100% 0, ...` — no px at all. An exemption nothing
  // needs is the first crack in an allowlist.
};

/**
 * Standard CSS properties whose values are a spacing insertion (gap between
 * or around boxes), as opposed to a font-size, radius, or line-length
 * measurement — each of those is scaled and gated separately. Excludes
 * `width`/`height`/`min-width`/etc: those size a box to fit its content
 * (e.g. the notification-bell badge's `1.1rem` circle), which is a
 * component-geometry decision, not a spacing-scale one.
 */
const SPACING_PROPERTIES = new Set([
  'padding',
  'padding-top',
  'padding-right',
  'padding-bottom',
  'padding-left',
  'margin',
  'margin-top',
  'margin-right',
  'margin-bottom',
  'margin-left',
  'gap',
  'row-gap',
  'column-gap',
  'top',
  'right',
  'bottom',
  'left',
  'inset',
]);

/** Every raw (non-token) rem literal in a declaration value, as a number. */
function remLiterals(value: string): number[] {
  return [...value.matchAll(/(-?[0-9]*\.?[0-9]+)rem\b/g)].map((m) => parseFloat(m[1]!));
}

/**
 * Individual declarations whose rem value is real geometry, not a
 * spacing-rhythm choice — so a property-level exemption (like
 * PX_EXEMPT_PROPERTIES above) would be too broad, since the same property
 * carries genuine spacing-scale values elsewhere (e.g. `padding-top` is
 * already tokenized in artifacts.css and chat.css). Keyed to the exact
 * file+prop+value so nothing else can ride along silently.
 */
const SPACING_SCALE_EXEMPT: {
  file: string;
  prop: string;
  value: string;
  reason: string;
}[] = [
  {
    file: 'styles.css',
    prop: 'padding-top',
    value: '9rem',
    reason:
      ".shortcuts-overlay__backdrop: fixed clearance for the app-shell header (and, on Fleet, the stacked fleet__header toolbar) above it, not a spacing-rhythm step — see the rule's own comment",
  },
];

function isSpacingScaleExempt(d: Declaration): boolean {
  return SPACING_SCALE_EXEMPT.some(
    (e) =>
      path.basename(d.file) === e.file && d.prop === e.prop && d.value.trim() === e.value,
  );
}

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

  it('declares no off-scale rem in a spacing property (W10-28)', () => {
    // Derived from the real --sw-space-* definitions rather than hardcoded,
    // so the gate always tracks the actual scale, not a stale copy of it.
    const spaceScale = new Set(
      all
        .filter((d) => d.prop.startsWith('--sw-space-') && isTokenDefinition(d))
        .flatMap((d) => remLiterals(d.value)),
    );
    expect(spaceScale.size).toBeGreaterThan(0);

    const violations = all.filter(
      (d) =>
        !isTokenDefinition(d) &&
        !isSpacingScaleExempt(d) &&
        SPACING_PROPERTIES.has(d.prop) &&
        remLiterals(d.value).some((v) => !spaceScale.has(Math.abs(v))),
    );
    expect(
      violations,
      `A rem value off the --sw-space-* scale in a spacing property bypasses\n` +
        `the grid. Snap to the nearest --sw-space-* token:\n` +
        describeAll(violations),
    ).toEqual([]);
  });

  it('declares no off-scale font-size — every value is a --sw-text-* token (W10-28)', () => {
    // Same derive-from-definitions approach as the spacing scale above.
    const textScale = new Set(
      all
        .filter((d) => d.prop.startsWith('--sw-text-') && isTokenDefinition(d))
        .flatMap((d) => remLiterals(d.value)),
    );
    expect(textScale.size).toBeGreaterThan(0);

    const violations = all.filter(
      (d) =>
        !isTokenDefinition(d) &&
        d.prop === 'font-size' &&
        remLiterals(d.value).some((v) => !textScale.has(Math.abs(v))),
    );
    expect(
      violations,
      `A raw rem font-size off the --sw-text-* scale bypasses the type\n` +
        `scale. Use a --sw-text-* token (or extend the scale in styles.css):\n` +
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

/* Proves the spacing/font-size scale checks can actually fail (docs/TESTING.md
   §6), same discipline as the W10-06 hex/px gates above: a synthetic
   declaration list is fed through the exact same filters the real gate
   uses, rather than asserting on prose about what the gate "should" do. */
describe('gate integrity: the spacing/font-size scale checks can fail (W10-28 red fixture)', () => {
  const scale = new Set([0.25, 0.5]);

  it('catches an off-scale rem in a spacing property', () => {
    const declarationValue = '0.4rem var(--sw-space-2)';
    expect(SPACING_PROPERTIES.has('padding')).toBe(true);
    expect(remLiterals(declarationValue).some((v) => !scale.has(Math.abs(v)))).toBe(true);
  });

  it('does not flag a spacing property whose rem values are already on scale', () => {
    const declarationValue = '0.5rem var(--sw-space-2)';
    expect(remLiterals(declarationValue).some((v) => !scale.has(Math.abs(v)))).toBe(
      false,
    );
  });

  it('does not flag a non-spacing property carrying an off-scale rem (width/height are geometry)', () => {
    expect(SPACING_PROPERTIES.has('width')).toBe(false);
    expect(SPACING_PROPERTIES.has('height')).toBe(false);
    expect(SPACING_PROPERTIES.has('min-width')).toBe(false);
  });

  it('catches an off-scale rem font-size', () => {
    const declarationValue = '1.1rem';
    expect(remLiterals(declarationValue).some((v) => !scale.has(Math.abs(v)))).toBe(true);
  });

  it('does not flag a font-size already expressed as a --sw-text-* token', () => {
    const declarationValue = 'var(--sw-text-lg)';
    expect(remLiterals(declarationValue)).toEqual([]);
  });

  it('exempts only the exact declaration named in SPACING_SCALE_EXEMPT, not the property everywhere', () => {
    expect(
      isSpacingScaleExempt({
        prop: 'padding-top',
        value: '9rem',
        file: '/x/styles.css',
        line: 1,
      }),
    ).toBe(true);
    expect(
      isSpacingScaleExempt({
        prop: 'padding-top',
        value: '0.4rem',
        file: '/x/styles.css',
        line: 1,
      }),
    ).toBe(false);
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

/* ── W10-31: color-scheme / accent-color gate ────────────────────────
   Neither `:root` block declared `color-scheme`, so the browser had no
   signal that the dark theme was dark: every native control (select
   popups, checkboxes, range thumbs, scrollbars) kept painting its
   light-mode UA chrome over the app's own dark surfaces — nine controls
   across five files, all invisible to the W10-06 hex/px scan because
   there was no colour value to find, only a missing declaration (the
   same shape as W10-30's anchor bug, one property over). Three separate
   fixes, three separate assertions: `color-scheme` (select popups,
   scrollbars, spinners), `accent-color` (checkbox mark, radio dot, range
   thumb — color-scheme alone does not theme these), and the `<meta>`
   fallback for the frame before either stylesheet rule can apply. */
describe('color-scheme and accent-color are declared (W10-31)', () => {
  it('declares color-scheme: light on the base :root block', () => {
    const rootRule = ruleBody(':root');
    expect(rootRule).toMatch(/color-scheme:\s*light\s*;/);
  });

  it('declares accent-color on the base :root block, driven by --sw-accent', () => {
    const rootRule = ruleBody(':root');
    expect(rootRule).toMatch(/accent-color:\s*var\(--sw-accent\)\s*;/);
  });

  it('declares color-scheme: dark on the explicit dark override block', () => {
    const darkRule = ruleBody(":root[data-theme='dark']");
    expect(darkRule).toMatch(/color-scheme:\s*dark\s*;/);
  });

  it('declares color-scheme: dark on the prefers-color-scheme fallback block, matching the override', () => {
    const fallbackRule = ruleBody(':root:not([data-theme])');
    expect(fallbackRule).toMatch(/color-scheme:\s*dark\s*;/);
  });

  it('keeps the dark override and fallback blocks identical, including color-scheme (no first-paint flash)', () => {
    // Reuses the same identical-blocks contract as the W10-06 test above:
    // color-scheme is just another declaration in those two blocks, and a
    // drift here is the same first-paint-flash bug for native chrome.
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
    const darkBody = body(":root[data-theme='dark']");
    expect(darkBody).toContain('color-scheme: dark');
    expect(darkBody).toBe(body(':root:not([data-theme])'));
  });

  it('declares a <meta name="color-scheme"> in index.html for first paint, before any CSS rule can apply', () => {
    const html = readFileSync(path.join(testDir, '..', 'index.html'), 'utf-8');
    expect(html).toMatch(/<meta\s+name="color-scheme"\s+content="light dark"\s*\/?>/);
  });
});

/* Proves the color-scheme gate can actually fail (docs/TESTING.md §6),
   same discipline as the W10-30 red fixture above: a synthetic stylesheet
   missing each declaration must trip the corresponding regex. */
describe('gate integrity: the color-scheme check can fail (W10-31 red fixture)', () => {
  it('a :root block with no color-scheme declaration does not match', () => {
    const source = ':root { --sw-bg: #ffffff; accent-color: var(--sw-accent); }';
    const start = source.indexOf(':root {');
    const rule = source.slice(start, source.indexOf('}', start) + 1);
    expect(rule).not.toMatch(/color-scheme:\s*light\s*;/);
  });

  it('an index.html with no color-scheme meta tag does not match', () => {
    const html = '<head><meta charset="UTF-8" /><title>Dokima</title></head>';
    expect(html).not.toMatch(/<meta\s+name="color-scheme"\s+content="light dark"\s*\/?>/);
  });
});

/* ── W10-32: applied-but-undefined utility-class gate ─────────────────
   The same blind spot as W10-30/W10-31, one level up: those two guard a
   missing *property* on a known selector. This one guards a missing
   *selector* entirely — `.sr-only` was applied via `className="sr-only"`
   at five call sites and defined in zero of the app's fifteen
   stylesheets, so jsdom (and the real browser) rendered it as plain
   visible text. Every hex/px/token check above is structurally blind to
   this: there is no declaration to scan, because the whole rule doesn't
   exist.

   Scoped to utility classes on purpose, not every className in the app:
   most classes are feature-specific hooks a component author may
   legitimately leave unstyled (inherits from a parent, or is a pure
   test/semantic marker) — a fully generic "every className must resolve
   to a rule" sweep flags dozens of those as false positives. A utility
   class is different in kind: it exists ONLY to apply shared behaviour
   (here, visually hiding text without removing it from the accessibility
   tree), so an undefined one is never intentional. `sr-only` is the only
   utility class in the app today (grepped); add future ones here. */
const UTILITY_CLASSES = ['sr-only'];

function tsxFiles(): string[] {
  return readdirSync(testDir, { recursive: true, encoding: 'utf-8' })
    .filter((f) => f.endsWith('.tsx'))
    .map((f) => path.join(testDir, f))
    .sort();
}

/** Whether `className` appears as a whitespace-separated token inside a
 * literal (non-dynamic) `className="..."` / `'...'` / `` `...` `` value. */
function classIsApplied(source: string, className: string): boolean {
  const re = /className=(?:"([^"]*)"|'([^']*)'|`([^`]*)`)/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(source))) {
    const value = match[1] ?? match[2] ?? match[3] ?? '';
    if (value.split(/\s+/).includes(className)) return true;
  }
  return false;
}

/** Whether `.className` appears as a CSS selector fragment anywhere in
 * `source` — a real rule, not a longer class name that happens to share
 * the prefix (`.sr-only-foo` must not satisfy a lookup for `sr-only`) and
 * not the class name showing up in a comment (a stylesheet's own doc
 * comments reference class names in prose — see styles.css's W10-32
 * comment above the real rule, and board.css's — without stripping `/*
 * ... *\/` first, that prose satisfies the lookup even when the rule
 * itself has been deleted, which is exactly the false-pass this gate
 * exists to prevent). Requires the selector to be immediately followed
 * by (optional whitespace/combinators then) `{`, so only an actual rule
 * declaration counts as "defined". */
function classIsDefined(source: string, className: string): boolean {
  const withoutComments = source.replace(/\/\*[\s\S]*?\*\//g, '');
  const escaped = className.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`\\.${escaped}(?![\\w-])[^{}]*\\{`).test(withoutComments);
}

describe('utility classes applied in components resolve to a stylesheet rule (W10-32)', () => {
  const componentSources = tsxFiles().map((f) => readFileSync(f, 'utf-8'));
  const styleSources = cssFiles().map((f) => readFileSync(f, 'utf-8'));

  it('finds the components it is supposed to be guarding', () => {
    // Guards the guard, same as the W10-06 "finds the stylesheets" check.
    expect(tsxFiles().length).toBeGreaterThan(50);
  });

  for (const className of UTILITY_CLASSES) {
    it(`".${className}" is actually applied somewhere (the check itself isn't vacuous)`, () => {
      expect(componentSources.some((src) => classIsApplied(src, className))).toBe(true);
    });

    it(`".${className}" is defined in at least one stylesheet`, () => {
      expect(
        styleSources.some((src) => classIsDefined(src, className)),
        `"${className}" is applied in a component but defined in no stylesheet — ` +
          `screen-reader-only text renders as visible product copy`,
      ).toBe(true);
    });
  }
});

/* Proves the applied-but-undefined check can actually fail (docs/TESTING.md
   §6): fed the exact real-world shape (a component using the class, a
   stylesheet that never defines it) through the same helpers the gate
   above uses. */
describe('gate integrity: the applied-but-undefined class check can fail (W10-32 red fixture)', () => {
  it('catches a class applied in a component but never defined in any stylesheet', () => {
    const component = '<span className="sr-only">Move ticket E2E-1</span>';
    const stylesheet = '.board-card { display: flex; }';
    expect(classIsApplied(component, 'sr-only')).toBe(true);
    expect(classIsDefined(stylesheet, 'sr-only')).toBe(false);
  });

  it('does not false-positive on a longer class name sharing the same prefix', () => {
    const stylesheet = '.sr-only-legacy { display: none; }';
    expect(classIsDefined(stylesheet, 'sr-only')).toBe(false);
  });

  it('does not false-positive on the class name appearing in a comment, not a rule', () => {
    // The exact shape of the bug this gate previously shipped with: the
    // real `.sr-only` rule removed, but explanatory prose (like the
    // comment above the real rule in styles.css, or the one in
    // board.css) still mentions ".sr-only" in text. A regex over raw
    // source text — comments included — treats prose as a declaration.
    const stylesheet = `
      /* re-measured now that .sr-only actually hides that text, see
         board.css: \`.sr-only\` is defined (clip-path) */
      .board-card { display: flex; }
    `;
    expect(classIsDefined(stylesheet, 'sr-only')).toBe(false);
  });

  it('passes once the class gets a real rule', () => {
    const stylesheet = '.sr-only { position: absolute; clip-path: inset(50%); }';
    expect(classIsDefined(stylesheet, 'sr-only')).toBe(true);
  });

  it('does not flag a class that is never applied by any component', () => {
    const component = '<span className="board-card__id">{ticket.id}</span>';
    expect(classIsApplied(component, 'sr-only')).toBe(false);
  });
});

/* ── W10-34: shortcuts overlay scrim, position, and column gate ──────
   The overlay had a fixed `position: fixed; inset: 5rem` panel with no
   backdrop of its own — the page behind it stayed full brightness, and a
   5rem top offset landed inside the app header on the Fleet screen (two
   stacked headers there, not one). Guards the fix stays a real scrim
   (a dedicated backdrop element, not just a shadow on the panel) and that
   the panel itself no longer self-positions with a fixed inset that can
   land on the toolbar again. */
describe('shortcuts overlay scrim and position (W10-34)', () => {
  it('gives the overlay a dedicated backdrop that dims the full page', () => {
    const backdropRule = ruleBody('.shortcuts-overlay__backdrop');
    expect(backdropRule).toMatch(/position:\s*fixed/);
    expect(backdropRule).toMatch(/inset:\s*0/);
    expect(backdropRule).toMatch(/background:\s*rgb\(0 0 0 \/ \d+%\)/);
  });

  it("positions the panel via the backdrop's layout, not a fixed inset of its own", () => {
    const panelRule = ruleBody('.shortcuts-overlay');
    expect(panelRule).not.toMatch(/position:\s*fixed/);
    expect(panelRule).not.toMatch(/inset:/);
  });
});

/* ── W10-34: dt/dd column gate ────────────────────────────────────────
   `.shortcuts-overlay__row` gave each key/description pair its own flex
   row, so column alignment depended on how wide that row's own `<kbd>`
   text happened to be — "?" and "Esc" render at different x positions.
   The fix (matching `.ticket-drawer__contract-grid`) puts dt/dd on a
   shared grid track owned by the list, not the row. */
describe('shortcuts overlay dt/dd column (W10-34)', () => {
  it('lays the shortcut list out on a shared grid track', () => {
    const listRule = ruleBody('.shortcuts-overlay__list');
    expect(listRule).toMatch(/display:\s*grid/);
    expect(listRule).toMatch(/grid-template-columns:/);
  });

  it('no longer has a per-row rule whose own content width could stagger the column', () => {
    expect(css).not.toMatch(/\.shortcuts-overlay__row\s*\{/);
  });
});

/**
 * W13-03. The direction is instrument panel: dense, one accent, tabular
 * numerics, state encoded in form. These guard the parts of it that a later
 * change could silently undo.
 */
describe('the design system (W13-03)', () => {
  it(
    'docs/design/tokens.json has not drifted from the stylesheet. It is ' +
      'GENERATED from styles.css, which stays the source of truth — and a ' +
      'generated file nothing re-checks is exactly how a second copy starts ' +
      'lying',
    () => {
      const tokens = JSON.parse(
        readFileSync(path.join(testDir, '..', '..', '..', 'docs', 'design', 'tokens.json'), 'utf-8'),
      ) as { color: { dark: Record<string, string>; light: Record<string, string> } };
      for (const [name, value] of Object.entries(tokens.color.dark)) {
        expect(css, `${name} in tokens.json is not in styles.css`).toContain(
          `${name}: ${value};`,
        );
      }
    },
  );

  it(
    'the dark accent does NOT take white text. Measured at 2.46:1, it fails — ' +
      'and the previous dark accent had the identical trap, so this is the ' +
      'second time. --sw-on-accent is the ground',
    () => {
      const dark = ruleBody(":root[data-theme='dark']");
      expect(dark).toMatch(/--sw-on-accent:\s*#0e1417/);
      expect(dark).not.toMatch(/--sw-on-accent:\s*#fff/i);
    },
  );

  it(
    'the type scale has enough range to carry hierarchy. It ran 0.65-1.25rem, ' +
      'so every text on a Fleet card sat inside about four pixels and nothing ' +
      'could read as more important than anything else',
    () => {
      const root = ruleBody(':root');
      const sizes = [...root.matchAll(/--sw-text-[a-z0-9]+:\s*([\d.]+)rem/g)].map((m) =>
        Number(m[1]),
      );
      expect(sizes.length).toBeGreaterThanOrEqual(8);
      expect(Math.max(...sizes) / Math.min(...sizes)).toBeGreaterThan(3);
    },
  );

  it('numbers get the tabular mono face — this product is mostly numbers', () => {
    expect(ruleBody(':root')).toMatch(/--sw-font-mono:/);
    for (const selector of ['.readout__value', '.tabular']) {
      const body = ruleBody(selector);
      expect(body).toMatch(/font-family:\s*var\(--sw-font-mono\)/);
      expect(body).toMatch(/font-variant-numeric:\s*tabular-nums/);
    }
  });

  it(
    'a raised surface exists in BOTH themes. There was none at all, so cards ' +
      'and panes had nothing to sit on and the app was one flat sheet with ' +
      'lines drawn on it',
    () => {
      expect(ruleBody(':root')).toMatch(/--sw-surface:/);
      expect(ruleBody(":root[data-theme='dark']")).toMatch(/--sw-surface:/);
    },
  );
});

/**
 * W13-04. The primitives are only worth having if surfaces stop reinventing
 * them. `.empty-state` proves that existing is not enough — it shipped, seven
 * surfaces ignored it and wrote their own.
 */
describe('the component system (W13-04)', () => {
  const surfaceCss = readdirSync(path.join(testDir), { recursive: true, encoding: 'utf-8' })
    .filter((f) => typeof f === 'string' && f.endsWith('.css') && f !== 'styles.css')
    .map((f) => readFileSync(path.join(testDir, f as string), 'utf-8'));

  it(
    'RATCHET: no MORE surfaces re-declare the shared card border. Measured at ' +
      '51 across 14 stylesheets, which is why a card in fleet.css and a card in ' +
      'board.css are subtly different objects. W13-05/06 drive it down; it may ' +
      'not rise',
    () => {
      const declarations = surfaceCss
        .flatMap((c) => [...c.matchAll(/border:[^;]*--sw-border[^;]*;/g)])
        .length;
      // 51 at W13-04; 50 once the Fleet card adopted `.surface` (W13-05).
      // Lower it whenever the number drops. Never raise it to make a change
      // pass — the same rule the export ratchet carries.
      expect(declarations).toBeLessThanOrEqual(50);
    },
  );

  it('the shared primitives are token-only — no literal colour survives in them', () => {
    for (const selector of ['.surface', '.state', '.surface--attention']) {
      const body = ruleBody(selector);
      expect(body).not.toMatch(/#[0-9a-f]{3,8}\b/i);
      expect(body).not.toMatch(/\brgba?\(/);
    }
  });

  it(
    'each state token keeps ONE meaning, so a Fleet card and a board lane say ' +
      'the same thing the same way. The accent never means "good" — if it did, ' +
      'a gate result would stop being readable at a glance',
    () => {
      expect(ruleBody('.state--attention')).toContain('var(--sw-accent)');
      expect(ruleBody('.state--running')).toContain('var(--sw-success)');
      expect(ruleBody('.state--blocked')).toContain('var(--sw-warning)');
      expect(ruleBody('.state--refused')).toContain('var(--sw-danger)');
      expect(ruleBody('.state--idle')).toContain('var(--sw-fg-muted)');
    },
  );

  it(
    'state is carried in FORM, not only in a value — a surface needing a person ' +
      'is a different shape, which is what six identical Fleet cards could not be',
    () => {
      const body = ruleBody('.surface--attention');
      expect(body).toMatch(/box-shadow|border-color/);
    },
  );
});
