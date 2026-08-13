---
title: Building CareerForge with a Two-Seat Agentic Workflow
description: A career-development platform built as both product and proof, a modular-monolith TypeScript system developed through a disciplined, independently-reviewed, multi-agent process with a human merge gate.
provenance: personal_ai_assisted
date: 2026-07-22
---

**Live demo:** [demo.carlosgutz.com](https://demo.carlosgutz.com) runs the real product on fictional example data (AI drafting is disabled in the demo, so those results are pre-generated) and resets nightly. Everything below is how it was built.

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

<svg viewBox="0 0 720 260" width="100%" role="img" aria-labelledby="diagA-t diagA-d" style="font-family: ui-monospace, SFMono-Regular, Menlo, monospace">
<title id="diagA-t">Enforced module boundaries</title>
<desc id="diagA-d">Request flow runs from routes to services to repositories. The scoring package is pure and deterministic and is forbidden from importing the llm package; the db package holds the only SQL.</desc>
<g fill="none" stroke="currentColor" style="stroke-width: 1.5">
<rect x="30" y="34" width="180" height="46"></rect>
<rect x="270" y="34" width="180" height="46"></rect>
<rect x="510" y="34" width="180" height="46"></rect>
<path d="M210 57 h60"></path>
<path d="M262 52 l8 5 l-8 5"></path>
<path d="M450 57 h60"></path>
<path d="M502 52 l8 5 l-8 5"></path>
<rect x="30" y="150" width="200" height="66"></rect>
<rect x="290" y="150" width="200" height="66"></rect>
<rect x="540" y="150" width="150" height="66"></rect>
<path d="M230 183 h60" stroke-dasharray="4 4"></path>
<path d="M251 170 l28 26 M279 170 l-28 26" style="stroke-width: 2"></path>
</g>
<g fill="currentColor" stroke="none" font-size="15">
<text x="120" y="62" style="text-anchor: middle">routes</text>
<text x="360" y="62" style="text-anchor: middle">services</text>
<text x="600" y="62" style="text-anchor: middle">repositories</text>
<text x="130" y="182" style="text-anchor: middle">scoring</text>
<text x="390" y="182" style="text-anchor: middle">llm</text>
<text x="615" y="182" style="text-anchor: middle">db</text>
</g>
<g fill="currentColor" stroke="none" font-size="11">
<text x="30" y="24">request flow</text>
<text x="130" y="202" style="text-anchor: middle">pure, deterministic</text>
<text x="390" y="202" style="text-anchor: middle">provider SDKs + prompts</text>
<text x="615" y="202" style="text-anchor: middle">the only SQL</text>
<text x="260" y="164" style="text-anchor: middle">never</text>
</g>
</svg>

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

### Resume integrity: a claim that cannot cite its evidence does not ship

Resume Studio composes a tailored resume out of individual claims rather than out
of free prose. Each claim carries its text, the section it belongs to, the
experience or project it describes, and the evidence references it rests on. That
structure exists for one reason: a machine can check a structured claim against its
sources before a human ever reads it, and cannot check a paragraph.

**Everything the model drafts stays a draft until I review it.** The system never
sends anything resembling an application, and no generated sentence reaches a
document on its own authority.

**One gate decides, and it is deterministic.** The claim-provenance check is a pure
function in the scoring package: no input or output, no clock, no randomness, and
no access to the LLM package. The compose route calls it before any insert, and on
any violation it writes nothing and marks the run flagged. A model that produces a
fluent, well-formed, unsupported sentence gets a flagged run, not a resume.

**Six laws, each separately testable, each covering a different way a claim can
outrun its evidence.** Citation membership requires every cited reference to have
actually been sent as evidence, and forbids a claim citing the same reference
twice. The numeric law requires every number in the claim to appear in a cited
source as written, and a unit-marked number such as 40% or $50 additionally needs a
compatible marker in that source. The vocabulary law requires any skill phrase the
claim asserts to be backed by a cited source. The provenance-class law holds two
independent structural locks: an experience or project claim may cite only its own
entity's evidence, and personal or AI-assisted evidence can never back a claim in
the experience section. The external-pointer law keeps URLs, emails, and domains
out of resume body prose, because links belong to the deterministic contact header
rather than to model-drafted text. The shape law carries the cross-field and
aggregate caps: a summary claim holds no entity reference, a non-summary claim must
hold one, and claim length, claim count, and per-entity totals stay inside fixed
limits.

**Where a deterministic comparison is ambiguous, the gate flags.** Over-flagging
routes work to human review, which is merely inconvenient. Under-flagging publishes
an unsupported claim about my own career, which is the failure the entire mechanism
exists to prevent. The tie-break is written down as a design law rather than left
to whichever branch happened to be written first.

**A correct gate can still be a dishonest one, and mine was.** The verdicts were
right from the beginning, but a flagged run did not record which law it had
violated. I was told that something had failed and not what. Surfacing the violated
law identifiers changed nothing about what the gate decides; it changed only
whether the decision could be read. The recorded violation is built to carry law
identifiers, and for a shape violation the specific sub-rule, while dropping the
offending token and the evidence references by construction, so teaching the gate
to speak did not turn it into a leak.

**The interface was worse than silent, because it guessed.** The Resume Studio
banner enumerated three of the six laws and omitted the two that had actually
fired, so a run that breached a summary length cap was reported to me as possible
fabrication. Four of the shape law's sub-rules are aggregate caps, where no
individual claim is defective and the set is simply too large; describing that as
invented content is not a wording problem but a false accusation against work that
was accurate. The banner now has three display states and all three are honest.
When the violated laws are recorded it names them. When they are not recorded it
says exactly that and enumerates nothing, on the principle that a system with
incomplete information should say less rather than guess.

That sequence is the part of this project I would most want a reviewer to look at.
Building a correct gate was the ordinary engineering. Noticing that a correct gate
was communicating dishonestly, and treating that as a defect worth its own story
rather than as cosmetic copy, is the part I had to be taught by using the thing.

### Design system: two identities, one grammar

The v2 redesign gives the two frontends distinct visual identities that share one
enforceable grammar. The public portfolio adopts a "Provenance Ledger" identity
(hairline rules, a self-hosted display face, monospace provenance stamps); the
private platform UI adopts a separate "Dusk Console" identity. They look nothing
alike, and that is deliberate: one is a public document a hiring team reads, the
other is a dark-first operator console I use during a search.

What the two apps share is not a stylesheet but a contract. Each app owns its own
`tokens.css` in which every color custom property is a bare hex value or a strict
`light-dark(#hex, #hex)` pair, and nothing else parses. Each app carries its own
copy of a text-parsing contrast gate: it reads the tokens file as text, computes
WCAG relative luminance inline, and asserts an explicit manifest of
foreground/background/threshold pairs in both light and dark mode. A forgotten
dark-mode value is unrepresentable by construction, and a token that participates
in no contrast pair fails the build. The thresholds are the WCAG floors applied as
tests rather than aspirations: 4.5:1 for text, 3:1 for structural hairlines and
indicators, with no decorative exemption tier. When the drafted hairline color
failed 3:1 it was re-chosen, not exempted; the adopted value measures 3.03:1 at its
worst case across both surfaces and both modes.

The display typeface is a self-hosted variable Fraunces subset rather than a
font-CDN request: a 34308-byte woff2, latin subset, with the optical-size axis
pinned to the display cut (keeping that axis variable measured 66.5KB, over the
40KB budget) and a metric-adjusted local fallback so the swap does not shift
layout. The typeface is a want and the performance budget is a law: an
abort-to-system-stack ramp drops Fraunces if the Lighthouse median performance
score falls below 96, one point above the never-lowered 0.95 CI floor, so the font
is sacrificed before the budget is ever at risk.

<svg viewBox="0 0 720 290" width="100%" role="img" aria-labelledby="diagB-t diagB-d" style="font-family: ui-monospace, SFMono-Regular, Menlo, monospace">
<title id="diagB-t">Two identities, one grammar</title>
<desc id="diagB-d">The portfolio (Provenance Ledger) and the platform web UI (Dusk Console) each own a tokens.css file and a contrast gate, and both build on one shared token grammar checked in light and dark mode. No shared package is created.</desc>
<g fill="none" stroke="currentColor" style="stroke-width: 1.5">
<rect x="40" y="40" width="270" height="118"></rect>
<rect x="410" y="40" width="270" height="118"></rect>
<rect x="58" y="92" width="110" height="46"></rect>
<rect x="182" y="92" width="110" height="46"></rect>
<rect x="428" y="92" width="110" height="46"></rect>
<rect x="552" y="92" width="110" height="46"></rect>
<rect x="40" y="212" width="640" height="58"></rect>
<path d="M175 158 V212"></path>
<path d="M170 200 l5 8 l5 -8"></path>
<path d="M545 158 V212"></path>
<path d="M540 200 l5 8 l5 -8"></path>
</g>
<g fill="currentColor" stroke="none" font-size="14">
<text x="175" y="66" style="text-anchor: middle">portfolio</text>
<text x="545" y="66" style="text-anchor: middle">apps/web</text>
<text x="113" y="120" style="text-anchor: middle">tokens.css</text>
<text x="237" y="120" style="text-anchor: middle">contrast gate</text>
<text x="483" y="120" style="text-anchor: middle">tokens.css</text>
<text x="607" y="120" style="text-anchor: middle">contrast gate</text>
</g>
<g fill="currentColor" stroke="none" font-size="11">
<text x="175" y="82" style="text-anchor: middle">Provenance Ledger</text>
<text x="545" y="82" style="text-anchor: middle">Dusk Console</text>
<text x="360" y="24" style="text-anchor: middle">no shared package (v2.1 trigger)</text>
<text x="360" y="238" style="text-anchor: middle">one grammar: color = #hex or light-dark(#hex, #hex)</text>
<text x="360" y="256" style="text-anchor: middle">contrast gate asserts every pair in both modes</text>
</g>
</svg>

### Deployment topology

Three things deploy differently, and the difference is the whole privacy design.

The portfolio you are reading builds to static files and ships to GitHub Pages
through an OIDC-based workflow with no long-lived deployment secret, at a custom
apex domain.

The public demo is a separate deployment that carries fictional example data only.
It runs as a single container task on AWS Fargate behind an API Gateway HTTP API,
backed by Neon serverless Postgres, provisioned with Terraform and deployed through
a GitHub OIDC federated role that stores no long-lived cloud secret. A nightly
scheduled job re-seeds it, which makes the reset and the backup the same mechanism.
It is keyless by decision rather than by omission: the environment layer fails
closed, so if demo mode is set while a live API key is present, the process refuses
to boot rather than starting in a state nobody intended. That was chosen over a
capped live key, which would have put real spend and a prompt-injection surface on a
public box, and over a mocked provider, which would have displayed fabricated output
as though it were real. The demo shows pre-generated real artifacts instead, and the
endpoints that would cost money answer honestly that they are disabled rather than
pretending to work.

The platform itself, meaning the Fastify API, the platform web UI, and PostgreSQL,
still runs local-first via `docker compose` on my own machine, and it stays there on
purpose: it holds real, private career data (resume detail, salary targets,
application history), and a local-only database is an invariant rather than a
preference. Every table already carries a `user_id` for a future multi-user move,
but until a real second user or a concrete remote-access need appears, hosting that
private store on someone else's disk is a permanent exposure surface the project
deliberately declines. The demo does not soften that line. It exists precisely
because the real data stays home: what is hosted is the example profile, so a
visitor can exercise the product without any real career detail leaving my machine.

<svg viewBox="0 0 720 290" width="100%" role="img" aria-labelledby="diagC-t diagC-d" style="font-family: ui-monospace, SFMono-Regular, Menlo, monospace">
<title id="diagC-t">Deployment topology</title>
<desc id="diagC-d">Two things are deployed publicly and one is not. The portfolio ships as static files to GitHub Pages via an OIDC workflow with no long-lived secret. The public demo is a separate deployment on AWS Fargate with Neon Postgres, carrying fictional example data only; it is keyless by decision and refuses to boot if an API key is present, and it re-seeds nightly. The platform API, web UI, and PostgreSQL run local-first under docker compose and hold the real private career data, which is never hosted.</desc>
<g fill="none" stroke="currentColor" style="stroke-width: 1.5">
<rect x="34" y="54" width="130" height="52"></rect>
<rect x="214" y="54" width="120" height="52"></rect>
<path d="M164 80 h50"></path>
<path d="M206 75 l8 5 l-8 5"></path>
<rect x="34" y="152" width="130" height="52"></rect>
<rect x="204" y="152" width="140" height="52"></rect>
<path d="M164 178 h30"></path>
<path d="M196 173 l8 5 l-8 5"></path>
<path d="M360 26 V276" stroke-dasharray="5 5"></path>
<rect x="398" y="54" width="288" height="150"></rect>
<rect x="416" y="70" width="252" height="34"></rect>
<rect x="416" y="112" width="252" height="34"></rect>
<rect x="416" y="154" width="252" height="34"></rect>
</g>
<g fill="currentColor" stroke="none" font-size="13">
<text x="99" y="78" style="text-anchor: middle">portfolio</text>
<text x="274" y="84" style="text-anchor: middle">GitHub Pages</text>
<text x="99" y="176" style="text-anchor: middle">demo</text>
<text x="274" y="176" style="text-anchor: middle">AWS Fargate</text>
<text x="542" y="92" style="text-anchor: middle">apps/api (Fastify)</text>
<text x="542" y="134" style="text-anchor: middle">apps/web (Dusk Console)</text>
<text x="542" y="176" style="text-anchor: middle">PostgreSQL (pgdata)</text>
</g>
<g fill="currentColor" stroke="none" font-size="11">
<text x="34" y="26">public internet</text>
<text x="99" y="94" style="text-anchor: middle">static SSG</text>
<text x="34" y="130">OIDC deploy, no long-lived secret</text>
<text x="99" y="192" style="text-anchor: middle">example data</text>
<text x="274" y="192" style="text-anchor: middle">Neon Postgres</text>
<text x="34" y="228">keyless by decision</text>
<text x="34" y="244">a present key blocks boot</text>
<text x="34" y="260">nightly re-seed = backup</text>
<text x="398" y="26">local (docker compose)</text>
<text x="398" y="224">real career data, never hosted</text>
</g>
</svg>

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

### A duplicated grammar instead of a shared design package

A shared design package was rejected for v2. The portfolio's module wall lets it
import only shared configuration and no platform packages, so a shared design
package would either breach that wall or complicate it with a second carve-out,
coupling the public zero-backend site to the platform's release cadence for the sake
of one small CSS file and one self-contained test. At two consumers whose token
values differ per identity anyway, duplication sits below the abstraction bar, and
each copy is independently verified by its own CI so drift cannot silently break
either app. The cost is two files kept in sync by hand; I accepted it and recorded
an explicit reopening trigger (a third frontend, or measured drift pain traced to a
real defect) rather than pretending the duplication is free.

### The platform stays local-first instead of being deployed

Keeping the platform on a local machine trades away remote access and an always-on
demo for the strongest privacy posture and zero recurring cost. I costed the hosted
alternatives honestly: an Azure App Service plus managed PostgreSQL floor around 25
to 40 dollars a month, a Fly or Render class PaaS around 10 to 20, and the cheaper
Azure Container Apps consumption tier paired with a burstable database around 12 to
15. The decision was not cost-decisive, though; it was privacy-decisive. Every
hosted option forces the same fork: either put the real private career store on a
third party's disk behind three first-ever platform secrets, or stand up a demo
instance seeded only with the fictional example profile that I would never use for a
real search. Neither is worth it yet. The deployment competency a hiring manager can
already see is the portfolio's live secretless OIDC deploy; the stronger signal is
the judgment on record, a costed trade with the explicit conditions under which I
would host the platform, not an unused always-on service.

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

The v2 design system and the platform-hosting decision are each recorded as an
architecture decision record with measured rationale rather than taste. The
Provenance Ledger enforces its accessibility floor mechanically, 4.5:1 for text and
3:1 for indicators in both modes with a worst-case hairline of 3.03:1, and the
self-hosted Fraunces display subset is 34308 bytes against a 40KB budget; the
platform stays local-first with a costed hosting trade recorded down to the roughly
12-to-15-dollar-per-month cheapest hosted option, rejected on privacy grounds rather
than cost. [docs/DECISIONS/0016-design-system.md; docs/DECISIONS/0015-platform-deployment.md]

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
