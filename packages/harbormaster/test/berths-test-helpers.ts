/**
 * Shared randomized-testing helpers for the berths suite. `fast-check` is
 * a devDependency of `@shipwright/events`/`@shipwright/tickets` only —
 * out of this ticket's write_scope to add to
 * `packages/harbormaster/package.json` — so property-style coverage here
 * uses a small seeded PRNG instead: deterministic per run (failures
 * reproduce from the printed seed) without a new dependency.
 */

/** mulberry32: tiny, fast, decent-enough distribution for test fixtures (not cryptographic). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function randInt(rng: () => number, min: number, max: number): number {
  return min + Math.floor(rng() * (max - min + 1));
}

export function pick<T>(rng: () => number, items: readonly T[]): T {
  const item = items[randInt(rng, 0, items.length - 1)];
  if (item === undefined) throw new Error('pick from empty array');
  return item;
}

/** Runs `body(seed)` for `count` deterministic seeds, reporting the failing seed on assertion failure (fast-check's own "shrink to a seed" ergonomics, simplified). */
export function forEachSeed(
  count: number,
  body: (rng: () => number, seed: number) => void,
): void {
  let seed = 0;
  try {
    for (seed = 1; seed <= count; seed += 1) {
      body(mulberry32(seed), seed);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`failed with seed=${seed}: ${message}`, { cause: err });
  }
}

/** Async counterpart of {@link forEachSeed}, run sequentially (each seed's fixture calls are real git/DB I/O, not parallelized). */
export async function forEachSeedAsync(
  count: number,
  body: (rng: () => number, seed: number) => Promise<void>,
): Promise<void> {
  let seed = 0;
  try {
    for (seed = 1; seed <= count; seed += 1) {
      await body(mulberry32(seed), seed);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`failed with seed=${seed}: ${message}`, { cause: err });
  }
}
