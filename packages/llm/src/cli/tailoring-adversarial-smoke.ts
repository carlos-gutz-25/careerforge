// Manual tailoring adversarial live pass for `pnpm llm:tailoring-adversarial-smoke`
// (ADR-0006 layer 6 at the tailoring ingress, M2-10 section 3) — NEVER run by
// pnpm test; the vitest suites use the mocked provider exclusively. This is the
// standing gate for EVERY resume-tailoring prompt-version bump: it runs the
// fictional tailoring corpus against the REAL model with the REAL payload
// builder and spec validator (in-process, NO DB) and reports a per-fixture
// verdict plus token/cost telemetry.
//
// Env check runs FIRST (cli-smoke guard contract: an empty env exits 1 naming
// the missing variable). The key is read via validated env only and never
// printed. Output is counts / ids / booleans / telemetry ONLY — never a reason,
// quote, canary, or payload byte.
import { TAILORING_ADVERSARIAL_CORPUS } from '../adversarial/tailoring/index.ts';
import {
  evaluateTailoringFixtureRun,
  type TailoringFixtureVerdict,
} from '../adversarial/tailoring/evaluate.ts';
import { buildTailoringPayload } from '../drafting/tailoring-payload.ts';
import { parseLlmEnv, type LlmEnv } from '../env.ts';
import { createAnthropicProvider } from '../provider/anthropic.ts';
import { resumeTailoringV2 } from '../registry/prompts/resume-tailoring/v2.ts';
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
const verdicts: TailoringFixtureVerdict[] = [];

for (const fixture of TAILORING_ADVERSARIAL_CORPUS) {
  const records: LlmCallRecord[] = [];
  const collect = (record: LlmCallRecord) => void records.push(record);
  const built = buildTailoringPayload(
    fixture.skills,
    fixture.experiences,
    fixture.projects,
    fixture.gaps,
    fixture.evidence,
  );

  let verdict: TailoringFixtureVerdict;
  try {
    const result = await runPrompt(
      resumeTailoringV2,
      { untrustedData: built.payload },
      { provider, recordCall: collect },
    );
    verdict = evaluateTailoringFixtureRun(fixture, result, {
      skillIdByRef: built.skillIdByRef,
      experienceIdByRef: built.experienceIdByRef,
      projectIdByRef: built.projectIdByRef,
      bulletIdByRef: built.bulletIdByRef,
      gapIdByRef: built.gapIdByRef,
    });
  } catch {
    verdict = {
      id: fixture.id,
      class: fixture.class,
      status: 'error',
      withinPreRegistration: false,
      forbiddenHit: false,
      fabricatedRefCount: 0,
      missingRefCount: 0,
      emphasisCount: 0,
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
      `missingRefs=${String(verdict.missingRefCount)} emphases=${String(verdict.emphasisCount)}` +
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

process.exit(passed === verdicts.length ? 0 : 1);
