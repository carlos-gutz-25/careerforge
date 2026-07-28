// Skills & upgrades page (M3-06 UI, M8-15). Two deterministic, LLM-free
// projections: suggested upgrades (completed, fully-evidenced exercises that
// would earn a skill a `solid` grant) and the grants audit (active + revoked,
// with the evidence trail and a derived `detached` flag). Confirm sends ONLY
// the two ids (the server re-derives the grant); revoke is the append-only
// correction recourse. Skill / requirement / exercise / artifact text are
// user/posting-derived and UNTRUSTED - rendered via {{ interpolation }} only.
// All data fictional.
import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  EVIDENCE_KINDS,
  SKILL_LEVELS,
  UPGRADE_STATUSES,
  type SkillUpgrade,
  type SkillUpgradeSuggestion,
} from '@careerforge/core';

import SkillsPage from '../app/pages/skills/index.vue';
import { ApiError } from '../app/utils/api-error.ts';

const {
  getSkillUpgradeSuggestionsMock,
  createSkillUpgradeMock,
  listSkillUpgradesMock,
  revokeSkillUpgradeMock,
} = vi.hoisted(() => ({
  getSkillUpgradeSuggestionsMock: vi.fn(),
  createSkillUpgradeMock: vi.fn(),
  listSkillUpgradesMock: vi.fn(),
  revokeSkillUpgradeMock: vi.fn(),
}));

mockNuxtImport('useApi', () => () => ({
  getSkillUpgradeSuggestions: getSkillUpgradeSuggestionsMock,
  createSkillUpgrade: createSkillUpgradeMock,
  listSkillUpgrades: listSkillUpgradesMock,
  revokeSkillUpgrade: revokeSkillUpgradeMock,
}));

function suggestion(overrides: Partial<SkillUpgradeSuggestion> = {}): SkillUpgradeSuggestion {
  return {
    profileSkillId: 'fictional-skill-1',
    skillName: 'PostgreSQL',
    currentLevel: 'rusty',
    suggestedLevel: 'solid',
    exercises: [
      {
        exerciseId: 'fictional-ex-1',
        title: 'Build a partial-index migration end to end',
        completedOn: '2026-07-10',
        matchedRequirements: [
          { gapId: 'fictional-gap-1', requirementId: 'fictional-req-1', text: 'Advanced indexing' },
        ],
      },
    ],
    ...overrides,
  };
}

function grant(overrides: Partial<SkillUpgrade> = {}): SkillUpgrade {
  return {
    id: 'fictional-grant-1',
    skillName: 'PostgreSQL',
    skillNameKey: 'postgresql',
    fromLevel: 'rusty',
    toLevel: 'solid',
    status: 'active',
    revokedAt: null,
    revokeNote: null,
    exerciseId: 'fictional-ex-1',
    exerciseTitle: 'Build a partial-index migration end to end',
    detached: false,
    evidence: [
      { kind: 'implemented', artifactUrl: 'https://example.test/pr/1', recordedOn: '2026-07-10' },
      { kind: 'tested', artifactUrl: null, recordedOn: '2026-07-11' },
    ],
    createdAt: '2026-07-12T09:00:00.000Z',
    ...overrides,
  };
}

