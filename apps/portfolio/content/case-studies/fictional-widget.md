---
title: Fictional Widget Pipeline
description: PF-5 live plant — a fictional case study with an unsourced metric.
provenance: personal
---

## Problem

The fictional widget pipeline processed each order twice under retry.

## Constraints

A single maintainer, a public repo, and no managed queue budget.

## Architecture

A deterministic dedupe stage sits in front of the fictional queue consumer.

## Tradeoffs

Idempotency keys cost storage; the dedupe window trades memory for correctness.

## Testing

Unit tests around the dedupe key plus an integration test against the queue.

## Results

Cut p95 latency 43% under peak load.

## What I'd Change and What I Learned

Next time I would measure the dedupe window empirically before shipping it.
