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

  it('rawText appears in exactly two spec locations: the ingest request and the detail 200 (wire-path law, M1-02)', async () => {
    // Posting text is UNTRUSTED and leaves the API on exactly ONE response —
    // GET /postings/:id. Any future route echoing it (a list payload, an
    // extraction response, an error body) adds a `rawText` property to the
    // spec and fails here, in the same suite that keeps the spec honest.
    const spec: unknown = JSON.parse(await renderOpenApiSpec());
    const locations: string[] = [];
    (function walk(node: unknown, path: string): void {
      if (node === null || typeof node !== 'object') return;
      for (const [key, value] of Object.entries(node)) {
        if (key === 'rawText') locations.push(path);
        walk(value, `${path}.${key}`);
      }
    })(spec, '$');

    expect(locations.sort()).toEqual([
      '$.paths./postings.post.requestBody.content.application/json.schema.properties',
      '$.paths./postings/{id}.get.responses.200.content.application/json.schema.properties',
    ]);
  });
});
