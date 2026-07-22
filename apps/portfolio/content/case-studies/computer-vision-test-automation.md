---
title: Computer-Vision Test Automation
description: Python and OpenCV automation that validated game behavior with computer vision, replacing repetitive manual QA work.
provenance: professional
date: 2026-07-22
sensitivityReviewed: 2026-07-22
sources:
  - docs/profile/projects.md
---

## Problem

Game and localization testing relied on people repeatedly inspecting on-screen
visual states by hand. That work was slow, repetitive, and hard to run
consistently at scale, which made it a strong candidate for automation.

## Constraints

The automation had to reproduce judgments a human tester would make about
on-screen state, work across game and localization testing workflows, and fit
into QA processes that several teams already depended on. It also had to be
repeatable enough to trust in regression runs rather than one-off checks.

## Architecture

I created Python automation tools for repeatable game and localization testing
workflows, using OpenCV to detect and evaluate on-screen visual states that
previously required manual inspection. Working with QA, localization,
engineering, and project-management teams, I identified the highest-value
opportunities to automate and led the technical direction for those
cross-functional projects.

## Tradeoffs

Validating behavior through computer vision trades a degree of robustness for
reach. Visual detection can be sensitive to changes in rendering or layout, so
the automation needs maintenance as the games evolve. In return, it can check
states that would otherwise require a person watching the screen. I focused the
automation on the high-repetition, high-value checks where that trade clearly
paid off, and left genuinely judgment-dependent scenarios to human testers.

## Testing

The value of the automation depended on it being repeatable and trustworthy, so
I validated the vision-based checks against the states a human tester would
confirm by hand before relying on them in regression runs. Increasing the
repeatability of regression testing was itself part of the goal.

## Results

- Reduced manual QA effort and operating costs by approximately $161k per quarter [docs/profile/projects.md].
- Increased the repeatability of regression testing [docs/profile/projects.md].
- Allowed QA teams to focus more time on scenarios requiring human judgment [docs/profile/projects.md].

## What I'd Change and What I Learned

Vision-based automation earns its keep on repetitive, high-volume checks, but it
carries a maintenance cost as interfaces change. What I would carry forward is to
invest early in making the visual checks resilient and easy to update, and to
keep choosing automation targets by value rather than by what is merely
automatable. Leading these projects across QA, localization, and engineering,
and over time managing teams of up to 40 people, also taught me that technical
direction only lands when it is chosen together with the people who run the tests
every day.
