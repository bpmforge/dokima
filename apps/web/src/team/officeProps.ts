/**
 * The furniture (W21-01) — desks with a real computer on them, a water cooler,
 * a couch, plants, a whiteboard.
 *
 * Same rule as the characters: drawn into a grid, baked once, blitted after.
 * The desk is the one prop with two states, because a lit screen is the only
 * furniture detail that carries meaning — somebody is sitting there working.
 * Everything else is scenery and never encodes state.
 */
import { bake, grid, outline, rect, ellipse, type Grid } from './officeArt.js';

const SHADOW = '#1a1520';

function prop(w: number, h: number, draw: (g: Grid) => void): HTMLCanvasElement | null {
  const g = grid(w, h);
  draw(g);
  return bake(outline(g, SHADOW));
}

/** A CRT-era workstation: monitor on a stand, keyboard, mug, papers, drawers. */
function desk(lit: boolean): HTMLCanvasElement | null {
  return prop(34, 30, (g) => {
    rect(g, 9, 0, 16, 13, '#2f3743');            // monitor shell
    rect(g, 9, 0, 16, 1, '#4d5b70');             // lit top bezel
    rect(g, 23, 1, 2, 12, '#1d232c');            // right-side shading
    rect(g, 11, 2, 12, 9, lit ? '#13384c' : '#0d2230');
    if (lit) {
      // Code on the screen. Ragged line lengths read as text at this scale.
      const lines: readonly [number, string][] = [
        [9, '#79ecd0'], [6, '#8fd2ff'], [11, '#79ecd0'],
        [5, '#ffdf95'], [8, '#8fd2ff'], [7, '#79ecd0'],
      ];
      lines.forEach(([len, colour], i) => rect(g, 12, 3 + i, len, 1, colour));
    }
    rect(g, 15, 13, 4, 3, '#3d4653');            // monitor neck
    rect(g, 12, 16, 10, 2, '#2f3743');           // monitor foot
    rect(g, 0, 18, 34, 6, '#bd8e5e');            // desktop
    rect(g, 0, 18, 34, 1, '#dcaf80');
    rect(g, 0, 23, 34, 1, '#8e6844');
    rect(g, 0, 24, 34, 3, '#805d3b');            // desk edge
    for (let i = 2; i < 34; i += 7) rect(g, i, 20, 4, 1, '#b1834f');  // wood grain
    rect(g, 8, 19, 15, 3, '#eae4d8');            // keyboard
    rect(g, 8, 19, 15, 1, '#f9f5ee');
    for (let i = 9; i < 22; i += 2) rect(g, i, 20, 1, 1, '#bcb5a7');  // key rows
    rect(g, 25, 20, 3, 2, '#eae4d8');            // mouse
    rect(g, 3, 17, 4, 5, '#e06f5e');             // mug
    rect(g, 3, 17, 4, 1, '#f28f7e');
    rect(g, 7, 18, 1, 2, '#e06f5e');             // handle
    rect(g, 25, 27, 9, 3, '#71512f');            // drawer pedestal
    rect(g, 27, 28, 5, 1, '#cca46e');
  });
}

export interface PropSprites {
  readonly deskLit: HTMLCanvasElement | null;
  readonly deskDark: HTMLCanvasElement | null;
  readonly chair: HTMLCanvasElement | null;
  readonly cooler: HTMLCanvasElement | null;
  readonly couch: HTMLCanvasElement | null;
  readonly table: HTMLCanvasElement | null;
  readonly plant: HTMLCanvasElement | null;
  readonly whiteboard: HTMLCanvasElement | null;
  readonly rug: HTMLCanvasElement | null;
}

