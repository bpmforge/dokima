/**
 * W21-01: the scene is the canvas's whole input, so this is where the office's
 * honesty is checked. A canvas cannot be asserted against; a pure layout
 * function can.
 */
import { describe, expect, it } from 'vitest';
import { buildScene, figureX, figureFlipped, AISLE_FROM, AISLE_TO } from './scene.js';
import { ALL_POSES, poseFor } from './poses.js';
import { ALL_MEMBER_STATES } from './memberState.js';

const placedFor = (kinds: readonly (typeof ALL_MEMBER_STATES)[number][]) =>
  kinds.map((kind, i) => ({ actorId: `actor-${i}`, spec: poseFor(kind) }));

describe('scene (W21-01)', () => {
  it('places every member it is given — the office cannot silently drop somebody', () => {
    const placed = placedFor(ALL_MEMBER_STATES);
    const scene = buildScene(placed);
    expect(scene).toHaveLength(placed.length);
    expect(scene.map((f) => f.actorId)).toEqual(placed.map((p) => p.actorId));
  });

  it('RED FIXTURE: ONLY walking-handoff moves — every other pose is pinned to its spot', () => {
    const scene = buildScene(placedFor(ALL_MEMBER_STATES));
    for (const fig of scene) {
      expect(fig.moves, `${fig.pose} moves`).toBe(fig.pose === 'walking-handoff');
      if (!fig.moves) {
        // Same x at every time — no drift, no ambient wandering.
        expect(figureX(fig, 0)).toBe(fig.x);
        expect(figureX(fig, 12.5)).toBe(fig.x);
        expect(figureFlipped(fig, 7)).toBe(false);
      }
    }
  });

  it('a walking figure stays inside the corridor it is allowed to walk', () => {
    const [walker] = buildScene([
      { actorId: 'a', spec: poseFor('submitted') },
    ]);
    expect(walker!.moves).toBe(true);
    for (let t = 0; t < 200; t += 0.37) {
      const x = figureX(walker!, t);
      expect(x).toBeGreaterThanOrEqual(AISLE_FROM - 1);
      expect(x).toBeLessThanOrEqual(AISLE_TO + 1);
    }
  });

  it('every pose the mapping can produce is one the scene can lay out', () => {
    const poses = new Set(buildScene(placedFor(ALL_MEMBER_STATES)).map((f) => f.pose));
    for (const pose of poses) expect(ALL_POSES).toContain(pose);
  });

  it('desks are drawn only for seated members, and a lit screen means work', () => {
    const scene = buildScene(placedFor(ALL_MEMBER_STATES));
    for (const fig of scene) {
      if (fig.place === 'desk') {
        expect(fig.desk, `${fig.pose} at a desk`).toBeDefined();
        expect(fig.desk!.lit).toBe(fig.pose !== 'sitting-idle');
      } else {
        expect(fig.desk).toBeUndefined();
      }
    }
  });

  it('is deterministic — the same members always get the same floor plan', () => {
    const placed = placedFor(ALL_MEMBER_STATES);
    expect(buildScene(placed)).toEqual(buildScene(placed));
  });

  it('overflowing a place staggers rather than stacking people on one pixel', () => {
    const many = Array.from({ length: 14 }, (_, i) => ({
      actorId: `a${i}`,
      spec: poseFor('working'),
    }));
    const scene = buildScene(many);
    const spots = new Set(scene.map((f) => `${f.x},${f.y}`));
    expect(spots.size).toBe(many.length);
  });
});
