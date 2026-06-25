---
trace_id: ENG-DISC-OBS-001
title: Observability & Runtime Verification — SLOs, In-Prod Evals, Alerting, Incident Response
layer: engineering-discipline
status: binding
applies_to: rebuild (agent-built pediatric OPD prescription system)
spec_independent: true
authority: |
  Conforms to OPERATING-MODEL DIGEST. Where this file disagrees with the digest,
  the digest wins until amended via ADR. This file is methodology/governance only;
  it does NOT define the product architecture (authored in parallel, married later).
conforms_to: OPERATING-MODEL DIGEST (single source of truth)
related:
  - agent_operating_model.md          # the build loop + command/event substrate
  - drift_control.md                  # CI eval gates this file extends INTO production
  - code_review_standards.md
  - definition_of_ready_done.md
owner: eng-lead
co_owners: [clinical-safety-owner, sre-on-call]
last_reviewed: 2026-06-25
---

# Observability & Runtime Verification

> **One-line thesis.** CI gates prove a change is safe *before* it ships; **observability proves the running system still matches its spec, every minute it is live.** We treat production as a continuously-evaluated test surface: every Rx-generation request carries a trace, emits structured events, contributes an **online eval score**, and is measured against **SLOs with error budgets** — including a **perceived-latency budget that is itself a tested SLO**. Alarms fire on the exact failure classes that have already hurt us — **model retirement/deprecation, 546/504 timeout-rate breaches, eval-score regression, and behavioral drift** — and each has a **named runbook with a pre-validated fallback and drilled rollback**. "Done = proven + gated, never declared" does not stop at merge; in production it becomes **"healthy = observed + within budget, never assumed."**

This document is the authority for **Axiom 1 (Done = proven + gated)** and **Axiom 3 (Answer from data, not guesswork)** *as they apply after merge*. It is the production-side continuation of `drift_control.md`: the same golden-eval scorers that gate a PR run **online on live traffic**, so behavioral drift the golden set never predicted is caught like a regression — in minutes, not at the next incident.

**Founding incident (the reason this file exists).** On **2026-06-25** a hardcoded dated Claude model id retired mid-production and broke Rx generation; the emergency fix swapped the model and tuned reasoning effort **by guesswork, with no eval harness and no alarm**. The real-world symptom in the browser console was `generate-prescription:1 Failed to load resource: the server responded with a status of 546` → `Prescription generation error: Generation failed (HTTP 546)`. The observability model below makes that exact sequence **alarm before a clinician notices**, route to a runbook, and fall back to a pre-validated model automatically.

---

## 0. Inherited axioms (and the production gate each one becomes)

| # | Axiom (from digest) | Production-side consequence enforced by THIS file |
|---|---------------------|---------------------------------------------------|
| 1 | Done = proven + gated, never declared. | A deploy is not "done" until it is **emitting traces, scoring online evals, and inside its SLO budgets**. Silence is treated as failure (heartbeat/synthetic probe). |
| 2 | Enforce in CI, not in convention. | SLOs, alert rules, dashboards and runbooks are **code in the repo** (`observability/` as IaC), reviewed and version-gated — not clicked into a console and forgotten. |
| 3 | Answer from data, not guesswork. | The model-swap decision that was guesswork is now **a scored online diff** with alarms; no production change is judged by vibes. |
| 4 | Humans and AI are symmetric actors. | Every command (human OR agent), incl. `ChangeModelConfig`, emits the **same audit event**; production telemetry carries `actor`. A model swap is an observable, alarmed deploy event. |
| 5 | Dose-engine is the dosing source of truth; AI never does arithmetic. | The **dose-engine cross-check runs online** as a sampled eval scorer; any live Rx whose AI numbers disagree with the deterministic engine is a **severe online event** that pages. |

> If a control below has no machine signal, no threshold, and no owner, it is decoration. Every subsection names **signal → threshold → alarm → runbook → owner**.

---

## 1. Canonical observability tooling (FIXED — swappable only via ADR)

These rows extend the digest §1 *Observability* row into concrete components. Binding so every discipline file and slice composes against the same telemetry contract.

