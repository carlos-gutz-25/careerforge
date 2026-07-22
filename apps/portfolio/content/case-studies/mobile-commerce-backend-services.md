---
title: Backend Services for a High-Volume Mobile Commerce Platform
description: Node.js backend services and Kafka integrations behind Love's mobile application, including the high-volume Showers experience used by professional drivers.
provenance: professional
date: 2026-07-22
sensitivityReviewed: 2026-07-22
sources:
  - docs/profile/projects.md
---

## Problem

Love's mobile application needed backend services and integrations to support
features used by professional drivers, including a high-volume Showers
experience. These were production services behind a live mobile app, so they had
to work reliably for real users while integrating with several internal and
third-party systems.

## Constraints

The services supported production features that professional drivers depended
on, so reliability mattered. They also had to integrate with several internal
and third-party systems, including queue-management, retail POS, and
payment-processing systems, and to do that without coupling the user-facing
mobile features tightly to systems outside my control.

## Architecture

I built and maintained Node.js APIs for the mobile application's features and
used test-driven development to implement and validate service behavior. For
asynchronous communication with internal and third-party systems, I developed
Kafka producers and consumers, and I integrated the third-party
queue-management, retail POS, and payment-processing systems the features
depended on. I architected and implemented the backend functionality for the
Showers feature, and I built Firebase-based push-notification capabilities used
to communicate with mobile users.

## Tradeoffs

Asynchronous, event-driven integration through Kafka trades the simplicity of
direct synchronous calls for decoupling and resilience. Dependent systems
process messages on their own schedule, which means the design has to account
for eventual consistency and message handling rather than assuming an immediate
reply. I favored that decoupling because the mobile features depended on several
internal and third-party systems, and wiring them together synchronously would
have made the platform only as available as its least reliable dependency.

## Testing

I used test-driven development to implement and validate service behavior,
writing tests with Mocha and Chai alongside the code so that each service was
specified and checked as it was built rather than after the fact.

## Results

- The Showers functionality processed more than $150k in daily transactions [docs/profile/projects.md].
- Kafka integrations provided reliable communication between the mobile platform and dependent services [docs/profile/projects.md].
- Push notifications produced a measurable increase in user engagement [docs/profile/projects.md].

## What I'd Change and What I Learned

Event-driven integration is powerful, but it is only as clear as its message
contracts. What I carry forward is to document the schema and delivery
expectations of each Kafka topic explicitly, so the boundaries between the
mobile platform and the systems it depends on stay legible as the platform
grows.
