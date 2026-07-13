import { describe, expect, it } from 'vitest';

import { INTERNAL_DEPENDENCIES, MODULE_ID } from './index.js';

describe('@careerforge/db', () => {
  it('identifies itself', () => {
    expect(MODULE_ID).toBe('@careerforge/db');
  });

  it('consumes @careerforge/core as TS source across the workspace boundary', () => {
    expect(INTERNAL_DEPENDENCIES).toEqual(['@careerforge/core']);
  });
});
