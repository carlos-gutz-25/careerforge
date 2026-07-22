---
title: Modernizing a Sales Analytics Platform
description: Helping lead a Vue 2 to Vue 3 migration of a data-intensive internal analytics platform, with a reusable component library and safer, feature-flagged releases.
provenance: professional
date: 2026-07-22
sensitivityReviewed: 2026-07-22
sources:
  - docs/profile/projects.md
---

## Problem

At Heartland Payment Systems I worked on a data-intensive internal analytics
platform used by sales professionals and managers to understand performance,
client portfolios, activity, production, incentives, and payment metrics.

The application was mature and heavily used, but its aging frontend stack made
it progressively harder to extend, test, and deploy. The teams that depended on
it needed clearer access to the metrics that drive their work, and the codebase
needed to be modernized without disrupting the dashboards already in daily use.

## Constraints

The platform was a large, production frontend codebase that people relied on
every day, so nothing could break while it was being modernized. It ran inside a
regulated payments company, which raised the bar on how changes were released
and verified. Modernization had to happen incrementally, alongside the existing
functionality, rather than as a single disruptive rewrite.

## Architecture

I helped lead the migration from Vue 2 to Vue 3, introducing Pinia for state
management to improve the maintainability of the large frontend. I also
modernized the frontend build tooling from Webpack to Vite.

Around that core I built and enhanced reusable tables, charts, navigation,
loading states, error handling, and notification components, so dashboards could
be assembled from consistent, tested building blocks. I developed role-aware
views and secure manager workflows, including the ability for authorized
managers to view the application as their direct reports. The work spanned the
Vue frontend, Node.js services, and a Snowflake-backed data layer.

## Tradeoffs

An incremental migration behind feature flags is slower than a big-bang rewrite
and means maintaining old and new paths side by side for a while. I accepted
that cost because it let new dashboard experiences be introduced safely
alongside the existing functionality, which mattered far more than migration
speed on a system this heavily used.

## Testing

I added automated tests for major dashboard routes and shared application
behavior, so the reusable components and the migrated views had a regression
safety net as the modernization progressed.

## Results

- Improved the performance of complex sales-data visualizations by more than 30% [docs/profile/projects.md].
- Made a large analytics application easier to extend, test, and deploy [docs/profile/projects.md].
- Gave sales teams clearer access to the metrics needed to evaluate performance and manage client portfolios [docs/profile/projects.md].

## What I'd Change and What I Learned

The most valuable decision was migrating incrementally behind feature flags
instead of rewriting; it kept a heavily used system stable while it modernized.
Next time I would establish the performance baselines and the component test
coverage even earlier, so every migration step could be measured against a known
starting point rather than assessed after the fact.
