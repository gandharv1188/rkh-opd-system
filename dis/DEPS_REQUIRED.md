# DEPS_REQUIRED — historical record (merged via DIS-001b on 2026-04-21)

> As of DIS-001b, the runtime + dev deps listed below have been merged
> into `dis/package.json` and `dis/package-lock.json` is committed.
> This file stays as an archive so future readers can trace which
> ticket introduced each dep.
>
> **New runtime deps** should still land via a dedicated follow-up
> ticket (not by editing package.json directly in a feature ticket).
> `sharp` remains deferred until DIS-058b (real preprocessor pipeline).

## Runtime dependencies merged in DIS-001b

| Package             | Version   | Purpose                                                                                                                                                      | Originally declared by |
| ------------------- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------- |
| `hono`              | `^4.6.0`  | Portable HTTP framework (ADR-005). Used by `src/http/server.ts`.                                                                                             | DIS-004                |
| `@hono/node-server` | `^1.13.0` | Node adapter for Hono — binds the app to a Node `http.Server`.                                                                                               | DIS-004                |
| `pino`              | `^9.5.0`  | Structured logger (`coding_standards.md §8`). Not wired yet — DIS-008.                                                                                       | DIS-004                |
| `postgres`          | `^3.4.4`  | Postgres driver (porsager/postgres). ADR-006. Used by `SupabasePostgresAdapter` via `setPostgresDriverLoader` — no static import in the adapter.             | DIS-054                |
| `pdfjs-dist`        | `^4.7.0`  | PDF native-text extraction for `DefaultFileRouter` (DIS-057). Lazy-imported.                                                                                 | DIS-057                |
| `@anthropic-ai/sdk` | `^0.27.0` | Anthropic SDK for `ClaudeHaikuAdapter` live path. Adapter stays SDK-agnostic via `AnthropicClientFactory` seam — the SDK is wired from the composition root. | DIS-001b (newly added) |

## Runtime dependencies still deferred

| Package | Version   | Purpose                                                                                     | Deferred until |
| ------- | --------- | ------------------------------------------------------------------------------------------- | -------------- |
| `sharp` | `^0.33.0` | Image pipeline — deferred to DIS-058b (real preprocessor). DIS-058 stub does not import it. | DIS-058b       |

## Dev dependencies present in `dis/package.json`

| Package             | Version   | Purpose                |
| ------------------- | --------- | ---------------------- |
| `typescript`        | `^5.6.0`  | TS compiler            |
| `vitest`            | `^2.0.0`  | Test runner            |
| `@types/node`       | `^20.0.0` | Node typings           |
| `eslint`            | `^9.0.0`  | Linter                 |
| `@eslint/js`        | `^9.0.0`  | Flat-config base rules |
| `typescript-eslint` | `^8.0.0`  | TS parser + rule-set   |
| `prettier`          | `^3.0.0`  | Formatter              |

## Historical notes (pre-DIS-001b)

DIS-058 landed as a type-safe passthrough (`DefaultPreprocessor`) that
satisfies the `PreprocessorPort` contract and enforces a default
50-page cap. It does **not** import `sharp` and does not perform any
image processing. The real pipeline (deskew, blank/duplicate drop,
resize, CLAHE, JPEG re-encode) will land in DIS-058b, which is when
`sharp ^0.33` must actually be installed.

## Known gap discovered during DIS-001b execution

- `tsconfig.json` declares `rootDir: src` but `include` lists
  `tests/**/*.ts`. These are mutually incompatible: `tsc --noEmit`
  fails with `TS6059: 'rootDir' is expected to contain all source
files` on every test file. This is a DIS-001 scope issue (the
  tsconfig was authored with this conflict) and is NOT fixed by
  DIS-001b — DIS-001b's `files_allowed` does not include
  `tsconfig.json`. Blocks VERIFY-7 from showing the DIS-020/021
  mismatch errors clearly. Resolution: folded into **DIS-021b**
  scope (which already needs to edit tests + core together for the
  reconciliation, so a small `tsconfig.json` `rootDir` removal or
  `include`-narrowing edit costs nothing additional there).
- `dis/tests/integration/health.test.ts:2` imports
  `'../../src/http/server.ts'` with a `.ts` extension — same bug class
  as the `src/http/` files DIS-001b fixed. Fix folded into DIS-021b
  for the same reason.

## Integrator notes (historical — applied in DIS-001b)

- DIS-001b ran `npm install` (v6 of DIS-001b VERIFY). Result:
  `added 207 packages in 16s`. `package-lock.json` committed.
- `tsconfig.json` kept `"module": "NodeNext"`, `"moduleResolution":
"NodeNext"` matching DIS-001 baseline. `.ts`→`.js` extension fix
  applied to `src/http/server.ts` and `src/http/index.ts`.
