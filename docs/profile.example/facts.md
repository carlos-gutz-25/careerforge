---
title: Durable Profile Facts
candidate: Alex Rivera (FICTIONAL EXAMPLE)
last_updated: 2026-01-15
status: example
---

# Durable Profile Facts

> **FICTIONAL EXAMPLE PROFILE** - see the note in `resume.md`. Values here are invented; the YAML block mirrors the shape the facts importer (M12-03) parses from the real, gitignored `docs/profile/facts.md`.

Durable facts are informative declarations ABOUT the candidate (work authorization, sponsorship need, location/remote preference, clearance, availability). They inform how administrative posting requirements are assessed. They are **never** hard filters: a graded stance like relocation never excludes a posting on its own.

## How this file works

- One fenced `yaml` block, keyed `facts`, mapping each fact kind to `{ value, declared, note? }`.
- `visa_sponsorship_needed` is `yes` or `no`.
- `relocation_stance` is one of `willing`, `open_for_right_opportunity`, `prefer_not`, `no`.
- `remote_onsite_stance` is one of `remote_only`, `prefer_remote`, `flexible`, `prefer_onsite`, `onsite_ok`.
- `work_authorization`, `security_clearance`, and `availability_notice` carry free-form text.
- Omit a kind you do not want to declare; an omitted kind stays "needs your input" against a matching requirement.
- To update: edit this file and re-run `pnpm profile:import`. This file is the source of truth.

```yaml
facts:
  work_authorization:
    value: "Authorized to work in the US"
    declared: 2026-01-15
  visa_sponsorship_needed:
    value: "no"
    declared: 2026-01-15
  relocation_stance:
    value: open_for_right_opportunity
    declared: 2026-01-15
    note: "Would relocate for a compelling senior role"
  remote_onsite_stance:
    value: prefer_remote
    declared: 2026-01-15
  availability_notice:
    value: "Two weeks notice"
    declared: 2026-01-15
```
