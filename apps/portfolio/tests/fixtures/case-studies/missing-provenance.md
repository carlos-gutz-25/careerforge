---
title: Fictional Widget Pipeline
description: Fixture with no provenance key (should fail R2).
date: 2026-01-15
---

## 1. Problem

The fictional widget pipeline processed each order twice under retry.

## 2. Constraints

A single maintainer, a public repo, and no managed queue budget.

## 3. Architecture

A deterministic dedupe stage sits in front of the queue consumer.

## 4. Tradeoffs

Idempotency keys cost storage; the dedupe window trades memory for correctness.

## 5. Testing

Unit tests around the dedupe key plus an integration test against the queue.

## 6. Results

Reliability improved across the pilot window with no regressions.

## 7. What I'd Change and What I Learned

Next time I would measure the dedupe window empirically before shipping it.
