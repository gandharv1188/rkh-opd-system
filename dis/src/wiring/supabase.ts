/**
 * DIS-079 — Supabase composition root (POC).
 *
 * Direct fix for orientation finding F1: `dis/src/wiring/` was empty, so the
 * service could not boot end-to-end. This module assembles the 6 adapters
 * that currently exist on the Wave-3a dispatch baseline into a `Ports` bag,
 * registers the real `postgres` driver loader (deferred import — tests can
 * override), and exposes `composeForHttp(ports)` so the HTTP layer
 * (`dis/src/http/server.ts`, DIS-004/005) can build a fully-wired app.
 *
 * IN-SCOPE (adapters wired today):
 *  - SupabasePostgresAdapter        (DatabasePort)
 *  - SupabaseStorageAdapter         (StoragePort)
 *  - DatalabChandraAdapter          (OcrPort)
 *  - ClaudeHaikuAdapter             (StructuringPort)
 *  - DefaultFileRouter              (FileRouterPort)
 *  - DefaultPreprocessor            (PreprocessorPort — stub, DIS-058b real)
 *  - EnvSecretsAdapter              (SecretsPort — inline env-backed shim,
 *                                    swappable for the real DIS-055 adapter
 *                                    once its sibling lands)
 *
 * OUT OF SCOPE (sibling Wave-3a adapters NOT yet wired — see handoff §5):
 *  - ClaudeVisionAdapter            (DIS-052)
 *  - SupabaseSecretsAdapter         (DIS-055)
 *  - PgCronQueueAdapter             (DIS-056)
 *  - NativePdfExtractor             (DIS-059 / real DIS-033 is already in
 *                                    core; this file routes through the
 *                                    default pdfjs-dist loader inside
 *                                    DefaultFileRouter)
 *  - OfficeWordAdapter              (DIS-060)
 *  - OfficeSheetAdapter             (DIS-061)
 *  - Real DefaultPreprocessor       (DIS-058a..c pipeline)
 *
 * The follow-up after Wave-3a merge wires these siblings in without
 * touching call sites — every downstream consumer reads from the
 * `Ports` bag.
 *
 * @see dis/document_ingestion_service/02_architecture/adapters.md
 * @see dis/document_ingestion_service/02_architecture/portability.md
 * @see ADR-006 (postgres driver loader seam)
 */

import postgres from 'postgres';
import type { Hono } from 'hono';
import { loadEnv, type Env } from '../core/env.js';

import type { DatabasePort } from '../ports/database.js';
import type { StoragePort } from '../ports/storage.js';
import type { OcrPort } from '../ports/ocr.js';
import type { StructuringPort } from '../ports/structuring.js';
import type { FileRouterPort } from '../ports/file-router.js';
import type { PreprocessorPort } from '../ports/preprocessor.js';
import type { QueuePort } from '../ports/queue.js';
import type { SecretsPort } from '../ports/secrets.js';

import {
  SupabasePostgresAdapter,
  setPostgresDriverLoader,
  type SqlClient,
} from '../adapters/database/supabase-postgres.js';
import { SupabaseStorageAdapter } from '../adapters/storage/supabase-storage.js';
import { DatalabChandraAdapter } from '../adapters/ocr/datalab-chandra.js';
import { ClaudeHaikuAdapter } from '../adapters/structuring/claude-haiku.js';
import { DefaultFileRouter } from '../adapters/file-router/default.js';
import { DefaultPreprocessor } from '../adapters/preprocessor/default.js';

import { createServer, type App } from '../http/server.js';

/**
 * The shape every downstream consumer (orchestrator, HTTP routes,
 * background workers) receives. Optional ports (`queue`, `secrets`) exist
 * on the bag so callers can type-narrow once their sibling adapters land;
 * today `secrets` is always set (env-backed shim) and `queue` is `undefined`
 * until DIS-056.
 */
export type Ports = {
  readonly database: DatabasePort;
  readonly storage: StoragePort;
  readonly ocr: OcrPort;
  readonly structuring: StructuringPort;
  readonly fileRouter: FileRouterPort;
  readonly preprocessor: PreprocessorPort;
  readonly secrets: SecretsPort;
  readonly queue?: QueuePort;
};

/**
 * In-process `SecretsPort` shim backed by the validated `Env` record.
 *
 * This is a temporary bridge: DIS-055 is landing a real
 * `SupabaseSecretsAdapter` (with caching + rotation semantics) in a sibling
 * worktree. When that merges, this shim is replaced in one line at
 * `createSupabasePorts`; no adapter consumer needs to change because each
 * already takes a `SecretsPort` by dependency injection.
 *
 * Throws when a secret is not present — matches the port contract.
 */
class EnvSecretsAdapter implements SecretsPort {
  constructor(private readonly env: Env) {}

