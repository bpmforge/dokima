/**
 * The room (W21-01) — a Stardew-style interior, drawn to a 2D context.
 *
 * The formula that makes an interior read as a ROOM rather than a top-down
 * map: the floor is drawn top-down, but the wall is drawn FACE-ON as a band
 * across the top. The band is layered, top to bottom — crown moulding,
 * wallpaper field, chair rail, wainscot, baseboard — and everything mounted on
 * the wall lives strictly inside that band, never over floor pixels.
 *
 * The window is the detail that sells it: its sill is drawn WIDER than the
 * frame and carries a shadow line beneath. That overhang is what makes a
 * window read as set *into* the wall instead of stickered onto it.
 */

export interface Palette {
  readonly field: string; readonly stripe: string;
  readonly wains: string; readonly wainL: string; readonly wainD: string;
  readonly rail: string; readonly railL: string;
  readonly crown: string; readonly crownL: string;
  readonly base: string; readonly baseL: string;
}

export const WALLPAPER_WORK: Palette = {
  field: '#cfc6a8', stripe: '#c3b898', wains: '#b9a883', wainL: '#c9baa0',
  wainD: '#a0906f', rail: '#8a6a48', railL: '#a8825a', crown: '#8a6a48',
  crownL: '#a8825a', base: '#6f5234', baseL: '#8a6a48',
};

export const WALLPAPER_BREAK: Palette = {
  field: '#b6d8c6', stripe: '#a6ccb8', wains: '#95bda9', wainL: '#a9cdba',
  wainD: '#7fa891', rail: '#6f8f7c', railL: '#8aa896', crown: '#6f8f7c',
  crownL: '#8aa896', base: '#4f6a5b', baseL: '#6f8f7c',
};

export const WALLPAPER_YOURS: Palette = {
  field: '#b9c6de', stripe: '#a9b8d4', wains: '#9aabc8', wainL: '#aebcd6',
  wainD: '#8493b0', rail: '#6d7c98', railL: '#8895b0', crown: '#6d7c98',
  crownL: '#8895b0', base: '#4e5a72', baseL: '#6d7c98',
};

/** Stage geometry. The canvas is fixed-size and scaled by CSS to fit. */
export const STAGE_W = 1020;
export const STAGE_H = 620;
/** Height of the face-on wall band. Everything above this line is wall. */
export const WALL_H = 112;
/** The divider between the work floor and the break room, and its doorway. */
export const DIVIDER_X = 520;
export const DIVIDER_W = 14;
export const DOORWAY: readonly [number, number] = [300, 372];
/** Your office is walled off the break room by its own band, with its own door. */
export const YOURS_Y = 400;
export const YOURS_WALL_H = 46;
export const YOURS_DOOR: readonly [number, number] = [700, 768];

type Ctx = CanvasRenderingContext2D;

/** Plank flooring for the work side; running bond, seams shaded. */
function plankFloor(ctx: Ctx, x: number, y: number, w: number, h: number): void {
  for (let j = y; j < y + h; j += 34) {
    const offset = ((j / 34) | 0) % 2 ? 30 : 0;
    for (let i = x - offset; i < x + w; i += 76) {
      ctx.fillStyle = '#d3ac79'; ctx.fillRect(i, j, 76, 34);
      ctx.fillStyle = '#c69a67'; ctx.fillRect(i, j + 30, 76, 4);   // seam shadow
      ctx.fillStyle = '#dcb885'; ctx.fillRect(i, j, 76, 2);        // lit top edge
      ctx.fillStyle = '#c69a67'; ctx.fillRect(i, j, 2, 34);
      ctx.fillStyle = '#caa06d'; ctx.fillRect(i + 14, j + 12, 26, 2);
      ctx.fillStyle = '#caa06d'; ctx.fillRect(i + 48, j + 22, 18, 2);
    }
  }
}

/** Checkerboard tile for the break room, with a sheen on each tile. */
function tileFloor(ctx: Ctx, x: number, y: number, w: number, h: number): void {
  for (let j = y; j < y + h; j += 38) {
    for (let i = x; i < x + w; i += 38) {
      const alt = (((i / 38) | 0) + ((j / 38) | 0)) % 2;
      ctx.fillStyle = alt ? '#cfe3d6' : '#dfeee4';
      ctx.fillRect(i, j, 38, 38);
      ctx.fillStyle = '#b9d2c4';
      ctx.fillRect(i, j + 36, 38, 2);
      ctx.fillRect(i + 36, j, 2, 38);
      ctx.fillStyle = '#eef7f0'; ctx.fillRect(i + 3, j + 3, 10, 3);
    }
  }
}

