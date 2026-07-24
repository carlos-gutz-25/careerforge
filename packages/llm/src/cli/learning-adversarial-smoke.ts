// Manual learning-plan adversarial live pass for
// `pnpm llm:learning-adversarial-smoke` (ADR-0006 layer 6 at the learning-plan
// ingress, M3-01 section 5) — NEVER run by pnpm test; the vitest suites use the
// mocked provider exclusively. This is the standing gate for EVERY
// learning-plan prompt-version bump: it runs the fictional learning corpus
// against the REAL model with the REAL payload builder and citation map
// (in-process, NO DB) and reports a per-fixture verdict plus token/cost
// telemetry.
//
// Env check runs FIRST (cli-smoke guard contract: an empty env exits 1 naming
// the missing variable). The key is read via validated env only and never
// printed. Output is counts / ids / booleans / telemetry ONLY — never a focus,
// title, quote, canary, or payload byte.
import { buildLearningPayload } from '../drafting/learning-payload.ts';
import {
  evaluateLearningFixtureRun,
  type LearningFixtureVerdict,
} from '../adversarial/learning/evaluate.ts';
import { LEARNING_ADVERSARIAL_CORPUS } from '../adversarial/learning/index.ts';
import { parseLlmEnv, type LlmEnv } from '../env.ts';
import { createAnthropicProvider } from '../provider/anthropic.ts';
import { learningPlanV1 } from '../registry/prompts/learning-plan/v1.ts';
import { runPrompt, type LlmCallRecord } from '../run.ts';

let env: LlmEnv;
try {
  env = parseLlmEnv(process.env);
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
}

// claude-sonnet-5 intro pricing, $ per MTok (input / output), through
// 2026-08-31 (ADR-0005). Telemetry only — the $20 cap is the real guard.
const INPUT_USD_PER_MTOK = 2;
const OUTPUT_USD_PER_MTOK = 10;

const provider = createAnthropicProvider({ apiKey: env.ANTHROPIC_API_KEY, model: env.LLM_MODEL });

let totalInput = 0;
let totalOutput = 0;
const verdicts: LearningFixtureVerdict[] = [];

for (const fixture of LEARNING_ADVERSARIAL_CORPUS) {
  const records: LlmCallRecord[] = [];
  const collect = (record: LlmCallRecord) => void records.push(record);
  const built = buildLearningPayload(fixture.skills, fixture.gaps, fixture.evidence);

  let verdict: LearningFixtureVerdict;
  try {
    const result = await runPrompt(
      learningPlanV1,
      { untrustedData: built.payload },
      { provider, recordCall: collect },
    );
    verdict = evaluateLearningFixtureRun(fixture, result, built.gapIdByRef);
  } catch {
    // A thrown provider error already produced an 'error' record (value-free);
    // it is outside pre-registration and fails, needing classification.
    verdict = {
      id: fixture.id,
      class: fixture.class,
      status: 'error',
      withinPreRegistration: false,
      forbiddenHit: false,
      fabricatedRefCount: 0,
      itemCount: 0,
      pass: false,
      reasons: ['provider call threw (classify and record)'],
    };
  }

  for (const record of records) {
    totalInput += record.usage.inputTokens;
    totalOutput += record.usage.outputTokens;
  }
  verdicts.push(verdict);

  process.stdout.write(
    `[${verdict.id}] class=${verdict.class} status=${verdict.status} ` +
      `pass=${String(verdict.pass)} withinPreReg=${String(verdict.withinPreRegistration)} ` +
      `obeyMarker=${String(verdict.forbiddenHit)} fabricatedRefs=${String(verdict.fabricatedRefCount)} ` +
      `items=${String(verdict.itemCount)}` +
      (verdict.reasons.length > 0 ? ` reasons=${verdict.reasons.join(' | ')}` : '') +
      '\n',
  );
}

const passed = verdicts.filter((verdict) => verdict.pass).length;
const estCostUsd =
  (totalInput / 1_000_000) * INPUT_USD_PER_MTOK + (totalOutput / 1_000_000) * OUTPUT_USD_PER_MTOK;

process.stdout.write(
  `\n${String(passed)}/${String(verdicts.length)} fixtures within pre-registration; ` +
    `inputTokens=${String(totalInput)} outputTokens=${String(totalOutput)} ` +
    `estCostUsd=${estCostUsd.toFixed(4)}\n`,
);

// Exit 0 only when every fixture is within pre-registration with no
// obey-marker. Any FAIL is a signal to investigate and record, never a silent
// pass.
process.exit(passed === verdicts.length ? 0 : 1);
