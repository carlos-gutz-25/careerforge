// Keyless mocked-provider test for the demo:capture pipeline (M10-03 slice 5b).
//
// Drives runDemoCapture against the dockerized integration test DB with a mock
// LlmProvider dispatched by prompt family, so CI exercises the WHOLE capture
// path (extract -> deterministic score -> draft the six artifacts) WITHOUT an
// API key and WITHOUT spend. The pipeline's own zod validation runs at capture
// time (each service parses provider output against its outputSchema), so a
// mock that returns schema-valid, tripwire-passing payloads proves the path is
// green end-to-end. Asserts: every posting yields a requirement-bearing
// extraction run; the strongest-fit proxy resolves; the tractable artifacts
// persist; every artifact honors the persist-or-null capture contract; and the
// usage tally reflects mock calls only (no real spend). All inputs are
// fictional (the example profile + DEMO_POSTINGS) per RISKS P-01.
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestDb, truncateAllTables } from '@careerforge/db/test-utils';
import type { GenerateRequest, GenerateResult, LlmProvider } from '@careerforge/llm';

import { runDemoCapture } from './capture.ts';
import { DEMO_POSTINGS } from './postings.ts';

// ---------------------------------------------------------------------------
// Mock payload builders — one per prompt family. Each returns a schema-VALID
// JSON `text` that also clears the service's server-side citation/provenance
// tripwire so the artifact persists (except interview-prep/resume-compose,
// which are persist-or-null by design). Ref discovery scans the UNTRUSTED-DATA
// block ONLY (never the whole message): the prompt instructions embed literal
// example refs (g1/r1/s1/...), and scanning them would inject phantom refs that
// break resume-tailoring's exact-permutation check. All values are fictional
// and pure ASCII.
// ---------------------------------------------------------------------------

/** Text between the <<<UNTRUSTED-DATA-{hex}>>> markers (packages/llm untrusted.ts). */
function dataBlock(content: string): string {
  const m = content.match(
    /<<<UNTRUSTED-DATA-[0-9a-f]+>>>\n([\s\S]*?)\n<<<END-UNTRUSTED-DATA-[0-9a-f]+>>>/,
  );
  return m?.[1] ?? '';
}

function refNums(block: string, prefix: string): number[] {
  // \b{prefix}\d+\b — 'e' will not match the "e1" inside a bullet ref "e1b1"
  // (no boundary before 'b'), and 'ev1' is disjoint from 'e' (which requires a
  // digit right after). So s/p/g/r/e/ev never cross-match.
  const re = new RegExp(`\\b${prefix}(\\d+)\\b`, 'g');
  const nums = new Set<number>();
  let mt: RegExpExecArray | null;
  while ((mt = re.exec(block)) !== null) nums.add(Number(mt[1]));
  return [...nums].sort((a, b) => a - b);
}

function firstRef(content: string, prefix: string): string | undefined {
  const nums = refNums(dataBlock(content), prefix);
  return nums.length ? `${prefix}${String(nums[0])}` : undefined;
}

/** Truncate at a word boundary to <=max chars (keeps whole tokens/numbers). */
function clampWords(s: string, max: number): string {
  const t = s.trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  const lastSpace = cut.lastIndexOf(' ');
  return (lastSpace > 0 ? cut.slice(0, lastSpace) : cut).trim();
}

const DISCLOSURE_REQUIRED = new Set([
  'have_undemonstrated',
  'needs_refresh',
  'genuine_gap',
  'low_priority',
]);

function extractRequirements(content: string): string {
  // A nice_to_have framework requirement for a skill the example profile lacks
  // (Kubernetes) → classification `low_priority` → an ELIGIBLE gap on every
  // posting, so improvement-plan/learning-plan have something to draft. Notes:
  //  - a must_have for an absent skill would classify `unknown` (NOT eligible,
  //    the M12-02 "no evidence is not a confirmed gap" rule), so kind matters.
  //  - the matcher pools text + sourceQuote, so the sourceQuote must be
  //    skill-free: a quote containing e.g. "Node.js" would forge a `have` link
  //    and drop eligibility. "Engineer" is verbatim in every posting title and
  //    matches none of the 8 profile skills, so it clears both the quote
  //    tripwire and the skill matcher. (This is a test double, not the shipped
  //    fixture — the live capture extracts the real, richer requirement set.)
  void content;
  return JSON.stringify({
    requirements: [
      {
        kind: 'nice_to_have',
        category: 'framework',
        text: 'Kubernetes',
        sourceQuote: 'Engineer',
        confidence: 0.9,
      },
    ],
  });
}

