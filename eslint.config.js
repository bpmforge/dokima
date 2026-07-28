import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';

// ARCHITECTURE.md §4 "allowed-dependency matrix" (row imports column) — the single
// source of truth this file encodes. Keys are @shipwright/<name> workspace package
// names; 'server'/'web' are apps/server and apps/web (also @shipwright/-scoped).
export const ALLOWED_IMPORTS = {
  shared: [],
  events: ['shared'],
  tickets: ['shared', 'events'],
  validators: ['shared', 'events'],
  gateway: ['shared', 'events'],
  memory: ['shared', 'events'],
  git: ['shared', 'events'],
  forge: ['shared', 'events', 'git'],
  mcp: ['shared', 'events'],
  loop: ['shared', 'events', 'validators', 'gateway', 'memory', 'mcp'],
  pipeline: ['shared', 'events', 'tickets', 'validators', 'gateway', 'memory', 'loop'],
  harbormaster: [
    'shared',
    'events',
    'tickets',
    'validators',
    'gateway',
    'memory',
    'git',
    'forge',
    'mcp',
    'loop',
    'pipeline',
  ],
  server: [
    'shared',
    'events',
    'tickets',
    'validators',
    'gateway',
    'memory',
    'git',
    'forge',
    'mcp',
    'loop',
    'pipeline',
    'harbormaster',
  ],
  web: ['shared'],
};

export const ALL_PACKAGE_NAMES = Object.keys(ALLOWED_IMPORTS);

// Law 2: provider SDKs are gateway-egress-only (docs/TECH_STACK.md "Provider SDKs").
export const PROVIDER_SDK_PACKAGES = [
  '@anthropic-ai/sdk',
  'openai',
  'google-auth-library',
];

// Law 4: only packages/events may open the DB write path.
export const DB_DRIVER_PACKAGES = ['better-sqlite3'];

// TECH_STACK.md "Repository conventions": packages export via `exports` maps only.
export const DEEP_IMPORT_REGEX = '^@shipwright/[^/]+/.+';

// SC-04 (docs/SECURITY_CONTROLS.md): promise-token / magic-string completion is
// forbidden — completion is receipt-existence only, never a regex over session output.
export const PROMISE_TOKEN_SELECTOR =
  'Literal[regex.pattern=/\\bDONE\\b|\\bPASSED\\b|\\bCOMPLETE\\b/]';
export const PROMISE_TOKEN_PACKAGES = ['loop', 'harbormaster', 'pipeline'];

function realDirFor(name) {
  return name === 'server' || name === 'web' ? `apps/${name}` : `packages/${name}`;
}

function packageFiles(name, extraGlobs = []) {
  return [`${realDirFor(name)}/**/*.{ts,tsx}`, ...extraGlobs];
}

// Red fixtures (e2e/boundary-fixtures/**) impersonate a package identity so the same
// rule that protects the real package also proves it is failing-capable. Verified by
// e2e/boundary-fixtures/check-fixtures.mjs (`pnpm lint:boundary-fixtures`), which is
// deliberately NOT part of the default `eslint .` scope — see that file's header.
const MATRIX_FIXTURE_GLOBS = {
  loop: ['e2e/boundary-fixtures/loop-imports-tickets/**/*.ts'],
  tickets: ['e2e/boundary-fixtures/tickets-imports-git/**/*.ts'],
};
const SDK_FIXTURE_GLOBS = {
  loop: ['e2e/boundary-fixtures/provider-sdk-in-loop/**/*.ts'],
};
const DB_FIXTURE_GLOBS = {
  gateway: [
    'e2e/boundary-fixtures/better-sqlite3-in-gateway/**/*.ts',
    'e2e/boundary-fixtures/db-driver-subpath-in-gateway/**/*.ts',
  ],
};
const DEEP_IMPORT_FIXTURE_GLOBS = {
  events: ['e2e/boundary-fixtures/deep-import/**/*.ts'],
};
const PROMISE_TOKEN_FIXTURE_GLOBS = {
  loop: ['e2e/boundary-fixtures/promise-token-in-loop/**/*.ts'],
};

