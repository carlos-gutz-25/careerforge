import { type Column, getTableColumns, getTableName } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import {
  applicationGameplanRuns,
  applicationGameplans,
  gameplanChecks,
  gameplanPhaseStrategies,
  gameplanStories,
  gameplanStoryCitations,
} from './gameplan.ts';

// M7-05 (ADR-0019) — NEVER-SEND LAYER L1, enforced by construction. The strongest
// never-send guarantee is structural: none of the gameplan tables may carry a
// message-shaped field, because a schema that cannot hold a message cannot send
// one. This test greps every column identifier (both the Drizzle JS key and the
// resolved DB column name) of all six tables against a forbidden message-shaped
// set and fails if any appears. If a future change adds a `body`/`subject`/
// `recipient`/… column to the artifact, this goes RED — the intended tripwire.

const GAMEPLAN_TABLES = [
  applicationGameplanRuns,
  applicationGameplans,
  gameplanPhaseStrategies,
  gameplanStories,
  gameplanStoryCitations,
  gameplanChecks,
];

// Exact-identifier forbiddens (matched whole, case-insensitive). The two-letter
// `to`/`from` are exact-only on purpose: as substrings they would false-match
// legitimate names like `inputTokens` ("to" in "tokens").
const FORBIDDEN_EXACT = new Set([
  'to',
  'from',
  'cc',
  'bcc',
  'sender',
  'recipient',
  'subject',
  'body',
  'message',
  'email',
  'emailaddress',
  'email_address',
  'salutation',
  'signature',
]);

// Unambiguous message-shaped substrings — none of the legitimate gameplan column
// names contains any of these, so a substring hit means a real message field.
const FORBIDDEN_SUBSTRINGS = [
  'recipient',
  'subject',
  'message',
  'salutation',
  'signature',
  'email',
];

function columnIdentifiers(table: (typeof GAMEPLAN_TABLES)[number]): string[] {
  // JS keys (Drizzle property names) AND resolved DB column names, both matched.
  // getTableColumns() over the union-typed `table` widens to `any`, so cast to a
  // typed record to keep the type-aware lint rules satisfied.
  const columns = getTableColumns(table) as Record<string, Column>;
  const jsKeys = Object.keys(columns).map((key) => key.toLowerCase());
  const dbNames = Object.values(columns).map((column) => column.name.toLowerCase());
  return [...jsKeys, ...dbNames];
}

describe('gameplan schema — never-send layer L1 (no message-shaped column)', () => {
  it.each(GAMEPLAN_TABLES.map((table) => ({ name: getTableName(table), table })))(
    '$name carries no message-shaped column',
    ({ table }) => {
      for (const identifier of columnIdentifiers(table)) {
        expect(FORBIDDEN_EXACT.has(identifier)).toBe(false);
        for (const forbidden of FORBIDDEN_SUBSTRINGS) {
          expect(identifier.includes(forbidden)).toBe(false);
        }
      }
    },
  );

  it('covers exactly the six gameplan tables', () => {
    const names = GAMEPLAN_TABLES.map((table) => getTableName(table)).sort();
    expect(names).toEqual(
      [
        'application_gameplan_runs',
        'application_gameplans',
        'gameplan_checks',
        'gameplan_phase_strategies',
        'gameplan_stories',
        'gameplan_story_citations',
      ].sort(),
    );
  });

  it('every gameplan table carries userId (ADR-0007) and timestamps', () => {
    // The db instance applies snake_case casing at query-build time, so the raw
    // column object's key is the camelCase JS name — assert on those keys.
    for (const table of GAMEPLAN_TABLES) {
      const keys = Object.keys(getTableColumns(table));
      expect(keys).toContain('userId');
      expect(keys).toContain('createdAt');
      expect(keys).toContain('updatedAt');
    }
  });
});
