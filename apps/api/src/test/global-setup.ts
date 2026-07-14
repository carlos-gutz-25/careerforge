// Same setup as packages/db (create careerforge_test if needed + migrate,
// fail fast when Postgres is down). A local file because vitest's globalSetup
// string is resolved as a path, not a bare package specifier.
export { default } from '@careerforge/db/test-setup';