function improvementPlan(content: string): string {
  const gapRef = firstRef(content, 'g') ?? 'g1';
  return JSON.stringify({
    items: [
      {
        gapRef,
        action: 'Build a small public project that exercises this skill end to end.',
        priority: 'high',
        recommendations: [],
      },
    ],
  });
}

function learningPlan(content: string): string {
  const gapRef = firstRef(content, 'g') ?? 'g1';
  return JSON.stringify({
    title: 'Focused skill-closure plan',
    items: [
      {
        gapRef,
        focus: 'Study the fundamentals and build a demonstrable example to close this gap.',
        priority: 'high',
      },
    ],
  });
}

function interviewPrep(content: string): string {
  const block = dataBlock(content);
  let requirementRef = firstRef(content, 'r') ?? 'r1';
  let obliged = false;
  try {
    const payload = JSON.parse(block) as {
      requirements?: { ref: string; gapClassification?: string }[];
    };
    const req =
      payload.requirements?.find((r) => r.ref === requirementRef) ?? payload.requirements?.[0];
    if (req) {
      requirementRef = req.ref;
      obliged =
        req.gapClassification !== undefined && DISCLOSURE_REQUIRED.has(req.gapClassification);
    }
  } catch {
    /* not JSON => treat as unobliged */
  }
  return JSON.stringify({
    questions: [
      {
        requirementRef,
        kind: 'technical',
        question: 'Walk me through how you have approached this area in your recent work.',
        evidencePoints: [],
        gapDisclosures: obliged
          ? [
              'I have not yet demonstrated this publicly, but here is how I would build the evidence.',
            ]
          : [],
      },
    ],
  });
}

function applicationGameplan(): string {
  const phase = 'Prepare deliberately and lead with the strongest verified evidence.';
  return JSON.stringify({
    strategySummary: 'Lead with proven strengths and address every gap honestly at each stage.',
    phaseStrategies: {
      apply: phase,
      screen: phase,
      interview: phase,
      offer: 'Weigh the offer against your priorities and negotiate in good faith.',
    },
    stories: [],
  });
}

function resumeCompose(content: string): string {
  const block = dataBlock(content);
  let ref: string | undefined;
  let source = '';
  try {
    const payload = JSON.parse(block) as { evidence?: { ref: string; source: string }[] };
    const first = payload.evidence?.[0];
    if (first) {
      ref = first.ref;
      source = first.source;
    }
  } catch {
    /* no-op */
  }
  if (ref === undefined || source.trim() === '') return JSON.stringify({ claims: [] });
  return JSON.stringify({
    claims: [
      { text: clampWords(source, 300), section: 'summary', entityRef: null, citationRefs: [ref] },
    ],
  });
}

function resumeTailoring(content: string): string {
  // skillOrder/projectOrder must be EXACT permutations of the sent refs, so
  // read them from the JSON payload's own ref fields — NOT by regex over the
  // block, which would pick up phantom refs from free text (e.g. "p95 latency"
  // in a bullet reads as project ref p95, breaking the permutation).
  let skillOrder: string[] = [];
  let projectOrder: string[] = [];
  try {
    const payload = JSON.parse(dataBlock(content)) as {
      skills?: { ref: string }[];
      projects?: { ref: string }[];
    };
    skillOrder = (payload.skills ?? []).map((s) => s.ref);
    projectOrder = (payload.projects ?? []).map((p) => p.ref);
  } catch {
    /* not JSON => empty orders (an empty permutation of an empty set) */
  }
  return JSON.stringify({ skillOrder, projectOrder, emphases: [], experienceBulletOrders: [] });
}

/** Dispatch on the (unique) system prompt of each family; discover refs from
 *  the user message. Unknown family = a loud throw (a new prompt reached the
 *  demo pipeline without a mock). */
function respondTo(req: GenerateRequest): string {
  const content = req.messages[0]?.content ?? '';
  const sys = req.system;
  if (sys.includes('requirement-extraction stage')) return extractRequirements(content);
  if (sys.includes('improvement-plan drafting stage')) return improvementPlan(content);
  if (sys.includes('learning-plan drafting stage')) return learningPlan(content);
  if (sys.includes('interview-prep drafting stage')) return interviewPrep(content);
  if (sys.includes('application-gameplan drafting stage')) return applicationGameplan();
  if (sys.includes('resume-composition stage')) return resumeCompose(content);
  if (sys.includes('resume-tailoring stage')) return resumeTailoring(content);
  throw new Error(`mock: unrecognized prompt family; system starts: ${sys.slice(0, 60)}`);
}

