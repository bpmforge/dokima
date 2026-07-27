/**
 * W9-04: unify control styling — every plain `<button>` across the app
 * (forms, drawer, trace, plans, settings, etc.) should share ONE styled
 * treatment, matching the header's existing `.theme-toggle` pill, in both
 * themes.
 *
 * jsdom doesn't run a real CSS cascade (default `test.css: false` here —
 * no vite/postcss pass over stylesheet imports), so `getComputedStyle`
 * can't see rules from `styles.css` and would be a tautology. Instead this
 * guards the textual contract directly, same technique as
 * `board/Lane.test.tsx`'s W9-05 edge-fade check: read the raw stylesheet
 * and assert the shared `button` rule declares the same tokens the
 * header's `.theme-toggle` already used, and that it's theme-safe (driven
 * only by the `--sw-*` custom properties that flip under
 * `:root[data-theme='dark']`, never a hardcoded hex).
 */
import { readFileSync } from 'node:fs';
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
    expect(buttonRule).toMatch(/border:\s*1px solid var\(--sw-border\)/);
    expect(buttonRule).toMatch(/background:\s*transparent/);
    expect(buttonRule).toMatch(/color:\s*var\(--sw-fg\)/);
    expect(buttonRule).toMatch(/border-radius:\s*6px/);
    expect(buttonRule).toMatch(/padding:\s*0\.4rem 0\.75rem/);
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
