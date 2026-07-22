---
title: A Pricing Rules Engine for Large Portfolios
description: Architecting a full-stack pricing application and rules engine that evaluated repricing scenarios across millions of rows of merchant-portfolio data.
provenance: professional
date: 2026-07-22
sensitivityReviewed: 2026-07-22
sources:
  - docs/profile/projects.md
---

## Problem

Pricing decisions across large merchant portfolios at Heartland Payment Systems
were complex and data-heavy. Users needed a repeatable way to evaluate repricing
scenarios and make data-informed pricing decisions against current portfolio
data, rather than working through the decision process by hand each time.

## Constraints

This was a production application with real-time pricing capabilities, evaluating
scenarios across millions of rows of portfolio data, so both correctness and
performance mattered. Access had to be controlled and verified, and the pricing
logic had to stay legible and maintainable as business rules evolved.

## Architecture

I architected and developed major portions of the full-stack pricing
application, contributing to both frontend and backend architecture. I helped
design a rules engine used to evaluate repricing scenarios across millions of
rows of portfolio data, and built user-facing workflows for reviewing pricing
results and applying business rules. I integrated application access with Google
SSO and data-access verification, and worked to improve performance and code
legibility in the complex pricing logic. I collaborated with product managers and
data engineers to translate pricing requirements into maintainable application
behavior. I also contributed to CI/CD workflows in Azure DevOps, infrastructure
changes in Terraform, application logging, monitoring, rate limiting, and
production troubleshooting.

## Tradeoffs

Encoding pricing decisions in a rules engine adds indirection compared with
bespoke logic per scenario, and a rules layer has to be evaluated across millions
of rows fast enough to feel real-time. I accepted that indirection because a
maintainable, repeatable rules engine was worth more over time than
scenario-specific code that would be harder to evolve as pricing requirements
changed.

## Testing

I focused on improving the performance and legibility of the complex pricing
logic, and supported the application through CI/CD workflows, application
logging, monitoring, and production troubleshooting, so behavior could be
verified and diagnosed against real usage.

## Results

- Replaced portions of a complex, data-heavy decision process with a repeatable application workflow [docs/profile/projects.md].
- Enabled users to evaluate pricing decisions across large portfolios using current data [docs/profile/projects.md].
- Created a more maintainable foundation for evolving pricing rules and business requirements [docs/profile/projects.md].

## What I'd Change and What I Learned

Building a rules engine over portfolio data taught me how much the maintainability
of the rules themselves matters. Next time I would invest earlier in making the
rules easy to read, test, and change in isolation, since that legibility is what
lets a pricing system keep pace with the business rather than ossify around its
first set of requirements.
