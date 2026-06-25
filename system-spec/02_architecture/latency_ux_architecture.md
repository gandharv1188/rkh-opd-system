# Latency & UX Architecture — Perceived Wait ≈ 0

> **Status:** Authoritative TARGET-STATE rebuild specification. Build to **this**, not to the live `web/` + Supabase Edge-Function prototype. Where this document and an upstream study report disagree, this document wins; where it disagrees with a verified API fact, the file author flags it.
>
> **Scope of this file.** The single deepest treatment of *how a pediatric OPD doctor experiences ~0 wait to a reviewable, signable prescription* — the four compounding latency mechanisms (off-edge compute, speculative/background generation from the auto-saved note, end-to-end streaming over SSE, async job + notify), the debounce/regeneration/last-write-wins policy, and the sign-off interaction. It is the *behavioral and timing* companion to its siblings: `overview.md` owns the system map, `backend_services.md` owns the service decomposition, `frontend_architecture.md` owns components/ports, `frontend_design_system.md` owns tokens, `../05_ai/*` owns prompt/tool internals, `../06_api/*` owns the OpenAPI/SSE contract, `../09_engineering_discipline/*` owns the TDD/eval runner. This file does not re-derive those; it specifies the *latency and interaction design* they hang off and cites them where depth lives.
>
> **Foundation (real, on-branch).** The hexagonal TypeScript skeleton on `origin/feat/dis-plan` under `dis/` is the canonical template (Hono, `postgres` driver, dbmate, 8 ports + `__fakes__`, Zod env, fitness-rules CI, a pure `state-machine.ts` `transition()`, a Postgres job queue `dis_jobs`/`M004`, an in-process `StatusChannel`). The clinical brain (dose engine, `compute_doses`, three-tier severity, `prescription_audit`) is on `origin/sprint-2-saved`. This document reuses those patterns 1:1 and names the exact files.

---

## 0. The one promise this document is accountable for

> **From the doctor's chair, the wait from "I have finished writing the note" to "I am reviewing a real, editable, signable prescription" is perceptibly zero — and the prescription is ALWAYS doctor-reviewed and signed, never auto-finalized.**

Two halves, both non-negotiable:

1. **Perceived wait ≈ 0.** Not "fast." Not "a shorter spinner." The target is that the draft is *already there* the instant the doctor looks for it, because we started generating it from the auto-saved note *while the doctor was still typing*. When it is not already there, the doctor sees **real streaming progress**, never an opaque or infinite spinner.
2. **The draft is always a draft until a human signs.** Speculation, streaming, and async jobs change *when* compute happens, never *who decides*. An AI draft is `draft_ready` (clinically: `pending_review`) until a human `SignOff` command moves it to `signed`. This is the same fail-closed gate the OCR pipeline uses for `promotion.ts` (`dis/` CS-1/CS-7), enforced as code via the pure `transition()` state machine — not as prompt text or UI convention.

Everything below is in service of those two sentences.

---

## 1. The flaw being designed out (the latency that exists today)

The prototype runs the Claude tool-use loop **synchronously inside a Supabase Edge Function** capped at a hard **150 s wall clock**.

```
supabase/functions/generate-prescription/index.ts   (origin/main + sprint-2-saved)
  ├─ model HARDCODED:   "claude-sonnet-4-6"                  (main ~518; sprint-2 711/832)
  ├─ tool loop:         for (round=1..MAX_TOOL_LOOPS=10) { await fetch(api.anthropic.com) }
  ├─ internal abort:    setTimeout(() => controller.abort(), 120_000)   (main 501)
  │                     setTimeout(() => controller.abort(), timeoutMs≈50_000) (sprint-2 694)
  └─ platform wall:     Edge Function HARD limit 150_000 ms → HTTP 504 / 546
```

**Observed behavior (verified):**

| Symptom | Evidence |
|---|---|
| Generation takes 50–150 s | three-round tool loop, non-streaming `max_tokens: 8192`, sequential fetches |
| Hard failure at exactly 150 s | `console-log.md:15-16` — `HTTP 546` responses at `150,000 ms` |
| Internal aborts are themselves workarounds | the 120 s / 50 s `setTimeout` aborts exist only to die *before* the platform kills the request, so the function can return *something* |
| Doctor waits up to ~5 min | retry-on-timeout + cold start + re-run compounds the 150 s wall |
| Cosmetic progress only | the pad shows a rotating `msgs[]` array (fake reassurance), not real model progress |

**The root cause is platform, not prompt.** A 150 s synchronous function can never host a multi-round, streaming, tool-using agentic loop that legitimately needs minutes. **Every timeout / token-budget / model-downgrade / "effort:low" hack in `sprint-2-saved` exists solely to survive this wall, and is DELETED — not ported — in the rebuild.** Once compute is off-edge and uncapped, the latency design is free to optimize for *perceived* time instead of *fitting inside 150 s*.

---

## 2. The latency design — four compounding mechanisms

These are multiplicative, not alternatives. Each removes a different second from the doctor's perceived wait; together they take it to ≈ 0.

| # | Mechanism | What it removes | Where it lives |
|---|---|---|---|
| **M1** | **Off-edge persistent worker** | the 150 s wall and the 504/546 failure class | `workers/generation.worker.ts` (process B) |
| **M2** | **Speculative / background generation from the auto-saved note** | the *entire* generation time from the doctor's critical path — work happens *before* the click | `core/speculation-policy.ts` + the worker |
| **M3** | **End-to-end streaming (SSE)** | the "opaque spinner" feeling when a draft *isn't* pre-warmed yet — real progress instead | `adapters/anthropic` → events → SSE relay |
| **M4** | **Async job + notify + review-first UX** | the request/response coupling — click returns `202` instantly; review opens on the *existing* draft | API Gateway + `GenerationPort` + pad |

