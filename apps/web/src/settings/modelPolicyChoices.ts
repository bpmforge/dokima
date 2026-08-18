/**
 * The D-024 model-policy choices, in the USER'S terms rather than the internal
 * mode names — data, extracted from `FirstRunWizard.tsx` (W12-16) when adding
 * the fifth choice took that file past the 400-line CODE_BOOK_PROTOCOL cap. The
 * wizard is the surface that renders these; this is the table it renders.
 *
 * Each maps onto machinery that already exists: a model-matrix preset (which
 * models serve which roles, FR-S3) and an escalation policy (whether and how
 * work climbs the R0-R4 ladder, D-018). Those are two different dimensions and
 * the wizard used to ask about only the first, which is why a fresh install
 * silently adopted `ladder`.
 */
import type { EscalationPolicyMode, ModelMatrixPreset } from './types.js';

export interface ModelPolicyChoice {
  readonly id: string;
  readonly label: string;
  readonly detail: string;
  readonly preset: ModelMatrixPreset;
  readonly policy: EscalationPolicyMode;
  /** True when the choice can be completed with no provider and no network (C-1). */
  readonly offlineCapable: boolean;
  /**
   * The choice needs the user to NAME a model, which the other four do not —
   * they route through the matrix. Asked on the provider step, where the kind
   * is already chosen, so the stored pin carries the `providerKind` W12-37
   * reads to infer its convergence ceiling.
   */
  readonly needsModel?: boolean;
}

export const MODEL_POLICY_CHOICES: readonly ModelPolicyChoice[] = [
  {
    id: 'local-only',
    label: 'Local only — never contact a cloud provider',
    detail:
      'Everything runs on models on this machine. No account, no network, no spend. Fully supported: if something needs a cloud model to work, that is a bug.',
    preset: 'all-local',
    policy: 'ladder',
    offlineCapable: true,
  },
  {
    id: 'cheapest-first',
    label: 'Start cheap, escalate when it has to',
    detail:
      'Local or small models do the work; a stronger model is used only when the cheaper one cannot finish. Needs at least one cloud provider configured.',
    preset: 'hybrid',
    policy: 'ladder',
    offlineCapable: false,
  },
  {
    id: 'approval-gated',
    label: 'Escalate only when I approve it',
    detail:
      'Same as above, but moving to a more expensive model waits for you to say yes. Nothing costly happens unattended.',
    preset: 'hybrid',
    policy: 'token-gated',
    offlineCapable: false,
  },
  {
    id: 'always-best',
    label: 'Always use my best cloud model',
    detail:
      'Skip the cheap tiers entirely. Fastest to a good answer, most expensive. Needs a cloud provider configured.',
    preset: 'all-cloud',
    policy: 'ladder',
    offlineCapable: false,
  },
  {
    id: 'one-model',
    label: 'Use one model I pick',
    detail:
      'Every piece of work runs on exactly the model you name, and nothing substitutes for it — no cheaper tier first, no escalation when it struggles. It retries and then stops.',
    preset: 'hybrid',
    policy: 'pinned',
    // A local model pinned this way needs no network; a cloud one does. The
    // flag describes the CHOICE, and this one cannot promise either, so it
    // claims the weaker of the two rather than the flattering one.
    offlineCapable: false,
    needsModel: true,
  },
];
