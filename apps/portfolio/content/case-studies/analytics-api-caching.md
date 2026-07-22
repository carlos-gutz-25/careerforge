---
title: Caching Expensive Analytics Queries
description: A Redis caching strategy for analytics endpoints backed by expensive Snowflake queries, cutting targeted latency from seconds to milliseconds without changing the API contract.
provenance: professional
date: 2026-07-22
sensitivityReviewed: 2026-07-22
sources:
  - docs/profile/projects.md
---

## Problem

The analytics platform at Heartland Payment Systems exposed API endpoints backed
by expensive Snowflake queries. Some endpoints were requested repeatedly and
recomputed the same expensive results each time, creating unnecessary latency
for users and unnecessary compute cost on the data warehouse.

## Constraints

The work sat inside a PCI DSS-regulated environment, so any change had to respect
that environment's security and operational requirements. Just as importantly,
the endpoints already had consumers, so the caching had to be added without
changing the consumer-facing API contract, and cached data still had to stay
appropriately fresh.

## Architecture

I designed and implemented a Redis caching strategy for the frequently requested
analytics endpoints. I identified the endpoints where repeated Snowflake queries
created the most avoidable latency and compute, then added Redis caching around
that data while preserving appropriate freshness behavior. The implementation
was structured to reduce duplicate database work without changing the interface
its consumers depended on. I used application monitoring and Azure-hosted logs to
validate the behavior and to troubleshoot production issues.

## Tradeoffs

Caching always trades freshness against speed and adds a cache layer to reason
about. I kept that trade deliberate and narrow: cache the specific
high-cost, high-repetition endpoints, preserve freshness where it mattered, and
leave the API contract untouched so no consumer had to change.

## Testing

I validated behavior against production signals — application monitoring and
Azure-hosted logs — to confirm the cache was serving correctly and to
troubleshoot issues as they surfaced, rather than assuming the cache behaved as
designed.

## Results

- Reduced response latency from more than two seconds to roughly 40 milliseconds for targeted requests [docs/profile/projects.md].
- Lowered the number of repeated Snowflake queries [docs/profile/projects.md].
- Improved dashboard responsiveness without sacrificing data freshness [docs/profile/projects.md].

## What I'd Change and What I Learned

Caching in front of an expensive data source is high-leverage, but only when the
freshness contract is explicit. The lesson I carry forward is to write down the
freshness expectation per endpoint before caching it, so the trade between speed
and staleness is a stated decision rather than an emergent one.
