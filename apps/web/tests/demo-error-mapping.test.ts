// demoAwareErrorMessage (M10-04, D4): the web's FIRST error-CODE branch, kept
// in one shared helper so the DEMO_DISABLED mapping is not copy-pasted across
// the eight draft surfaces. Pure function - no mount, no network.
import { describe, expect, it } from 'vitest';

import { ApiError } from '../app/utils/api-error.ts';
import { DEMO_DISABLED_NOTE, demoAwareErrorMessage } from '../app/utils/demo.ts';

describe('demoAwareErrorMessage (M10-04)', () => {
  it('maps a DEMO_DISABLED 403 to the honest demo note, never the raw server text', () => {
    const error = new ApiError(403, 'DEMO_DISABLED', 'demo instances do not call the model');
    expect(demoAwareErrorMessage(error, 'fallback')).toBe(DEMO_DISABLED_NOTE);
  });

  it('surfaces any other ApiError message unchanged (pre-existing behavior preserved)', () => {
    const error = new ApiError(500, 'INTERNAL', 'boom');
    expect(demoAwareErrorMessage(error, 'fallback')).toBe('boom');
  });

  it('uses the caller fallback for a non-ApiError cause', () => {
    expect(demoAwareErrorMessage(new Error('network'), 'fallback')).toBe('fallback');
  });
});
