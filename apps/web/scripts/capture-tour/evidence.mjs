/**
 * evidence.mjs — the audit's eyes, serialized (W13-54, DESIGN_REVIEW_LOOP
 * layer 2).
 *
 * Beside every captured frame, an `evidence.json` describing the state in
 * TEXT: visible strings, interactive elements (role + accessible name +
 * geometry), and summary stats. This is the model-agnostic move (Law 9b):
 * the 2026-08-20 comprehension audit never actually needed vision — every
 * finding reduced to strings, labels and measurements — so a local model
 * without vision judges the same evidence a person's eyes produced, and the
 * PNG is enrichment for models that can use it (FR-G5, honest degrade).
 *
 * `extractEvidence` is SELF-CONTAINED on purpose: Playwright serializes the
 * function into the page, so it may close over nothing. The same property
 * lets jsdom unit-test it directly.
 *
 * Deterministic by construction: document order, integer-rounded geometry,
 * no timestamps — two captures of an unchanged UI byte-diff clean, extending
 * W13-07's rot-detection property from pixels to evidence.
 */
/* extractEvidence executes INSIDE the page (Playwright serializes it), and
   inside jsdom in tests — document/window are its runtime globals even
   though this file lives in a node script directory. */
/* global document, window, NodeFilter */
import { promises as fs } from 'node:fs';
import path from 'node:path';

