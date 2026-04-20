# DEPS_REQUIRED — DIS-004

This ticket introduces new dependencies that must be merged into
`dis/package.json` by the Architect / integrator. DIS-004 does NOT modify
`dis/package.json` directly because that file is owned by DIS-001.

## Runtime dependencies

| Package             | Version   | Purpose                                                                       |
| ------------------- | --------- | ----------------------------------------------------------------------------- |
| `hono`              | `^4.6.0`  | Portable HTTP framework (per coding_standards §1). Used by `src/http/server`. |
| `@hono/node-server` | `^1.13.0` | Node adapter for Hono — binds the app to a Node `http.Server`.                |
| `pino`              | `^9.5.0`  | Structured logger (per coding_standards §8). Not wired yet — DIS-008.         |

## Dev dependencies

| Package       | Version  | Purpose                                                         |
| ------------- | -------- | --------------------------------------------------------------- |
| `vitest`      | `^2.1.0` | Test runner for `tests/integration/**/*.test.ts`.               |
| `@types/node` | `^20`    | Node typings. Already covered by DIS-001; listed here for info. |

## Integrator notes

- No `npm install` is run from DIS-004. Merge the entries above into the
  corresponding `dependencies` / `devDependencies` blocks in
  `dis/package.json` at integration time.
- `pino` is declared now so DIS-008 (logging) does not need another
  dependency-bump ticket; no code imports it yet.
- `tsconfig.json` must keep `"moduleResolution": "bundler"` (or
  `"nodenext"`) so the relative `.ts` import extensions used in
  `src/http/*.ts` resolve correctly — this matches the DIS-001 baseline.