export function bakeProps(): PropSprites {
  return {
    deskLit: desk(true),
    deskDark: desk(false),

    chair: prop(14, 11, (g) => {
      rect(g, 1, 0, 12, 6, '#4a5570');
      rect(g, 1, 0, 12, 1, '#68779a');
      rect(g, 1, 6, 12, 2, '#333c52');
      rect(g, 6, 8, 2, 2, '#232a3a');
      rect(g, 4, 10, 7, 1, '#232a3a');
    }),

    // The water cooler Brad asked for: bottle, bubble, spigot, drip tray.
    cooler: prop(16, 32, (g) => {
      ellipse(g, 8, 7, 5, 6, '#86dcf2');
      rect(g, 5, 9, 7, 4, '#86dcf2');
      ellipse(g, 6, 5, 3, 3, '#b6ecfa');        // the bubble catching the light
      rect(g, 6, 2, 5, 3, '#63bed4');           // bottle neck
      rect(g, 3, 13, 11, 15, '#ecf2f6');        // body
      rect(g, 3, 13, 11, 2, '#fbfeff');
      rect(g, 12, 13, 2, 15, '#c6d0d8');
      rect(g, 6, 17, 5, 3, '#434e5c');          // spigot plate
      rect(g, 7, 20, 1, 3, '#93a4ae');          // tap
      rect(g, 5, 25, 7, 1, '#a3b4be');          // drip tray
      rect(g, 3, 28, 11, 4, '#c6d0d8');         // base
    }),

    couch: prop(48, 23, (g) => {
      rect(g, 0, 0, 48, 8, '#cc5e6e');
      rect(g, 0, 0, 48, 2, '#e47e8e');
      rect(g, 0, 8, 48, 10, '#b44e60');
      for (let i = 2; i < 44; i += 15) {
        rect(g, i, 9, 13, 8, '#c85b6e');
        rect(g, i, 9, 13, 1, '#dc6e80');
      }
      rect(g, 0, 18, 48, 3, '#8e3a4a');
      rect(g, 2, 21, 4, 2, '#5e2834');
      rect(g, 42, 21, 4, 2, '#5e2834');
    }),

    table: prop(26, 15, (g) => {
      rect(g, 0, 0, 26, 8, '#cca46e');
      rect(g, 0, 0, 26, 1, '#e4c18c');
      rect(g, 0, 7, 26, 2, '#9e7c4c');
      rect(g, 3, 9, 3, 6, '#805d3b');
      rect(g, 20, 9, 3, 6, '#805d3b');
      rect(g, 8, 1, 7, 4, '#f4f0e4');
      rect(g, 9, 2, 5, 1, '#ff9e6e');
      rect(g, 9, 3, 5, 1, '#e07e5e');
    }),

    plant: prop(18, 25, (g) => {
      const fronds: readonly [number, number, number, number][] = [
        [9, 4, 7, 5], [4, 8, 5, 4], [14, 8, 4, 4], [9, 11, 6, 4],
      ];
      fronds.forEach(([a, b, c, d]) => ellipse(g, a, b, c, d, '#43a25e'));
      ellipse(g, 7, 5, 4, 3, '#63c87e');
      ellipse(g, 11, 10, 3, 2, '#63c87e');
      rect(g, 8, 13, 2, 5, '#5e4429');
      rect(g, 4, 18, 10, 7, '#b46e3e');
      rect(g, 4, 18, 10, 2, '#cc8854');
      rect(g, 12, 18, 2, 7, '#8e522c');
    }),

    whiteboard: prop(42, 24, (g) => {
      rect(g, 0, 0, 42, 21, '#ecf0ec');
      rect(g, 0, 0, 42, 2, '#fcfffc');
      rect(g, 0, 19, 42, 2, '#bcc0bc');
      rect(g, 4, 5, 16, 1, '#4e8acc');
      rect(g, 4, 8, 22, 1, '#4e8acc');
      rect(g, 4, 11, 12, 1, '#d45e4e');
      rect(g, 4, 15, 18, 1, '#4e8acc');
      rect(g, 28, 4, 10, 9, '#93c393');
      rect(g, 0, 21, 42, 3, '#6e6e76');
    }),

    rug: (() => {
      const g = grid(74, 36);
      rect(g, 0, 0, 74, 36, '#4e6e8e');
      rect(g, 3, 3, 68, 30, '#6388ac');
      rect(g, 8, 8, 58, 20, '#4e6e8e');
      rect(g, 0, 0, 74, 1, '#7ea0c0');
      rect(g, 0, 35, 74, 1, '#3a5470');
      return bake(g);
    })(),
  };
}
