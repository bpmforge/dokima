import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * W18-01: the canvas never blocks behind a native dialog. window.confirm
 * froze the whole tab during the 2026-08-21 live design pass; every
 * confirmation is now the in-app two-click ArmedButton. This sweep keeps a
 * new one from creeping back in.
 */
describe('no native blocking dialogs (W18-01)', () => {
  it('no user-reachable code path calls window.confirm/alert/prompt', () => {
    const srcRoot = fileURLToPath(new URL('..', import.meta.url));
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (/\.tsx?$/.test(entry.name) && !entry.name.includes('.test.')) {
          const text = readFileSync(full, 'utf8');
          if (/window\.(confirm|alert|prompt)\(/.test(text)) offenders.push(full);
        }
      }
    };
    walk(srcRoot);
    expect(offenders).toEqual([]);
  });
});
