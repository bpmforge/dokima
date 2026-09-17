/**
 * W23-27. A provider kind is enumerated in nine places, and they must agree.
 *
 * FOUND BY A THIRD LOCAL DAEMON. 3486645f added `mtplx` to the gateway's
 * `ProviderKind` and reached three of the nine sites that enumerate kinds.
 * `pnpm typecheck` caught ONE of the six misses (a `kind === 'mtplx'` against
 * a web union that had no such member); the other five were found by hand.
 * One of them was `KNOWN_KINDS` in providers-core.ts, where an unknown kind
 * makes `loadConfiguredProviders` SILENTLY SKIP the entry — the W12-17 defect,
 * reintroduced for a new kind.
 *
 * WHY THE MIRRORS EXIST. apps/web cannot import `@dokima/gateway`
 * (ARCHITECTURE §4 — web talks to the server over REST/WS only), so its
 * `ProviderKind` is a hand-copy by design. providers-core.ts imports the type
 * but keeps its own runtime `Set`, because a type is gone at runtime. The
 * `Record<ProviderKind, …>` maps already fail typecheck when the WEB union
 * grows; nothing made the web union grow when the gateway one did. That first
 * hop is what this asserts.
 *
 * This reads SOURCE TEXT, not modules: half these files are TypeScript in
 * packages this scripts project does not build, and the point is that the
 * declarations agree, not that they execute. Same shape as
 * tsconfig-coverage.test.mjs (W23-26): assert coverage, let the real code do
 * the work.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => readFileSync(path.join(ROOT, rel), 'utf8');

/** The text of one declaration: from `start` to the first line ending in `end`. */
function declaration(rel, start, end) {
  const src = read(rel);
  const from = src.indexOf(start);
  if (from < 0) throw new Error(`${rel}: no declaration starting "${start}"`);
  const to = src.indexOf(end, from);
  if (to < 0) throw new Error(`${rel}: "${start}" never reaches "${end}"`);
  return src.slice(from, to + end.length);
}

const quoted = (text) => [...text.matchAll(/'([a-z0-9-]+)'/g)].map((m) => m[1]);

/** A kind is present as a quoted string or as a bare object key. */
const mentions = (text, kind) =>
  new RegExp(`'${kind}'|(^|[\\s{,])${kind}\\s*:`, 'm').test(text);

/** The source of truth: the list `buildProvider` dispatches on. */
const GATEWAY_KINDS = quoted(
  declaration(
    'packages/gateway/src/registry/types.ts',
    'export const PROVIDER_KINDS',
    '];',
  ),
);

/**
 * Local kinds are the ones the gateway presets construct with a default base
 * URL — `id: '…'` in the preset file. Those additionally need a prefilled URL
 * in the web form, an unpriced row, and the owned-hardware retry ceiling.
 */
const LOCAL_KINDS = [
  ...read('packages/gateway/src/providers/oai-compat-presets.ts').matchAll(
    /^\s+id: '([a-z-]+)',$/gm,
  ),
].map((m) => m[1]);

/** [what, file, declaration start, declaration end] — every kind must appear. */
const EVERY_KIND_MIRRORS = [
  [
    'web ProviderKind union',
    'apps/web/src/settings/providers-api.ts',
    'export type ProviderKind =',
    ';',
  ],
  [
    'web PROVIDER_KINDS',
    'apps/web/src/settings/providers-api.ts',
    'export const PROVIDER_KINDS',
    '];',
  ],
  [
    'web KIND_LABEL',
    'apps/web/src/settings/providers-api.ts',
    'export const KIND_LABEL',
    '};',
  ],
  [
    'web AUTH_METHODS_BY_KIND',
    'apps/web/src/settings/providers-auth-methods.ts',
    'const AUTH_METHODS_BY_KIND',
    '};',
  ],
  [
    'server KNOWN_KINDS',
    'apps/server/src/cli/ops/providers-core.ts',
    'const KNOWN_KINDS',
    ']);',
  ],
];

/** Same shape, for local kinds only. */
const LOCAL_KIND_MIRRORS = [
  [
    'web LOCAL_DEFAULT_BASE_URL',
    'apps/web/src/settings/providers-api.ts',
    'export const LOCAL_DEFAULT_BASE_URL',
    '};',
  ],
  [
    'server UNPRICED_BY_DESIGN',
    'apps/server/src/api/pipeline/gateway-model-port/pricing.ts',
    'export const UNPRICED_BY_DESIGN',
    ');',
  ],
  [
    'server tierKindFor',
    'apps/server/src/cli/run-build-policy.ts',
    'export function tierKindFor',
    '\n}',
  ],
];

describe('every provider kind reaches every hand-mirror of the kind list (W23-27)', () => {
  it('the gateway list and the local subset were actually read — an empty list would pass vacuously', () => {
    expect(GATEWAY_KINDS.length).toBeGreaterThanOrEqual(7);
    expect(LOCAL_KINDS.length).toBeGreaterThanOrEqual(3);
    for (const kind of LOCAL_KINDS) expect(GATEWAY_KINDS).toContain(kind);
  });

  it.each(EVERY_KIND_MIRRORS)(
    '%s (%s) lists every gateway kind',
    (_what, rel, start, end) => {
      const text = declaration(rel, start, end);
      const missing = GATEWAY_KINDS.filter((kind) => !mentions(text, kind));
      expect(missing, `${rel}: ${start} lacks ${missing.join(', ')}`).toEqual([]);
    },
  );

  it.each(LOCAL_KIND_MIRRORS)(
    '%s (%s) lists every local kind',
    (_what, rel, start, end) => {
      const text = declaration(rel, start, end);
      const missing = LOCAL_KINDS.filter((kind) => !mentions(text, kind));
      expect(missing, `${rel}: ${start} lacks ${missing.join(', ')}`).toEqual([]);
    },
  );

  it('the mirrors carry nothing the gateway cannot build', () => {
    for (const [, rel, start, end] of EVERY_KIND_MIRRORS.slice(1)) {
      const extra = quoted(declaration(rel, start, end)).filter(
        (k) =>
          !GATEWAY_KINDS.includes(k) && !/^(none|api-key|gcp-adc|subscription)$/.test(k),
      );
      // Bare keys are not captured by quoted(); only quoted extras are checkable here.
      expect(extra, `${rel}: ${start} names kinds the gateway lacks`).toEqual([]);
    }
  });
});
