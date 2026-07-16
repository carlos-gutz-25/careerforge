// Manual live smoke for `pnpm llm:smoke` (ADR-0005 §4) — NEVER run by
// pnpm test; the vitest suites use the mocked provider exclusively.
// Env check runs FIRST (cli-smoke guard contract: an empty env exits 1
// naming the missing variable). The key is read via validated env only and
// never appears in any output below — model, status, token usage, latency.
// Plain writes, not pino: this is a terminal tool, not the service log stream.
import { parseLlmEnv, type LlmEnv } from '../env.ts';
import { createAnthropicProvider } from '../provider/anthropic.ts';
import { fixtureEchoV1 } from '../registry/prompts/fixture-echo/v1.ts';
import { runPrompt, type LlmCallRecord } from '../run.ts';

let env: LlmEnv;
try {
  env = parseLlmEnv(process.env);
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
}

const provider = createAnthropicProvider({ apiKey: env.ANTHROPIC_API_KEY, model: env.LLM_MODEL });
const SMOKE_DATA = 'careerforge live smoke';

const records: LlmCallRecord[] = [];
const result = await runPrompt(
  fixtureEchoV1,
  { untrustedData: SMOKE_DATA },
  {
    provider,
    recordCall: (record) => {
      records.push(record);
    },
  },
);

for (const record of records) {
  process.stdout.write(
    `[${record.promptId}] attempt ${String(record.attempt)}: status=${record.status} ` +
      `model=${record.model} inputTokens=${String(record.usage.inputTokens)} ` +
      `outputTokens=${String(record.usage.outputTokens)} ` +
      `cacheReadTokens=${String(record.usage.cacheReadInputTokens)} ` +
      `latencyMs=${String(record.latencyMs)}\n`,
  );
}

if (result.status === 'ok') {
  const echoed = result.output.echo === SMOKE_DATA;
  process.stdout.write(`echo round-trip: ${echoed ? 'MATCH' : 'MISMATCH'}\n`);
  process.exit(echoed ? 0 : 1);
}
process.stderr.write(`live smoke failed: ${result.status}\n`);
process.exit(1);
