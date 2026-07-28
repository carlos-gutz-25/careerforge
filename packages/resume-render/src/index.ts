import { MODULE_ID as CORE_MODULE_ID } from '@careerforge/core';

export const MODULE_ID = '@careerforge/resume-render';

// The ONLY @careerforge/* package this workspace depends on. Built from the real
// @careerforge/core import so it cannot drift from what is actually imported (the
// scoring index.ts shape). External npm libs (pdfmake/docx/pdf-parse/mammoth) are
// legitimate render/parse dependencies and are NOT internal-package deps - the
// module wall is about @careerforge/* packages, enforced by the D1a manifest-pin
// test (the @careerforge/* subset of dependencies) + the D1b eslint block.
export const INTERNAL_DEPENDENCIES = [CORE_MODULE_ID];

export { renderResume, type RenderedResume } from './render.ts';
export { auditParse } from './audit.ts';
