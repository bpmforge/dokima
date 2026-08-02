import { describe, expect, it } from 'vitest';
import { PACKAGE_NAME } from './index.js';

describe('@dokima/harbormaster placeholder', () => {
  it('is scaffolded', () => {
    expect(PACKAGE_NAME).toBe('harbormaster');
  });
});
