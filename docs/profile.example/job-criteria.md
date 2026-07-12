---
title: Job Criteria
candidate: Alex Rivera (FICTIONAL EXAMPLE)
last_updated: 2026-01-01
status: example
primary_track: senior_individual_contributor
---

# Job Criteria

> **FICTIONAL EXAMPLE PROFILE** — see the note in `resume.md`. Values here are invented; the YAML blocks mirror the shapes the criteria importer (M1-08) parses from the real, gitignored `docs/profile/job-criteria.md`.

## Search Priorities

1. Find a strong **Senior Software Engineer** role with meaningful ownership.
2. Prioritize backend-leaning full-stack and data-intensive product work.

## Target Roles

### Primary Targets

- Senior Software Engineer
- Senior Full-Stack Engineer
- Senior Backend Engineer

### Roles Not Currently Targeted

- Entry-Level or Junior Software Engineer
- QA-only or test-execution roles

## Compensation

### Preferred Range

- **Preferred base salary:** $150,000–$190,000

### Compensation Dealbreakers

- Base salary below **$120,000**, unless explicitly approved as an exception
- Equity-only compensation

## Location and Work Arrangement

### Preferred

1. Remote-first or fully remote within the United States
2. Hybrid in the Springfield metro area

### Location Dealbreakers

- Five-day onsite requirements outside the Springfield metro

## Dealbreakers

### Industry or Organization

- Gambling platforms
- Businesses whose central product appears deceptive, exploitative, or harmful

## Job-Matching Rules

### Hard Filters

```yaml
exclude_when:
  - base_salary_max_is_known_and_below: 120000
  - compensation_type: equity_only
  - employment_type:
      - unpaid
      - internship
  - industry:
      - gambling
  - seniority:
      - entry_level
      - junior
  - onsite_requirement:
      days_per_week: 5
  - primary_function:
      - qa_only
```

### Positive Scoring Signals

```yaml
increase_score_for:
  role:
    - senior_software_engineer
    - senior_backend_engineer
  technologies:
    - typescript
    - node_js
    - vue_3
    - postgresql
    - redis
  problem_domains:
    - api_platforms
    - analytics
    - performance
  work_arrangement:
    - remote_us
  scope:
    - architecture
    - system_ownership
```

### Negative Scoring Signals

```yaml
decrease_score_for:
  - frontend_only
  - unclear_salary
  - short_term_contract
```

## Opportunity Tiers

### Tier 1: Apply Immediately

- Senior scope, remote or Springfield hybrid, base ≥ $150,000, no dealbreakers.

### Tier 2: Strong Consideration

- Senior scope, base ≥ $120,000, good technology alignment, no major dealbreakers.

### Reject

- Any hard-filter violation, or compensation below the floor without an approved exception.
