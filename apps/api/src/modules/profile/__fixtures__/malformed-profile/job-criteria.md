# Job Criteria (deliberately malformed FICTIONAL fixture)

The defect: `problem_domains` smuggled into `exclude_when` — a scoring
vocabulary in an exclusion path, exactly what the closed key set rejects
(M1-08 domain law).

```yaml
exclude_when:
  - seniority:
      - entry_level
  - problem_domains:
      - payments_and_fintech
```

```yaml
increase_score_for:
  role:
    - senior_software_engineer
  technologies:
    - typescript
  problem_domains:
    - api_platforms
  work_arrangement:
    - remote_us
  scope:
    - architecture
```

```yaml
decrease_score_for:
  - frontend_only
```

```yaml
force_lowest_priority: []
```

```yaml
comp_bounds:
  currency: usd
  base_preferred_min: 150000
  base_preferred_max: 190000
```