/** Cut-pile carpet for your office — the one room that is not a work floor. */
function carpetFloor(ctx: Ctx, x: number, y: number, w: number, h: number): void {
  ctx.fillStyle = '#7d90b4';
  ctx.fillRect(x, y, w, h);
  for (let j = y; j < y + h; j += 6) {
    ctx.fillStyle = ((j / 6) | 0) % 2 ? '#7788ac' : '#8296b8';
    ctx.fillRect(x, j, w, 3);
  }
  ctx.fillStyle = '#66759a';
  ctx.fillRect(x + 10, y + 10, w - 20, 4);
  ctx.fillRect(x + 10, y + h - 14, w - 20, 4);
  ctx.fillRect(x + 10, y + 10, 4, h - 20);
  ctx.fillRect(x + w - 14, y + 10, 4, h - 20);
}

function floor(
  ctx: Ctx, x: number, y: number, w: number, h: number,
  kind: 'plank' | 'tile' | 'carpet',
): void {
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  if (kind === 'plank') plankFloor(ctx, x, y, w, h);
  else if (kind === 'tile') tileFloor(ctx, x, y, w, h);
  else carpetFloor(ctx, x, y, w, h);
  ctx.restore();
}

/** One wall band: crown / wallpaper / chair rail / wainscot / baseboard. */
export function wallBand(
  ctx: Ctx, x: number, y: number, w: number, h: number, pal: Palette,
): void {
  const crown = 6;
  const base = 12;
  const rail = Math.round(h * 0.6);
  ctx.fillStyle = pal.field; ctx.fillRect(x, y, w, h);
  for (let i = x; i < x + w; i += 16) {
    ctx.fillStyle = pal.stripe;
    ctx.fillRect(i, y + crown, 7, rail - crown);
  }
  ctx.fillStyle = pal.wains; ctx.fillRect(x, y + rail, w, h - rail - base);
  for (let i = x + 6; i < x + w - 10; i += 42) {
    ctx.fillStyle = pal.wainL; ctx.fillRect(i, y + rail + 5, 30, 2);
    ctx.fillStyle = pal.wainD; ctx.fillRect(i, y + h - base - 6, 30, 2);
  }
  ctx.fillStyle = pal.rail; ctx.fillRect(x, y + rail - 4, w, 5);
  ctx.fillStyle = pal.railL; ctx.fillRect(x, y + rail - 4, w, 2);
  ctx.fillStyle = pal.crown; ctx.fillRect(x, y, w, crown);
  ctx.fillStyle = pal.crownL; ctx.fillRect(x, y, w, 2);
  ctx.fillStyle = pal.base; ctx.fillRect(x, y + h - base, w, base);
  ctx.fillStyle = pal.baseL; ctx.fillRect(x, y + h - base, w, 3);
  ctx.fillStyle = 'rgba(0,0,0,.22)'; ctx.fillRect(x, y + h, w, 4);  // floor contact
}

/**
 * A window set INTO the wall band. The sill is drawn 7px wider on each side
 * than the frame and carries a shadow line under it — the overhang is the
 * whole trick.
 */
export function wallWindow(ctx: Ctx, x: number, y: number, w: number, h: number): void {
  ctx.fillStyle = '#5e4028'; ctx.fillRect(x - 3, y - 3, w + 6, h + 6);
  ctx.fillStyle = '#7d5738'; ctx.fillRect(x - 3, y - 3, w + 6, 3);
  ctx.fillStyle = '#9fd8ef'; ctx.fillRect(x, y, w, h);
  ctx.fillStyle = '#83c6e4'; ctx.fillRect(x, y + h * 0.55, w, h * 0.45);
  ctx.fillStyle = '#ffffff';
  ctx.beginPath(); ctx.ellipse(x + w * 0.33, y + h * 0.34, 11, 5, 0, 0, 7); ctx.fill();
  ctx.beginPath(); ctx.ellipse(x + w * 0.68, y + h * 0.26, 8, 4, 0, 0, 7); ctx.fill();
  ctx.fillStyle = '#3f9e5a'; ctx.fillRect(x, y + h - 7, w, 7);      // hedge outside
  ctx.fillStyle = '#5e4028';                                         // muntins
  ctx.fillRect(x + w / 2 - 2, y, 4, h);
  ctx.fillRect(x, y + h / 2 - 2, w, 4);
  ctx.fillStyle = 'rgba(255,255,255,.22)'; ctx.fillRect(x + 2, y + 2, w - 4, 4);
  ctx.fillStyle = '#8a6242'; ctx.fillRect(x - 7, y + h + 3, w + 14, 7);   // sill
  ctx.fillStyle = '#a8825a'; ctx.fillRect(x - 7, y + h + 3, w + 14, 2);
  ctx.fillStyle = 'rgba(0,0,0,.28)'; ctx.fillRect(x - 7, y + h + 10, w + 14, 3);
}