export function extractEvidence() {
  // STYLE-based, not size-based: jsdom (the unit-test environment) has no
  // layout engine, so every rect is 0x0 there — a size gate would reject the
  // entire document and the extractor would be testable only against a live
  // browser. Sizes still feed geometry, where zeros degrade to occupancy 0.
  const isHiddenItself = (el) => {
    if (el.hasAttribute && el.hasAttribute('hidden')) return true;
    const style = window.getComputedStyle(el);
    return style.visibility === 'hidden' || style.display === 'none';
  };
  /**
   * ANCESTOR-AWARE. It used to test the element's OWN computed style only,
   * and `getComputedStyle` on a child of a `display:none` parent reports the
   * child's own specified display — never `none`. So every control inside a
   * hidden container passed as visible.
   *
   * Live consequence: `SettingsPage` mounts `ProvidersPanel` permanently
   * under `hidden={tab !== 'providers'}` (so its discovered catalog survives
   * a tab switch), and the pack for EVERY other Settings tab therefore listed
   * six provider controls — a Kind select, Base URL, two checkboxes, a submit
   * button — sized 0x0 at the origin. A model judging the Copilot tab was
   * being shown controls that are not on that screen, and 0x0 geometry it
   * could reasonably read as a layout defect. Both are fictions.
   *
   * Still style-based, never size-based: jsdom has no layout engine, so a
   * size gate would reject the whole document there (see the header).
   */
  const isVisible = (el) => {
    for (let node = el; node && node.nodeType === 1; node = node.parentElement) {
      if (isHiddenItself(node)) return false;
    }
    return true;
  };
  const round = (n) => Math.round(n);

  // Visible text, document order, whitespace-normalized, deduped.
  const strings = [];
  const seen = new Set();
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = (node.textContent ?? '').replace(/\s+/g, ' ').trim();
    if (!text || !node.parentElement || !isVisible(node.parentElement)) continue;
    if (seen.has(text)) continue;
    seen.add(text);
    strings.push(text);
  }

  const clean = (text) => (text ?? '').replace(/\s+/g, ' ').trim();

  /**
   * The name assistive tech would announce, in the order the accname spec
   * resolves it. It previously read `aria-label`, then placeholder/title for
   * form controls, then text content — and consulted no `<label>` at all.
   *
   * A `<label>` is how almost every control in this app is named, so the pack
   * reported them as `""`: Base URL, Enabled, Use for every project, the Kind
   * select, the Copilot consent checkbox. Worse than the blanks themselves,
   * a genuinely unlabelled control looked exactly like a correctly labelled
   * one, so the pack could neither surface a real accessibility defect nor be
   * trusted when it seemed to show one.
   */
  const accessibleName = (el) => {
    const aria = clean(el.getAttribute('aria-label'));
    if (aria) return aria;

    const labelledBy = el.getAttribute('aria-labelledby');
    if (labelledBy) {
      const text = labelledBy
        .split(/\s+/)
        .map((id) => clean(document.getElementById(id)?.textContent))
        .filter(Boolean)
        .join(' ');
      if (text) return text;
    }

    // `<label for>` first, then a wrapping `<label>` — both are how this app
    // labels its controls, and neither was consulted before.
    if (el.id) {
      const forLabel = document.querySelector(`label[for="${el.id.replace(/"/g, '\\"')}"]`);
      const text = clean(forLabel?.textContent);
      if (text) return text;
    }
    const wrapping = el.closest ? el.closest('label') : null;
    if (wrapping) {
      const text = clean(wrapping.textContent);
      if (text) return text;
    }

    const isFormControl =
      el.tagName === 'INPUT' || el.tagName === 'SELECT' || el.tagName === 'TEXTAREA';
    if (isFormControl) {
      return clean(el.getAttribute('placeholder') ?? el.getAttribute('title') ?? '');
    }
    return clean(el.textContent);
  };

  // Interactive elements: what a user can operate, named the way assistive
  // tech would name it — the instruction↔surface check's raw material.
  const interactive = [];
  const controls = document.querySelectorAll(
    'button, a[href], input, select, textarea, [role]',
  );
  for (const el of controls) {
    if (!isVisible(el)) continue;
    const rect = el.getBoundingClientRect();
    const name = accessibleName(el);
    interactive.push({
      tag: el.tagName.toLowerCase(),
      role: el.getAttribute('role') ?? null,
      name: name.slice(0, 200),
      disabled: el.hasAttribute('disabled'),
      rect: {
        x: round(rect.x),
        y: round(rect.y),
        w: round(rect.width),
        h: round(rect.height),
      },
    });
  }

  // Geometry: the content bounding box and its viewport occupancy — the
  // measurement behind "70% of this viewport is empty" (UX_AUDIT A-5) —
  // plus a class histogram, which is how "these two cards render identical
  // classes in different columns" (A-4) becomes checkable from text.
  const viewport = { w: window.innerWidth, h: window.innerHeight };
  let minX = Infinity;
  let minY = Infinity;
  let maxX = 0;
  let maxY = 0;
  const classHistogram = {};
  for (const el of document.body.querySelectorAll('*')) {
    if (!isVisible(el)) continue;
    const rect = el.getBoundingClientRect();
    if ((el.textContent ?? '').trim() !== '' || el.childElementCount === 0) {
      minX = Math.min(minX, rect.x);
      minY = Math.min(minY, rect.y);
      maxX = Math.max(maxX, rect.x + rect.width);
      maxY = Math.max(maxY, rect.y + rect.height);
    }
    for (const cls of el.classList) {
      classHistogram[cls] = (classHistogram[cls] ?? 0) + 1;
    }
  }
  const hasContent = Number.isFinite(minX);
  const contentBox = hasContent
    ? {
        x: round(minX),
        y: round(minY),
        w: round(Math.min(maxX, viewport.w) - minX),
        h: round(Math.min(maxY, viewport.h) - minY),
      }
    : { x: 0, y: 0, w: 0, h: 0 };
  const occupancy =
    viewport.w > 0 && viewport.h > 0
      ? Math.round(((contentBox.w * contentBox.h) / (viewport.w * viewport.h)) * 100) / 100
      : 0;

  // Sorted so serialization is stable regardless of DOM iteration quirks.
  const sortedHistogram = {};
  for (const key of Object.keys(classHistogram).sort()) {
    sortedHistogram[key] = classHistogram[key];
  }

  return {
    strings,
    interactive,
    geometry: { viewport, contentBox, occupancy },
    classHistogram: sortedHistogram,
  };
}

/** Collects evidence from a live Playwright page. */
export function collectEvidence(page) {
  return page.evaluate(extractEvidence);
}

/** Writes `<frame>.evidence.json` beside the frame it describes. */
export async function writeEvidence(imgDir, relPath, evidence) {
  const target = path.join(imgDir, relPath.replace(/\.png$/, '.evidence.json'));
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, `${JSON.stringify(evidence, null, 2)}\n`);
  return target;
}
