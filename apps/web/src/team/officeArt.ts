/**
 * The office's pixel art, generated (W21-01).
 *
 * Every sprite here is drawn procedurally into a small integer grid and then
 * baked once to an offscreen canvas at 3x. Nothing is loaded, nothing is
 * licensed, and nothing can 404 — the art ships as the code that draws it.
 *
 * Two rules keep it honest. Sprites are baked ONCE per palette and cached, so
 * the animation loop only ever blits. And the character bakers expose exactly
 * the frames the pose mapping can ask for (see `poses.ts`): there is no
 * "generic wander" frame, because there is no state that would justify one.
 */

/** A small paletted grid — the unit every sprite is drawn in before baking. */
export interface Grid {
  readonly w: number;
  readonly h: number;
  d: (string | null)[];
}

export function grid(w: number, h: number): Grid {
  return { w, h, d: new Array<string | null>(w * h).fill(null) };
}

export function pset(g: Grid, x: number, y: number, c: string): void {
  const i = x | 0;
  const j = y | 0;
  if (i >= 0 && j >= 0 && i < g.w && j < g.h) g.d[j * g.w + i] = c;
}

export function pget(g: Grid, x: number, y: number): string | null {
  if (x < 0 || y < 0 || x >= g.w || y >= g.h) return null;
  return g.d[y * g.w + x] ?? null;
}

/** Filled rectangle. */
export function rect(
  g: Grid, x: number, y: number, w: number, h: number, c: string,
): void {
  for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) pset(g, i, j, c);
}

/** Filled ellipse — the only curve primitive the art needs. */
export function ellipse(
  g: Grid, cx: number, cy: number, rx: number, ry: number, c: string,
): void {
  for (let j = 0; j < g.h; j++) {
    for (let i = 0; i < g.w; i++) {
      const a = (i - cx + 0.5) / rx;
      const b = (j - cy + 0.5) / ry;
      if (a * a + b * b <= 1) pset(g, i, j, c);
    }
  }
}

/** One-pixel outline in `c`, the 32-bit-era read that makes shapes pop. */
export function outline(g: Grid, c: string): Grid {
  const out = g.d.slice();
  const neighbours: readonly [number, number][] = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  for (let j = 0; j < g.h; j++) {
    for (let i = 0; i < g.w; i++) {
      if (pget(g, i, j)) continue;
      const touches = neighbours.some(([a, b]) => {
        const v = pget(g, i + a, j + b);
        return v !== null && v !== c;
      });
      if (touches) out[j * g.w + i] = c;
    }
  }
  g.d = out;
  return g;
}

/** Pixel scale. 3x is the PS1-era chunk that still fits a desk-sized room. */
export const SCALE = 3;

/**
 * Bake a grid to an offscreen canvas. Returns null where 2D canvas is not
 * available (jsdom under test), which every caller treats as "do not paint" —
 * the DOM figures remain the office's real, assertable surface.
 */
export function bake(g: Grid): HTMLCanvasElement | null {
  const c = document.createElement('canvas');
  c.width = g.w * SCALE;
  c.height = g.h * SCALE;
  let x: CanvasRenderingContext2D | null = null;
  try {
    x = c.getContext('2d');
  } catch {
    return null;  // jsdom throws here; the DOM office does not need the paint.
  }
  if (!x) return null;
  for (let j = 0; j < g.h; j++) {
    for (let i = 0; i < g.w; i++) {
      const v = g.d[j * g.w + i];
      if (v) {
        x.fillStyle = v;
        x.fillRect(i * SCALE, j * SCALE, SCALE, SCALE);
      }
    }
  }
  return c;
}

/* ---------------------------------------------------------------- people -- */

export const CHAR_W = 16;
export const CHAR_H = 26;

export interface Palette {
  readonly hl: string; readonly hm: string; readonly hd: string;
  readonly sl: string; readonly sm: string; readonly sd: string;
  readonly sk: string; readonly skd: string;
  readonly ey: string; readonly bl: string; readonly mo: string;
  readonly pa: string; readonly pd: string; readonly sh: string; readonly ol: string;
  readonly ch: string; readonly chl: string; readonly chd: string;
}

const HAIR: Record<string, readonly [string, string, string]> = {
  brown: ['#b98a55', '#8a5f34', '#5c3d20'],
  black: ['#5a5f74', '#33384a', '#1e2130'],
  dark: ['#7a5540', '#523524', '#331f14'],
  pink: ['#ffc2dd', '#ee79ac', '#b04b7c'],
  blonde: ['#ffe9a8', '#e8c15e', '#a8862c'],
  silver: ['#ece1c9', '#c0b49c', '#7e7462'],
  ginger: ['#ffb06a', '#e07a30', '#a04c16'],
  violet: ['#c9a6f0', '#8455c4', '#4e2f80'],
};

