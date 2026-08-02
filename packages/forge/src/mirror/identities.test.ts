import { describe, expect, it } from 'vitest';
import { checkMirrorPrerequisites } from './identities.js';

const FULL_CONFIG = {
  makerToken: 'maker-tok',
  makerLogin: 'dokima-maker',
  reviewerToken: 'reviewer-tok',
  reviewerLogin: 'dokima-reviewer',
  repoAdminConfirmed: true,
};

describe('checkMirrorPrerequisites', () => {
  it('is ready when both identities and repo admin are configured', () => {
    expect(checkMirrorPrerequisites(FULL_CONFIG)).toEqual({ ready: true, gaps: [] });
  });

  it('names HP-5 when the maker token/login is missing', () => {
    const result = checkMirrorPrerequisites({ ...FULL_CONFIG, makerToken: undefined });
    expect(result.ready).toBe(false);
    expect(result.gaps.map((g) => g.hpId)).toContain('HP-5');
  });

  it('names HP-5 when the reviewer token/login is missing', () => {
    const result = checkMirrorPrerequisites({ ...FULL_CONFIG, reviewerLogin: undefined });
    expect(result.ready).toBe(false);
    expect(result.gaps.map((g) => g.hpId)).toContain('HP-5');
  });

  it('names HP-5 when maker and reviewer tokens are identical (defeats SC-03 isolation)', () => {
    const result = checkMirrorPrerequisites({
      ...FULL_CONFIG,
      reviewerToken: FULL_CONFIG.makerToken,
    });
    expect(result.ready).toBe(false);
    expect(result.gaps.some((g) => g.message.includes('identical'))).toBe(true);
  });

  it('names HP-6 when repo admin is not confirmed', () => {
    const result = checkMirrorPrerequisites({
      ...FULL_CONFIG,
      repoAdminConfirmed: false,
    });
    expect(result.ready).toBe(false);
    expect(result.gaps.map((g) => g.hpId)).toContain('HP-6');
  });

  it('reports every gap at once, not just the first', () => {
    const result = checkMirrorPrerequisites({});
    expect(result.ready).toBe(false);
    expect(result.gaps.length).toBeGreaterThanOrEqual(3);
  });
});
