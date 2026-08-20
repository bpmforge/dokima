// @vitest-environment jsdom
/* global document */
/**
 * W13-54. `extractEvidence` is the audit's eyes — these tests pin that the
 * evidence pack carries what each class of audit finding needed, and that it
 * is deterministic (the W13-07 rot-diff property, extended to text).
 */
import { describe, expect, it } from 'vitest';
import { extractEvidence } from './evidence.mjs';

function mount(html) {
  document.body.innerHTML = html;
}

describe('extractEvidence', () => {
  it('captures visible strings in document order — the A-1/A-3 raw material', () => {
    mount(`
      <h1>Agent Roster</h1>
      <p>No model will take this role yet — pick models in Settings → Models.</p>
      <p style="display:none">hidden internals</p>
    `);
    const evidence = extractEvidence();
    expect(evidence.strings[0]).toBe('Agent Roster');
    expect(evidence.strings).toContain(
      'No model will take this role yet — pick models in Settings → Models.',
    );
    expect(evidence.strings.join(' ')).not.toContain('hidden internals');
  });

  it('captures interactive elements with accessible names — what an instruction must point at', () => {
    mount(`
      <button>Start a run</button>
      <button aria-label="close receipt on file">○</button>
      <input placeholder="the id exactly as your provider lists it" />
    `);
    const { interactive } = extractEvidence();
    const names = interactive.map((el) => el.name);
    expect(names).toContain('Start a run');
    expect(names).toContain('close receipt on file');
    expect(names).toContain('the id exactly as your provider lists it');
  });

  it('carries the class histogram — how "a Blocked card is the same shape as a Ready card" (A-4) becomes checkable from text', () => {
    mount(`
      <div class="board-card surface surface--blocked">one</div>
      <div class="board-card surface">two</div>
    `);
    const { classHistogram } = extractEvidence();
    expect(classHistogram['board-card']).toBe(2);
    expect(classHistogram['surface--blocked']).toBe(1);
  });

  it('is deterministic: the same DOM serializes byte-identically', () => {
    const html = `
      <h1>Fleet</h1>
      <div class="readout"><span>7</span></div>
      <button>Open</button>
    `;
    mount(html);
    const first = JSON.stringify(extractEvidence());
    mount(html);
    const second = JSON.stringify(extractEvidence());
    expect(second).toBe(first);
  });

  it('reports geometry honestly on an empty page — zero occupancy, never NaN', () => {
    mount('');
    const { geometry } = extractEvidence();
    expect(geometry.occupancy).toBe(0);
    expect(geometry.contentBox).toEqual({ x: 0, y: 0, w: 0, h: 0 });
  });
});
