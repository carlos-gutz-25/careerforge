# ADR-0005: LLM Integration Pattern — Thin Provider Interface, Extract-then-Score

**Status:** Proposed · **Date:** 2026-07-12

## Context

LLMs are used for requirement extraction, gap explanation, improvement-plan and learning-plan drafting, and interview prep. Hard constraints: store source evidence; separate deterministic rules from model output; treat posting text as untrusted; swappable providers; every claim cites evidence. The design must also keep costs visible and prompts testable.

## Decision

### 1. Thin internal provider interface

`packages/llm` defines a minimal `LlmProvider` interface (roughly: `generate({ system, messages, jsonSchema?, maxTokens }) → { output, usage, model }`). The **Anthropic adapter is the default** (recommended: `claude-sonnet-5` for extraction — strong structured output at moderate cost; models are configurable per prompt via env). Adapters are ~100 lines; adding OpenAI/local later is a new adapter, not a refactor. No LangChain-style framework.

### 2. Versioned prompt registry

Prompts are TypeScript modules with stable IDs (`extract-requirements@v2`). Every LLM call records `prompt_id`, provider, model, token usage, and the **raw response** in `extraction_runs` — full audit and replay, and prompt changes can be regression-compared against stored postings.

### 3. Extract-then-score pipeline (the core rule)

**The LLM extracts; deterministic code scores.**

- LLM stage: posting text → structured requirements (JSON constrained by schema, zod-validated, retried once on schema failure, else `schema_failed`). Every requirement carries a `source_quote` that must **verbatim-match** the posting (whitespace-normalized) or is flagged `quote_verified = false`.
- Deterministic stage (`packages/scoring`, pure functions, no LLM imports): requirements × structured profile × search criteria → the 7 sub-scores (min_quals, technical, domain, seniority, comp_location, priority, stretch) and 5-bucket gap classification, each with rule-generated rationale and evidence links.
- LLM-assisted drafting (improvement plans, learning plans, interview prep) consumes only **verified, structured data** — never raw posting text again — and its outputs are always `draft` until Carlos reviews.

### 4. Cost and determinism controls

Extraction cached by `content_hash × prompt_id`; re-extraction is an explicit user action; ~~temperature 0 for extraction~~ *(superseded — see Amendment 2026-07-15)*; token usage surfaced in the UI. Tests run against a mocked provider with recorded fixtures; a small optional live smoke test is manual.

## Amendment (2026-07-15, M1-04) — determinism controls on current models

**"Temperature 0 for extraction" is unenforceable on current-generation models.** `claude-sonnet-5` (and the current Opus family) rejects non-default sampling parameters (`temperature`/`top_p`/`top_k`) with a 400 — see the official migration guide (<https://platform.claude.com/docs/en/about-claude/models/migration-guide>, Claude Sonnet 5 breaking changes) and the adaptive-thinking documentation (<https://platform.claude.com/docs/en/build-with-claude/adaptive-thinking>). The adapter therefore omits `temperature` unless explicitly configured (the knob remains for models that accept it), and the determinism story is restated:

- **The residual nondeterminism source is thinking-token variance:** adaptive thinking is on by default on `claude-sonnet-5`, varies per request, is billed even when its text is display-omitted, and shares the `max_tokens` budget with the response. The available control is `thinking: {type: "disabled"}`, exposed as `GenerateRequest.thinking: 'default' | 'disabled'` in the provider seam. Whether `extract-requirements@v1` runs with thinking disabled or default-with-low-effort is a **named M1-05 decision** (cost + determinism rationale in the M1-05 plan).
- Determinism otherwise rests on **structured outputs (wire-schema-constrained JSON) + caching by `content_hash × prompt_id` + evidence verification** — reproducibility of *scores* was never entrusted to sampling parameters (scoring is deterministic code, decision 3).
- **Structured-outputs schema subset:** the JSON Schema accepted by `output_config.format` does not support string-length constraints (`minLength`/`maxLength`) — <https://platform.claude.com/docs/en/build-with-claude/structured-outputs>, JSON Schema limitations. ADR-0006 layer-3 length caps therefore live in the **zod validation layer**, not the wire schema; every prompt version carries both (the zod schema is authoritative).

**Pricing note (budget):** `claude-sonnet-5` is $3/$15 per MTok standard, with an introductory $2/$10 through **2026-08-31** (<https://platform.claude.com/docs/en/pricing>). The T-03 budget projection was made at standard rates; the **M2 retro re-checks the budget at standard rates** after the intro pricing expires.

## Alternatives Considered

- **Vercel AI SDK:** good multi-provider abstraction; could be adopted *behind* `LlmProvider` later. Rejected as the public interface: designing the seam ourselves is the demonstrable skill, and our needs (single call shape, JSON out) are tiny.
- **LangChain/LlamaIndex:** rejected — heavy abstractions that obscure prompts and control flow, exactly what this project must keep auditable.
- **LLM scores fit directly:** rejected hard. Scores would be irreproducible, unexplainable, and injectable. Explainability is a product requirement, not a preference.

## Consequences

- Slightly more upfront code than an SDK-of-SDKs, repaid in auditability and a clean swap seam.
- Two-stage design means extraction quality bounds scoring quality — mitigated by evidence verification, confidence fields, and Carlos's review UI (override any classification).
- Stored raw responses grow the DB trivially (single user) and enable prompt regression testing — a feature, not a cost, at this scale.

## Value

- **Product:** explainable, reproducible, auditable analysis — the honesty guarantees are architectural, not aspirational.
- **Skills:** production LLM engineering: provider abstraction, prompt versioning, structured output validation, eval-style regression thinking, cost control.
- **Employability:** "responsible LLM integration with injection defense and deterministic scoring" is a differentiating, interview-rich story for 2026 senior roles — far stronger than "I called an API."