export function wallClock(ctx: Ctx, x: number, y: number, r: number): void {
  ctx.fillStyle = '#5e4028'; ctx.beginPath(); ctx.arc(x, y, r + 3, 0, 7); ctx.fill();
  ctx.fillStyle = '#f4ecd8'; ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fill();
  ctx.strokeStyle = '#3a2e22'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y - r + 5); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + r - 7, y + 3); ctx.stroke();
}

/** Daylight pooling on the floor under a window — the room's only warmth. */
function sunPool(ctx: Ctx, x: number, y: number, w: number): void {
  ctx.save();
  ctx.globalAlpha = 0.13;
  ctx.fillStyle = '#fff8d0';
  ctx.beginPath();
  ctx.moveTo(x, y); ctx.lineTo(x + w, y);
  ctx.lineTo(x + w + 26, y + 92); ctx.lineTo(x - 26, y + 92);
  ctx.closePath(); ctx.fill();
  ctx.restore();
}

/** Soft contact shadow under a prop or a character. */
export function contactShadow(ctx: Ctx, cx: number, cy: number, rx: number): void {
  ctx.save();
  ctx.globalAlpha = 0.2;
  ctx.fillStyle = '#000';
  ctx.beginPath();
  ctx.ellipse(cx, cy, rx, 5, 0, 0, 7);
  ctx.fill();
  ctx.restore();
}

/** The empty room: shell, floors, walls, wall fittings. Props come after. */
export function drawRoom(ctx: Ctx): void {
  ctx.fillStyle = '#241c17';
  ctx.fillRect(0, 0, STAGE_W, STAGE_H);
  floor(ctx, 8, WALL_H, DIVIDER_X - 8, STAGE_H - WALL_H - 8, 'plank');
  floor(ctx, DIVIDER_X + DIVIDER_W, WALL_H,
    STAGE_W - 8 - (DIVIDER_X + DIVIDER_W), YOURS_Y - WALL_H, 'tile');
  floor(ctx, DIVIDER_X + DIVIDER_W, YOURS_Y + YOURS_WALL_H,
    STAGE_W - 8 - (DIVIDER_X + DIVIDER_W),
    STAGE_H - 8 - (YOURS_Y + YOURS_WALL_H), 'carpet');
  sunPool(ctx, 146, WALL_H, 124);
  sunPool(ctx, 388, WALL_H, 124);
  sunPool(ctx, 700, WALL_H, 124);

  wallBand(ctx, 0, 0, DIVIDER_X, WALL_H, WALLPAPER_WORK);
  wallBand(ctx, DIVIDER_X, 0, STAGE_W - DIVIDER_X, WALL_H, WALLPAPER_BREAK);
  wallWindow(ctx, 146, 26, 124, 54);
  wallWindow(ctx, 388, 26, 124, 54);
  wallWindow(ctx, 700, 26, 124, 54);
  wallWindow(ctx, 870, 26, 100, 54);
  wallClock(ctx, 604, 52, 17);

  // The divider, interrupted by a doorway people actually walk through.
  const segments: readonly [number, number][] = [
    [WALL_H, DOORWAY[0]], [DOORWAY[1], STAGE_H - 8],
  ];
  for (const [a, b] of segments) {
    ctx.fillStyle = '#6f5234'; ctx.fillRect(DIVIDER_X, a, DIVIDER_W, b - a);
    ctx.fillStyle = '#8a6a48'; ctx.fillRect(DIVIDER_X, a, 4, b - a);
    ctx.fillStyle = '#4e3922'; ctx.fillRect(DIVIDER_X + DIVIDER_W - 4, a, 4, b - a);
  }
  ctx.fillStyle = '#4e3922';
  ctx.fillRect(DIVIDER_X, DOORWAY[0] - 6, DIVIDER_W, 6);
  ctx.fillRect(DIVIDER_X, DOORWAY[1], DIVIDER_W, 6);

  // Your office: its own wall band across the break room, with its own door.
  const right = STAGE_W - 8;
  for (const [a, b] of [[DIVIDER_X + DIVIDER_W, YOURS_DOOR[0]], [YOURS_DOOR[1], right]] as const) {
    wallBand(ctx, a, YOURS_Y, b - a, YOURS_WALL_H, WALLPAPER_YOURS);
  }
  ctx.fillStyle = '#2a2118';
  ctx.fillRect(YOURS_DOOR[0], YOURS_Y, YOURS_DOOR[1] - YOURS_DOOR[0], YOURS_WALL_H);
  ctx.fillStyle = '#6f5234';
  ctx.fillRect(YOURS_DOOR[0] - 5, YOURS_Y, 5, YOURS_WALL_H);
  ctx.fillRect(YOURS_DOOR[1], YOURS_Y, 5, YOURS_WALL_H);
  ctx.fillStyle = '#8a6a48';
  ctx.fillRect(YOURS_DOOR[0] - 5, YOURS_Y, YOURS_DOOR[1] - YOURS_DOOR[0] + 10, 4);
}
