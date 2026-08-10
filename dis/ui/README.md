# DIS Verification UI

Vite + React + TypeScript SPA shell for the Document Ingestion Service verification UI.

## First run

```bash
cd dis/ui
npm install
npx playwright install chromium
```

## Develop

```bash
npm run dev       # Vite dev server on http://localhost:5173
```

## Production preview

```bash
npm run build     # tsc -b && vite build  →  dist/
npm run preview   # serves dist/ on http://localhost:4173
```

## Checks

```bash
npm run typecheck # tsc --noEmit
npm run test      # Playwright smoke test (headless, spins up preview server)
```

## Layout

- `src/App.tsx` — composes `TopBar`, `Sidebar`, `MainContent`.
- `src/layout/` — layout primitives. Each root element has a `data-testid` used by smoke tests.
- `src/styles.css` — minimal global styles.
- `tests/smoke.spec.ts` — Playwright smoke test asserting the three shell regions render.

## Scope (DIS-115)

Scaffold only: shell layout, build pipeline, smoke test. No Queue page, Verify page, state management, or API client yet — those arrive in DIS-116..135.

Lighthouse (perf ≥ 0.85) and axe a11y checks are deferred to DIS-127.
