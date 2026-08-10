# Changelog

All notable changes to `@rkh/dis` are documented in this file.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- DIS-001 project scaffolding — tsconfig, package.json, folder layout.
- DIS-003 port interface stubs — 8 ports + index barrel + `assertNever` helper.
- DIS-004 `/health` endpoint — Hono server + correlation-id middleware.
- DIS-020 state-machine implementation — 10 states, 11 events, typed errors (CS-1).
- DIS-021 `IngestionOrchestrator` with DI ports + typed errors.
- DIS-022 confidence-policy evaluator — fail-closed default (CS-7).
- DIS-023 promotion-plan builder — latest-only + dedup enforcement (CS-10, CS-11).
- DIS-024 `AuditLogger` with append-only type contract.
- DIS-050 `DatalabChandraAdapter` — submit-poll with raw preservation (CS-2).
- DIS-051 `ClaudeHaikuAdapter` — schema-validated structuring with retry.
- DIS-053 `SupabaseStorageAdapter` against Storage REST.
- DIS-054 `SupabasePostgresAdapter` implements `DatabasePort`.
- DIS-057 `DefaultFileRouter` — TDD §7 decision tree.
- DIS-058 `DefaultPreprocessor` pipeline — normalize/blank/dup/resize/contrast/jpeg + page cap.

### Changed

- DIS-021b reconciled state-machine ↔ orchestrator + extracted named `DatabasePort` methods (CS-1).

### Fixed

- DIS-050a `DatalabChandraAdapter` hotfix — wire-contract + webhook path.
- DIS-021d restored full typecheck surface — closed `DatabasePort` gap, `.js` extensions, Node 24 `Buffer`, Hono generics.

### Infrastructure

- DIS-002 CI baseline — lint, typecheck, test, port-validator, citations, files-touched, fitness, forbidden-tokens, secret-scan, openapi-lint jobs in `.github/workflows/dis-ci.yml`.
- DIS-001b merged `DEPS_REQUIRED` into `package.json` and fixed `.ts`→`.js` import suffixes in `src/http/`.
- DIS-021c locked vitest discovery + made CI scripts cwd-independent.
