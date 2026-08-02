// Fail-closed boot guard (M10-03 D7b): a DEMO_MODE instance refuses to serve
// until demo:seed has written the demo_seed_state marker. This is the gate the
// D9-ii planted-FAIL neuters (drop the throw -> the unseeded-refusal test goes
// RED, proving the guard actually detects an unseeded demo). No DB: the marker
// read is stubbed.
import { describe, expect, it } from 'vitest';
import { type DemoSeedStateRow } from '@careerforge/db';

import { assertDemoSeeded, DemoUnseededError } from './demo-boot.ts';

const MARKER: DemoSeedStateRow = {
  id: 1,
  seededAt: new Date('2026-08-02T00:00:00.000Z'),
  fixtureSetVersion: 'm10-03-v1',
  fixtureManifestSha256: 'd3a47ced9bf42fb5432cfd96a47fe075e925b162899e92197e3fcafc351332cc',
};

describe('assertDemoSeeded (M10-03 D7b fail-closed boot)', () => {
  it('refuses to boot when DEMO_MODE is on and no seed marker exists', async () => {
    await expect(
      assertDemoSeeded({ demoMode: true, seedState: { read: () => Promise.resolve(undefined) } }),
    ).rejects.toBeInstanceOf(DemoUnseededError);
  });

  it('boots when DEMO_MODE is on and a seed marker exists', async () => {
    await expect(
      assertDemoSeeded({ demoMode: true, seedState: { read: () => Promise.resolve(MARKER) } }),
    ).resolves.toBeUndefined();
  });

  it('is inert off-demo - never reads the marker', async () => {
    let read = false;
    await assertDemoSeeded({
      demoMode: false,
      seedState: {
        read: () => {
          read = true;
          return Promise.resolve(undefined);
        },
      },
    });
    expect(read).toBe(false);
  });
});
