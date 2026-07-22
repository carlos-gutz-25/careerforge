---
title: Fictional Widget Pipeline
description: A fictional case study used only to exercise the honesty gate.
provenance: personal
date: 2026-01-15
sources:
  - README.md
  - docs/BACKLOG.md
---

## 1. Problem

The fictional widget pipeline processed each order twice under retry.

## 2. Constraints

A single maintainer, a public repo, and no budget for a managed queue.

## 3. Architecture

A deterministic dedupe stage sits in front of the fictional queue consumer.

## 4. Tradeoffs

Idempotency keys cost storage; the dedupe window trades memory for correctness.

## 5. Testing

Unit tests around the dedupe key plus an integration test against the queue.

## 6. Results

- Cut duplicate deliveries to 0 across the pilot window [README.md].
- Removed 3 redundant retry paths [docs/BACKLOG.md].
- Metric baseline drawn from [docs/profile/projects.md].
- Scope framed by [M2-04] against risk [L-02].

## 7. What I'd Change and What I Learned

Next time I would measure the dedupe window empirically before shipping it.
