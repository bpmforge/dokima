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
  const isVisible = (el) => {
    const style = window.getComputedStyle(el);
    return style.visibility !== 'hidden' && style.display !== 'none';
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

  // Interactive elements: what a user can operate, named the way assistive
  // tech would name it — the instruction↔surface check's raw material.
  const interactive = [];
  const controls = document.querySelectorAll(
    'button, a[href], input, select, textarea, [role]',
  );
  for (const el of controls) {
    if (!isVisible(el)) continue;
    const rect = el.getBoundingClientRect();
    const name =
      el.getAttribute('aria-label') ??
      (el.tagName === 'INPUT' || el.tagName === 'SELECT' || el.tagName === 'TEXTAREA'
        ? (el.getAttribute('placeholder') ?? el.getAttribute('title') ?? '')
        : (el.textContent ?? '').replace(/\s+/g, ' ').trim());
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
