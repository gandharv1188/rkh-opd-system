# Adapter Interfaces

Every port (interface) is listed with its current (POC) and future (prod)
adapters. Adapters implement the interface; the core never imports an
adapter directly — it receives one via dependency injection.

## Directory layout (service repo)

```
dis/
├── src/
│   ├── core/                 # pure business logic
│   │   ├── orchestrator.ts
│   │   ├── state-machine.ts
│   │   ├── confidence-policy.ts
│   │   ├── promotion.ts
│   │   └── audit-log.ts
│   ├── ports/                # interfaces only
│   │   ├── ocr.ts
│   │   ├── structuring.ts
│   │   ├── storage.ts
│   │   ├── database.ts
│   │   ├── queue.ts
│   │   ├── secrets.ts
│   │   ├── file-router.ts
│   │   └── preprocessor.ts
│   ├── adapters/
│   │   ├── ocr/
│   │   │   ├── datalab-chandra.ts
│   │   │   ├── claude-vision.ts
│   │   │   └── onprem-chandra.stub.ts
│   │   ├── structuring/
│   │   │   ├── claude-haiku.ts
│   │   │   └── claude-sonnet.ts
│   │   ├── storage/
│   │   │   ├── supabase-storage.ts
│   │   │   └── s3.ts
│   │   ├── database/
│   │   │   ├── supabase-postgres.ts
│   │   │   └── aws-rds.ts
│   │   ├── queue/
│   │   │   ├── pg-cron.ts
│   │   │   └── sqs.ts
│   │   ├── secrets/
│   │   │   ├── supabase-secrets.ts
│   │   │   └── aws-secrets-manager.ts
│   │   ├── file-router/
│   │   │   └── default.ts
│   │   └── preprocessor/
│   │       ├── default.ts
│   │       └── opencv.ts
│   ├── http/
│   │   ├── server.ts          # Hono / Fastify — thin
│   │   └── routes/
│   └── wiring/
│       ├── supabase.ts        # composes POC adapters
│       └── aws.ts             # composes prod adapters
├── tests/
│   ├── unit/
│   ├── integration/
│   └── clinical-acceptance/
├── schemas/
│   └── clinical_extraction.v1.json
├── prompts/
│   └── structuring.md
├── Dockerfile
├── openapi.yaml
└── package.json
```

## Port inventory

| Port               | File                    | POC adapter               | Prod adapter                                                |
| ------------------ | ----------------------- | ------------------------- | ----------------------------------------------------------- |
| `OcrPort`          | `ports/ocr.ts`          | `DatalabChandraAdapter`   | `DatalabChandraAdapter` (same — HTTP API is cloud-agnostic) |
| `StructuringPort`  | `ports/structuring.ts`  | `ClaudeHaikuAdapter`      | same                                                        |
| `StoragePort`      | `ports/storage.ts`      | `SupabaseStorageAdapter`  | `S3Adapter`                                                 |
| `DatabasePort`     | `ports/database.ts`     | `SupabasePostgresAdapter` | `AwsRdsAdapter`                                             |
| `QueuePort`        | `ports/queue.ts`        | `PgCronAdapter`           | `SqsAdapter`                                                |
| `SecretsPort`      | `ports/secrets.ts`      | `SupabaseSecretsAdapter`  | `AwsSecretsManagerAdapter`                                  |
| `FileRouterPort`   | `ports/file-router.ts`  | `DefaultFileRouter`       | same                                                        |
| `PreprocessorPort` | `ports/preprocessor.ts` | `DefaultPreprocessor`     | same                                                        |

## Ground rules

1. **Core never imports an adapter.** Only ports. Violation = lint error.
2. **Adapters never import each other.** They are peers at the edge.
3. **Core is pure TypeScript.** No Node-specific APIs. No Supabase SDK.
   No AWS SDK. No `fs`, no `fetch`. Core receives dependencies.
4. **Adapters are Node-ish but avoid Deno-/Lambda-specific APIs unless
   explicitly behind a further shim.** This keeps us runtime-agnostic.
5. **All adapters must have a fake for tests.** e.g., `FakeOcrAdapter`
   that returns canned results for fixture documents.
6. **Adapter swaps are configuration, not deployment.** A `.env`
   variable flips provider; the running service picks it up on next
   request (5-minute cache max).

## Port contracts

Stored in `ports/*.ts`. The source of truth is the TypeScript file. The
TDD shows the canonical shape; adapters must not add undocumented
methods.

### Change control

Changing a port interface is a **breaking change**. Procedure:

1. Open an "ADR" (Architecture Decision Record) in
   `02_architecture/adrs/NNNN-title.md`.
2. Architect (me) reviews and approves.
3. Bump port version in the TypeScript file (`// port-version: 2`).
4. Update every adapter in the same PR or block merge.
5. Re-run the full adapter test suite.

## Fakes & test doubles

For every adapter, a `__fakes__/` peer file exports a `Fake<Name>Adapter`
constructor that takes a script: e.g.,

```ts
const fake = new FakeOcrAdapter({
  'fixture1.pdf': { blocks: [...], markdown: '...' },
  'fixture2.jpg': { error: 'provider_down' },
});
```

Unit tests compose the core with fakes only. Integration tests compose
with real adapters pointed at sandbox credentials.
