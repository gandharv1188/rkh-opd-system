# Portability Plan — Supabase POC → AWS Production

DIS is designed to run on both stacks with identical behavior. This
document is the contract that guarantees it.

## The two target stacks

| Concern         | POC (Supabase)                                                                                                           | Prod (AWS)                                                          |
| --------------- | ------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------- |
| Compute         | Supabase Edge Functions (Deno) **or** self-hosted Node.js container on Fly.io/Render if the 150s limit becomes a blocker | ECS Fargate service (Node.js) or Lambda (for short ingest endpoint) |
| Object storage  | Supabase Storage                                                                                                         | S3                                                                  |
| Database        | Supabase Postgres                                                                                                        | RDS Postgres 16                                                     |
| Background jobs | `pg_cron` triggering a `process_pending()` Postgres function that enqueues HTTP calls via `pg_net`                       | SQS + Lambda consumer                                               |
| Secrets         | Supabase project secrets                                                                                                 | AWS Secrets Manager                                                 |
| Realtime notify | Supabase Realtime (LISTEN/NOTIFY wrapper)                                                                                | AppSync subscriptions / SNS → WebSocket                             |
| Auth            | Supabase Auth (JWT)                                                                                                      | Cognito                                                             |
| CDN for uploads | Supabase Storage signed URLs                                                                                             | CloudFront + signed URLs                                            |

## The three containment boundaries

Everything DIS owns falls into one of three layers. Only one of them
changes at port time.

1. **Pure core (does NOT change at port time).**
   `src/core`, `src/ports`, `src/http/routes`, schemas, prompts.
2. **Thin wiring (changes once per stack).**
   `src/wiring/supabase.ts` vs. `src/wiring/aws.ts`. Select via
   `DIS_STACK=supabase|aws`.
3. **Adapters (added/removed to match the stack).**
   e.g., drop `SupabaseStorageAdapter`, add `S3Adapter`.

## Deployment artifact

A single `Dockerfile` produces an image that runs anywhere:

- Locally (docker-compose).
- On Supabase: deployed as an Edge Function **only if runtime allows**;
  otherwise deployed to Fly.io/Render and fronted by a Supabase Edge
  Function that proxies requests. (Architect's preferred path for POC:
  Fly.io free tier for the service itself; Supabase only for DB +
  Storage.)
- On AWS: same image pushed to ECR and run on Fargate.

## Runtime compatibility

- **Language:** TypeScript, compiled to Node 20 ESM.
- **HTTP framework:** Hono (portable between Node, Deno, Bun, Lambda).
- **Postgres client:** `postgres` (no Supabase-specific extensions used
  in queries).
- **No framework lock-in:** Supabase SDK confined to
  `adapters/storage/supabase-storage.ts`,
  `adapters/database/supabase-postgres.ts`,
  `adapters/secrets/supabase-secrets.ts`,
  `adapters/queue/pg-cron.ts`.

## Database portability

**Rules:**

- Migrations are plain SQL (`.sql` files in `dis/migrations/`).
- Tool: `node-pg-migrate` or `dbmate`. **Not** `supabase db push` —
  that's a Supabase-side convenience only.
- No Supabase-specific features in schema: no `supabase_auth.uid()` in
  defaults; no `storage.objects` foreign keys.
- RLS policies are written with a generic `current_setting('app.user_id')`
  pattern; wiring sets this from JWT claims on the respective stack.

**Extensions we rely on (both stacks support them):**

- `pgcrypto` — UUID generation.
- `pg_stat_statements` — metrics.
- `pg_trgm` — fuzzy search on test names.

Supabase-specific extensions we do **not** use: `pg_graphql`, `pg_net`
(only in the pg_cron adapter, which is stack-specific), `supabase_vault`.

## Storage portability

All storage operations go through `StoragePort`:

```ts
interface StoragePort {
  putObject(input: {
    key: string;
    body: Buffer;
    contentType: string;
    metadata?: Record<string, string>;
  }): Promise<{ etag: string }>;
  getObject(key: string): Promise<{
    body: Buffer;
    contentType: string;
    metadata?: Record<string, string>;
  }>;
  getSignedUploadUrl(input: {
    key: string;
    expiresSec: number;
    maxSizeBytes: number;
    contentType: string;
  }): Promise<{ url: string; fields?: Record<string, string> }>;
  getSignedDownloadUrl(key: string, expiresSec: number): Promise<{ url: string }>;
  deleteObject(key: string): Promise<void>;
}
```

Supabase Storage returns public URLs directly; S3 returns pre-signed
URLs. Both satisfy the contract.

## Queue portability

`QueuePort`:

```ts
interface QueuePort {
  enqueue(
    topic: string,
    payload: Record<string, unknown>,
    opts?: { delaySec?: number },
  ): Promise<{ messageId: string }>;
  startConsumer(topic: string, handler: (payload: unknown) => Promise<void>): Promise<void>;
}
```

- POC: `PgCronAdapter` — `enqueue` inserts into `dis_jobs`. A scheduled
  `pg_cron` call pulls and dispatches via `pg_net` to the service's
  `/internal/process-job` endpoint.
- Prod: `SqsAdapter` — enqueue → SQS; consumer → Lambda triggered by SQS.

Business logic doesn't know the difference.

## Secrets portability

`SecretsPort`:

```ts
interface SecretsPort {
  get(name: string): Promise<string>; // throws if not set
}
```

Implementation caches for 5 minutes. Rotation is supported by simply
updating the secret at source — adapter picks up on next cache miss.

## The porting checklist

When moving from Supabase POC to AWS production:

1. **Provision AWS resources** (one-time, scripted via Terraform):
   RDS, S3 bucket, SQS queue, Secrets Manager entries, ECR repo,
   Fargate service, ALB, CloudFront.
2. **Migrate database:** `pg_dump` from Supabase; `pg_restore` to RDS.
3. **Migrate storage:** `aws s3 cp` with manifest from Supabase Storage.
4. **Set env vars on Fargate:** `DIS_STACK=aws`, provider keys from
   Secrets Manager, bucket names, queue URLs.
5. **Deploy image** from ECR.
6. **Smoke test** using the clinical-acceptance fixture set.
7. **DNS cutover** with TTL reduced in advance.
8. **Leave Supabase running in read-only for 1 week** as a rollback
   target.

Every step above has a corresponding ticket in `07_tickets/epics.md`
under Epic F (Production Port), to be executed only when the product
is ready.

## Dry-run requirement

Before declaring DIS v1 portable, a dry-run is mandated (Epic E ticket):

- Spin up AWS account in sandbox.
- Run the checklist end-to-end.
- Run clinical-acceptance tests against the AWS deployment.
- Measure: duration of the port, number of code changes required
  (target: zero core changes), manual steps (target: ≤ 3 outside the
  script).

If the dry-run requires any core changes, DIS is not shipped until
those are refactored out.
