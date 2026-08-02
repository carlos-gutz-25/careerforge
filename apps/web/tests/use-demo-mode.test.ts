// useDemoMode composable (M10-04, D1): one boot fetch of the public GET
// /health `demo` field, useState-cached, resolved once by auth.global.ts.
// FAIL-QUIET is the load-bearing property this pins: the banner/prefill are
// affordances, the server enforces demo policy, so a failed fetch must default
// to demo:false and never throw into navigation. useApi is mocked - no network.
import { mockNuxtImport } from '@nuxt/test-utils/runtime';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useDemoMode, useDemoState } from '../app/composables/use-demo-mode.ts';

const { healthMock } = vi.hoisted(() => ({ healthMock: vi.fn() }));
mockNuxtImport('useApi', () => () => ({ health: healthMock }));

describe('useDemoMode (M10-04)', () => {
  beforeEach(() => {
    healthMock.mockReset();
    useDemoState().value = undefined;
  });

  it('resolves demo:true from a demo instance /health', async () => {
    healthMock.mockResolvedValue({ status: 'ok', version: '0.0.0', demo: true });
    const { demo, resolve } = useDemoMode();
    await resolve();
    expect(demo.value).toBe(true);
  });

  it('resolves demo:false from a real instance /health', async () => {
    healthMock.mockResolvedValue({ status: 'ok', version: '0.0.0', demo: false });
    const { demo, resolve } = useDemoMode();
    await resolve();
    expect(demo.value).toBe(false);
  });

  it('FAILS QUIET to demo:false when /health rejects (affordance, not policy)', async () => {
    healthMock.mockRejectedValue(new Error('network down'));
    const { demo, resolve } = useDemoMode();
    await resolve();
    expect(demo.value).toBe(false);
  });

  it('resolves once per load: a second resolve does not re-fetch', async () => {
    healthMock.mockResolvedValue({ status: 'ok', version: '0.0.0', demo: true });
    const { resolve } = useDemoMode();
    await resolve();
    await resolve();
    expect(healthMock).toHaveBeenCalledTimes(1);
  });
});
