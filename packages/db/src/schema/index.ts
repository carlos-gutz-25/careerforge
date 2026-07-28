// Schema v1 (the nine M0-06 tables) + forward-only milestone additions:
// extraction_runs + requirements landed with M1-05 (migration 0003); later
// M1+ tables (fit_reports, …) arrive the same way with their milestones.
export * from './auth.ts';
export * from './profile.ts';
export * from './jobs.ts';
export * from './extractions.ts';
export * from './fit.ts';
export * from './gaps.ts';
export * from './plans.ts';
export * from './learning.ts';
export * from './exercises.ts';
export * from './mastery.ts';
export * from './resume.ts';
export * from './resume-compose.ts';
export * from './interview.ts';
export * from './skill-upgrades.ts';
export * from './case-studies.ts';
export * from './criteria-adjustments.ts';
export * from './gameplan.ts';
export * from './demo-blueprints.ts';
