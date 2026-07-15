// Drift gate for the committed OpenAPI spec (M0-09): regenerates the spec
// from the route schemas in-process and byte-compares it against
// docs/api/openapi.json. Runs inside `pnpm test`, so drift fails the local
// gate AND CI's required `test` check — no separate CI job to maintain.
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { renderOpenApiSpec } from './openapi.ts';

const SPEC_PATH = fileURLToPath(new URL('../../../docs/api/openapi.json', import.meta.url));

describe('OpenAPI spec drift', () => {
  it('docs/api/openapi.json matches the spec generated from the route schemas', async () => {
    const committed = await readFile(SPEC_PATH, 'utf8').catch(() => undefined);
    expect(
      committed,
      'docs/api/openapi.json is missing — run `pnpm openapi:generate` and commit it',
    ).toBeDefined();

    const generated = await renderOpenApiSpec();
    expect(
      generated,
      'route schemas drifted from docs/api/openapi.json — run `pnpm openapi:generate` and commit the diff',
    ).toBe(committed);
  });
});
