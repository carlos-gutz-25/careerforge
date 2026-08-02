import { type DemoSeedStateRepository } from '@careerforge/db';

/**
 * Fail-closed boot refusal (M10-03 D7b): a DEMO_MODE instance must be seeded
 * before it serves. `demo:seed` writes the demo_seed_state marker LAST, so an
 * absent marker means the demo pipeline never completed (or never ran) — the
 * instance would serve an empty/half-provisioned demo. Refusing at boot makes
 * that mis-provisioning loud instead of shipping a broken public demo.
 * Distinct from the env-level fail-closed (DEMO_MODE + a live key = no boot):
 * this one is about DATA readiness, not credentials.
 */
export class DemoUnseededError extends Error {
  constructor() {
    super('DEMO_MODE is on but the demo is not seeded — run `pnpm demo:seed` before serving.');
  }
}

/** Throws DemoUnseededError when DEMO_MODE is on and no demo_seed_state marker
 *  exists. Inert (and never touches the DB) when DEMO_MODE is off. */
export async function assertDemoSeeded(deps: {
  demoMode: boolean;
  seedState: Pick<DemoSeedStateRepository, 'read'>;
}): Promise<void> {
  if (!deps.demoMode) return;
  const marker = await deps.seedState.read();
  if (!marker) throw new DemoUnseededError();
}