### 2.1 M1 — Off-edge persistent worker (kills the wall)

The Claude tool-use loop runs on a **long-lived, uncapped, horizontally-scalable worker** that pulls jobs from a durable queue — never inside an Edge Function.

```
POC:  Hono container on Fly.io / Render          (long-lived; holds SSE; worker entrypoint)
PROD: Google Cloud Run (60-min request timeout, scale-to-zero, clean SSE)
       → AWS Fargate / Lambda by DIS_STACK=aws flip
Queue: Postgres (ops.jobs, the dis/ M004 pattern) POC  →  SQS  PROD
```

Because the worker has no wall clock, it can:

- run `client.messages.stream(...)` with `.finalMessage()` for timeout-protected completion (the Anthropic SDK **refuses non-streaming requests above ~16K `max_tokens`**, and prescription generation runs at `max_tokens ≈ 16000+`, so **streaming is mandatory** — see `../05_ai/`),
- execute a multi-round tool loop with parallel `Promise.all` tool fetches,
- retry with backoff+jitter on 429/5xx without racing a platform timeout.

This single change is the *enabler* for M2–M4. (Full worker internals: `backend_services.md` §4; this file only specifies its latency-facing behavior.)

### 2.2 M2 — Speculative / background generation from the auto-saved note (the headline)

**This is the mechanism that makes perceived wait ≈ 0.** The other three make generation *robust and visible*; M2 makes it *already done*.

The insight: the doctor's note **already auto-saves** while they type. The prototype debounces a 3 s save to `visits.raw_dictation` (`prescription-pad.html` `setupAutoSave` / `saveNote`, sprint-2 lines ~3905–3964). We turn that latent signal into **pre-computation**:

> Every meaningful note autosave **and** every section-chip change is a `DraftNoteUpdated` command on the bus → a debounced background worker **speculatively (re)generates a draft** keyed by a **content hash** of `{ note, patient_context_version, selected_sections, rx_lang }`. By the time the doctor clicks **Generate**, a fresh `draft_ready` for the current hash usually already exists → the review screen opens at **0 ms**.

The doctor writes the note over (say) 90–180 s of the consult. We use that wall-clock window — which the doctor is *already spending on the patient* — to absorb the 50–150 s of generation. The generation time does not vanish; it moves **off the doctor's critical path and onto the consult's existing idle time.**

```
        consult timeline (doctor's real time)
  t0 ──────────────────────────────────────────────────────────── t_click ── REVIEW
  │  doctor examines patient, dictates / types note                │         (0 ms)
  │   ┌── autosave (debounce 800 ms) → DraftNoteUpdated → spec gen ─┐
  │   │      ┌── autosave → supersede → spec gen ──┐                │
  │   │      │        ┌── chip change → spec gen ──┐                │
  │   └──────┴────────┴── last hash → draft_ready ─┘                │
  │                          (generation overlaps the consult)      │
  click Generate ──▶ hash matches latest draft? ──▶ open review NOW ┘
```

**This is not "prefetching a guess."** It is generating the *actual* draft for the *actual* current note, continuously, so the latest version is ready. The doctor's click is a **confirmation**, not a **request**.

#### 2.2.1 The content hash (the identity of a draft)

A draft is identified by a stable, deterministic content hash so we can answer one question instantly at click time: *"does a ready draft for exactly what the doctor sees now already exist?"*

```ts
// core/content-hash.ts   (pure — no IO, no clock, no model-id)
export function draftContentHash(input: {
  note: string;                       // normalized: trim, collapse internal whitespace, NFC
  patientContextVersion: string;      // bumps when vitals/labs/allergies/weight change (CQRS read-model version)
  selectedSections: string[];         // canonical-sorted
  rxLang: 'bilingual' | 'hindi' | 'english';
}): string;                           // sha256 hex; stable across whitespace-only edits
```

Rules that keep the hash *useful* (high cache-hit, low false-supersede):

- **Normalize before hashing** — trim, collapse runs of whitespace, NFC-normalize Devanagari, lowercase section names, sort the sections array. A trailing space must not invalidate a ready draft.
- **`patientContextVersion` is part of identity.** If the nurse updates weight or a lab arrives mid-consult, the patient context changes, the hash changes, and the previous draft is correctly treated as stale (dose math depends on weight — see §6 on weight).
- **No timestamps, UUIDs, or correlation IDs in the hashed input.** Those belong on the job row, not the draft identity — otherwise every save is a cache miss (and it also poisons the prompt cache; see §7).

#### 2.2.2 Debounce & regeneration policy (last-write-wins)

Speculation must be *frequent enough* to usually be ready, but *cheap enough* not to spend Opus tokens on every keystroke. The policy is **debounce + supersede**:

| Knob | Value | Rationale |
|---|---|---|
| **Save debounce** | **800 ms** after last input (down from prototype's 3 s) | A doctor pauses ~1 s between thoughts; 800 ms catches a settled sentence without firing mid-word. Cheaper saves are fine (M5 dedup, §3). |
| **Speculation trigger debounce** | **3 s** of *settled* note (no input for 3 s) **AND** note length ≥ a minimum (e.g. ≥ 40 chars / contains a complaint token) | We save aggressively (crash-safety) but only *spend a model call* once the note has settled into something worth generating. |
| **Min-delta gate** | skip speculation if the new hash differs from the last-generated hash only by `selectedSections` reorder or whitespace | the hash already normalizes these; the gate is a belt-and-braces guard. |
| **Supersede** | **last-write-wins** — a newer hash for the same visit **cancels/aborts** the in-flight speculative run and enqueues the new one | the doctor's latest note is the only one that matters; never finish a draft for a note that no longer exists. |
| **Concurrency per visit** | **1 in-flight speculative job** | a second is queued only after the first is superseded; prevents fan-out cost on a fast typist. |
| **Cost ceiling** | per-visit speculative spend cap (config) → above it, fall back to on-click generation only | bounds worst-case cost on a pathologically-edited note; logged to `ops.cost_ledger`. |

**Supersede is implemented in two places, belt-and-braces:**

1. **At enqueue (cheap):** when a `DraftNoteUpdated` arrives, mark any `queued`/`generating`/`streaming` speculative job for that `visit_id` with a *different* hash as `superseded` (state-machine event), and enqueue the new hash.
2. **At lease (authoritative):** before the worker spends a model call, it re-checks `job.content_hash == latest_hash_for(visit)`. If not, it transitions `→ superseded`, acks, and moves on — **no model call is made for a stale note.** (This is the `if (hash != latest_hash_for(visit))` guard in `backend_services.md` §4.4.)

```ts
// core/speculation-policy.ts   (pure)
export type SpeculationDecision =
  | { kind: 'generate'; hash: string }            // settled + worth it + not already ready
  | { kind: 'skip'; reason: 'unsettled' | 'too_short' | 'no_meaningful_delta' }
  | { kind: 'reuse'; hash: string }               // a ready/in-flight draft already covers this hash
  | { kind: 'supersede'; cancel: string[]; hash: string };  // newer hash; cancel these job ids

export function decideSpeculation(ctx: SpeculationContext): SpeculationDecision;
```

#### 2.2.3 The two paths at click time

| At `RequestGeneration` (click Generate)… | Doctor experience |
|---|---|
| **Hash matches a `draft_ready` job** (the common case) | **Review opens at 0 ms** on the existing draft, with a subtle **"draft — please confirm"** badge. No spinner. |
| **Hash matches a `streaming` job** (note settled very recently) | Review opens immediately showing the **partial draft**, the stream continues to fill it in live (diagnosis → meds → safety). |
| **Hash is stale** (doctor edited and clicked within the debounce window) | Inline **"regenerating from your latest note…"** with a **real streaming progress** view (M3) — not a blank spinner. The stale draft is marked `superseded`; a fresh job is enqueued at high priority. |
| **No speculative draft at all** (speculation was skipped — short note, disabled, or first click) | A normal streamed generation starts; M3 shows real progress. This is the *worst case* and it is still strictly better than today (streaming + off-edge, no 150 s wall). |

The "draft — confirm" badge is critical for safety honesty: the doctor must know a draft was pre-generated speculatively and may predate their final keystroke. Confirming (or any edit) re-validates against the current hash; if stale, we regenerate *before* allowing sign-off (§8.4).

### 2.3 M3 — End-to-end streaming (SSE) (kills the opaque spinner)

When a draft is *not* already warm, the doctor must see **real progress**, not a cosmetic rotator. The worker emits **domain events** as the model streams, and the pad renders the draft **progressively**.

**Event vocabulary** (generalized from the `dis/` `StatusChannel` `StatusChangedEvent`):

```ts
// the per-job channel the pad subscribes to (one shape; past-tense; carries job_id)
type GenerationEvent =
  | { type: 'GenerationStarted';   job_id; visit_id; speculative: boolean }
  | { type: 'ToolInvoked';         job_id; tool: 'get_formulary'|'get_standard_rx'|'get_previous_rx'|'get_lab_history'|'get_reference'|'compute_doses'; args_digest }
  | { type: 'DraftDelta';          job_id; section: 'diagnosis'|'medicine'|'investigation'|'safety'|'counselling'; delta }
  | { type: 'GenerationCompleted'; job_id; draft_id; severity; tokens; latency_ms }
  | { type: 'GenerationFailed';    job_id; reason; retryable: boolean };
```

**Progressive render order** (matches how the model produces and how a doctor reads): **diagnosis appears → each medicine card materializes as `compute_doses` returns → investigations → safety panel → counselling.** The doctor starts reading the diagnosis while the meds are still arriving. This replaces the prototype's `msgs[]` rotator with information the doctor can actually act on.

**Why SSE, not WebSocket.** The prototype's Supabase Realtime WebSocket was removed for IO cost (commit `1d80756`). The notify channel is **SSE** (`GET /jobs/{id}/events`) with a **status-row poll fallback** (`GET /jobs/{id}`). SSE is one-directional (server→client), which is exactly the shape of streamed deltas; it survives proxies and reconnects with `Last-Event-ID`; and Cloud Run/Fly hold it cleanly. The `RealtimePort` abstracts it so the in-process `StatusChannel` is the POC single-process path and a cross-process transport (Postgres `LISTEN/NOTIFY` or Redis pub/sub) is the prod path **without touching the SSE handler** (`backend_services.md` §6.2).

### 2.4 M4 — Async job + notify + review-first UX (kills request/response coupling)

`POST /generate` **never blocks**. It validates, enqueues a `RequestGeneration` command, and returns **`202 { job_id }`** immediately. The pad then either opens the existing draft (M2 hit) or subscribes to the SSE channel (M2 miss) — but the HTTP request that *triggered* it is already done.

```
Doctor clicks Generate
  → POST /generate                    →  202 { job_id }      (≤ 50 ms, never waits on the model)
  → GenerationPort resolves locally:
       draft_ready for hash?  → open review (0 ms)           [M2 hit]
       else                   → SSE GET /jobs/{job_id}/events → progressive render  [M2 miss / streaming]
```

`notify` (SSE event or status-row flip to `draft_ready`) is what tells the pad a *speculative* draft finished while the doctor was still typing — surfacing the subtle "draft ready" badge **before** the doctor even clicks Generate. This is the moment perceived wait becomes *negative*: the answer arrives before the question is asked.

### 2.5 The `GenerationPort` state contract — never an infinite spinner

The frontend `GenerationPort` (client anti-corruption seam, `frontend_architecture.md`) is a finite state machine with a **hard client deadline** so the UI can *never* hang:

```
        ┌──────┐  request/subscribe   ┌───────────┐   first DraftDelta   ┌───────┐
        │ idle │ ───────────────────▶ │ streaming │ ───────────────────▶ │ ready │
        └──────┘                      └─────┬─────┘                       └───────┘
            ▲  hash mismatch detected       │ deadline / no progress           │ edit → hash change
            │  (note edited post-draft)     ▼                                  ▼
        ┌───────┐                       ┌───────┐                          ┌───────┐
        │ stale │ ◀──────────────────── │timeout│                          │ stale │
        └───────┘                       └───┬───┘                          └───────┘
                                            │  user choice
                            ┌───────────────┼────────────────┐
                            ▼               ▼                ▼
                      [retry job]     [edit manually]   [single-shot regenerate]
```

| State | Meaning | UI obligation |
|---|---|---|
| `idle` | nothing in flight; may have a warm draft | show "draft ready" badge if a matching `draft_ready` exists |
| `streaming` | deltas arriving | progressive render; live section skeletons; **AbortController armed** |
| `ready` | `GenerationCompleted` for the current hash | full reviewable draft; sign-off gate evaluated (§8) |
| `stale` | current note hash ≠ the ready draft's hash | "your note changed — regenerate" affordance; **block sign-off** until re-validated |
| `error` | `GenerationFailed`, retryable=false, or schema-invalid | typed error envelope; offer retry / manual edit |
| `timeout` | hard client deadline hit with no completion | **degraded UI**: retry / manual edit / single-shot — *never a perpetual spinner* |

Every request carries an **`AbortController`**; exponential-backoff retry on transient failure; a hard deadline (config, e.g. 90 s of *no progress*, distinct from total time since streaming makes total time irrelevant). Contract-tested in `../09_engineering_discipline/` (state-contract tests are a release gate).

---

## 3. Debounce, dedup, and the write-amplification fix

The prototype writes `visits.raw_dictation` **3×** for a single settled note (it was, before the 30 s timer was disabled, the single largest DB write source — ~37,786 calls / 6 weeks, 19.7% of all writes, per the comment in `setupAutoSave`). The rebuild fixes this **and** repurposes the save signal for speculation, via the command bus.

**Every note save is a `DraftNoteUpdated` command — validated, deduped, and idempotent:**

```
client (DictationPad)                 CommandBus / Gateway              effects
  │ input → debounce 800 ms            │                                 │
  │── DraftNoteUpdated(visit, note, hash, idem_key) ─▶ validate          │
  │                                    │ idempotency: if last persisted   │
  │                                    │   hash == this hash → NO-OP 204   │  ← dedup: kills the 3× write
  │                                    │ else → persist raw_dictation,     │
  │                                    │        bump patient_context? no   │
  │                                    │        emit DraftNoteUpdated event│
  │                                    │        → speculation-policy       │  ← reuses the save as pre-compute
  │◀── 204 (Saved HH:MM)               │                                  │
```

- **Idempotency key** on every write (`Idempotency-Key` mandatory, `dis/` middleware). A save whose content hash equals the last persisted hash is a **204 no-op** — the doctor sees "Saved" but no row is written. This is the structural fix for the 3× write, not a tuned interval.
- **One debounce, two consumers.** The same settled-note signal drives *both* crash-safety persistence (save) *and* speculation (generate). They are decoupled: persistence is cheap and frequent (800 ms); speculation is gated and supersede-driven (§2.2.2).
- **Save indicator** preserved as a first-class UX affordance (the prototype's "Editing… → Saving… → ✓ Saved HH:MM → Save failed"), now driven by command-bus events rather than ad-hoc `fetch` status.

---

## 4. End-to-end sequence diagrams

### 4.1 The happy path — speculative draft ready before the click (perceived wait = 0)

```
Doctor/Pad    CommandBus/Gateway   Queue(ops.jobs)   GenWorker(off-edge)   Claude(stream)   DB(rx_jobs/drafts)   SSE
   │                 │                   │                  │                   │                  │             │
   │ types note …    │                   │                  │                   │                  │             │
   │─input(debounce 800ms)──────────────▶│                  │                   │                  │             │
   │─DraftNoteUpdated(note,hashA)───────▶│                  │                   │                  │             │
   │                 │ dedup? no → persist raw_dictation; emit event            │                  │             │
   │                 │─decideSpeculation→ generate(hashA)──▶│ enqueue(speculative=true,hashA)─────▶│             │
   │                 │                   │─lease(SKIP LOCKED)──────────────────▶│                   │             │
   │                 │                   │                  │ hashA==latest? yes│                   │             │
   │                 │                   │                  │ transition→generating; persist        │             │
   │                 │                   │                  │─messages.stream──▶│                   │             │
   │                 │                   │                  │◀─ToolInvoked(get_formulary…)           │             │
   │                 │                   │                  │  [compute_doses → DoseEnginePort recompute, byte-exact]
   │                 │                   │                  │◀─DraftDelta(diagnosis,meds,safety)     │             │
   │                 │                   │                  │ transition→streaming; UPSERT draft────▶│             │
   │                 │                   │                  │◀─finalMessage (stop_reason guarded)    │             │
   │                 │                   │                  │ transition→draft_ready; persist + outbox▶│ notify(job)▶│
   │◀──────────────── "draft ready" badge (SSE notify, BEFORE the doctor clicks) ──────────────────────────────────│
   │ … keeps examining/typing … note unchanged …                                                                  │
   │ clicks GENERATE │                   │                  │                   │                   │             │
   │─POST /generate(hashA)──────────────▶│ 202 {job_id=existing}                │                   │             │
   │                 │ hashA == draft_ready? YES                                │                   │             │
   │◀── OPEN REVIEW @ 0ms (draft — confirm) ─────────────────────────────────────────────────────────────────────│
   │ review · edit (DoseAdjuster → client DoseEnginePort recompute, no AI math) │                   │             │
   │ SignOff (gate)  │─SignOff───────────▶│ transition(draft_ready→signed); content-hash seal; persist immutable   │
   │                 │─PrescriptionSigned─▶ ops.outbox ─▶ ABDM/FHIR async (process C, non-blocking) │             │
   │ print auto-opens (single <PrintDocument> renderer)                                                            │
```

### 4.2 The miss path — note edited and clicked within the window (real streaming, no opaque spinner)

```
Doctor/Pad    CommandBus/Gateway     GenWorker            Claude(stream)        DB                  SSE
   │ edits note (hashA→hashB), clicks GENERATE quickly                                              │
   │─DraftNoteUpdated(hashB)─▶│ supersede in-flight hashA job (state→superseded)                    │
   │─POST /generate(hashB)───▶│ 202 {job_id_B}  enqueue(priority,hashB)                              │
   │◀── 202, GenerationPort→streaming; "regenerating from your latest note…"                         │
   │                          │─lease─▶│ hashB==latest? yes → generating                             │
   │                          │        │─messages.stream──▶│                                          │
   │◀── DraftDelta(diagnosis) ─────────┼───────────────────┼──── progressive render (real progress) ──│
   │◀── DraftDelta(medicine ×N as compute_doses returns) ──┼─────────────────────────────────────────│
   │◀── GenerationCompleted ───────────┼── transition→draft_ready; persist; notify ───────────────────│
   │ review · SignOff (hashB matches current note → gate passes)                                      │
```

The worst case (no speculation at all) is identical to 4.2 minus the supersede — and is still strictly better than the prototype: off-edge (no 150 s wall) + streaming (real progress) + `202` (no blocked request).

### 4.3 The failure path — generation fails, never an infinite spinner

```
Doctor/Pad         GenWorker                    Claude            DB                 GenerationPort
   │ POST /generate ─▶ 202                        │                │                  │
   │◀ streaming …      │─messages.stream──────────▶│ 5xx / overload │                  │
   │                   │ backoff+jitter retry (×N) │ still failing  │                  │
   │                   │ ModelPolicyPort downgrade? Opus 4.8 → Sonnet 4.6 (FLAGGED)    │
   │                   │ stop_reason:"refusal"? guard before reading content[0]        │
   │                   │ transition→failed (audited); emit GenerationFailed(retryable) │
   │◀── GenerationFailed ──────────────────────────┼────────────────┼──▶ state=error  │
   │ degraded UI: [Retry] [Edit manually] [Single-shot regenerate]  — NEVER a perpetual spinner
```

The client also arms a hard deadline independent of the worker: if no `DraftDelta`/completion arrives within the no-progress window, `GenerationPort` → `timeout` → degraded UI. Two independent guards (worker-side and client-side) so a dropped SSE connection can never leave the doctor staring at a spinner.

---

## 5. The async job & data model behind the latency (read-model + outbox)

The latency design needs a durable, queryable record of *every* generation attempt — speculative or on-click — so the pad can answer "is a draft ready for this hash?" without a round trip to the model. (Full DDL: `../04_database/`; this is the latency-facing subset.)

### 5.1 `prescribing.rx_generation_jobs` (the read model the pad queries)

```sql
-- the projection that makes "is a fresh draft ready?" an O(1) index lookup
create table prescribing.rx_generation_jobs (
  id              uuid primary key default gen_random_uuid(),
  visit_id        uuid not null,
  patient_id      uuid not null,
  status          text not null
                  check (status in ('queued','generating','streaming','draft_ready','superseded','failed')),
  speculative     boolean not null default false,     -- true = pre-generated from autosave; false = explicit click
  content_hash    text not null,                      -- §2.2.1 — the draft identity
  idempotency_key text not null,
  correlation_id  text not null,
  model_used      text,                               -- the model id+version ACTUALLY used (audit; never hardcoded)
  tokens_in       int, tokens_out int,
  cost_micro_inr  bigint,                             -- integer micro-INR; no float money
  latency_ms      int,                                -- worker-side; informational (perceived time ≈ 0 by design)
  draft_id        uuid,                               -- → prescribing.prescription_drafts
  last_error      text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  version         int not null default 0,
  facility_id     uuid not null,
  constraint uq_rx_job_idem unique (idempotency_key),
  constraint fk_rx_job_visit foreign key (visit_id, patient_id)
    references clinical.visits (id, patient_id)        -- composite FK enforces visit↔patient consistency
);

-- the index that makes the click-time question instant: "ready draft for this exact hash?"
create unique index uq_rx_job_ready_hash
  on prescribing.rx_generation_jobs (visit_id, content_hash)
  where status = 'draft_ready';

create index idx_rx_job_visit_status
  on prescribing.rx_generation_jobs (visit_id, status);
```

At click time the pad's `GenerationPort` (via the read model) runs exactly one indexed lookup: *is there a `draft_ready` row for `(visit_id, content_hash=hash(currentNote))`?* — yes ⇒ open at 0 ms; no ⇒ subscribe and stream.

### 5.2 `prescribing.prescription_audit` (one row per attempt — ported from `sprint-2-saved`)

Append-only, one row per generation *attempt* including retries/fallback: `meta_mode`, `stop_reason`, `tokens_in/out`, `rounds`, `tools_called[]`, `requested/emitted/omitted/added` counts, `severity_*`, `warnings[]`, `duration_ms`, **and the model id+version actually used**. This is what makes the latency machinery auditable for NABH and clinical-safety review (it records *that* a draft was speculative, *which* note hash it came from, and *who* signed it). Port from `origin/sprint-2-saved:supabase/functions/.../20260428001000_prescription_audit.sql`.

### 5.3 `ops.outbox` (transactional event dispatch)

Domain events are written to `ops.outbox` **in the same transaction** as the read-model update (transactional outbox), then a dispatcher relays them to (a) the SSE/notify channel (the doctor's pad) and (b) downstream subscribers (the ABDM `PrescriptionSigned` handler). This is what keeps ABDM/FHIR generation **event-driven and off the sign-off path** — sign-off writes `PrescriptionSigned` and returns; the integration worker picks it up asynchronously (§8.5).

---

## 6. Where the dose engine sits in the latency path (correctness never traded for speed)

**No latency optimization is ever allowed to put an AI-computed number on paper.** The deterministic `DoseEnginePort` (745-line pure port from `origin/sprint-2-saved:.../dose-engine.ts`) is the sole arithmetic authority, and it sits *inside* the streaming path:

1. The AI proposes a medicine + regimen with **no numeric fields** (drug, method, frequency, formulation only).
2. As each `compute_doses` tool call returns during streaming, the worker calls `DoseEnginePort.computeDose(...)` → recomputes mg/ml/drops from concentration + band + weight/BSA, rebuilds the bilingual R2/R3 strings + pictogram payload, applies per-ingredient max-single/max-daily caps, and emits a `DraftDelta { section: 'medicine' }` carrying the **engine's** numbers.
3. The **server re-checks the engine output byte-for-byte** before persisting the draft — no tolerance; a 20% client override is rejected; any mismatch flags the draft `REVIEW REQUIRED` (which engages the sign-off gate, §8).

**Latency consequence of "context is part of the hash" (§2.2.1):** because the dose engine is weight-driven, `patientContextVersion` includes weight. If the nurse adds/changes weight mid-consult, the hash changes, the speculative draft is correctly superseded, and the next speculation recomputes doses against the new weight. This is why **the missing-weight prompt fires at Generate, not at speculation** — speculation can run on whatever context exists, but the doctor cannot *open review* on a draft whose doses were computed without a weight. (Missing-weight prompt ported verbatim from `prescription-pad.html` `generatePrescription`, sprint-2 ~4915.) Client-side dose adjustments during review also go through the pure engine (`DoseAdjuster` → `DoseEnginePort`), never the AI.

> **TDD gate (release blocker):** golden JS↔TS parity fixtures (≥20 cases — syrups round 0.5 ml, drops 0.1 ml, tablets ¼ tab; caps; bilingual strings) comparing `web/dose-engine.js` against the TS `computeDose`. `sprint-2-saved` ships the port *without* fixtures; closing that gap is mandatory before the engine is trusted in the streaming path (`backend_services.md` §5.3, owned by `../09_engineering_discipline/`).

---

## 7. Prompt caching — the independent TTFT + cost win

Streaming gives *perceived* progress; prompt caching gives *real* speedup on every model call (time-to-first-token and per-call cost), which directly shortens the M2/M3 windows.

| Rule | Detail |
|---|---|
| **Render order** | `tools → system → messages` (the API's cache prefix order). |
| **Freeze the prefix** | tool defs in deterministic order + skill `core_prompt.md` + pre-embedded NABH block. Place `cache_control:{type:"ephemeral"}` on the **last system block**. |
| **Volatile content after the breakpoint** | the note, allergies, `patient_id`, tool results go **after** the cache breakpoint so they never invalidate the cached prefix. |
| **No timestamps/UUIDs/correlation-ids in the prefix** | this is also why §2.2.1's content hash excludes them — a per-request unique string in the prefix poisons both the prompt cache and the draft cache. |
| **Pre-warm** | `max_tokens:0` priming call on worker boot so the first real generation already hits a warm cache. |
| **Minimum prefix** | Opus 4.8 minimum cacheable prefix = **4096 tokens**; the skill prompt clears it. **Audit `usage.cache_read_input_tokens != 0`** across requests (recorded in `prescription_audit`). |

(Full prompt/tool/caching internals: `../05_ai/`. This file only notes that caching compounds with M1–M4.)

---

## 8. The sign-off interaction (where latency meets clinical safety)

Latency design ends, and the safety invariant begins, at sign-off. The whole point of making the draft *appear instantly* is to give the doctor more time to *review*, never to nudge them toward rubber-stamping. The sign-off interaction is designed so speed never erodes scrutiny.

### 8.1 The state machine is the safety spine (pure `transition()`)

The prescribing lifecycle is governed by the same pure `transition(state, event)` pattern as the `dis/` OCR state machine (`origin/feat/dis-plan:dis/src/core/state-machine.ts`). Invalid transitions **throw and are NEVER persisted** — every path, including failures and supersedes, routes through `transition()`.

```
note_captured ─▶ generating ─▶ streaming ─▶ draft_ready ─▶ doctor_editing ─▶ signed ─▶ printed
                     │             │             │              │
                     └─────────────┴─────────────┴── superseded (newer content hash)
                     └─────────────┴─────────────┴── failed     (audited, never finalized)
```

```ts
// core/generation.statemachine.ts  (pure — mirrors dis/ state-machine.ts)
export type RxState =
  | 'note_captured' | 'generating' | 'streaming' | 'draft_ready'
  | 'doctor_editing' | 'signed' | 'printed' | 'superseded' | 'failed';

export type RxEvent =
  | { kind: 'request_generation'; actor: Actor }      // human click | speculative | AI agent — SYMMETRIC
  | { kind: 'stream_started' } | { kind: 'draft_ready' }
  | { kind: 'edit'; actor: Actor }                    // any doctor edit → doctor_editing (re-arms the gate)
  | { kind: 'supersede'; new_hash: string }
  | { kind: 'sign_off'; actor: Actor; ack: SignoffAck } // ONLY a human; carries severity acknowledgements
  | { kind: 'print' }
  | { kind: 'fail'; reason: string };

export class InvalidRxTransitionError extends Error { readonly code = 'INVALID_STATE_TRANSITION'; /* … */ }
export function transition(state: RxState, event: RxEvent): RxState; // throws on illegal (e.g. draft_ready --print--> )
```

**Clinical-safety invariant, enforced as code:** there is **no transition from `draft_ready`/`streaming`/`doctor_editing` to `signed` except via a `sign_off` event whose `actor.type === 'human'`.** Speculation, streaming, and async jobs can produce `draft_ready` autonomously; **only a human `SignOff` reaches `signed`.** A future autonomous "AI-drafts-then-doctor-signs" mode is an additive subscriber emitting `request_generation` — it still cannot emit `sign_off` on a human's behalf (§9).

### 8.2 The `SignoffGate` interaction (severity-aware, re-armed on every edit)

Ported verbatim from `sprint-2-saved`'s `applySignoffGate()`, re-homed into the `<SignoffGate>` component:

| Draft severity | Gate behavior |
|---|---|
| **High** (or any `REVIEW REQUIRED` from the dose-engine recheck) | **Sign-off disabled** until the doctor ticks an explicit acknowledgement checkbox per flagged item. No color-only signaling (text + icon — WCAG 2.2 AA). |
| **Moderate** | Caution banner; sign-off enabled but the doctor must scroll past the banner (no dismiss-without-read). |
| **Low / none** | Sign-off enabled. |

**Critical re-arm rule:** the gate is **re-applied after *any* edit** so a `high → edit → save` sequence can never bypass an acknowledgement (the `transition` to `doctor_editing` re-evaluates severity and re-arms the gate). This closes the prototype-era bypass where editing a flagged line silently cleared the gate.

### 8.3 Provenance honesty (the "draft — confirm" contract)

Because drafts can be **speculative** (generated before the doctor's last keystroke), the UI is explicit about provenance:

- AI-generated lines are **visually distinct** from clinician edits (no color-only distinction).
- A speculative draft opens with a **"draft — please confirm"** badge; confirming or editing re-validates the hash.
- The printed Rx carries an **"AI-assisted, doctor-reviewed"** line — the doctor's signature attests review, and the audit trail (§5.2) records that it was reviewed and by whom.

### 8.4 Staleness guard at sign-off (the one place latency could bite safety)

The single risk of speculation is **signing a draft that predates the doctor's final note edit.** The guard:

> At the moment of `SignOff`, the gate **re-checks `hash(currentNote) == draft.content_hash`.** If stale (`state → stale`), **sign-off is blocked**, the doctor sees "your note changed since this draft — regenerate", and a fresh job is enqueued. A doctor can **never** sign a draft that does not match the note currently on screen.

This makes the speculative optimization *safe by construction*: the worst outcome of an over-eager speculation is a forced regenerate, never a mismatched signature.

### 8.5 Sign-off never blocks on ABDM/FHIR

`SignOff` writes `signed` + the content-hash seal (immutable; edits create new `prescribing.rx_versions` rows) and emits `PrescriptionSigned` to `ops.outbox` **in the same transaction**, then returns. Print auto-opens immediately (single `<PrintDocument>` renderer). The ABDM service (process C) consumes `PrescriptionSigned` asynchronously to build the FHIR bundle and push to ABDM — a slow or unavailable ABDM gateway can never stall the doctor's sign-off or print (`backend_services.md` §7, `../07_integrations/`).

---

## 9. Symmetric actors — why this latency design survives the AI-first future

The latency mechanisms are built on the **command bus**, where humans and AI emit the *same* `Command` envelope. This is load-bearing for the *next* product phase, not just this one.

```ts
interface Command<K, P> {
  kind: K;                 // "RequestGeneration" | "DraftNoteUpdated" | "SignOff" | …
  payload: P;              // Zod-validated
  actor: { type: 'human' | 'ai_agent' | 'system'; id: string; role: string };
  facility_id: string;
  idempotency_key: string; correlation_id: string; occurred_at: string;
}
```

- **Speculation is already a symmetric command.** `DraftNoteUpdated` (autosave) and `RequestGeneration` (click) are *indistinguishable* to the worker — which is precisely *why* speculation works: the background pre-generation and the explicit click run the identical path and produce the identical `draft_ready`. The "click" is just a `RequestGeneration` whose `actor.type === 'human'`; the "speculation" is one whose trigger was an autosave.
- **Going AI-first = an additive subscriber.** An autonomous agent that emits `RequestGeneration` on its own (and, in a fully-autonomous future, requests `SignOff`) is a *new subscriber* — no existing handler, port, schema, or latency mechanism changes. The fail-closed gate (§8.1) still requires `actor.type === 'human'` on `sign_off`, so even an autonomous drafter cannot self-sign until policy explicitly grants it.

The latency design is therefore not a one-off hack for "doctor types, then clicks"; it is the *general* shape of "an actor wants a draft, and a draft is produced and gated" — which is exactly the AI-first shape.

---

## 10. The perceived-wait budget (decisive targets)

These are the numbers the system is built and gated against. "Perceived wait" is *the doctor's* wait, not the worker's compute time.

| Interaction | Target (perceived) | Mechanism that delivers it |
|---|---|---|
| Note autosave acknowledged ("Saved HH:MM") | ≤ 200 ms | local debounce + `204` no-op dedup (§3) |
| **Click Generate → review opens (speculative hit)** | **≤ 0–100 ms** | M2 warm draft + O(1) `uq_rx_job_ready_hash` lookup |
| Click Generate → first visible content (speculative miss) | ≤ 2 s to first `DraftDelta` | M1 off-edge + M3 streaming + warm prompt cache (§7) |
| Click Generate → full draft (cold, worst case) | streamed; complete when the model completes (no wall) | M1 (no 150 s cap) + M3 progressive render |
| `POST /generate` HTTP response | ≤ 50 ms (`202`) | M4 async — never blocks on the model |
| Speculative draft ready *before* click (typical consult ≥ 60 s of note time) | draft ready by click | M2 overlaps generation with the consult |
| SignOff → print auto-opens | ≤ 300 ms | §8.5 — ABDM/FHIR async, off the path |
| **Infinite spinner** | **never** | `GenerationPort` hard deadline → degraded UI (§2.5) |

**Worker-side compute time (50–150 s) is explicitly *not* a doctor-facing target** — the entire design moves it off the critical path. It is tracked (`latency_ms`, `prescription_audit`) for cost/ops, not for UX. Generation eval (frozen pediatric fixture set: dosing within rounding rules, NABH fields present, no PII leakage, JSON-schema conformance, safety invariants) and `GenerationPort` state-contract tests are CI gates owned by `../09_engineering_discipline/`.

---

## 11. Build order for the latency subsystem (within the larger phased migration)

This file's deliverables, in dependency order (the full program order is `overview.md` §9 / `backend_services.md` §10):

1. **Off-edge worker + Postgres queue (M1).** Stand up `workers/generation.worker.ts` consuming `ops.jobs` (the `dis/` `M004` lease/`SKIP LOCKED` pattern). Delete the Edge-Function tool loop and every 150 s-survival hack. *Unblocks everything.*
2. **Streaming + SSE (M3).** `adapters/anthropic` → `GenerationEvent` domain events → generalize the `dis/` `StatusChannel` → Gateway `GET /jobs/{id}/events` SSE relay + status-row poll fallback. Replace the cosmetic `msgs[]` rotator with progressive render.
3. **Async job + `202` + read model (M4 + §5).** `POST /generate → 202 {job_id}`; `prescribing.rx_generation_jobs` + `uq_rx_job_ready_hash`; `GenerationPort` state machine (§2.5) with AbortController + hard deadline.
4. **Content hash + speculation policy (M2 + §2.2 + §3).** `core/content-hash.ts`, `core/speculation-policy.ts`; rewire autosave to `DraftNoteUpdated` with `204` dedup; last-write-wins supersede at enqueue *and* at lease.
5. **Sign-off interaction (§8).** Pure `generation.statemachine.ts` `transition()`; `<SignoffGate>` (severity-aware, re-armed on edit); staleness guard at sign-off; `PrescriptionSigned` → `ops.outbox` (ABDM async).
6. **Shadow rollout.** Run speculative generation in **shadow**, diff drafts against legacy Edge output, behind the feature-flag ladder (`ENABLED → SHADOW → OPT_IN_OPERATORS → *`) + kill-switch, before cutover.

---

## 12. Key source references (branch-qualified)

- **Latency-fix foundation (`origin/feat/dis-plan`):**
  - `dis/src/core/state-machine.ts` — the pure `transition(state, event)` pattern reused for the prescribing lifecycle (§8.1)
  - `dis/src/http/realtime/status-channel.ts` — the `StatusChannel` / `StatusChangedEvent` generalized to `GenerationEvent` (§2.3, §11)
  - `dis/src/ports/queue.ts` + `dis/migrations/M004_dis_jobs.sql` — the durable queue / lease / `SKIP LOCKED` pattern (§5.1, M1)
  - `dis/src/http/routes/{ingest,process-job}.ts` — thin Hono route + `202`-enqueue + idempotency template (§4, M4)
  - `dis/scripts/fitness-rules.json` — extend with `core_no_model_id_literals`, `core_no_arithmetic_in_generation`
- **Clinical brain (`origin/sprint-2-saved`):**
  - `supabase/functions/_shared/dose-engine.ts` — the pure `DoseEnginePort` in the streaming path (§6)
  - `supabase/functions/generate-prescription/index.ts` — `compute_doses`, three-tier severity, `applySignoffGate` source (§6, §8.2); **also the 150 s flaw** (loop ~700–804, hardcoded `claude-sonnet-4-6` ~711/832, 50 s abort ~694)
  - `…/20260428001000_prescription_audit.sql` — one-row-per-attempt audit ported to `prescribing.prescription_audit` (§5.2)
- **Prototype (port-from, then retire) (`E:\…\radhakishan-prescription-system`):**
  - `supabase/functions/generate-prescription/index.ts` — the synchronous 150 s flaw being designed out (§1; `main` AbortController 120 s line 501, model line 518)
  - `web/prescription-pad.html` — `setupAutoSave`/`saveNote` (autosave → `DraftNoteUpdated`, §3, ~3905–3964), `generatePrescription` (missing-weight prompt + sections, §6, ~4915–4985), the cosmetic `msgs[]` rotator being replaced by streaming (§2.3)
  - `web/dose-engine.js` — dosing source of truth; golden parity fixtures gate (§6)
  - `console-log.md:15-16` — the `HTTP 546` at `150,000 ms` evidence (§1)
- **Sibling specs (do not duplicate):** `overview.md` (system map), `backend_services.md` (service decomposition), `frontend_architecture.md` (client ports/components), `frontend_design_system.md` (tokens), `../05_ai/*` (prompt/tool/caching internals), `../06_api/*` (OpenAPI/SSE contract), `../07_integrations/*` (ABDM/FHIR), `../09_engineering_discipline/*` (TDD/eval runner & gates).
```