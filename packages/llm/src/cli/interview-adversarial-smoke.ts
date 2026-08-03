// Manual interview-prep adversarial live pass for
// `pnpm llm:interview-adversarial-smoke` (ADR-0006 layer 6 at the
// interview-prep ingress, M3-04 section 8) — NEVER run by pnpm test; the
// vitest suites use the mocked provider exclusively. This is the standing
// gate for EVERY interview-prep prompt-version bump: it runs the fictional
// interview corpus against the REAL model with the REAL payload builder and
// ref maps (in-process, NO DB) and reports a per-fixture verdict plus
// token/cost telemetry.
//
// Env check runs FIRST (cli-smoke guard contract: an empty env exits 1 naming
// the missing variable). The key is read via validated env only and never
// printed. Output is counts / ids / booleans / telemetry ONLY — never a
// question, point, quote, canary, or payload byte.
import { buildInterviewPayload } from '../drafting/interview-payload.ts';
import {
  evaluateInterviewFixtureRun,
  type InterviewFixtureVerdict,
} from '../adversarial/interview/evaluate.ts';
import { INTERVIEW_ADVERSARIAL_CORPUS } from '../adversarial/interview/index.ts';
import { parseLlmEnv, type LlmEnv } from '../env.ts';
import { createAnthropicProvider } from '../provider/anthropic.ts';
import { interviewPrepV1 } from '../registry/prompts/interview-prep/v1.ts';
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
const verdicts: InterviewFixtureVerdict[] = [];

for (const fixture of INTERVIEW_ADVERSARIAL_CORPUS) {
  const records: LlmCallRecord[] = [];
  const collect = (record: LlmCallRecord) => void records.push(record);
  const built = buildInterviewPayload(fixture.skills, fixture.requirements, fixture.evidence);

  let verdict: InterviewFixtureVerdict;
  try {
    const result = await runPrompt(
      interviewPrepV1,
      { untrustedData: built.payload },
      { provider, recordCall: collect },
    );
    verdict = evaluateInterviewFixtureRun(fixture, result, built);
  } catch {
    // A thrown provider error already produced an 'error' record (value-free);
    // it is outside pre-registration and fails, needing classification.
    verdict = {
      id: fixture.id,
      class: fixture.class,
      status: 'error',
      withinPreRegistration: false,
      forbiddenHit: false,
      pointerHitCount: 0,
      fabricatedRefCount: 0,
      questionCount: 0,
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
      `questions=${String(verdict.questionCount)}` +
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
