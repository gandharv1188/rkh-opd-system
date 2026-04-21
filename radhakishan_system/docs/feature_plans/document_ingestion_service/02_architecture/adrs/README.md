# Architecture Decision Records (ADRs)

> Non-trivial architectural decisions live here. One decision per
> file. Format per `02_architecture/coding_standards.md §15`:
> **Context / Decision / Consequences / Alternatives**.
>
> When a past ADR is reversed, **supersede** it with a new ADR rather
> than editing the old one. The old ADR stays in place with a header
> note pointing to its successor. This is how `agentic_dev_protocol.md`
> Phase 9.2 is satisfied.

## Filename convention

`ADR-NNN-<kebab-case-title>.md`

- `NNN` is zero-padded and sequential. Never reused.
- `<kebab-case-title>` is the shortest phrase that names the decision
  (e.g. `hexagonal-ports-and-adapters`, not `architecture-choice`).

## Required sections

```markdown
# ADR-NNN — <Title>

- **Status:** Accepted | Superseded by ADR-XXX | Deprecated
- **Date:** YYYY-MM-DD
- **Deciders:** <roles from 08_team/RACI.md>

## Context

Why this decision was needed. What problem forced the call. What the
constraints were. Link to the TDD section(s) this ADR binds into.

## Decision

The thing we decided, stated as an imperative. One paragraph.

## Consequences

What becomes easier. What becomes harder. What tests / CI controls
enforce this decision. What future ADRs would have to supersede this
one.

## Alternatives considered

Each rejected option with a one-paragraph reason. Future readers must
be able to tell a rejected option from an unconsidered one.
```

## Index

When `ADR-001` lands, list it here with a one-line hook. Append new
rows in order; do not edit past rows except to mark them superseded.

| ID  | Title         | Status | Supersedes | Superseded by |
| --- | ------------- | ------ | ---------- | ------------- |
| —   | (no ADRs yet) | —      | —          | —             |

## Gate integration

- **Control 9 (Phase 2 drift prevention)** greps `dis/src/**` for
  `// reason: …` comments and requires each to cite an `ADR-NNN` that
  exists in this folder.
- **Gate 6d (Breaking-change)** requires an ADR before a port
  interface, schema, or API contract break can be merged.
- **Gate 5 (Code review)** reviewers use ADRs to distinguish
  load-bearing decisions (can't refactor without re-opening the ADR)
  from incidental ones.

## When an ADR is NOT the right tool

- Implementation details that change often (e.g. which JSON schema
  validator we use this month) — put in code comments or CHANGELOG.
- Process / workflow choices — put in `08_team/`.
- Product scope — put in `01_product/` or `00_overview/non_goals.md`.
- Code style or formatting — put in `02_architecture/coding_standards.md`.

ADRs are for decisions that a future engineer or agent, six months
later, would want to know the _reason_ for before changing.
