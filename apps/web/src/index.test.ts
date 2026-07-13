import { describe, expect, it } from 'vitest';

import { APP_ID } from './index.js';

describe('apps/web', () => {
  it('identifies itself', () => {
    expect(APP_ID).toBe('web');
  });
});
