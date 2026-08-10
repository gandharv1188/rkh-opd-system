# Clarifications

> Ambiguities raised mid-ticket that block the agent from proceeding.
> One file per clarification, numbered `CLAR-NNN`.
>
> Opened when a ticket's acceptance criteria cannot be resolved from
> the plan documents alone. The Architect responds within 4 business
> hours (per `08_team/RACI.md` — Escalation). On response, the
> blocking ticket moves from `Blocked` back to `Ready` or `In Progress`.

## Filename convention

`CLAR-NNN.md` — sequential, never reused. Numbering is separate from
`DIS-###`.

## Required sections

```markdown
# CLAR-NNN — <one-line summary>

- **Opened by:** <agent name or human>
- **Date opened:** YYYY-MM-DD
- **Blocks ticket:** DIS-###
- **Status:** Open | Answered | Withdrawn

## The ambiguity

What the ticket or plan says, and where the two interpretations lead
in different directions. Quote verbatim from the source document
where helpful.

## Options under consideration

- **Option A** — …
- **Option B** — …

## Why it matters

The consequence of guessing wrong. Typically one of:

- Scope expands beyond `files_allowed`
- CS-# safety surface changes
- Port contract would need a breaking change
- Integration gate would trip

## Resolution

(Filled in by the Architect.)

**Answered by:** <Architect name>
**Date answered:** YYYY-MM-DD
**Decision:** Option A | Option B | neither — <alternative>
**Reason:** one paragraph
**Applies to:** this ticket only | this wave | all future tickets in Epic X
```

## Index

Append rows in order. Do not edit past rows.

| ID  | Summary                 | Blocks | Status |
| --- | ----------------------- | ------ | ------ |
| —   | (no clarifications yet) | —      | —      |

## What a clarification is NOT

- A scope-change request — those are new tickets in `backlog.md`.
- A technical debate — those are decisions in an ADR.
- A process complaint — those go in the session retrospective or a
  new ticket tagged `process`.

A clarification is specifically: _"I cannot tell from the plan what
this ticket's acceptance criterion means."_
