# Dokima SAST baseline

The Opengrep ruleset Dokima's `tool-sast` check runs when no other ruleset is
configured (W23-60). It has 25 rules for JavaScript/TypeScript and Python:

| Class                     | JS/TS                                                             | Python                                                |
| ------------------------- | ----------------------------------------------------------------- | ----------------------------------------------------- |
| Code injection (eval)     | `js-eval-dynamic`, `js-new-function-dynamic`, `js-vm-run-dynamic` | `py-eval-exec-dynamic`                                |
| Command injection         | `js-child-process-shell-dynamic`, `js-spawn-shell-true-dynamic`   | `py-os-system-dynamic`, `py-subprocess-shell-dynamic` |
| SQL injection             | `js-sql-string-built`, `js-sql-request-data`                      | `py-sql-string-built`, `py-sql-request-data`          |
| Path traversal            | `js-request-path-traversal`                                       | `py-request-path-traversal`                           |
| Hardcoded credentials     | `js-hardcoded-credential`                                         | `py-hardcoded-credential`                             |
| Insecure deserialization  | `js-unsafe-deserialization`                                       | `py-unsafe-deserialization`, `py-yaml-unsafe-load`    |
| Weak crypto               | `js-weak-hash`, `js-weak-cipher`                                  | `py-weak-hash`, `py-weak-cipher`                      |
| Disabled TLS verification | `js-tls-verification-disabled`                                    | `py-tls-verification-disabled`                        |

The set aims for precision, not coverage. Each rule matches only a shape that
is almost always a real problem, so a finding is worth a reviewer's time.

## Licence

Apache-2.0 (see `LICENSE`). This covers these rule files only. The rest of the
Dokima package is under FSL-1.1-ALv2.

Every rule was written clean-room for Dokima. Nothing here is copied or adapted
from the Semgrep registry, whose rules are not licensed for redistribution, or
from any proprietary rule pack.

## Plugging in a richer pack

The baseline is the last step of the resolution order:

1. `DOKIMA_SAST_RULES`, when it is set. A set path that holds no rules makes
   SAST NOT RUN; Dokima does not fall back silently.
2. `~/.dokima/rules/sast`, when it holds rules.
3. This directory.

`dokima doctor` shows which ruleset is active.

## Tests

Each `<name>.yaml` has fixtures `rules/sast-baseline-fixtures/<name>.*`, with
`ruleid:` lines that must match and `ok:` lines that must not. Run
`opengrep test --config rules/sast-baseline/<name>.yaml rules/sast-baseline-fixtures/<name>.js`
for one file. `packages/harbormaster/src/sast-baseline.test.ts` runs them all.
The fixtures are not shipped in the package.
