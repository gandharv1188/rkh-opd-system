# Document Ingestion Service — Master Plan

> **Codename:** DIS (Document Ingestion Service)
> **Owner (Architect / Tech Lead / QA Lead):** Claude
> **Execution model:** Agentic, ticket-driven, no-corner-cutting
> **Target integration:** Radhakishan Hospital POC (Supabase) → AWS production port
> **Status:** Plan — awaiting ticket assignment

This folder contains the complete, implementation-ready plan for building a
standalone Document Ingestion Service that replaces the current
`process-document` Edge Function while remaining portable to AWS with
zero business-logic changes.

## How to read this folder

Read the documents in numbered order. Each level assumes the previous one.
Agents executing tickets MUST reference the relevant sections in their
commit messages and PR descriptions.

| #   | Folder            | Purpose                                                      | Primary audience                     |
| --- | ----------------- | ------------------------------------------------------------ | ------------------------------------ |
| 00  | `00_overview`     | North Star, glossary, non-goals                              | Everyone                             |
| 01  | `01_product`      | Product brief, user stories, clinical safety requirements    | PM, clinical reviewer, all engineers |
| 02  | `02_architecture` | TDD, sequence diagrams, adapter interfaces, portability plan | Backend + frontend engineers         |
| 03  | `03_data`         | Data model, migrations, retention                            | Backend engineers, DBA               |
| 04  | `04_api`          | OpenAPI contract, error model, idempotency rules             | Frontend + backend engineers         |
| 05  | `05_testing`      | Test strategy, clinical acceptance tests, fixtures           | QA, all engineers                    |
| 06  | `06_rollout`      | Shadow → opt-in → default, feature flags, kill-switch        | PM, ops                              |
| 07  | `07_tickets`      | Epic → stories → tasks with acceptance criteria              | Agent executors                      |
| 08  | `08_team`         | Roles, RACI, review gates                                    | PM, all engineers                    |
| 09  | `09_runbooks`     | Incident response, key rotation, disaster recovery           | Ops, on-call                         |

## Execution rules (binding on all agents)

1. **TDD is mandatory.** No implementation ticket begins until its test
   ticket has a failing test committed on the branch.
2. **No ticket merges without:**
   - All acceptance criteria checked off (evidence linked in PR)
   - Tests passing in CI
   - Code review by another agent or human
   - Clinical-safety tickets require a **second human review** by a
     clinician on the reviewer list in `08_team/RACI.md`
3. **No freelancing.** If a ticket is ambiguous, open a clarification
   ticket in `07_tickets/clarifications/` rather than making a judgment
   call.
4. **No scope creep.** Every ticket has an explicit "Out of scope" list.
   Anything outside goes into `07_tickets/backlog.md` as a new ticket,
   not into the current one.
5. **Dependencies are hard.** A ticket cannot start until every ticket
   it depends on is in `Done` status, not `In Review`.
6. **Every PR references the ticket ID and the TDD section it implements.**
   Format: `[DIS-123] <summary> — implements TDD §4.2`.
7. **Documentation is part of Done.** If a ticket changes architecture,
   the TDD in `02_architecture` is updated in the same PR.

## Instruction Priority

1. **User's explicit instructions** — always highest.
2. **This README + the documents it references** — override default
   agent behavior.
3. **Default agent behavior / best practices** — fallback.

If a ticket contradicts this README, raise a clarification ticket — do
not silently proceed.

## Quick links (filled in as documents are authored)

- [North Star](./00_overview/north_star.md)
- [Glossary](./00_overview/glossary.md)
- [Non-goals](./00_overview/non_goals.md)
- [Product Brief](./01_product/product_brief.md)
- [Clinical Safety Requirements](./01_product/clinical_safety.md)
- [User Stories](./01_product/user_stories.md)
- [Technical Design Document](./02_architecture/tdd.md)
- [Adapter Interfaces](./02_architecture/adapters.md)
- [Portability Plan (Supabase → AWS)](./02_architecture/portability.md)
- [Sequence Diagrams](./02_architecture/sequence_diagrams.md)
- [Data Model](./03_data/data_model.md)
- [Migrations](./03_data/migrations.md)
- [API Contract (OpenAPI)](./04_api/openapi.yaml)
- [Error Model](./04_api/error_model.md)
- [Test Strategy](./05_testing/test_strategy.md)
- [Clinical Acceptance Tests](./05_testing/clinical_acceptance.md)
- [Rollout Plan](./06_rollout/rollout_plan.md)
- [Ticket Board](./07_tickets/README.md)
- [Epics](./07_tickets/epics.md)
- [Team & RACI](./08_team/RACI.md)
- [Review Gates](./08_team/review_gates.md)
- [Runbooks](./09_runbooks/README.md)