  async get(name: string): Promise<string> {
    const value = (this.env as unknown as Record<string, unknown>)[name];
    if (typeof value !== 'string' || value.length === 0) {
      throw new Error(`secret not configured: ${name}`);
    }
    return value;
  }
}

// --- Driver-loader indirection so tests can skip the `postgres` import. ---
//
// The integration test at dis/tests/integration/wiring-supabase.test.ts
// overrides this via __setDriverLoaderHookForTests so it does not need a
// live Postgres or even a resolvable `postgres` module.

type DriverLoader = (connectionString: string) => SqlClient;

const defaultDriverLoader: DriverLoader = (connectionString) => {
  // `postgres` is a callable client; its runtime shape matches our
  // `SqlClient` structural type closely enough (the compatibility is
  // verified on first query — the adapter wraps errors so mismatches
  // surface as DatabaseError rather than TypeError deep in the driver).
  return postgres(connectionString) as unknown as SqlClient;
};

let activeDriverLoader: DriverLoader = defaultDriverLoader;

/** @internal — used only by the integration test. */
export function __setDriverLoaderHookForTests(loader: DriverLoader): void {
  activeDriverLoader = loader;
}

/** @internal — restore the default after a test case. */
export function __resetDriverLoaderHookForTests(): void {
  activeDriverLoader = defaultDriverLoader;
}

/**
 * Build the Supabase-stack Ports bag.
 *
 * Responsibilities executed once per call (POC: called once at boot):
 *  1. Validate environment (DIS-010). Throws `EnvValidationError` on
 *     missing / malformed vars — fail-closed at boot.
 *  2. Register the postgres driver loader with the database adapter so
 *     later `new SupabasePostgresAdapter({ connectionString })` calls
 *     resolve the real client. Idempotent across repeated boots in the
 *     same process (last-writer-wins, consistent with the module-level
 *     seam in supabase-postgres.ts).
 *  3. Instantiate each adapter with its env-sourced config.
 *
 * Notes on the `DATALAB_API_KEY` wiring:
 *  - `DatalabChandraAdapter` expects a `SecretsPort`, not a raw key. This
 *    file supplies the `EnvSecretsAdapter` (backed by the validated
 *    `Env`), so the key flows through the port. When DIS-055's real
 *    `SupabaseSecretsAdapter` lands, swap the secrets field in
 *    `Ports` and every adapter upgrades for free.
 *
 * @param source  Environment source (defaults to `process.env`).
 */
export function createSupabasePorts(
  source: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
): Ports {
  // 1. Validate env (propagates DIS-010 EnvValidationError on failure).
  const env = loadEnv(source);

  // 2. Register the driver loader before constructing the DB adapter.
  setPostgresDriverLoader(activeDriverLoader);

  // 3. Construct adapters.
  const secrets = new EnvSecretsAdapter(env);

  // Supabase Postgres connection string comes from SUPABASE_URL; this is
  // the Supabase-project-host pattern: the driver is configured lazily
  // when the adapter first runs a query (see adapter source).
  const connectionString = env.SUPABASE_URL ?? '';
  const database = new SupabasePostgresAdapter({ connectionString });

  const storage = new SupabaseStorageAdapter({
    secretsPort: secrets,
    bucket: 'documents',
  });

  const ocr = new DatalabChandraAdapter({ secretsPort: secrets });

  const structuring = new ClaudeHaikuAdapter({ secretsPort: secrets });

  const fileRouter = new DefaultFileRouter({
    nativeTextMinCharsPerPage: env.DIS_NATIVE_TEXT_MIN_CHARS_PER_PAGE,
  });

  const preprocessor = new DefaultPreprocessor({ pageCap: env.DIS_MAX_PAGES });

  return {
    database,
    storage,
    ocr,
    structuring,
    fileRouter,
    preprocessor,
    secrets,
    // queue intentionally omitted until DIS-056.
  };
}

/**
 * Compose the HTTP app with the given Ports bag.
 *
 * Today the HTTP layer (`createServer` in `dis/src/http/server.ts`) only
 * registers `/health` — it does not yet consume ports (DIS-004/DIS-005
 * land the ingest/approve/reject routes). Keeping `composeForHttp` as the
 * single call-site means route PRs only need to take `ports` as a
 * parameter here and pass it into `createServer` once that function
 * learns the shape.
 *
 * The `_ports` parameter is intentionally unused for now but documents
 * the composition boundary; do not remove.
 */
export function composeForHttp(_ports: Ports): Hono {
  return createServer() as unknown as Hono;
}

/**
 * Convenience single-call boot — `loadEnv + createSupabasePorts +
 * composeForHttp` in the order most callers want. HTTP callers can use
 * this; workers should call `createSupabasePorts` directly.
 */
export function bootSupabase(
  source: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
): { ports: Ports; app: App } {
  const ports = createSupabasePorts(source);
  const app = composeForHttp(ports) as unknown as App;
  return { ports, app };
}