| Concern | Canonical choice | What it carries | Swap cost |
|---|---|---|---|
| **Error & exception tracking** | **Sentry** (frontend `web/**` + Edge Functions) | stack traces, release tags, `trace_id`, breadcrumbs, model id, scrubbed of PHI | Low |
| **Infra/platform logs & metrics** | **Supabase logs + metrics** (Edge Function logs, DB, Storage) | request logs, function invocation status (incl. **546/504**), DB latency, autovacuum/IO | Low |
| **Structured event log (domain truth)** | **Append-only event log on the command bus** (digest §0/§2) | every command/event with audit envelope; the **system of record** for "what happened" | — |
| **Tracing** | **OpenTelemetry (OTel)** SDK → exporter; W3C `traceparent` propagated edge→AI→DB | one `trace_id` per Rx request spanning UI → Edge → Claude tool-loop → dose-engine → DB | Med |
| **Metrics + dashboards + alerting** | **Grafana** (Grafana Cloud free tier) over Prometheus-format metrics + Supabase/Sentry sources | SLO dashboards, error-budget burn, timeout-rate panels, alert routing | Med |
| **Online / in-prod eval scoring** | **Braintrust** (free tier ~1M spans) | live Rx → online eval scores; one-click **"prod miss → golden case"** back into `drift_control.md` golden set | Med |
| **Synthetic / heartbeat probes** | **GitHub Actions scheduled workflow** hitting a `/health` + a canned "synthetic Rx" eval case every 5 min | liveness + a continuous *known-answer* eval that fails loud if quality collapses | Low |
| **On-call / paging** | **Sentry alerts + Grafana OnCall** (or PagerDuty free) → on-call rotation | sev-routed pages with runbook deep-link | Low |
| **Status & incident timeline** | **Markdown incident log** (`docs/incidents/NNNN-*.md`) + ADR cross-link | blameless post-incident record; runbook drill evidence | Low |
| **Model-deprecation watch** | **Scheduled job** polling the Anthropic models list/deprecation notices vs the pinned id in config | the **model-retirement firewall**, generalized to a monitor | Low |

> **Swappability clause** (digest §1): any row changes only via an ADR that (a) names the replacement, (b) proves the same signal→alarm→runbook contract, and (c) updates the digest. Until then these are binding.

**Assumed from the digest throughout:** CI/CD = **GitHub Actions**; backend = **Deno** Edge Functions; the deterministic **`web/dose-engine.js`** is the dosing source of truth; the Rx-generation Edge Function (`supabase/functions/generate-prescription/`) is the primary observed surface; the model id lives **only** in a centralized config adapter.

---

## 2. The observability pipeline (one trace, many sinks)

Every Rx request is one **distributed trace** (`trace_id`), correlated with the **domain event** on the bus and an **online eval score**. The three never diverge because they share the id.

```
 CLINICIAN (prescription-pad)
      │  generate-rx command  (actor=human|agent, trace_id=T, task trace-id)
      ▼
 ┌──────────────────────────── COMMAND BUS ────────────────────────────┐
 │  append-only EVENT LOG  (system of record)  ──────────────┐         │
 └───────────────────┬─────────────────────────────┬─────────┼─────────┘
                     ▼                              ▼         ▼
            Edge Fn: generate-prescription   dose-engine   read models
            (OTel root span T)               cross-check
                 │   Claude tool-loop (5 tools)  │
                 │   spans: get_reference,       │
                 │   get_formulary, ...          │
                 ▼                               ▼
        ┌─────────────────────────────────────────────────────────────┐
        │             TELEMETRY FAN-OUT (same trace_id T)              │
        ├───────────────┬───────────────┬───────────────┬─────────────┤
        ▼               ▼               ▼               ▼             ▼
   Sentry          Supabase logs    OTel→Grafana    Braintrust    Event log
   (errors,        (546/504,        (metrics,       (ONLINE       (audit /
    releases)       fn status)       SLO panels)     EVAL score)   traceability)
        │               │               │               │             │
        └──────── all keyed on trace_id T ──────────────┴─────────────┘
                                │
                                ▼
                 ALERTING (§5)  ──▶  RUNBOOKS (§7)  ──▶  on-call
```

**Correlation contract (mandatory, enforced by a fitness function):**
- Every Edge Function response and every emitted event carries `trace_id`, `release` (git SHA), `model_id`, `prompt_version`, `actor`.
- The frontend logs `trace_id` to Sentry on any failure so a clinician-reported "it broke" maps to one trace, the model id in play, and the online eval score for that exact Rx.
- **PHI never enters telemetry** (§4). Trace/event payloads carry `patient_id` (a UHID surrogate is acceptable as an opaque key) but **never** name, DOB, free-text note, or Rx body in logs/Sentry/metrics labels.

---

## 3. SLOs & error budgets (the contract with clinicians)

SLOs are defined **per user-journey**, measured from telemetry, and given an **error budget** that governs change velocity. Targets below are the **v1 starting contract** — deliberately humble for a POC, ratcheted via ADR as data accrues. The point is not the exact number; it is that **a number exists, is measured, and burns a budget that throttles risky change.**

### 3.1 Service Level Indicators (what we measure)

| Journey | SLI (definition) | Where measured |
|---|---|---|
| **Rx generation — availability** | `1 − (5xx + 546 + timeout) / total` on `generate-prescription` | Supabase fn logs + OTel |
| **Rx generation — success latency (server)** | p50 / p95 / p99 of successful Rx end-to-end (request → JSON) | OTel root span |
| **Rx generation — perceived latency** *(see §3.3)* | time-to-first-useful-feedback as the clinician experiences it (first streamed token / first content paint) | Frontend OTel + RUM mark |
| **Rx generation — timeout rate** | `(546 + 504) / total` on the Rx path | Supabase fn logs |
| **Rx generation — quality (online eval)** | mean online eval pass-rate; **severe-online-error count** | Braintrust |
| **Registration / lookup** | availability + p95 latency of Supabase REST writes/reads | OTel + Supabase |
| **Print / sign-off path** | success rate of sign-off→print E2E (synthetic) | synthetic probe |