/** Builds the single combined `no-restricted-imports` config object for one package identity. */
export function buildDependencyRuleConfig(name, { includeFixtures = false } = {}) {
  const forbiddenSiblings = ALL_PACKAGE_NAMES.filter(
    (other) => other !== name && !ALLOWED_IMPORTS[name].includes(other),
  ).map((other) => `@shipwright/${other}`);

  const paths = [];

  // Note: bans below use glob-capable `patterns.group` (not `paths.name`), which only
  // matches the exact bare specifier. Both @anthropic-ai/sdk and better-sqlite3 publish
  // real, usable subpaths (e.g. '@anthropic-ai/sdk/resources/messages',
  // 'better-sqlite3/lib/database.js') that would bypass an exact-match-only ban — see
  // e2e/boundary-fixtures/db-driver-subpath-in-gateway for the proof.
  const patterns = [
    {
      regex: DEEP_IMPORT_REGEX,
      message:
        'TECH_STACK.md repository conventions: packages export via `exports` maps only — no deep imports across package boundaries.',
    },
  ];
  if (name !== 'gateway') {
    for (const pkg of PROVIDER_SDK_PACKAGES) {
      patterns.push({
        group: [pkg, `${pkg}/**`],
        message: `ARCHITECTURE.md §4 law 2: provider SDKs are egress-only through packages/gateway — @shipwright/${name} may not import '${pkg}' (including subpaths).`,
      });
    }
  }
  if (name !== 'events') {
    for (const pkg of DB_DRIVER_PACKAGES) {
      patterns.push({
        group: [pkg, `${pkg}/**`],
        message: `ARCHITECTURE.md §4 law 4: only packages/events opens the DB write path — @shipwright/${name} may not import '${pkg}' (including subpaths).`,
      });
    }
  }
  if (forbiddenSiblings.length > 0) {
    patterns.push({
      group: forbiddenSiblings,
      message: `ARCHITECTURE.md §4: @shipwright/${name} may only import ${ALLOWED_IMPORTS[name].length ? ALLOWED_IMPORTS[name].map((n) => `@shipwright/${n}`).join(', ') : 'nothing (foundation package)'}.`,
    });
  }

  const extraGlobs = includeFixtures
    ? [
        ...(MATRIX_FIXTURE_GLOBS[name] ?? []),
        ...(SDK_FIXTURE_GLOBS[name] ?? []),
        ...(DB_FIXTURE_GLOBS[name] ?? []),
        ...(DEEP_IMPORT_FIXTURE_GLOBS[name] ?? []),
      ]
    : [];

  return {
    files: packageFiles(name, extraGlobs),
    rules: {
      'no-restricted-imports': ['error', { paths, patterns }],
    },
  };
}

/** Builds the SC-04 promise-token config object for one package identity. */
export function buildPromiseTokenRuleConfig(name, { includeFixtures = false } = {}) {
  const extraGlobs = includeFixtures ? (PROMISE_TOKEN_FIXTURE_GLOBS[name] ?? []) : [];
  return {
    files: packageFiles(name, extraGlobs),
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: PROMISE_TOKEN_SELECTOR,
          message:
            'SC-04 (docs/SECURITY_CONTROLS.md): string-match/regex completion patterns over session output are forbidden — completion is receipt-existence only, never a promise token.',
        },
      ],
    },
  };
}

export default tseslint.config(
  {
    // `.claude/**` holds agent scratch and per-agent git worktrees. A worktree
    // is a SECOND FULL CHECKOUT of this repo, so without this ignore ESLint
    // lints another agent's copy of the tree and reports its files as errors
    // in this one. Gitignoring `.claude/` does not help: flat config does not
    // read `.gitignore` unless explicitly wired via `includeIgnoreFile`.
    ignores: ['**/dist/**', '**/node_modules/**', '**/.shipwright/**', '**/.claude/**'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      globals: { ...globals.node },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
  {
    files: ['apps/web/**/*.{ts,tsx}'],
    languageOptions: {
      globals: { ...globals.browser },
    },
  },
  ...ALL_PACKAGE_NAMES.map((name) => buildDependencyRuleConfig(name)),
  ...PROMISE_TOKEN_PACKAGES.map((name) => buildPromiseTokenRuleConfig(name)),
);
