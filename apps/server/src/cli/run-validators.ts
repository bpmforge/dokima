/**
 * run-validators.ts — which validators a generated project's close gate runs
 * (W21-38).
 *
 * The founder asked directly whether the product keeps a model honest about
 * the stack it designed. It does not, and the gap is not in the content pack:
 *
 *   - `content/validators/` ships 83 validators imported from attest,
 *     including `validate-tech-stack.sh` ("every direct dependency in the
 *     project's manifest must appear in docs/TECH_STACK.md") and
 *     `validate-deps.sh`.
 *   - `DEFAULT_REQUIRED_VALIDATORS` is exactly `['secrets-scan',
 *     'validate-remote-parity']`, and run 16's close receipt for
 *     PLAN-vault-001 lists those two and nothing else.
 *   - `run-build.ts` never passed `requiredValidators` at all, so there was no
 *     per-project way to opt in even if you knew the names.
 *
 * So an agent could add any dependency it liked — including one it invented,
 * which is ANTI_SLOP R-21 slopsquatting and admits an attacker rather than
 * mere sloppiness — and nothing compared it against what the project designed.
 *
 * THIS ADDS THE MECHANISM, NOT A POLICY. Which of the 83 belong in a
 * GENERATED PRODUCT's gate is a founder decision: most are irrelevant to a
 * password manager, several assume documents a given project may never
 * produce, and a gate that refuses for debt a ticket did not create teaches
 * people to bypass it. The setting is the place that decision gets recorded.
 *
 * AN UNKNOWN NAME REFUSES RATHER THAN BEING IGNORED. A typo'd validator that
 * silently does nothing is worse than no setting: the founder believes a check
 * is running and it is not, which is the precise shape of every reporting
 * defect this wave has found.
 */
import { loadValidatorPack } from '@dokima/validators';
import type { JsonValue } from '@dokima/shared';

/** The generic settings key the Settings panel and the CLI both write. */
export const REQUIRED_VALIDATORS_SETTINGS_KEY = 'requiredValidators';

export type RequiredValidatorsResult =
  | { readonly requiredValidators: readonly string[] | undefined }
  | { readonly refusal: string };

/**
 * Resolves the project's required validator set, or refuses. `undefined` means
 * unset — the caller keeps `DEFAULT_REQUIRED_VALIDATORS`, so an install that
 * never touches this behaves exactly as before.
 */
export function resolveRequiredValidators(
  raw: JsonValue | undefined,
  known: readonly string[],
): RequiredValidatorsResult {
  if (raw === undefined || raw === null) return { requiredValidators: undefined };
  if (!Array.isArray(raw) || raw.some((entry) => typeof entry !== 'string')) {
    return {
      refusal:
        `${REQUIRED_VALIDATORS_SETTINGS_KEY} must be a list of validator names ` +
        `(e.g. ["secrets-scan","validate-tech-stack"])`,
    };
  }
  const names = raw.map((entry) => String(entry).trim()).filter((entry) => entry.length > 0);
  if (names.length === 0) {
    return {
      refusal:
        `${REQUIRED_VALIDATORS_SETTINGS_KEY} is empty. A close gate with no ` +
        `validators is a decision, not a default — remove the setting to keep ` +
        `the built-in set, or name the validators you want`,
    };
  }
  const unknown = names.filter((name) => !known.includes(name));
  if (unknown.length > 0) {
    return {
      refusal:
        `${REQUIRED_VALIDATORS_SETTINGS_KEY} names validator(s) this install does ` +
        `not have: ${unknown.join(', ')}. A validator that silently does nothing ` +
        `is worse than none — you would believe a check was running. Available: ` +
        `${known.slice(0, 12).join(', ')}${known.length > 12 ? `, … (${known.length} total)` : ''}`,
    };
  }
  return { requiredValidators: names };
}

/**
 * Reads the setting, lists what this install actually ships, and resolves the
 * two together. Lives here rather than in `run-build.ts` because that file
 * sits at the 400-line cap and because "which validators run" is one concern.
 */
/**
 * What a GENERATED project's close gate runs when nobody has said otherwise
 * (W21-97).
 *
 * `DEFAULT_REQUIRED_VALIDATORS` is `['secrets-scan',
 * 'validate-remote-parity']` — a leaked credential and a wrong git remote.
 * Nothing asked whether the code was any good, while `content/validators/`
 * ships 85 validators. W21-38 built the setting above and left the policy
 * open: "which of the 83 belong in a GENERATED PRODUCT's gate is a founder
 * decision."
 *
 * The founder decided: the product is for people who may have no development
 * experience, so it should RUN the checks rather than wait to be asked.
 * W21-97 put the quality work on the board as tickets; a ticket a novice does
 * not know how to perform is only half an answer.
 *
 * SET HERE, and the seam matters. This resolution is reached only by
 * `run-build.ts` — the product's loop working a USER's project. Raising
 * `DEFAULT_REQUIRED_VALIDATORS` would also govern this repo's own runs, and
 * seeding a project setting at creation would append a settings event to every
 * new project. Both were tried and both had blast radius unrelated to the
 * intent. This changes exactly the population it means to.
 *
 * CHOSEN ON MEASUREMENT, because W21-38's warning binds: "a gate that refuses
 * for debt a ticket did not create teaches people to bypass it". Each
 * candidate was run against a bare generated project AND this repo:
 *
 *   validate-dead-code         0 gaps both  (~5s)  -> IN
 *   validate-lint              0 gaps both  (~4s)  -> IN
 *   validate-code-health       27 gaps in THIS repo -> OUT until that
 *                              pre-existing R-02 try-in-loop debt is paid
 *                              (W21-98).
 *   validate-security-controls needs docs/SECURITY_CONTROLS.md -> OUT as a
 *                              default, but it is precisely what
 *                              QUALITY-SECURITY-REVIEW's acceptance produces,
 *                              so it becomes checkable once that ticket lands.
 *   validate-tests             runs Playwright when a config exists -> OUT: a
 *                              full e2e run on every ticket close.
 *
 * A project that names its own `requiredValidators` still wins — this is the
 * floor for someone who has not thought about it, which is the whole point.
 * Any name this install does not ship is dropped rather than refusing the run.
 */
export const GENERATED_PROJECT_VALIDATORS: readonly string[] = [
  'secrets-scan',
  'validate-remote-parity',
  'validate-dead-code',
  'validate-lint',
];

export async function requiredValidatorsFor(
  contentDir: string,
  read: (key: string) => JsonValue | undefined,
): Promise<RequiredValidatorsResult> {
  const specs = await loadValidatorPack({ contentDir });
  const known = specs.map((spec) => spec.name);
  const configured = read(REQUIRED_VALIDATORS_SETTINGS_KEY);
  if (configured === undefined || configured === null) {
    const available = GENERATED_PROJECT_VALIDATORS.filter((name) => known.includes(name));
    return { requiredValidators: available.length > 0 ? available : undefined };
  }
  return resolveRequiredValidators(configured, known);
}
