---
title: Building CareerForge with a Two-Seat Agentic Workflow
description: A career-development platform built as both product and proof, a modular-monolith TypeScript system developed through a disciplined, independently-reviewed, multi-agent process with a human merge gate.
provenance: personal_ai_assisted
date: 2026-07-22
---

## Problem

CareerForge began as a practical response to my own search for my next senior
engineering role.

I did not need another job board. I needed a system that could take a real job
posting, compare it with my actual experience, show the evidence behind that
comparison, identify where I genuinely fell short, and turn those gaps into a
concrete improvement plan. Existing job platforms help people find openings, but
they do not complete the full loop: find a role, assess the evidence, identify
gaps, strengthen the candidate, and apply strategically.

CareerForge also addressed a second problem: much of my strongest engineering work
belongs to former employers and cannot be published. I can describe the outcomes,
but I cannot show the underlying proprietary code. That work includes improving
complex sales-data visualization performance by more than 30%, reducing targeted
API latency from more than two seconds to roughly 40 milliseconds, building backend
services for a feature that processes more than $150k in daily transactions, and
creating automation that reduced QA costs by roughly $161k per quarter.

I therefore needed a current, public artifact where employers could inspect more
than resume bullets. CareerForge gave me a place to demonstrate how I define
boundaries, structure a system, evaluate tradeoffs, test claims, and decide when
work is actually complete.

As the project evolved, it became an additional engineering experiment: could I use
AI to accelerate implementation without outsourcing judgment? I did not want a pile
of plausible-looking code that I could not fully explain or defend. I wanted to
find out whether a disciplined, multi-agent process, combined with explicit
boundaries, independent review, planted failures, and a merge gate controlled by
me, could produce software I would confidently place in a public repository.
CareerForge became both the product and the proof.

CareerForge is under active development. The Job Intelligence MVP is complete and
this portfolio is live, while later milestones (the skill accelerator and the
integrations that close the loop) are still ongoing. I describe it here honestly as
work in progress.

**Primary user:** me, during an active senior-engineering job search.
**Secondary audience:** hiring teams and engineers who want to evaluate both the
finished platform and the engineering process behind it.

## Constraints

* **Public repository, private career data.** The monorepo is public, but real
  resume data, salary information, job postings, and application activity remain
  local and gitignored. Public tests and fixtures use a fictional profile only.
* **Never fabricate evidence.** CareerForge cannot invent experience, resume
  content, accomplishments, or metrics. Fit analysis must connect a conclusion to
  real evidence or clearly state that evidence is missing.
* **No automated scraping in the MVP.** Although the original idea included
  scraping jobs, the implemented MVP accepts pasted job descriptions. Automated
  collection was deliberately excluded because of terms-of-service, legal, privacy,
  and maintenance concerns.
* **Local-first platform.** The career platform remains local through the MVP.
  Only the public portfolio is deployed.
* **Team-grade controls on a solo project.** Changes to the main branch require
  pull requests, green checks, and merge-only integration, with no personal
  bypass. I wanted the repository to demonstrate how I work under real engineering
  controls, not merely what I can make run locally.
* **The tool cannot replace the search.** I began using the platform alongside
  real applications rather than postponing the job search until the product felt
  complete.

## Architecture

CareerForge uses a modular-monolith architecture with TypeScript across the whole
system: Nuxt and Vue 3 for the frontend, Fastify for the backend, and PostgreSQL
with Drizzle for persistence.

The architectural feature I value most is the enforcement of explicit module
boundaries. The scoring package contains pure, deterministic logic and cannot
import the LLM package; the LLM package is the only one that touches provider SDKs
and owns the versioned prompt registry; the database package is the only module
that contains SQL; application flow runs from routes to services to repositories;
and the portfolio cannot import platform packages or private career data. This
separation prevents probabilistic model output from quietly becoming deterministic
business logic. The system can use an LLM where interpretation is valuable without
letting the model become the untraceable source of every decision.

Every external boundary is validated with Zod: API input, environment
configuration, structured LLM output, and persisted data entering application
workflows. Structured logging uses request IDs and excludes personally
identifiable information.

The development process is also part of the architecture. I used two distinct
agent seats: an execution seat that wrote and committed changes, and a read-only
review seat that independently checked claims and implementation details against
primary sources. I remained responsible for defining the work, resolving
disagreements, deciding whether the evidence was sufficient, and authorizing every
merge. The agents increased implementation and review capacity; they did not own
the definition of correctness.

