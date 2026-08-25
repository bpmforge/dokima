/**
 * W20-08 (D-028): the office is a skin over the same store — and the rule that
 * keeps it honest is that every animation maps to a named state. These tests
 * are the mechanism for "no idle theater".
 */
import { describe, expect, it } from 'vitest';
import { ALL_MEMBER_STATES } from './memberState.js';
import { ALL_POSES, poseFor } from './poses.js';

describe('officeSkin (W20-08)', () => {
  it('RED FIXTURE: every state has a pose — a state with no pose would render as idle, showing a working member doing nothing', () => {
    for (const kind of ALL_MEMBER_STATES) {
      const spec = poseFor(kind);
      expect(spec, `no pose for state "${kind}"`).toBeTruthy();
      expect(ALL_POSES).toContain(spec.pose);
      expect(spec.because.length).toBeGreaterThan(5);
    }
  });

  it('every pose the office can draw is reachable from some state — an unreachable pose is theater with no event behind it', () => {
    const used = new Set(ALL_MEMBER_STATES.map((k) => poseFor(k).pose));
    for (const pose of ALL_POSES) {
      expect(used.has(pose), `pose "${pose}" has no state behind it`).toBe(true);
    }
  });

  it('the waiting room is where blocked-on-you is drawn, and the break room only ever holds idle (W20-10, OPERATIONS.md)', () => {
    expect(poseFor('blocked-on-you').place).toBe('your-office');
    expect(poseFor('idle').place).toBe('break-room');
    // …and nothing else may be drawn in your office: only what waits on YOU.
    const inYourOffice = ALL_MEMBER_STATES.filter((k) => poseFor(k).place === 'your-office');
    expect(inYourOffice).toEqual(['blocked-on-you']);
    const inBreakRoom = ALL_MEMBER_STATES.filter((k) => poseFor(k).place === 'break-room');
    expect(inBreakRoom).toEqual(['idle']);
  });

  it('each pose carries the reason it is on screen, so the office can explain itself without inventing a narrative', () => {
    expect(poseFor('working').because).toContain('session turn');
    expect(poseFor('shipped').because).toContain('receipt');
    expect(poseFor('idle').because).toContain('no events');
  });
});
