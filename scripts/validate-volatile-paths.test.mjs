/**
 * W13-64. One string literal caused observed data loss; this keeps the class
 * extinct.
 */
import { describe, expect, it } from 'vitest';
import { findVolatilePathLiterals, scanRepo } from './validate-volatile-paths.mjs';

describe('findVolatilePathLiterals', () => {
  it('RED FIXTURE: the exact literal that lost data is caught', () => {
    expect(
      findVolatilePathLiterals('const card = await createProject({ path: `/tmp/dokima-sample-${Date.now()}` });'),
    ).toHaveLength(1);
  });

  it('a comment may still carry the lesson beside the code it protects', () => {
    expect(
      findVolatilePathLiterals('// this used to hardcode `/tmp/dokima-sample-<ts>`\nconst x = 1;'),
    ).toHaveLength(0);
  });

  it('/private/tmp is the same volatile place wearing its macOS name', () => {
    expect(findVolatilePathLiterals(`const p = '/private/tmp/x';`)).toHaveLength(1);
  });
});

describe('this repo', () => {
  it('is clean, and stays clean — no baseline, the count is zero by law', () => {
    expect(scanRepo()).toEqual([]);
  }, 30_000);
});
