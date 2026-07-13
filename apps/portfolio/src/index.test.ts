import { describe, expect, it } from 'vitest';

import { APP_ID } from './index.js';

describe('apps/portfolio', () => {
  it('identifies itself', () => {
    expect(APP_ID).toBe('portfolio');
  });
});
