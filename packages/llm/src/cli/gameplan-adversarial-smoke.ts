// Manual application-gameplan adversarial live pass for
// `pnpm llm:gameplan-adversarial-smoke` (ADR-0006 layer 6 at the gameplan ingress,
// ADR-0019 layer L2 verification, M7-06) - NEVER run by pnpm test; the vitest
// suites use the mocked provider exclusively. This is the standing gate for EVERY
// application-gameplan prompt-version bump: it runs the fictional gameplan corpus
// against the REAL model with the REAL payload builder and ref maps (in-process,
// NO DB) and reports a per-fixture verdict plus token/cost telemetry.
//
// M7-06 ships the CLEAN-CONTROL corpus only (D7): this pass verifies the prompt's
// contract holds on BENIGN input (in-contract JSON, zero outreach-shaped structure,
// zero pointers), NOT injection resistance - the never-send-bait attack class and
// its adversarial live legs are M7-08. danglingRefs / crossReqCites are recorded as
// telemetry (the M7-07 story-citation tripwire owns their failure semantics) and do
// NOT gate PASS; outreach and pointer DO gate.
//
// Env check runs FIRST (cli-smoke guard contract: an empty env exits 1 naming the
// missing variable). The key is read via validated env only and never printed.
// Output is counts / ids / booleans / telemetry ONLY - never a model string, ref,
// or payload byte.
import {
  evaluateGameplanFixtureRun,
  type GameplanFixtureVerdict,
} from '../adversarial/gameplan/evaluate.ts';
import { GAMEPLAN_ADVERSARIAL_CORPUS } from '../adversarial/gameplan/index.ts';
import { buildGameplanPayload } from '../drafting/gameplan-payload.ts';
import { parseLlmEnv, type LlmEnv } from '../env.ts';
import { createAnthropicProvider } from '../provider/anthropic.ts';
import { applicationGameplanV1 } from '../registry/prompts/application-gameplan/v1.ts';
import { runPrompt, type LlmCallRecord } from '../run.ts';

let env: LlmEnv;
try {
  env = parseLlmEnv(process.env);
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
}

// claude-sonnet-5 intro pricing, $ per MTok (input / output), through 2026-08-31
// (ADR-0005). Telemetry only - the $20 cap is the real guard.
const INPUT_USD_PER_MTOK = 2;
const OUTPUT_USD_PER_MTOK = 10;

const provider = createAnthropicProvider({ apiKey: env.ANTHROPIC_API_KEY, model: env.LLM_MODEL });

let totalInput = 0;
let totalOutput = 0;
const verdicts: GameplanFixtureVerdict[] = [];

for (const fixture of GAMEPLAN_ADVERSARIAL_CORPUS) {
  const records: LlmCallRecord[] = [];
  const collect = (record: LlmCallRecord) => void records.push(record);
  const built = buildGameplanPayload(
    fixture.skills,
    fixture.requirements,
    fixture.evidence,
    fixture.improvementPlan,
  );

  let verdict: GameplanFixtureVerdict;
  try {
    const result = await runPrompt(
      applicationGameplanV1,
      { untrustedData: built.payload },
      { provider, recordCall: collect },
    );
    verdict = evaluateGameplanFixtureRun(fixture, result, {
      requirementIdByRef: built.requirementIdByRef,
      evidenceByRef: built.evidenceByRef,
    });
  } catch {
    // A thrown provider error already produced an 'error' record (value-free); it
    // is outside pre-registration and fails, needing classification.
    verdict = {
      id: fixture.id,
      class: fixture.class,
      status: 'error',
      withinPreRegistration: false,
      forbiddenHit: false,
      storyCount: 0,
      outreachHitCount: 0,
      pointerHitCount: 0,
      danglingRefCount: 0,
      crossRequirementCiteCount: 0,
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
      `outreachHits=${String(verdict.outreachHitCount)} pointerHits=${String(verdict.pointerHitCount)} ` +
      `danglingRefs=${String(verdict.danglingRefCount)} crossReqCites=${String(verdict.crossRequirementCiteCount)} ` +
      `stories=${String(verdict.storyCount)}` +
      (verdict.reasons.length > 0 ? ` reasons=${verdict.reasons.join(' | ')}` : '') +
      '\n',
  );
}

const passed = verdicts.filter((verdict) => verdict.pass).length;
const estCostUsd =
  (totalInput / 1_000_000) * INPUT_USD_PER_MTOK + (totalOutput / 1_000_000) * OUTPUT_USD_PER_MTOK;

process.stdout.write(
  `\n${String(passed)}/${String(verdicts.length)} fixtures passed; ` +
    `inputTokens=${String(totalInput)} outputTokens=${String(totalOutput)} ` +
    `estCostUsd=${estCostUsd.toFixed(4)}\n`,
);

// Exit 0 only when every fixture passed (within pre-registration, no outreach, no
// pointer). Any FAIL is a signal to investigate and record, never a silent pass.
process.exit(passed === verdicts.length ? 0 : 1);
