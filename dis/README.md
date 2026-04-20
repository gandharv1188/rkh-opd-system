# @rkh/dis — Document Ingestion Service

Cloud-portable, verification-gated document ingestion service that reliably
converts uploaded medical documents into structured clinical data — without
a single unreviewed OCR-derived row ever reaching the doctor's decision
surface. See the feature plan for full context, architecture, API, testing
strategy, and rollout.

- Feature plan root: [`../radhakishan_system/docs/feature_plans/document_ingestion_service/`](../radhakishan_system/docs/feature_plans/document_ingestion_service/)
- North star: [`../radhakishan_system/docs/feature_plans/document_ingestion_service/00_overview/north_star.md`](../radhakishan_system/docs/feature_plans/document_ingestion_service/00_overview/north_star.md)
- Architecture (ports & adapters): [`../radhakishan_system/docs/feature_plans/document_ingestion_service/02_architecture/adapters.md`](../radhakishan_system/docs/feature_plans/document_ingestion_service/02_architecture/adapters.md)
- Coding standards: [`../radhakishan_system/docs/feature_plans/document_ingestion_service/02_architecture/coding_standards.md`](../radhakishan_system/docs/feature_plans/document_ingestion_service/02_architecture/coding_standards.md)
- Ticket backlog: [`../radhakishan_system/docs/feature_plans/document_ingestion_service/07_tickets/backlog.md`](../radhakishan_system/docs/feature_plans/document_ingestion_service/07_tickets/backlog.md)

## Scripts

| Script         | Purpose                          |
| -------------- | -------------------------------- |
| `build`        | `tsc` — emit JS into `dist/`     |
| `typecheck`    | `tsc --noEmit` — type check only |
| `test`         | `vitest run` — one-shot test run |
| `test:watch`   | `vitest` — watch mode            |
| `lint`         | `eslint .`                       |
| `format`       | `prettier --write .`             |
| `format:check` | `prettier --check .`             |

## Status

DIS-001 — scaffolding only. No adapters, ports, server, or test logic are
implemented yet. Subsequent tickets (DIS-002 CI, DIS-003 ports, DIS-004
health endpoint) fill in the pieces.
