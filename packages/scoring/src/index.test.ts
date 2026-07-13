import { describe, expect, it } from 'vitest';

import { INTERNAL_DEPENDENCIES, MODULE_ID } from './index.js';

describe('@careerforge/scoring', () => {
  it('identifies itself', () => {
    expect(MODULE_ID).toBe('@careerforge/scoring');
  });

  it('consumes @careerforge/core as TS source across the workspace boundary', () => {
    expect(INTERNAL_DEPENDENCIES).toEqual(['@careerforge/core']);
  });
});
