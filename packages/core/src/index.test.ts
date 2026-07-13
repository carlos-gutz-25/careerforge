import { describe, expect, it } from 'vitest';

import { MODULE_ID } from './index.js';

describe('@careerforge/core', () => {
  it('identifies itself', () => {
    expect(MODULE_ID).toBe('@careerforge/core');
  });
});
