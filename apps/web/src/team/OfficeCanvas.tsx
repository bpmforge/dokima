/**
 * The office, painted (W21-01).
 *
 * This component is BACKGROUND PAINT and nothing else. It owns no state, reads
 * no store, and decides nothing: it takes a `SceneFigure[]` — already derived
 * from `deriveMemberState` -> `poseFor` -> `buildScene` — and blits it. The
 * clickable, focusable, screen-readable office is the DOM layer above it in
 * `OfficeSkin`, which is why every existing assertion still holds.
 *
 * Under `prefers-reduced-motion` the loop never starts and one static frame is
 * painted, which is also the right default for an app that sits open all day.
 */
import { useEffect, useRef } from 'react';
import { framesFor, type CharacterFrames } from './officeArt.js';
import { bakeProps, type PropSprites } from './officeProps.js';
import {
  contactShadow, drawRoom, STAGE_H, STAGE_W, YOURS_Y, YOURS_WALL_H,
} from './officeRoom.js';
import { DESK_SPOTS, figureFlipped, figureX, type SceneFigure } from './scene.js';
import type { Pose } from './poses.js';

/** Pose -> which baked frame to blit. Total over the union, by construction. */
const FRAME: Record<Pose, (f: CharacterFrames, t: number) => HTMLCanvasElement | null> = {
  // The one animation that means something: keys actually moving.
  'sitting-typing': (f, t) => (Math.floor(t * 6) % 2 ? f.sitTyping : f.sit),
  'sitting-reading': (f) => f.sit,
  'sitting-checking': (f) => f.sit,
  'standing-waiting': (f) => f.standing,
  'walking-handoff': (f, t) => f.walk[Math.floor(t * 6) % f.walk.length] ?? f.carrying,
  'sitting-idle': (f) => f.lounge,
  celebrating: (f, t) => (Math.floor(t * 3) % 2 ? f.raising : f.standing),
};

let props: PropSprites | null = null;
function propSprites(): PropSprites {
  props ??= bakeProps();
  return props;
}

function blit(
  ctx: CanvasRenderingContext2D,
  sprite: HTMLCanvasElement | null,
  x: number,
  y: number,
): void {
  if (sprite) ctx.drawImage(sprite, Math.round(x), Math.round(y));
}

/** Scenery: the break room's cooler and couch, the plants, the whiteboard. */
function drawProps(ctx: CanvasRenderingContext2D): void {
  const p = propSprites();
  const yoursFloor = YOURS_Y + YOURS_WALL_H;
  blit(ctx, p.rug, 700, yoursFloor + 30);
  const placed: readonly [HTMLCanvasElement | null, number, number][] = [
    [p.whiteboard, 300, 300],
    [p.plant, 452, 180],
    [p.plant, 452, 470],
    [p.cooler, 546, 130],      // the water cooler people walk to
    [p.couch, 620, 140],
    [p.table, 790, 150],
    [p.plant, 950, 130],
    [p.chair, 600, yoursFloor + 98],
    [p.chair, 710, yoursFloor + 98],
    [p.chair, 820, yoursFloor + 98],
  ];
  for (const [sprite, x, y] of placed) {
    if (!sprite) continue;
    contactShadow(ctx, x + sprite.width / 2, y + sprite.height - 3, sprite.width * 0.42);
    blit(ctx, sprite, x, y);
  }
}

function paint(
  ctx: CanvasRenderingContext2D,
  figures: readonly SceneFigure[],
  t: number,
): void {
  drawRoom(ctx);
  drawProps(ctx);
  const p = propSprites();
  // Every desk is drawn, occupied or not — the studio is furniture, not a
  // headcount. Screens light only where the scene seated somebody.
  const lit = new Set(
    figures.filter((f) => f.desk?.lit).map((f) => `${f.desk!.x},${f.desk!.y}`),
  );
  for (const [x, y] of DESK_SPOTS) {
    const occupied = lit.has(`${x},${y}`);
    if (p.deskDark) {
      contactShadow(ctx, x + p.deskDark.width / 2, y + p.deskDark.height - 4,
        p.deskDark.width * 0.4);
    }
    blit(ctx, occupied ? p.deskLit : p.deskDark, x, y);
  }
  // Painter's order — lower on the stage draws later, so it overlaps correctly.
  for (const fig of [...figures].sort((a, b) => a.y - b.y)) {
    const frames = framesFor(fig.actorId);
    const sprite = FRAME[fig.pose](frames, t + fig.phase);
    if (!sprite) continue;
    const x = figureX(fig, t);
    contactShadow(ctx, x + sprite.width / 2, fig.y + sprite.height - 4, sprite.width * 0.38);
    if (figureFlipped(fig, t)) {
      ctx.save();
      ctx.translate(Math.round(x) + sprite.width, Math.round(fig.y));
      ctx.scale(-1, 1);
      ctx.drawImage(sprite, 0, 0);
      ctx.restore();
    } else {
      blit(ctx, sprite, x, fig.y);
    }
  }
}

export interface OfficeCanvasProps {
  readonly figures: readonly SceneFigure[];
}

export function OfficeCanvas({ figures }: OfficeCanvasProps) {
  const ref = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    // jsdom (and any context-less environment) simply gets no painting; the
    // DOM office above this canvas is unaffected. jsdom THROWS rather than
    // returning null, so this is a try, not a null check.
    let ctx: CanvasRenderingContext2D | null = null;
    try {
      ctx = canvas.getContext('2d');
    } catch {
      return;
    }
    if (!ctx) return;
    ctx.imageSmoothingEnabled = false;

    const reduced =
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    if (reduced) {
      paint(ctx, figures, 0);
      return;
    }

    let raf = 0;
    let start: number | null = null;
    const tick = (now: number) => {
      start ??= now;
      paint(ctx, figures, (now - start) / 1000);
      raf = window.requestAnimationFrame(tick);
    };
    raf = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(raf);
  }, [figures]);

  return (
    <canvas
      ref={ref}
      className="office__stage"
      data-testid="office-stage"
      width={STAGE_W}
      height={STAGE_H}
      // Decorative: every fact it paints is stated in the DOM figures above it.
      aria-hidden="true"
    />
  );
}