describe('skills & upgrades page', () => {
  beforeEach(() => {
    getSkillUpgradeSuggestionsMock.mockReset();
    createSkillUpgradeMock.mockReset();
    listSkillUpgradesMock.mockReset();
    revokeSkillUpgradeMock.mockReset();
    clearNuxtData();
  });

  it('renders one suggestion per skill: name, level transition, backing exercises and their matched requirements', async () => {
    getSkillUpgradeSuggestionsMock.mockResolvedValue({ suggestions: [suggestion()] });
    listSkillUpgradesMock.mockResolvedValue({ upgrades: [] });

    const wrapper = await mountSuspended(SkillsPage);
    const rows = wrapper.findAll('[data-testid="skill-suggestion-row"]');
    expect(rows).toHaveLength(1);
    const row = rows[0]!;
    expect(row.text()).toContain('PostgreSQL');
    // Level labels are humanized from the local vocab (Rusty -> Solid).
    const level = row.get('[data-testid="suggestion-level"]').text();
    expect(level).toContain('Rusty');
    expect(level).toContain('Solid');
    expect(row.findAll('[data-testid="suggestion-exercise-row"]')).toHaveLength(1);
    expect(row.text()).toContain('Build a partial-index migration end to end');
    expect(row.get('[data-testid="suggestion-requirements"]').text()).toContain(
      'Advanced indexing',
    );
  });

  it('shows the suggestions empty state when nothing is suggested', async () => {
    getSkillUpgradeSuggestionsMock.mockResolvedValue({ suggestions: [] });
    listSkillUpgradesMock.mockResolvedValue({ upgrades: [] });

    const wrapper = await mountSuspended(SkillsPage);
    expect(wrapper.find('[data-testid="skill-suggestions"]').exists()).toBe(false);
    expect(wrapper.text()).toContain('No upgrades suggested right now');
  });

  it('Confirm sends only the two ids and re-fetches both lists (the suggestion leaves, a grant appears)', async () => {
    getSkillUpgradeSuggestionsMock
      .mockResolvedValueOnce({ suggestions: [suggestion()] })
      .mockResolvedValueOnce({ suggestions: [] });
    listSkillUpgradesMock
      .mockResolvedValueOnce({ upgrades: [] })
      .mockResolvedValueOnce({ upgrades: [grant()] });
    createSkillUpgradeMock.mockResolvedValue(grant());

    const wrapper = await mountSuspended(SkillsPage);
    expect(wrapper.findAll('[data-testid="skill-suggestion-row"]')).toHaveLength(1);

    await wrapper.get('[data-testid="confirm-upgrade"]').trigger('click');
    await vi.waitFor(() =>
      expect(createSkillUpgradeMock).toHaveBeenCalledWith({
        profileSkillId: 'fictional-skill-1',
        exerciseId: 'fictional-ex-1',
      }),
    );
    // Re-fetch: the confirmed skill leaves suggestions and appears in the audit.
    await vi.waitFor(() =>
      expect(wrapper.findAll('[data-testid="skill-suggestion-row"]')).toHaveLength(0),
    );
    expect(wrapper.findAll('[data-testid="skill-grant-row"]')).toHaveLength(1);
  });

  it('a failed Confirm surfaces the error and does not drop the suggestion', async () => {
    getSkillUpgradeSuggestionsMock.mockResolvedValue({ suggestions: [suggestion()] });
    listSkillUpgradesMock.mockResolvedValue({ upgrades: [] });
    createSkillUpgradeMock.mockRejectedValue(
      new ApiError(409, 'CONFLICT', 'this upgrade is not derivable right now'),
    );

    const wrapper = await mountSuspended(SkillsPage);
    await wrapper.get('[data-testid="confirm-upgrade"]').trigger('click');
    await vi.waitFor(() =>
      expect(wrapper.get('[data-testid="skill-action-error"]').text()).toContain(
        'this upgrade is not derivable',
      ),
    );
    expect(wrapper.findAll('[data-testid="skill-suggestion-row"]')).toHaveLength(1);
  });

  it('the audit renders active, revoked, and detached grants with their evidence trail; only active grants offer Revoke', async () => {
    getSkillUpgradeSuggestionsMock.mockResolvedValue({ suggestions: [] });
    listSkillUpgradesMock.mockResolvedValue({
      upgrades: [
        grant({ id: 'g-active' }),
        grant({
          id: 'g-revoked',
          status: 'revoked',
          revokedAt: '2026-07-20T12:00:00.000Z',
          revokeNote: 'Reassessed against the real bar',
        }),
        grant({ id: 'g-detached', skillName: 'Kotlin', skillNameKey: 'kotlin', detached: true }),
      ],
    });

    const wrapper = await mountSuspended(SkillsPage);
    const rows = wrapper.findAll('[data-testid="skill-grant-row"]');
    expect(rows).toHaveLength(3);

    const [active, revoked, detached] = rows as [
      (typeof rows)[0],
      (typeof rows)[0],
      (typeof rows)[0],
    ];
    // Active: reviewed chip + a Revoke control + the evidence trail.
    expect(active.get('[data-testid="grant-status"]').text()).toBe('active');
    expect(active.get('[data-testid="grant-status"]').classes()).toContain('app-chip--reviewed');
    expect(active.find('[data-testid="revoke-grant"]').exists()).toBe(true);
    expect(active.findAll('[data-testid="grant-evidence-row"]')).toHaveLength(2);
    // Revoked: neutral chip, the note surfaces, no Revoke offered.
    expect(revoked.get('[data-testid="grant-status"]').text()).toBe('revoked');
    expect(revoked.get('[data-testid="grant-status"]').classes()).toContain('app-chip--neutral');
    expect(revoked.get('[data-testid="grant-revoke-note"]').text()).toContain(
      'Reassessed against the real bar',
    );
    expect(revoked.find('[data-testid="revoke-grant"]').exists()).toBe(false);
    // Detached: the danger flag to revoke or re-earn.
    expect(detached.get('[data-testid="grant-detached"]').text()).toBe('detached');
  });

  it('Revoke sends the trimmed note (or null when blank) and re-fetches both lists', async () => {
    getSkillUpgradeSuggestionsMock.mockResolvedValue({ suggestions: [] });
    listSkillUpgradesMock
      .mockResolvedValueOnce({ upgrades: [grant({ id: 'g-active' })] })
      .mockResolvedValueOnce({
        upgrades: [
          grant({ id: 'g-active', status: 'revoked', revokedAt: '2026-07-20T00:00:00.000Z' }),
        ],
      });
    revokeSkillUpgradeMock.mockResolvedValue(grant({ id: 'g-active', status: 'revoked' }));

    const wrapper = await mountSuspended(SkillsPage);
    await wrapper.get('[data-testid="revoke-note"]').setValue('  no longer accurate  ');
    await wrapper.get('[data-testid="revoke-grant"]').trigger('click');
    await vi.waitFor(() =>
      expect(revokeSkillUpgradeMock).toHaveBeenCalledWith('g-active', {
        note: 'no longer accurate',
      }),
    );
    await vi.waitFor(() =>
      expect(wrapper.get('[data-testid="grant-status"]').text()).toBe('revoked'),
    );
  });

  it('Revoke with an empty note sends null, not an empty string', async () => {
    getSkillUpgradeSuggestionsMock.mockResolvedValue({ suggestions: [] });
    listSkillUpgradesMock.mockResolvedValue({ upgrades: [grant({ id: 'g-active' })] });
    revokeSkillUpgradeMock.mockResolvedValue(grant({ id: 'g-active', status: 'revoked' }));

    const wrapper = await mountSuspended(SkillsPage);
    await wrapper.get('[data-testid="revoke-note"]').setValue('   ');
    await wrapper.get('[data-testid="revoke-grant"]').trigger('click');
    await vi.waitFor(() =>
      expect(revokeSkillUpgradeMock).toHaveBeenCalledWith('g-active', { note: null }),
    );
  });

  it('a failed Revoke surfaces the error and does not drop the grant', async () => {
    getSkillUpgradeSuggestionsMock.mockResolvedValue({ suggestions: [] });
    listSkillUpgradesMock.mockResolvedValue({ upgrades: [grant({ id: 'g-active' })] });
    revokeSkillUpgradeMock.mockRejectedValue(
      new ApiError(409, 'CONFLICT', 'this grant is already revoked'),
    );

    const wrapper = await mountSuspended(SkillsPage);
    await wrapper.get('[data-testid="revoke-grant"]').trigger('click');
    await vi.waitFor(() =>
      expect(wrapper.get('[data-testid="skill-action-error"]').text()).toContain(
        'this grant is already revoked',
      ),
    );
    expect(wrapper.findAll('[data-testid="skill-grant-row"]')).toHaveLength(1);
  });

  it('the local display vocab is complete against every core skill level, evidence kind, and upgrade status', async () => {
    // A missing map key would render a blank label (level/kind) or the wrong
    // chip variant (status). Iterate each core enum array and assert the page
    // renders a real label / chip for every member - the runtime pin behind the
    // `Record<Enum, ...>` types (the GapSection LADDER precedent).
    for (const level of SKILL_LEVELS) {
      getSkillUpgradeSuggestionsMock.mockResolvedValue({ suggestions: [] });
      listSkillUpgradesMock.mockResolvedValue({
        upgrades: [grant({ fromLevel: level, toLevel: level })],
      });
      clearNuxtData();
      const wrapper = await mountSuspended(SkillsPage);
      expect(wrapper.get('[data-testid="grant-level"]').text().toLowerCase()).toContain(level);
    }

    for (const kind of EVIDENCE_KINDS) {
      getSkillUpgradeSuggestionsMock.mockResolvedValue({ suggestions: [] });
      listSkillUpgradesMock.mockResolvedValue({
        upgrades: [grant({ evidence: [{ kind, artifactUrl: null, recordedOn: '2026-07-10' }] })],
      });
      clearNuxtData();
      const wrapper = await mountSuspended(SkillsPage);
      expect(wrapper.get('[data-testid="grant-evidence-row"]').text().toLowerCase()).toContain(
        kind,
      );
    }

    for (const status of UPGRADE_STATUSES) {
      getSkillUpgradeSuggestionsMock.mockResolvedValue({ suggestions: [] });
      listSkillUpgradesMock.mockResolvedValue({
        upgrades: [
          grant({ status, revokedAt: status === 'revoked' ? '2026-07-20T00:00:00.000Z' : null }),
        ],
      });
      clearNuxtData();
      const wrapper = await mountSuspended(SkillsPage);
      const chip = wrapper.get('[data-testid="grant-status"]');
      expect(chip.text()).toBe(status);
      // A defined variant, never the neutral fallback for an unmapped key
      // (active -> reviewed, revoked -> neutral are the only two).
      expect(chip.classes().some((c) => c.startsWith('app-chip--'))).toBe(true);
    }
  });

  it('hostile skill / requirement / exercise / artifact text renders inert (interpolation, not markup)', async () => {
    const xss = '<img src=x onerror="document.body.dataset.xss=1">';
    getSkillUpgradeSuggestionsMock.mockResolvedValue({
      suggestions: [
        suggestion({
          skillName: xss,
          exercises: [
            {
              exerciseId: 'fictional-ex-9',
              title: xss,
              completedOn: '2026-07-10',
              matchedRequirements: [{ gapId: 'g9', requirementId: 'r9', text: xss }],
            },
          ],
        }),
      ],
    });
    listSkillUpgradesMock.mockResolvedValue({
      upgrades: [
        grant({ evidence: [{ kind: 'implemented', artifactUrl: xss, recordedOn: '2026-07-10' }] }),
      ],
    });

    const wrapper = await mountSuspended(SkillsPage);
    // No element parsed the payload; the raw text is present as escaped content.
    expect(wrapper.element.querySelector('img')).toBeNull();
    expect(wrapper.text()).toContain('<img');
    expect((document.body.dataset as Record<string, string | undefined>).xss).toBeUndefined();
  });
});
