/**
 * Machine-identity provisioning gate (HP-5/HP-6, docs/PREREQUISITES.md,
 * G-21): the forge connect flow must not silently proceed without both
 * scoped tokens and confirmed repo admin — it blocks with evidence naming
 * the human-prerequisite id, per PREREQUISITES.md's rule ("a missing HP
 * row parks the dependent ticket as blocked-with-evidence naming the HP
 * id").
 */

export interface MirrorIdentityConfig {
  makerToken?: string;
  makerLogin?: string;
  reviewerToken?: string;
  reviewerLogin?: string;
  /** HP-6: human confirmed admin rights on the target repo (needed for branch protection, SC-14). */
  repoAdminConfirmed?: boolean;
}

export interface MirrorPrerequisiteGap {
  hpId: 'HP-5' | 'HP-6';
  message: string;
}

export interface MirrorPrerequisiteResult {
  ready: boolean;
  gaps: MirrorPrerequisiteGap[];
}

/**
 * Two distinct identities are the whole point of SC-03 — a maker token
 * reused as the reviewer token (or vice versa) defeats the maker!=reviewer
 * guarantee just as surely as a missing token, so it's flagged the same way.
 */
export function checkMirrorPrerequisites(
  config: MirrorIdentityConfig,
): MirrorPrerequisiteResult {
  const gaps: MirrorPrerequisiteGap[] = [];

  if (!config.makerToken || !config.makerLogin) {
    gaps.push({
      hpId: 'HP-5',
      message:
        'shipwright-maker machine account/token not configured (docs/PREREQUISITES.md HP-5)',
    });
  }
  if (!config.reviewerToken || !config.reviewerLogin) {
    gaps.push({
      hpId: 'HP-5',
      message:
        'shipwright-reviewer machine account/token not configured (docs/PREREQUISITES.md HP-5)',
    });
  }
  if (
    config.makerToken &&
    config.reviewerToken &&
    config.makerToken === config.reviewerToken
  ) {
    gaps.push({
      hpId: 'HP-5',
      message:
        'maker and reviewer tokens are identical — SC-03 requires separately scoped tokens (docs/PREREQUISITES.md HP-5)',
    });
  }
  if (config.repoAdminConfirmed !== true) {
    gaps.push({
      hpId: 'HP-6',
      message:
        'repo admin not confirmed — required for branch-protection setup on connect (docs/PREREQUISITES.md HP-6)',
    });
  }

  return { ready: gaps.length === 0, gaps };
}
