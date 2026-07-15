// Profile directories tests are ALLOWED to parse (RISKS P-01): the fictional
// example profile and the deliberately malformed fictional fixture. There is
// intentionally no constant for the real docs/profile/ — tests must not be
// able to reach it by importing something from here.
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = fileURLToPath(new URL('../../../../..', import.meta.url));

export const EXAMPLE_PROFILE_DIR = path.join(REPO_ROOT, 'docs', 'profile.example');

export const MALFORMED_PROFILE_DIR = fileURLToPath(
  new URL('./__fixtures__/malformed-profile', import.meta.url),
);
