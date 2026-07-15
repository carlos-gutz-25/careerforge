// CLI entry for `pnpm openapi:generate` — writes the OpenAPI spec derived
// from the route zod schemas to docs/api/openapi.json (or --out <path>).
// Env-free by design (see SPEC_ENV): the spec cannot depend on configuration,
// so this CLI reads no environment variables at all. The committed file is
// drift-checked by openapi-drift.test.ts; run this and commit when it fails.
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

import { renderOpenApiSpec } from '../openapi.ts';

const DEFAULT_OUT = fileURLToPath(new URL('../../../../docs/api/openapi.json', import.meta.url));

const { values } = parseArgs({ options: { out: { type: 'string' } } });
const outPath = path.resolve(values.out ?? DEFAULT_OUT);

const spec = await renderOpenApiSpec();
await mkdir(path.dirname(outPath), { recursive: true });
await writeFile(outPath, spec, 'utf8');

const pathCount = Object.keys((JSON.parse(spec) as { paths?: object }).paths ?? {}).length;
process.stdout.write(`wrote ${outPath} (${pathCount} paths)\n`);
