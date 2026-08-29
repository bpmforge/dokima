import type { TicketDraftInput } from './types.js';

/**
 * quality-tickets.ts — the work a plan needs that nobody thinks to ask for
 * (W21-97).
 *
 * THE PROBLEM, measured 2026-08-28 by describing a houseplant tracker through
 * the UI: decomposition produced nine tickets and every one was a FEATURE —
 * schema, presets, scheduling, web push, a cron endpoint, VAPID key
 * configuration. No security review, no accessibility pass, no performance
 * check, no test-coverage step, and nothing saying what "done" means for the
 * project. That plan provisions VAPID keys and an authenticated cron endpoint
 * and contains nothing that ever looks at either.
 *
 * THE FOUNDER SETTLED THE POLICY: the product exists to help people build
 * their ideas, "especially those that want to automate their ideas or those
 * that have no development experience". Someone with no development
 * background will never think to ask for a security review — which is the
 * whole argument for the product planning one rather than waiting to be asked.
 *
 * WHY THIS IS CODE AND NOT PROMPT TEXT. The drafts come from a model, and this
 * codebase does not let a model's compliance BE the guarantee — that is the
 * same discipline behind maker != verifier and behind re-running verify at the
 * close gate rather than trusting a manifest. A prompt asking for quality
 * tickets produces them most of the time; appending them produces them every
 * time, which is what "by default" has to mean.
 *
 * WHAT IT DELIBERATELY DOES NOT DO: it does not raise the close gate's
 * required validators. W21-38 built that mechanism and warned in its own
 * header that "a gate that refuses for debt a ticket did not create teaches
 * people to bypass it". Tickets are visible, orderable work a person can read,
 * reorder or delete; a silently raised gate is a wall. The two levers are
 * separate on purpose.
 */

/** One standard check every generated plan carries unless the drafts already cover it. */
interface QualityTicketSpec {
  readonly idSuffix: string;
  readonly title: string;
  /** Substrings that mean the model already drafted this work itself. */
  readonly alreadyCoveredBy: readonly string[];
  readonly acceptance: readonly string[];
}

/**
 * Ordered as a person would do them: look for holes, then check the work is
 * usable, then that it holds up, then that it is worth trusting, then say
 * whether it can ship.
 */
const QUALITY_TICKETS: readonly QualityTicketSpec[] = [
  {
    idSuffix: 'SECURITY-REVIEW',
    title: 'Security review before release',
    alreadyCoveredBy: ['security review', 'security audit', 'threat model', 'pen test'],
    acceptance: [
      'Every secret, key and credential this project handles is named, and none is committed to the repository or logged',
      'Every endpoint that changes data or reads private data requires authentication, and each one is listed with how it is protected',
      'Dependencies are checked for known vulnerabilities, and anything unfixed is written down with the reason',
      'Each finding is either fixed or recorded with why it is acceptable — an unrecorded finding is not resolved',
    ],
  },
  {
    idSuffix: 'ACCESSIBILITY',
    title: 'Accessibility pass on every screen',
    alreadyCoveredBy: ['accessibility', 'a11y', 'wcag', 'screen reader'],
    acceptance: [
      'Every interactive control can be reached and operated with the keyboard alone',
      'Every control has a name a screen reader announces, and no state is signalled by colour alone',
      'Text meets WCAG AA contrast against its background',
      'Any exception is written down with the reason, rather than left undiscovered',
    ],
  },
  {
    idSuffix: 'CODE-HEALTH',
    title: 'Code health and dead-code sweep',
    alreadyCoveredBy: ['code health', 'refactor', 'dead code', 'tech debt', 'lint'],
    acceptance: [
      'No error is swallowed silently — every catch either handles the failure or reports it, and an empty result is distinguishable from a failed one',
      'Code written but never called is removed or given a caller',
      'Duplicated logic introduced across tickets is consolidated once, rather than left to drift',
      'The linter and type checker pass with no suppressions added to make them pass',
    ],
  },
  {
    idSuffix: 'PERFORMANCE',
    title: 'Performance check under realistic load',
    alreadyCoveredBy: ['performance', 'load test', 'benchmark', 'profiling', 'latency'],
    acceptance: [
      'The slowest user-facing operation is measured, with the number written down rather than estimated',
      'Any query or loop whose cost grows with the amount of data is identified, and bounded or paginated',
      'A measurement is taken before and after any optimisation, so the change is shown to have helped',
    ],
  },
  {
    idSuffix: 'TEST-COVERAGE',
    title: 'Tests cover the paths that matter',
    alreadyCoveredBy: ['test coverage', 'testing', 'unit test', 'integration test', 'e2e'],
    acceptance: [
      'Every acceptance criterion in this plan has a test that would fail if the behaviour broke',
      'The main flow a user takes is covered end to end, not only in pieces',
      'Each failure path that is handled is tested, not just the successful one',
    ],
  },
  {
    idSuffix: 'RELEASE-READINESS',
    title: 'Release readiness — is this actually shippable?',
    alreadyCoveredBy: ['release readiness', 'launch checklist', 'go live', 'deployment checklist'],
    acceptance: [
      'The project builds and starts from a clean checkout, following only its own written instructions',
      'Someone who has never seen it can run it from the README alone',
      'The security, accessibility, code-health, performance and test tickets are all closed, or their exceptions are written down',
      'What is NOT in this release is stated, so nobody assumes a missing feature is a defect',
    ],
  },
];

function alreadyDrafted(drafts: readonly TicketDraftInput[], spec: QualityTicketSpec): boolean {
  return drafts.some((d) => {
    const haystack = `${d.title} ${d.acceptance.join(' ')}`.toLowerCase();
    return spec.alreadyCoveredBy.some((needle) => haystack.includes(needle));
  });
}

/**
 * The quality tickets this plan is missing, each depending on the feature work
 * it checks so it cannot be closed first.
 *
 * `dependsOn` is every DRAFTED ticket, not the leaves: a security review that
 * runs before the last feature lands has reviewed something that no longer
 * exists. Quality tickets do not depend on each other — they are independent
 * questions and a person may answer them in any order, or drop one.
 *
 * A plan with no drafts at all gets nothing: there is no work to check, and
 * inventing review tickets for an empty plan would be noise.
 */
export function qualityTicketsFor(
  drafts: readonly TicketDraftInput[],
): readonly TicketDraftInput[] {
  if (drafts.length === 0) return [];
  const featureIds = drafts.map((d) => d.id);
  return QUALITY_TICKETS.filter((spec) => !alreadyDrafted(drafts, spec)).map((spec) => ({
    id: `QUALITY-${spec.idSuffix}`,
    type: 'task' as const,
    title: spec.title,
    // Its own directory: a review writes findings, and giving it a scope that
    // overlaps the feature tickets would be the lane collision FR-T3 refuses.
    writeScope: [`docs/quality/${spec.idSuffix.toLowerCase()}/**`],
    dependsOn: featureIds,
    acceptance: spec.acceptance,
    // Prose on purpose. These are judgements a person makes, and the close
    // gate already reports unexecutable criteria as needing a human check
    // (humanCheckNotice) rather than counting them as satisfied — which is
    // exactly the honest handling this work wants.
    verify: '',
    ownPackage: null,
    importsWorkspacePackages: [],
    providesInterfaces: [],
    consumesInterfaces: [],
  }));
}