interface RecordingMockProvider extends LlmProvider {
  readonly requests: GenerateRequest[];
}

function createDemoMockProvider(): RecordingMockProvider {
  const requests: GenerateRequest[] = [];
  return {
    name: 'mock',
    requests,
    generate(request: GenerateRequest): Promise<GenerateResult> {
      requests.push(request);
      const text = respondTo(request);
      return Promise.resolve({
        text,
        usage: {
          inputTokens: 100,
          outputTokens: 50,
          cacheReadInputTokens: 0,
          cacheCreationInputTokens: 0,
        },
        model: 'mock-model',
        stopReason: 'end_turn',
        raw: { mock: true },
      });
    },
  };
}

// ---------------------------------------------------------------------------

interface PostingFixture {
  slug: string;
  extraction: { requirements: unknown[] } | null;
  gapCount: number;
}
interface ArtifactFixture {
  strongestSlug: string;
  improvementPlan: unknown;
  learningPlan: unknown;
  interviewPrep: unknown;
  gameplan: unknown;
  resumeDocument: unknown;
  resumeVariant: unknown;
}

const ARTIFACT_KEYS = [
  'improvementPlan',
  'learningPlan',
  'interviewPrep',
  'gameplan',
  'resumeDocument',
  'resumeVariant',
] as const;

const handle = createTestDb();
const repoRoot = fileURLToPath(new URL('../../../../../', import.meta.url));
const profileDir = path.join(repoRoot, 'docs/profile.example');

describe('demo:capture pipeline (mocked provider, keyless)', () => {
  beforeEach(() => truncateAllTables(handle));
  afterAll(() => handle.pool.end());

  it('captures a fixture set end-to-end with no live provider call', async () => {
    const provider = createDemoMockProvider();
    const result = await runDemoCapture({ db: handle.db, provider, profileDir });

    // Every posting is captured with a requirement-bearing extraction run.
    const postings = result.fixtureSet.postings as PostingFixture[];
    expect(postings).toHaveLength(DEMO_POSTINGS.length);
    for (const p of postings) {
      expect(p.extraction).not.toBeNull();
      expect(p.extraction?.requirements.length ?? 0).toBeGreaterThan(0);
      expect(p.gapCount).toBeGreaterThanOrEqual(0);
    }

    // The strongest-fit proxy resolves to one of the captured postings.
    expect(DEMO_POSTINGS.map((x) => x.slug)).toContain(result.strongestSlug);

    // Usage is tallied from the mock only — no real spend. One tally per call.
    expect(result.usage.calls).toBeGreaterThan(0);
    expect(provider.requests).toHaveLength(result.usage.calls);

    // With the mocked provider every family returns a schema-valid,
    // tripwire-passing payload, so all six artifacts persist deterministically.
    // (A live capture may legitimately flag some — the capture contract
    // tolerates null — but the keyless test pins the happy path so a mock or
    // pipeline regression fails loudly.)
    const artifacts = result.fixtureSet.artifacts as unknown as ArtifactFixture;
    expect(artifacts.strongestSlug).toBe(result.strongestSlug);
    for (const key of ARTIFACT_KEYS) {
      expect(artifacts[key], `${key} should persist under the mock`).not.toBeNull();
      expect(typeof artifacts[key]).toBe('object');
    }

    // The persisted improvement plan is a repo row aggregate (PlanWithItems:
    // items are {item, gapClassification, gapRequirementId, ...}) with >=1
    // drafted item grounded in a real gap.
    const plan = artifacts.improvementPlan as {
      items: { item: { action: string }; gapClassification: string; gapRequirementId: string }[];
    };
    expect(Array.isArray(plan.items)).toBe(true);
    expect(plan.items.length).toBeGreaterThan(0);
    expect(typeof plan.items[0]?.item.action).toBe('string');
    expect(typeof plan.items[0]?.gapRequirementId).toBe('string');

    // interview-prep telemetry is captured whenever the draft was reached
    // (value-free counts; null only if drafting never ran).
    expect(result.interviewPrepTelemetry).not.toBeNull();
  }, 60_000);
});