const SHIRT: Record<string, readonly [string, string, string]> = {
  teal: ['#8fecdd', '#33b4a6', '#1c7a70'],
  lav: ['#d6bcff', '#9a6fe0', '#5d3f9c'],
  sky: ['#b8dcff', '#5aa2e0', '#33689e'],
  rose: ['#ffc0d6', '#e8698f', '#a63f62'],
  indigo: ['#a9b4f8', '#5b68d4', '#333c92'],
  slate: ['#d2dbe2', '#8fa0ac', '#5c6d79'],
  amber: ['#ffdc9a', '#e8a63c', '#a3711c'],
  orange: ['#ffc296', '#e8763c', '#a34a18'],
};

export const HAIR_KEYS = Object.keys(HAIR);
export const SHIRT_KEYS = Object.keys(SHIRT);

export function palette(hair: string, shirt: string, skin = '#f6cfa6'): Palette {
  const [hl, hm, hd] = HAIR[hair] ?? HAIR.brown!;
  const [sl, sm, sd] = SHIRT[shirt] ?? SHIRT.teal!;
  return {
    hl, hm, hd, sl, sm, sd,
    sk: skin, skd: '#dba87e', ey: '#1d2029', bl: '#f5928f', mo: '#b4635a',
    pa: '#3a4260', pd: '#2b3149', sh: '#241d22', ol: '#141220',
    ch: '#4a5570', chl: '#68779a', chd: '#333c52',
  };
}

type Facing = 'front' | 'side' | 'back';
type Arms = 'down' | 'type' | 'up' | 'hold';

function head(g: Grid, cx: number, top: number, p: Palette, face: Facing): void {
  ellipse(g, cx, top + 6, 5, 6, p.sk);
  for (let j = top; j < top + 13; j++) {
    let last = -1;
    for (let i = 0; i < g.w; i++) if (pget(g, i, j) === p.sk) last = i;
    if (last >= 0) { pset(g, last, j, p.skd); pset(g, last - 1, j, p.skd); }
  }
  if (face === 'back') {
    ellipse(g, cx, top + 6, 6, 6, p.hm);
    rect(g, cx - 6, top + 6, 12, 6, p.hm);
    ellipse(g, cx - 2, top + 3, 3, 3, p.hl);
    rect(g, cx - 3, top + 1, 4, 1, p.hl);
    rect(g, cx - 2, top + 12, 4, 2, p.sk);
    return;
  }
  ellipse(g, cx, top + 4, 6, 5, p.hm);
  ellipse(g, cx - 1, top + 2, 5, 3, p.hl);
  rect(g, cx - 6, top + 4, 2, 8, p.hm);
  rect(g, cx + 4, top + 4, 2, 8, p.hm);
  rect(g, cx + 5, top + 5, 1, 7, p.hd);
  if (face === 'front') {
    pset(g, cx - 3, top + 7, p.ey); pset(g, cx - 3, top + 8, p.ey);
    pset(g, cx + 2, top + 7, p.ey); pset(g, cx + 2, top + 8, p.ey);
    pset(g, cx - 4, top + 9, p.bl); pset(g, cx + 3, top + 9, p.bl);
    pset(g, cx - 1, top + 10, p.mo); pset(g, cx, top + 10, p.mo);
  } else {
    pset(g, cx + 1, top + 7, p.ey); pset(g, cx + 1, top + 8, p.ey);
    pset(g, cx + 3, top + 9, p.bl);
  }
  rect(g, cx - 2, top + 12, 4, 2, p.sk);
}

function torso(
  g: Grid, cx: number, top: number, p: Palette, arms: Arms, back: boolean,
): void {
  rect(g, cx - 5, top, 10, 8, p.sm);
  rect(g, cx - 5, top, 10, 2, p.sl);
  rect(g, cx + 3, top, 2, 8, p.sd);
  if (!back) rect(g, cx - 2, top, 4, 3, p.sl);
  if (arms === 'down') {
    rect(g, cx - 6, top + 1, 1, 6, p.sm); rect(g, cx + 5, top + 1, 1, 6, p.sm);
    rect(g, cx - 6, top + 7, 1, 2, p.sk); rect(g, cx + 5, top + 7, 1, 2, p.sk);
  } else if (arms === 'type') {
    rect(g, cx - 7, top + 3, 3, 3, p.sm); rect(g, cx + 4, top + 3, 3, 3, p.sm);
    rect(g, cx - 8, top + 5, 2, 2, p.sk); rect(g, cx + 6, top + 5, 2, 2, p.sk);
  } else if (arms === 'up') {
    rect(g, cx - 6, top - 2, 1, 5, p.sm); rect(g, cx + 5, top + 1, 1, 6, p.sm);
    rect(g, cx - 6, top - 4, 1, 2, p.sk); rect(g, cx + 5, top + 7, 1, 2, p.sk);
  } else {
    rect(g, cx - 6, top + 2, 2, 3, p.sm); rect(g, cx + 4, top + 2, 2, 3, p.sm);
    rect(g, cx - 6, top + 5, 2, 2, p.sk); rect(g, cx + 4, top + 5, 2, 2, p.sk);
  }
}

