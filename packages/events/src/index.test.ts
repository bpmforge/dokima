import { describe, expect, it } from 'vitest';
import { PACKAGE_NAME } from './index.js';

describe('@shipwright/events placeholder', () => {
  it('is scaffolded', () => {
    expect(PACKAGE_NAME).toBe('events');
  });
});
