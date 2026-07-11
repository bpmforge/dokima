import { describe, expect, it } from 'vitest';
import { APP_NAME } from './index.js';

describe('apps/web placeholder', () => {
  it('exports the app name', () => {
    expect(APP_NAME).toBe('Shipwright');
  });
});