### 3.2 SLO targets & error budgets (v1)

| SLO | Target (rolling 30d) | Error budget | Budget unit |
|---|---|---|---|
| Rx-generation availability | **99.0%** | 1.0% = ~7.2h/30d unavailable | request-failure ratio |
| Rx-generation **success p95 latency** | **≤ 25 s** | 5% of requests may exceed | latency violations |
| Rx-generation **timeout rate (546+504)** | **≤ 1.0%** | hard secondary objective; see §5 alarm | timeout ratio |
| Rx-generation **perceived-latency p95** (first feedback) | **≤ 3.0 s** | 5% may exceed | perceived-latency violations |
| Rx **online quality** (eval pass-rate) | **≥ 95%** | 5% may miss soft rubric | quality ratio |
| Rx **severe online errors** | **0** (never-event class) | **zero budget — any occurrence pages** | count |
| Registration/lookup availability | **99.5%** | 0.5% | request-failure ratio |
| Sign-off→print E2E (synthetic) | **100% of probes** | zero tolerated; 1 fail pages | probe pass |

> **Why 99.0% (not 99.9%) on Rx availability:** this is an OPD POC with mandatory physician sign-off as the safety backstop and a manual fallback (the doctor can prescribe without the AI). The honest SLO matches the real consequence of a miss, not an aspirational five-nines we cannot staff. **Severe online errors get a ZERO budget** because a single overdose-class output is not a budgeted statistic — it is an incident.

### 3.3 Perceived-latency budget as a TESTED SLO (not a vibe)

Clinicians abandon a "thinking" prescription pad. We make **perceived latency a first-class, *tested* SLO**, distinct from server latency:

- **Definition:** `perceived_latency = t(first_useful_feedback) − t(generate_click)`, where *first useful feedback* = the first streamed token rendered, OR a determinate progress state ("Generating… consulting formulary"), whichever is first. Indeterminate spinners do **not** count as feedback.
- **It is tested in CI, not only observed in prod.** A **Playwright performance assertion** on the streaming Rx flow fails the build if first-feedback exceeds the budget against a recorded/staged backend. (The digest's first rollout slice is *off-edge async + streaming generation* precisely so this budget is achievable.)
- **It is observed in prod** via a frontend RUM mark (`performance.mark('rx-first-feedback')`) exported through OTel; the p95 panel and its error budget live on the SLO dashboard.
- **Promptfoo latency assertion** in the eval gate (`drift_control.md` L1) bounds *model* latency; this SLO bounds *clinician-felt* latency. Both must be green.

```yaml
# observability/slo/perceived-latency.test.ts  (Vitest+Playwright — RUNS IN CI, gate)
test('perceived latency p95 ≤ 3s on streaming Rx', async ({ page }) => {
  await startStagedBackend({ scenario: 'aom-typical' });
  const t0 = await page.evaluate(() => performance.now());
  await page.getByRole('button', { name: /generate/i }).click();
  await page.waitForFunction(() => !!performance.getEntriesByName('rx-first-feedback').length);
  const t1 = await page.evaluate(() =>
    performance.getEntriesByName('rx-first-feedback')[0].startTime);
  expect(t1 - t0).toBeLessThanOrEqual(3000); // fails the build if exceeded
});
```

### 3.4 Error-budget policy (governs change velocity)

| Budget state (rolling 30d) | Policy |
|---|---|
| **> 50% remaining** | Normal velocity. Ship features. |
| **10–50% remaining** | Caution. Risky/High-tier changes (model, prompt, dosing) require explicit budget sign-off in the PR. |
| **< 10% remaining** | **Reliability freeze**: only reliability fixes + rollbacks merge until budget recovers. New features blocked by a CI check that reads the burn metric. |
| **Exhausted (0%)** | Incident. Auto-page; mandatory blameless review; ADR if the SLO target itself was wrong. |

> The freeze is **enforced, not advised**: a CI job reads the current burn from Grafana/Braintrust and **fails non-reliability PRs** when the budget is gone. Axiom 2 — enforce in CI, not in convention.

---

## 4. Structured logging, tracing & metrics (the conventions, with PHI firewall)

### 4.1 Structured logging — one schema, machine-parseable, PHI-free

All logs are **structured JSON**; no `console.log("it broke")`. A fitness function (`drift_control.md` family) fails the build on a free-text log call in `web/**` or Edge Functions outside the logger wrapper.

```jsonc
// Canonical log envelope (Edge Function + frontend)
{
  "ts": "2026-06-25T11:42:07.811Z",
  "level": "error",                 // debug|info|warn|error
  "service": "generate-prescription",
  "trace_id": "01J...T",            // W3C trace id — correlates EVERYTHING
  "release": "git:1d80756",         // SHA of deployed code
  "model_id": "claude-sonnet-4-6",  // model in play — CENTRAL to the firewall
  "prompt_version": "core_prompt@v7",
  "actor": "human",                 // human|agent (symmetric)
  "event": "rx_generation_failed",
  "http_status": 546,               // the founding-incident signal
  "duration_ms": 28411,
  "patient_id": "RKH-26270500017",  // opaque UHID key — NOT name/DOB/note
  "err_class": "UpstreamModelError",
  "msg": "anthropic 4xx model_not_found"
  // FORBIDDEN: patient name, DOB, free-text note, Rx body, allergies text,
  //            api keys, ABDM tokens — see §4.4 PHI firewall
}
```

**Log levels & retention:** `error`/`warn` → Sentry + Grafana, 90d; `info` (audit/event log) → append-only event store, retained per data-governance policy; `debug` → off in prod, sampled in staging.

### 4.2 Tracing — one trace, edge to dose-engine

```
trace_id = T
└─ span: ui.generate_click            (frontend)        attrs: release, actor
   └─ span: edge.generate_prescription                  attrs: model_id, prompt_version
      ├─ span: claude.tool_loop.iteration[0]            attrs: stop_reason, tokens_in/out, cost
      │  ├─ span: tool.get_reference(nabh_compliance)
      │  ├─ span: tool.get_formulary([...])
      │  └─ span: tool.get_lab_history(patient_id)
      ├─ span: dose_engine.cross_check                  attrs: agreed=true|false  ◀── severe if false
      └─ span: db.persist_prescription                  attrs: status=draft
```

- **Propagation:** W3C `traceparent` flows UI → Edge → (annotated on) Claude calls → DB writes. Every span carries `model_id`, `release`, `cost`, `tokens`.
- **Sampling:** **100% of errors and severe events; 100% of Rx-generation traces** (low volume POC — full capture is affordable and the clinical stakes justify it). Reduce only via ADR when volume forces it.
- The `dose_engine.cross_check` span with `agreed=false` is the **online manifestation of Axiom 5** — it is a severe event regardless of HTTP status.

### 4.3 Metrics — the minimal panel set (RED + clinical)

We use **RED** (Rate, Errors, Duration) plus clinical/AI dimensions. Metric names are stable contracts (renaming is a versioned change).

| Metric | Type | Labels | Powers |
|---|---|---|---|
| `rx_requests_total` | counter | `status`, `model_id`, `release` | availability SLI, timeout rate |
| `rx_request_duration_seconds` | histogram | `model_id`, `release` | latency SLO (p50/p95/p99) |
| `rx_perceived_latency_seconds` | histogram | `release` | perceived-latency SLO (§3.3) |
| `rx_timeout_total` | counter | `kind={546,504}`, `model_id` | **timeout-rate alarm (§5)** |
| `rx_online_eval_score` | gauge | `scorer`, `model_id` | online quality SLI, drift alarm |
| `rx_severe_event_total` | counter | `kind`, `model_id` | **zero-budget pager** |
| `claude_tokens_total` / `claude_cost_usd_total` | counter | `model_id`, `direction` | cost budget + drift |
| `model_deprecation_days_remaining` | gauge | `model_id` | **model-retirement alarm (§5)** |
| `error_budget_burn_ratio` | gauge | `slo` | burn alerts + reliability-freeze CI gate |

### 4.4 PHI firewall (binding — patient-data project)

> Global CLAUDE safety rule: **never put secrets, credentials, or patient data in logs, URLs, commit messages, or test fixtures.** This is enforced, not trusted.

- **Allowlist serializer:** the logger emits **only allowlisted keys**; any other field is dropped, not redacted-by-best-effort. PHI keys (name, DOB, note text, Rx body, allergy text) are never on the allowlist.
- **Semgrep PHI rule** (digest §7 SAST) fails CI on a log/Sentry/URL sink that references a PHI-typed field.
- **Sentry:** `beforeSend` scrubber + server-side data-scrubbing on; `sendDefaultPii: false`.
- **`patient_id` only:** the opaque UHID surrogate is the maximum identifier in telemetry; it is a *key for support*, not a record. Re-identification requires the audited DB, not the log stream.

---

## 5. Alerting — the four founding alarms + drift, with thresholds

Alerts are **code** (`observability/alerts/*.yaml`), reviewed and version-gated. Each alert names **condition → severity → page/ticket → runbook**. We tune for *actionable* alarms: every alert links a runbook; an alert with no runbook is a defect.

### 5.1 The alarm catalogue

| # | Alarm | Condition (signal → threshold) | Sev | Routes to | Runbook |
|---|---|---|---|---|---|
| A1 | **Model retirement / deprecation** | `model_deprecation_days_remaining{model_id=$pinned} ≤ 30` **OR** deprecation notice detected for pinned id | **High** (ticket) → **Critical** if ≤ 7d | eng-lead + on-call | RB-01 |
| A2 | **Model 4xx `model_not_found` / hard upstream** | any `rx_requests_total{status=~"4xx",err_class="model_not_found"} > 0` | **Critical** (page) | on-call | RB-01 |
| A3 | **Timeout-rate breach (546/504)** | `rate(rx_timeout_total[10m]) / rate(rx_requests_total[10m]) > 1%` for 10m | **High** (page) | on-call | RB-02 |
| A4 | **Severe online eval error** | `increase(rx_severe_event_total[5m]) > 0` (overdose-class, allergen prescribed, dose-engine `agreed=false`, missing NABH) | **Critical** (page) | on-call + clinical-safety-owner | RB-03 |
| A5 | **Online eval-score regression / drift** | `rx_online_eval_score` 6h mean drops > **3 pp** vs 7d baseline, OR below 95% floor | **High** (page) | on-call + eng-lead | RB-04 |
| A6 | **Error-budget fast burn** | budget for any SLO burning > **2%/hr** (will exhaust < 24h) | **High** (page) | on-call | RB-05 |
| A7 | **Synthetic Rx probe fail** | scheduled known-answer eval case fails 2 consecutive runs | **Critical** (page) | on-call | RB-02/RB-03 |
| A8 | **Cost anomaly** | `claude_cost_usd_total` 1h rate > **3×** 7d hourly baseline | **Med** (ticket) | eng-lead | RB-06 |
| A9 | **Telemetry blackout** | no `rx_requests_total` increment for 30m during clinic hours (heartbeat) | **High** (page) | on-call | RB-07 |

> **A1 + A2 are the founding incident, decomposed.** A1 is the *prevention* alarm (deprecation seen ahead of time → planned, eval-gated swap). A2 is the *detection* alarm (it already broke → automated fallback). Together they make `HTTP 546` from a dated-model retirement **impossible to be discovered by a clinician first**.

### 5.2 Alert rule (illustrative — timeout-rate, A3)

```yaml
# observability/alerts/rx-timeouts.yaml  (Grafana/Prometheus-style)
groups:
  - name: rx-generation
    rules:
      - alert: RxTimeoutRateBreach
        expr: |
          (sum(rate(rx_timeout_total{kind=~"546|504"}[10m]))
           / sum(rate(rx_requests_total[10m]))) > 0.01
        for: 10m
        labels: { severity: high, journey: rx-generation }
        annotations:
          summary: "Rx timeout rate {{ $value | humanizePercentage }} > 1% over 10m"
          runbook: "docs/runbooks/RB-02-timeout-storm.md"
          dashboard: "grafana/d/rx-slo"
```

### 5.3 Model-deprecation watcher (A1 — prevention, scheduled in CI)

```yaml
# .github/workflows/model-deprecation-watch.yml
name: model-deprecation-watch
on:
  schedule: [{ cron: "0 6 * * *" }]   # daily 06:00
  workflow_dispatch:
jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Resolve pinned model id from config adapter
        run: node observability/scripts/read-pinned-model.js > pinned.txt
      - name: Query Anthropic models + deprecation status
        env: { ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }} }
        run: node observability/scripts/check-deprecation.js --pinned "$(cat pinned.txt)"
      # exits non-zero (opens ticket / pages) if pinned id deprecated or < 30d to retirement,
      # OR if a newer GA model exists that should be eval-gated in via the planned-swap workflow.
```

> The pinned id is read **only** from the centralized config adapter (the `model-id-in-config` fitness function guarantees it lives nowhere else), so the watcher and the firewall reference the same single source of truth.

---

## 6. In-production eval-score monitoring (online evals)

This is the heart of "answer from data, *after* you ship." The same scorers that gate a PR in `drift_control.md` run **online on live traffic** through Braintrust, so we catch quality regressions the golden set never anticipated.

### 6.1 What runs online, and how

| Online scorer | Runs on | Blocking? | Drives |
|---|---|---|---|
| **Deterministic dose-engine cross-check** | **100%** of Rx (it's cheap & deterministic) | not request-blocking, but **`agreed=false` ⇒ severe event A4** | Axiom 5 in prod |
| **Schema / NABH-block / safety-block presence** | 100% of Rx | severe if missing | structural Rx contract online |
| **Allergy-contraindication + interaction presence** | 100% (cross-checked vs `patient_allergies`) | severe on collision | never-event class online |
| **LLM-judge soft rubric (G-Eval)** | **sampled** (cost-bounded, e.g. 10–20%) | non-blocking; feeds `rx_online_eval_score` | drift trend (A5) |
| **Cost / latency** | 100% (from spans) | budget alarms (A8/§3) | cost + latency drift |

> The **deterministic scorers run on every live Rx** because they are cheap and the clinical stakes are absolute. The **LLM-judge runs sampled** because it is costly and only ever measures *soft* quality — **a judge never verifies a dose** (digest §10). Judge model version is **pinned**; when it updates we re-validate against held-out human labels before trusting its online scores (Krippendorff α ≈ 0.8 target).

### 6.2 Online → golden: closing the loop

```
 LIVE Rx (scored online) ──▶ Braintrust online eval
        │
        ├─ score ≥ threshold ──▶ trend panel (A5 baseline)
        │
        └─ MISS (severe / regression / clinician thumbs-down)
                 │  one-click "promote to golden case"
                 ▼
        NEW golden eval case (severity tag + forbidden outputs)
                 │  PR into drift_control.md golden set
                 ▼
        CI eval gate now blocks this regression forever  ◀── the ratchet
```

This is the **production-miss → golden-case ratchet** the digest mandates: every real-world failure becomes a permanent CI gate. The golden set is "a safety net, not proof of safety" (digest §10) precisely because it **grows from production**, and this is the mechanism by which it grows.

### 6.3 Drift detection statistics (so A5 isn't noise)

- **Baseline:** trailing 7-day mean of `rx_online_eval_score` per `(scorer, model_id)`.
- **Trigger:** 6-hour rolling mean drops **> 3 percentage points** vs baseline, sustained 2 windows — or any breach of the 95% floor.
- **Stratify by `model_id` and `prompt_version`** so a drift alarm immediately implicates a deploy. A drift that coincides with a `ChangeModelConfig`/prompt deploy event (visible on the same dashboard annotation) is near-certainly causal → straight to RB-04.

---

## 7. Incident response & runbooks

Runbooks live at `docs/runbooks/RB-NN-*.md`, are **drilled quarterly** (game-days), and each ends with an evidence block proving the last drill date. Severity drives response.

### 7.1 Severity & response matrix

| Sev | Definition (clinical lens) | Ack | Mitigation target | Who |
|---|---|---|---|---|
| **SEV-1** | Rx generation down OR a **severe clinical output reached/could reach a patient** | 5 min | 15 min (fallback/rollback) | on-call + clinical-safety-owner + eng-lead |
| **SEV-2** | Degraded: timeout breach, drift alarm, budget fast-burn | 15 min | 1 h | on-call |
| **SEV-3** | Cost anomaly, single non-severe probe blip | next business day | — | eng-lead |

### 7.2 The named runbooks

| ID | Trigger | First action | Pre-validated mitigation |
|---|---|---|---|
| **RB-01** | Model retirement/deprecation (A1/A2) — *the founding runbook* | Confirm pinned `model_id` in config; check A2 4xx rate | **Flip config to the pre-validated fallback model id** (kept eval-green in CI); deploy is a 1-line config + `ChangeModelConfig` event; verify online evals recover |
| **RB-02** | Timeout storm 546/504 (A3/A7) | Check Supabase fn duration + Anthropic status | Shed load / enable streaming-async path; raise fn timeout if config; if upstream, fall back per RB-01 |
| **RB-03** | Severe online eval event (A4) | **Confirm whether any signed Rx was affected** | Physician sign-off is the backstop — quarantine the model/prompt, fall back, notify clinical-safety-owner; promote case to golden (§6.2) |
| **RB-04** | Eval-score drift (A5) | Annotate dashboard with recent deploys; bisect by model/prompt | Roll back the implicated `ChangeModelConfig`/prompt version (versioned, §8) |
| **RB-05** | Error-budget fast burn (A6) | Identify burning SLI | Trigger reliability-freeze CI gate (§3.4); mitigate top contributor |
| **RB-06** | Cost anomaly (A8) | Inspect token spans by model/prompt | Cap, or roll back the change that ballooned tokens |
| **RB-07** | Telemetry blackout (A9) | Verify exporter/collector health vs real outage | Restore telemetry; treat as SEV-2 until proven benign (blind = unsafe) |

### 7.3 RB-01 — the founding runbook (model retirement), in full

> This is the runbook the **2026-06-25 incident had no version of**. It turns the guesswork swap into a drilled, eval-backed, reversible procedure.

```md
# RB-01 — Model Retirement / Deprecation
TRIGGER: Alarm A1 (deprecation ≤30d) or A2 (live model_not_found 4xx / HTTP 546 spike)
SEVERITY: A1 ⇒ SEV-2 (planned); A2 ⇒ SEV-1 (live outage)

## 0. Pre-validated state (must already be true — verified each quarterly drill)
- [ ] A FALLBACK model id is declared in the config adapter and kept GREEN against the
      golden eval set in CI on every run (a scheduled eval job proves fallback still passes
      never-events + severe=0). The fallback is never allowed to silently rot.

## 1. Detect & confirm (≤5 min)
- [ ] Open grafana/d/rx-slo. Confirm rx_timeout_total / status=4xx{model_not_found} signal.
- [ ] Read pinned model_id from config adapter (single source of truth).

## 2. Mitigate (≤15 min) — FALL BACK, do not guess
- [ ] Set config adapter model_id := <pre-validated fallback id>. Commit = ChangeModelConfig.
- [ ] Deploy config (off-edge async path stays up). Event logged with actor + trace.
- [ ] Watch rx_requests_total{status=2xx} recover and rx_online_eval_score return to baseline.
- [ ] DO NOT tune reasoning effort by feel. If effort change is needed, it is a NEW
      eval-gated PR (drift_control.md), not a hotfix.

## 3. Verify (≤30 min)
- [ ] Synthetic Rx probe (A7 case) passes 2 consecutive runs.
- [ ] Online severe-event count = 0 since fallback.

## 4. Recover to steady state (planned, eval-gated)
- [ ] Open a HIGH-tier PR to adopt the long-term replacement model via the planned-swap
      workflow: base-vs-branch golden eval diff, never-events 100%, severe=0, cost/latency
      in budget, named human approver (digest §9).
- [ ] Refresh the fallback id to the new prior GA model. Re-run the fallback eval job.

## 5. Post-incident
- [ ] docs/incidents/NNNN written (blameless). ADR if model policy changed.
- [ ] Game-day this path next quarter; record drill date below.
DRILL LOG: 2026-06-25 (tabletop) — next: 2026-09-25
```

### 7.4 Blameless post-incident & rollback drills

- Every SEV-1/2 gets a **blameless `docs/incidents/NNNN-*.md`**: timeline, `trace_id`s, root cause, the **gate that should have caught it** (and the new gate/golden case added so it can't recur), action items with owners.
- **Rollback drills are scheduled, not theoretical.** Quarterly game-day exercises each runbook end-to-end on staging; RB-01's fallback flip is drilled against a deliberately "retired" model id. A runbook with no drill date in the last 90 days is flagged by a CI check on the runbook front-matter.

---

## 8. Verifying production matches the spec (runtime V&V)

CI proves the *merged code* matches spec (`drift_control.md` traceability matrix). This section proves the **deployed, running system** still does — because deploys can diverge from what was tested (config drift, env, vendor change, the retired model).

| Verification | Mechanism | Cadence | Fails how |
|---|---|---|---|
| **Liveness / heartbeat** | synthetic `/health` probe | 5 min | A9 page |
| **Known-answer behavior** | **synthetic Rx eval** — a canned golden case run against *real prod* (sandboxed test patient, never persisted) | 5–15 min | A7 page if quality collapses |
| **Contract conformance in prod** | sampled live Rx validated against the **same Ajv schema + FHIR R4 validator** used in CI | continuous (online) | severe event if a prod response violates the contract CI passed |
| **Release ↔ spec linkage** | deploy stamps `release=<git SHA>`; every telemetry record carries it → trace any live behavior back to the exact spec/code/test/eval via the traceability matrix | every request | n/a (forensic) |
| **Config = intended** | `model_id` / `prompt_version` on every record cross-checked against the config adapter's committed value; mismatch ⇒ config-drift alarm | continuous | A-config page |
| **Post-deploy smoke + canary** | after each deploy: synthetic Rx + online-eval watch for 30 min before declaring the release healthy | per deploy | auto-rollback trigger |

> **"Healthy = observed + within budget, never assumed."** A deploy is not done when the pipeline is green; it is done when the **post-deploy canary** shows real traffic inside SLO with online evals at baseline. The synthetic Rx probe is the production analog of "did we actually run it?" from the build loop's **VERIFY** step — extended to forever.

### 8.1 Change management, versioning & rollback (PCCP-style, production view)

- **Prompts and model ids are versioned artifacts** (`core_prompt@vN`, config-pinned model id). Every production behavior is attributable to a `(release, model_id, prompt_version)` triple stamped on telemetry.
- **Allowed changes within intended use are pre-defined** (digest §7): a prompt/model change inside the envelope is eval-gated + drilled-rollback; anything outside is an ADR + clinical-safety review.
- **Rollback is a first-class, drilled deploy** — config flip + `ChangeModelConfig` event — not a scramble. Auto-rollback triggers on post-deploy canary breaching A4 (severe) or A5 (drift).

---

## 9. Worked example — the founding incident, now observable end-to-end

**Then (2026-06-25, no observability):** dated model retired → Edge Function returns `HTTP 546` → clinician sees "Generation failed" → engineer swaps model + tunes effort **by guesswork**, no score, no alarm, no rollback path.

**Now (with this model):**

1. **T−30 days:** A1 fires (deprecation watcher) → ticket → planned swap runs the eval-gated PR workflow (digest §9). The incident *never happens* because the swap is done ahead of time, scored, with a refreshed fallback.
2. **If it still slips:** model retires live → A2 (`model_not_found` 4xx) **and** A3 (546 timeout-rate) **page the on-call within minutes**, before clinics flood the desk.
3. On-call opens **RB-01**, flips config to the **pre-validated fallback model id** (kept eval-green in CI). One config line; `ChangeModelConfig` event logged with `actor`.
4. `rx_requests_total{status=2xx}` recovers; the **synthetic Rx probe** and **online evals** confirm clinical quality is back at baseline — *measured, not assumed*.
5. **No effort-tuning by feel.** Any effort/prompt change is a **new eval-gated PR**.
6. **Post-incident:** blameless write-up; if the live retirement reached a clinician, RB-03's affected-Rx check runs and the case is **promoted to a golden eval case** so the regression is gated forever; the deprecation-watch lead time is widened in an ADR.

**Result:** the decision made by guesswork is now a **scored, alarmed, runbooked, reversible** operation. That is the entire point of the operating model, carried into production.

---

## 10. Production observability DoD (the deploy gate)

Encoded as required CI checks + deploy-pipeline gates + branch protection on the deploy workflow. A release is not "live & done" until every relevant box is machine-verified.

- [ ] **Telemetry wired:** new/changed surface emits the **structured log envelope** (§4.1), an **OTel span** in the Rx trace (§4.2), and the **RED + clinical metrics** (§4.3).
- [ ] **Trace correlation:** response + events carry `trace_id`, `release`, `model_id`, `prompt_version`, `actor` (fitness function green).
- [ ] **PHI firewall:** Semgrep PHI rule clean; logger allowlist serializer used; Sentry PII off (§4.4).
- [ ] **SLOs declared:** any new journey has an SLI + SLO target + error budget in `observability/slo/` (§3).
- [ ] **Perceived-latency SLO** test green in CI for any change to the Rx UI/streaming path (§3.3).
- [ ] **Alerts as code:** new failure mode has an alert rule + **a named runbook** (§5/§7); no alert without a runbook.
- [ ] **Online eval scorers** attached for any model/prompt/Rx-schema change; deterministic dose-engine cross-check runs on 100% of Rx (§6).
- [ ] **Synthetic probe** updated to cover the new path (§8).
- [ ] **Rollback path** declared and (for model/prompt) a **pre-validated fallback** exists and is eval-green (RB-01).
- [ ] **Post-deploy canary** window defined; auto-rollback triggers (A4/A5) configured (§8.1).
- [ ] **Runbook drill date** within 90 days for any runbook this change touches.

> An agent cannot self-attest past these: they are required checks on the deploy workflow + branch protection, the production-side equivalent of `drift_control.md`'s merge gate.

---

## 11. Honest caveats (carry into downstream files)

- **Observability is detection, not prevention.** It shortens *time-to-know* and *time-to-mitigate*; the actual safety backstops remain **mandatory physician sign-off** and **severe-error gating**. This is engineering rigor, not regulatory clearance — **CDSCO is the binding regulator** (digest §10).
- **An online eval is only as good as its scorers and its sampling.** The deterministic dose-engine cross-check is trustworthy because it is deterministic; the **LLM-judge online score is soft and drifts** when the judge model updates — pinned, re-validated against human labels, and **never used to verify a dose**.
- **SLO numbers here are a humble v1 POC contract**, not five-nines theater. They are deliberately matched to the real consequence of a miss (sign-off + manual fallback exist) and are **ratcheted via ADR** as production data accrues. Start with the **four founding alarms (A1–A4) + drift (A5)**; let the alarm catalogue and golden set **accrete** from real incidents — don't front-load enterprise ceremony, front-load the alarms that catch harm.
- **Telemetry can lie or go dark** — a blackout (A9) is treated as SEV-2 until proven benign, because a system you cannot see is a system you cannot certify safe.

---

### Relevant repo anchors (absolute)

- `E:\projects\AI-Enabled HMIS\radhakishan-prescription-system-folder\radhakishan-prescription-system\supabase\functions\generate-prescription\index.ts` — primary **observed surface**; emits the `HTTP 546` of the founding incident; model id (`claude-sonnet-4-6`) currently hardcoded at lines ~518/637 — to be moved behind the config adapter and stamped on every telemetry record.
- `E:\projects\AI-Enabled HMIS\radhakishan-prescription-system-folder\radhakishan-prescription-system\web\dose-engine.js` — dosing **source of truth**; anchors the **online** dose-engine cross-check scorer (Axiom 5 in prod).
- `E:\projects\AI-Enabled HMIS\radhakishan-prescription-system-folder\radhakishan-prescription-system\.github\workflows\deploy-pages.yml` — current **zero-gate** deploy; this file adds the **post-deploy canary + telemetry/SLO/alert/runbook gates** around it, plus the `model-deprecation-watch.yml` and synthetic-Rx-probe scheduled workflows.
- `E:\projects\AI-Enabled HMIS\radhakishan-prescription-system-folder\radhakishan-prescription-system\console-log.md` — captured browser console showing the real `generate-prescription:1 … status of 546` and `Generation failed (HTTP 546)` sequence this observability model is built to alarm on.
- `E:\projects\AI-Enabled HMIS\radhakishan-prescription-system-folder\radhakishan-prescription-system\radhakishan_system\scripts\integration_test.js` — hand-rolled shape smoke test; **superseded** by the synthetic-Rx probe + online eval harness here.
- To be created by the scaffolding workflow (digest §8): `observability/slo/`, `observability/alerts/`, `docs/runbooks/RB-NN-*.md`, `docs/incidents/`, `.github/workflows/model-deprecation-watch.yml`. No `package.json` / `deno.json` at root and no CI test/observability job exist (confirmed 2026-06-25).