The public monorepo is itself the living evidence for this study. Its architecture
decision records, its continuous-integration workflows, and the code are all open
to inspection: the [repository](https://github.com/carlos-gutz-25/careerforge),
the [architecture decision records](https://github.com/carlos-gutz-25/careerforge/tree/main/docs/DECISIONS),
and the [CI workflows](https://github.com/carlos-gutz-25/careerforge/tree/main/.github/workflows).

## Tradeoffs

### Pasted job descriptions instead of automated scraping

The earliest concept included scraping jobs to find opportunities automatically. I
deliberately narrowed the MVP to pasted job descriptions. That choice made
ingestion less convenient, but it removed avoidable terms-of-service, legal,
privacy, and maintenance risk. It also kept the first milestone focused on the more
important problem: whether CareerForge could evaluate a role honestly and produce a
useful action plan once a posting entered the system.

### Extending the existing required CI check instead of adding another

New gates were folded into the existing required check rather than advertised as a
separate blocking status. Adding a new required check would have meant another
branch-protection change and risked configuring protection around a status that was
not yet reliably emitted. The cost is that each pull request now pays a few extra
minutes for browser-based validation. I accepted that cost in exchange for an
enforceable and truthful gate.

### Full axe-core analysis instead of Lighthouse's accessibility subset

Lighthouse's accessibility audit does not execute every axe rule, so CareerForge
runs the full axe-core engine. That makes the accessibility gate slower, but it
means the claim of zero detected violations refers to the complete configured
engine rather than a convenient subset.

### Pinned browser instead of a rolling version

The browser is pinned in CI so Lighthouse measurements and performance budgets are
reproducible. A rolling version could introduce unexplained score changes unrelated
to application code.

### GitHub Pages with an OIDC deployment

The portfolio uses GitHub Pages and an OIDC-based deployment with no long-lived
deployment secret. This introduces limitations around configurable HTTP response
headers. I accepted that limitation only after verifying that the affected
Lighthouse audits carried no score weight under the configured quality budget.

## Testing

CareerForge treats testing as evidence, not ceremony.

**Every gate must be observed failing.** When I add or narrow a quality gate, I
intentionally introduce a controlled defect and capture the resulting failure. A
check that has only ever passed has not yet demonstrated that it protects anything.
This planted-failure discipline makes each gate prove that it can detect the
condition it claims to prevent.

**New checks must demonstrate unique coverage.** A gate must also prove that it
catches something the existing suite cannot. An accessibility defect in a
scrollable region made the full axe check fail while the Lighthouse accessibility
score still reported a perfect result; an incorrect base-path prefix made the
internal-link check fail while the structural HTML check stayed green, the same
class of defect that had previously allowed an unstyled deployment to look
successful.

**Merge blocking is proven in CI, not just locally.** Planted regressions were
committed and allowed to reach CI so the repository could prove that the required
check actually turned red and prevented merging. The evidence is tied to specific
commits rather than to local terminal output alone.

**Review is adversarial, including toward the tests.** The two-seat process found
failures that conventional coverage would not necessarily expose: a planted test
that exercised a rule Lighthouse already covered, so it did not prove the new
gate's unique value; a dependency published that same day that was automatically
introduced as a supply-chain exception, then removed and replaced with a vetted,
pinned release; and residue from a planted regression that remained after the
intended repair and was found by comparing the resulting tree against a known-clean
baseline. The process did not assume that a passing test, a generated explanation,
or a review agent was automatically correct.

The platform also uses conventional automated coverage: Vitest unit and integration
tests, a dockerized PostgreSQL for integration testing, Playwright end-to-end
tests, mocked LLM providers with recorded fixtures, and a prompt-injection corpus
that must remain green.

## Results

The Job Intelligence MVP completes the workflow it set out to: extract
requirements, evaluate fit, classify gaps, and generate an improvement plan for
review.

During the M1 dogfood gate I used CareerForge to evaluate 6 real job postings from
my active search, and its fit reports informed applications that were already in
flight. [M1-13; docs/profile/projects.md]

The portfolio is deployed at a custom apex domain with no long-lived deployment
secret. Three CI quality gates protect the deployed artifact: Lighthouse
performance and quality budgets, full axe-core accessibility analysis, and
internal-link and asset-path validation. Each gate is proven to block merges rather
than merely to run: planted regressions turned the required check red at specific
commits, and the evidence is tied to those commits rather than to local output
alone. [ec37ecf; b7492b6] The Lighthouse budget was demonstrated with a local
planted failure, and in CI it blocks through the same fail-on-error wiring the
other two gates use. [M2-03]

The public repository is itself one of the project's primary deliverables. It
provides inspectable evidence of senior full-stack TypeScript development; backend
and data-boundary design; deterministic and LLM-assisted logic kept under separate
controls; runtime validation and privacy boundaries; automated testing and
adversarial quality gates; CI/CD and branch-protection discipline; architectural
tradeoff documentation; and responsible use of AI-assisted development. That
matters because my target roles emphasize backend-leaning full-stack ownership,
performance, reliability, modernization, maintainable systems, and practical
engineering judgment.

## What I'd Change and What I Learned

**Do not build protection for an unobserved failure.** I deliberately left a
proposed CI paint-flake guard unimplemented until the failure actually occurs. A
speculative retry could hide a real regression and create confidence without
evidence. The better decision was to document the risk, leave the item visibly
open, and wait for observable behavior before designing the protection.

**Park work honestly.** Some improvements remain open, including broader
multi-page gate coverage and a path-scoped CI skip. I record these as named parked
items rather than describing the related area as complete. "Not required for this
milestone" and "finished" are not the same statement.

**Review systems are fallible.** The review agent made identifiable mistakes during
development. Those errors were caught, corrected, and preserved as part of the
project record. That did not invalidate the review workflow; it demonstrated why no
model, tool, test, or reviewer should become a single source of truth.

**AI accelerated execution, not accountability.** The largest lesson was that
directing AI did not reduce the need for engineering judgment. It concentrated it.
The agents could implement, investigate, and review quickly, but that speed made
weak assumptions and unjustified confidence more dangerous, not less. My
responsibility was to define the boundaries, require evidence, compare conclusions
across independent viewpoints, and reject work I could not explain or defend.

I learned to trust AI with bounded execution: generating an implementation from
explicit requirements, performing repetitive analysis, exploring alternatives, and
challenging a proposed solution. I did not delegate truth, architecture, security,
privacy, or the definition of done. The most important failures were rarely syntax
errors; they were plausible claims that exceeded the evidence, dependencies that
had not earned trust, tests that appeared stronger than they were, and cleanup that
looked complete until it was compared against a known-good state.

Next time, I would establish the evidence contract, the review rubric, the
dependency-admission policy, and the planted-failure requirement even earlier. The
most effective part of the workflow was not using more AI. It was giving each agent
a bounded role, keeping their claims independently testable, and retaining a human
merge gate with enough technical understanding to say no.