function legs(g: Grid, cx: number, top: number, p: Palette, step: number): void {
  if (step === 0) {
    rect(g, cx - 4, top, 3, 5, p.pa); rect(g, cx + 1, top, 3, 5, p.pa);
    rect(g, cx + 2, top, 1, 5, p.pd);
    rect(g, cx - 4, top + 5, 3, 2, p.sh); rect(g, cx + 1, top + 5, 3, 2, p.sh);
  } else if (step === 1) {
    rect(g, cx - 5, top, 3, 5, p.pa); rect(g, cx + 2, top, 3, 4, p.pa);
    rect(g, cx - 6, top + 5, 4, 2, p.sh); rect(g, cx + 2, top + 4, 3, 2, p.sh);
  } else {
    rect(g, cx - 4, top, 3, 4, p.pa); rect(g, cx + 2, top, 3, 5, p.pa);
    rect(g, cx - 4, top + 4, 3, 2, p.sh); rect(g, cx + 2, top + 5, 4, 2, p.sh);
  }
}

function standing(p: Palette, step: number, face: Facing, arms: Arms = 'down'): Grid {
  const g = grid(CHAR_W, CHAR_H);
  head(g, 8, 0, p, face);
  torso(g, 8, 13, p, arms, face === 'back');
  legs(g, 8, 21, p, step);
  return outline(g, p.ol);
}

function seated(p: Palette, typing: boolean): Grid {
  const g = grid(CHAR_W, CHAR_H);
  rect(g, 0, 16, 16, 10, p.ch);
  rect(g, 0, 16, 16, 2, p.chl);
  rect(g, 14, 16, 2, 10, p.chd);
  rect(g, 0, 24, 16, 2, p.chd);
  torso(g, 8, 14, p, typing ? 'type' : 'down', true);
  head(g, 8, 0, p, 'back');
  return outline(g, p.ol);
}

function lounging(p: Palette): Grid {
  const g = grid(CHAR_W, CHAR_H);
  head(g, 8, 2, p, 'front');
  torso(g, 8, 15, p, 'down', false);
  rect(g, 4, 23, 3, 3, p.pa);
  rect(g, 9, 23, 3, 3, p.pa);
  return outline(g, p.ol);
}

/**
 * The frames a character can be drawn in. This set is deliberately closed and
 * matches `poses.ts` one for one — a renderer cannot reach for a frame that no
 * member state would produce.
 */
export interface CharacterFrames {
  readonly sit: HTMLCanvasElement | null;
  readonly sitTyping: HTMLCanvasElement | null;
  readonly lounge: HTMLCanvasElement | null;
  readonly walk: readonly (HTMLCanvasElement | null)[];
  readonly standing: HTMLCanvasElement | null;
  readonly raising: HTMLCanvasElement | null;
  readonly carrying: HTMLCanvasElement | null;
}

export function bakeCharacter(p: Palette): CharacterFrames {
  return {
    sit: bake(seated(p, false)),
    sitTyping: bake(seated(p, true)),
    lounge: bake(lounging(p)),
    walk: [0, 1, 0, 2].map((step) => bake(standing(p, step, 'side'))),
    standing: bake(standing(p, 0, 'front')),
    raising: bake(standing(p, 0, 'front', 'up')),
    carrying: bake(standing(p, 0, 'side', 'hold')),
  };
}

/**
 * A stable look per member. Derived from the actor id so the same person is
 * the same person across reloads, and so a member with no persona still gets
 * a body — the office never leaves a real actor undrawn.
 */
export function paletteFor(actorId: string): Palette {
  let hash = 0;
  for (let i = 0; i < actorId.length; i++) {
    hash = (hash * 31 + actorId.charCodeAt(i)) >>> 0;
  }
  const hair = HAIR_KEYS[hash % HAIR_KEYS.length]!;
  const shirt = SHIRT_KEYS[(hash >> 5) % SHIRT_KEYS.length]!;
  const skins = ['#f6cfa6', '#e8b98a', '#d9a066', '#c98d5a'];
  return palette(hair, shirt, skins[(hash >> 11) % skins.length]!);
}

/** Baked frames, cached per actor — the loop blits, it never re-bakes. */
const CACHE = new Map<string, CharacterFrames>();

export function framesFor(actorId: string): CharacterFrames {
  const hit = CACHE.get(actorId);
  if (hit) return hit;
  const made = bakeCharacter(paletteFor(actorId));
  CACHE.set(actorId, made);
  return made;
}
