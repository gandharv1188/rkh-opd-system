# AI Implementation Audit

_Last updated: 2026-04-28_

## Executive Summary

The AI prescription generation system was audited on 2026-04-28. The IO investigation that prompted this work (see docs 09 and 10) was a performance issue. This audit found something different: a small number of clinical safety risks in how the AI's output is trusted by the front-end. None are bugs in the AI per se; they are gaps in the validation layer between the AI and the prescription that the doctor signs.

## Top 3 Things to Fix This Week

1. **CRITICAL-3 — Computed `overall_status` (smallest fix, biggest safety win).** Add ~10 lines of JS in `renderReview()` that re-derive the overall safety status from actual `max_dose_check`, `allergy_note`, and `interactions` data. Override whatever the model wrote. Show "REVIEW REQUIRED" in red with a confirm dialog before sign-off.
2. **CRITICAL-1 + CRITICAL-2 — DoseEngine cross-validation.** After the AI returns a prescription, run each medicine's dose through `web/dose-engine.js` and flag any discrepancy >20%. Also change the formulary-not-found fallback message from "use clinical training knowledge" to "DO NOT dose from memory; flag REVIEW REQUIRED."
3. **MEDIUM-1 — Fallback mode banner.** When the Edge Function returns `meta.mode === "fallback-single-shot"`, show a prominent red warning in the UI and require manual confirmation before sign-off.

---

## Bucket 1 — Clinical Safety

### CRITICAL-1: The AI is the sole dose calculator — DoseEngine never validates AI output

| Field | Detail |
| --- | --- |
| Severity | Critical |
| Where | `web/dose-engine.js` (whole file); `web/prescription-pad.html` lines 5034-5100 (`renderReview`); `supabase/functions/generate-prescription/index.ts` lines 738-759 |
| What's wrong | `dose-engine.js` is documented as "source of truth" but is only invoked when the doctor manually clicks "Adjust dose". The primary Generate path renders the AI's raw `row2_en`, `row3_hi`, `calc`, and dose numbers directly via `esc()`. The engine is never called to cross-check. |
| Why it matters | A neonate weighing 2.1 kg dosed at "adult mental math" for gentamicin could receive a 5-10x overdose. The doctor reviews the displayed output, not the calculation trace, and may not spot a factor-of-10 error in a 3-row bilingual card. |
| Suggested fix | After `extractJSON()` returns, for each medicine entry that has `weight_kg`, `dose_mg_per_kg`, `concentration_mg`, `concentration_per_ml`, and `formulation` populated, call `DoseEngine.computeDose()` and compare its result against the AI's `row2_en` dose. If discrepancy >20%, override with DoseEngine's value and set flag: "Dose recalculated by DoseEngine — AI value differed". |

### CRITICAL-2: `get_formulary` explicitly tells the model to fall back to mental math when a drug is not found

| Field | Detail |
| --- | --- |
| Severity | Critical |
| Where | `supabase/functions/generate-prescription/index.ts` line 308 |
| What's wrong | When formulary lookup fails, the function returns: `"No formulary entries found for: {names}. Use your clinical training knowledge for dosing."` This is the exact failure mode in project memory — model dosing from training data, often with wrong Indian concentrations. |
| Why it matters | An aminoglycoside or anticonvulsant dosed from memory at a wrong concentration can cause severe harm. The doctor has no signal this happened. |
| Suggested fix | Replace the message with: `"No formulary entry found for: {names}. DO NOT dose from memory. Set overall_status to REVIEW REQUIRED and flag that formulary data is missing for this drug. Ask the doctor to verify the dose manually."` |

### CRITICAL-3: `overall_status` is a free-text string the model generates — never computed or validated

| Field | Detail |
| --- | --- |
| Severity | Critical |
| Where | `supabase/functions/generate-prescription/index.ts` lines 658-678 (`extractJSON`); `web/prescription-pad.html` line 3496 |
| What's wrong | `overall_status` is whatever string the model outputs. No code computes it from actual check results. The model can write "SAFE" while `max_dose_check` entries are FLAGGED. UI defaults to "SAFE" if field missing: `esc(r.safety.overall_status || "SAFE")`. |
| Why it matters | This is the doctor's primary go/no-go signal. Internally inconsistent output (flagged max dose, status "SAFE") gives false confidence. Empty-string default makes it worse. |
| Suggested fix | In `renderReview()`, compute programmatically — if any `max_dose_check[].status === "FLAGGED"` or `allergy_note` contains "ALLERGY", force `overall_status = "REVIEW REQUIRED"` with red background, regardless of model output. |

### HIGH-1: Missing patient weight is silently passed to the model with no guard

| Field | Detail |
| --- | --- |
| Severity | High |
| Where | `web/prescription-pad.html` lines 4898-4914 (`generatePrescription`) |
| What's wrong | `weight_kg` is not validated before sending to the AI. Model may guess or use historical weight. |
| Why it matters | 4 kg infant vs 14 kg toddler differ 3.5x in weight-based doses. |
| Suggested fix | Block Generate if `selectedPatient.visit.weight_kg` is absent. Show: "Weight not recorded — enter weight before generating prescription." |

### HIGH-2: Hindi text in `row3_hi` is unvalidated — model can output ASCII claiming it is Devanagari

| Field | Detail |
| --- | --- |
| Severity | High |
| Where | `web/prescription-pad.html` lines 5107-5109 |
| What's wrong | `row3_hi` is rendered after `esc()` with no Devanagari Unicode check (U+0900-U+097F). No font fallback if Noto Sans CDN is blocked. |
| Why it matters | Hindi row is the primary dosing communication for low-literacy parents. Wrong Hindi = wrong dose at home. |
| Suggested fix | Validate `/[ऀ-ॿ]/.test(row3_hi)`. If false, set error placeholder + REVIEW REQUIRED. Add local Devanagari font fallback. |

### HIGH-3: Preterm corrected vs chronological age is in prompt only — not enforced in code

| Field | Detail |
| --- | --- |
| Severity | High |
| Where | `radhakishan_system/skill/core_prompt.md` lines 355-356 |
| What's wrong | The rule "corrected age for growth, chronological age for vaccinations" is stated but never structurally enforced. Model must compute corrected age itself. |
| Why it matters | Wrong corrected age for a 28-weeker means wrong vaccinations, wrong growth Z-scores. |
| Suggested fix | When neonatal chip is active (DOB <90d or GA <37wk), include explicitly computed corrected age + chronological age as structured fields in the clinical note. |

### MEDIUM-1 (clinically elevated): `singleShotFallback` strips all tools — safety checks skipped silently

| Field | Detail |
| --- | --- |
| Severity | High (clinical context) |
| Where | `supabase/functions/generate-prescription/index.ts` lines 614-654 |
| What's wrong | When tool-use loop fails (timeout, outage), the fallback runs single-shot with no tools. Model relies entirely on training memory. Returned with `meta.mode: "fallback-single-shot"` but no UI warning. |
| Why it matters | Worst possible output (pure model mental math) is delivered silently to the doctor. |
| Suggested fix | In front-end response handler (~line 4926), if `data.meta?.mode === "fallback-single-shot"`, show prominent red banner: "Warning: AI fallback mode — formulary data unavailable. All doses must be verified manually before signing." Refuse `is_approved` save in fallback mode. |

---

## Bucket 2 — Prompt Engineering

### HIGH-4: No Anthropic prompt caching — full token cost on every call

| Field | Detail |
| --- | --- |
| Severity | High |
| Where | `supabase/functions/generate-prescription/index.ts` lines 510-525 |
| What's wrong | No `anthropic-beta: prompt-caching-2024-07-31` header. System prompt not wrapped with `cache_control`. `core_prompt.md` + `nabh_compliance.md` is ~500+ lines on every call. |
| Why it matters | ~90% cost saving missed on input tokens for the system portion on cache hits. |
| Suggested fix | Add the beta header. Restructure system as `[{type:"text", text: corePrompt, cache_control:{type:"ephemeral"}}]`. |

### MEDIUM-2: `get_formulary` tool description does not match the new `ingredient_doses` data structure

| Field | Detail |
| --- | --- |
| Severity | Medium |
| Where | `supabase/functions/generate-prescription/index.ts` lines 75-87 |
| What's wrong | Description references old scalar `dose_min`/`dose_max` while `condenseDrugForAI` returns `ingredient_doses[]`. |
| Why it matters | Model may misread which field is the limiting ingredient's dose. |
| Suggested fix | Update description to mirror condensed output, including `ingredient_doses[].is_limiting` as the signal. |

### MEDIUM-3: `get_standard_rx` has no required fields — model can call with empty input

| Field | Detail |
| --- | --- |
| Severity | Medium |
| Where | `supabase/functions/generate-prescription/index.ts` line 107: `"required": []` |
| What's wrong | Model can call `get_standard_rx({})` and get "No hospital protocol found", proceeding without the protocol. |
| Why it matters | Doctor loses the hospital's preferred first-line therapy as a guardrail. |
| Suggested fix | Set `"required": ["icd10"]` or add a pre-call guard returning an error. |

### LOW-1: Temperature not set — defaults to 1.0 for Sonnet

| Field | Detail |
| --- | --- |
| Severity | Medium (despite "LOW" label, clinical work warrants this) |
| Where | `supabase/functions/generate-prescription/index.ts` lines 516-523 |
| What's wrong | No `temperature` field. Default 1.0 produces unnecessary variance for clinical dosing. |
| Why it matters | Repeated calls for the same patient can yield different doses. |
| Suggested fix | Set `temperature: 0.2` for the main loop. Also for the fallback single-shot. |

---

## Bucket 3 — Architecture / Robustness

### HIGH-5: In-memory cache has no TTL and may serve stale skill files

| Field | Detail |
| --- | --- |
| Severity | Medium |
| Where | `supabase/functions/generate-prescription/index.ts` lines 29-38 |
| What's wrong | `cache` object caches Storage fetches with no TTL or version check. Updates to `core_prompt.md` may not take effect until isolate restart. |
| Why it matters | Updating safety rules, max doses, or Hindi text in references has unpredictable propagation time. |
| Suggested fix | Add 15-minute TTL to `fetchCached`. Log when a cache hit is served so logs reveal staleness. |

### MEDIUM-4: `patient_id` logged plaintext in Edge Function logs

| Field | Detail |
| --- | --- |
| Severity | Medium |
| Where | `supabase/functions/generate-prescription/index.ts` line 429 |
| What's wrong | `console.log` includes full `JSON.stringify(input)` which includes `patient_id` for `get_previous_rx` and `get_lab_history`. |
| Why it matters | Pediatric UHID-level logging in retained logs accessible to platform admins is PHI exposure. |
| Suggested fix | Mask: `patient_id.slice(0,3) + "***"` or omit. |

### MEDIUM-5: No idempotency — clicking Generate twice can race

| Field | Detail |
| --- | --- |
| Severity | Medium |
| Where | `web/prescription-pad.html` line 4876, 4961 |
| What's wrong | Generate button is disabled during call but re-enabled on error. A timeout that resolves after re-enable can cause two concurrent calls. |
| Why it matters | Two prescriptions can be generated for one visit, with the second overwriting the first silently. |
| Suggested fix | Use in-flight flag (`let generating = false`) checked at entry, cleared in `finally` block, independent of button state. |

---

## Bucket 4 — Code Quality

### LOW-2: `formulary_context` and `std_rx_context` received but never used

| Field | Detail |
| --- | --- |
| Severity | Low |
| Where | `supabase/functions/generate-prescription/index.ts` lines 694-699 |
| What's wrong | Destructured from request body, never referenced. Dead code from pre-tool-use architecture. |
| Why it matters | Confuses future maintainers; suggests context the model isn't actually receiving. |
| Suggested fix | Remove from destructuring. Document the migration to tool-use. |

### LOW-3: Hardcoded Supabase anon key in Edge Function source

| Field | Detail |
| --- | --- |
| Severity | Low |
| Where | `supabase/functions/generate-prescription/index.ts` lines 15-16 |
| What's wrong | Anon key embedded in source. Public by design but anti-pattern; rotation breaks function silently. |
| Why it matters | Key rotation requires a code redeploy rather than a secret update. |
| Suggested fix | Read from `Deno.env.get("SUPABASE_ANON_KEY")`. Document as required secret. |

### LOW-4: Contradictory rounding rules for drops between two reference files

| Field | Detail |
| --- | --- |
| Severity | Medium |
| Where | `radhakishan_system/skill/references/dosing_methods.md` line 69 vs `radhakishan_system/skill/core_prompt.md` line 342 |
| What's wrong | `dosing_methods.md` says drops → "Nearest 0.1 ml". `core_prompt.md` says drops → "ALWAYS prescribe in NUMBER OF DROPS, never in ml. 1 ml = 20 drops, round to whole drop." |
| Why it matters | Model fetching `dosing_methods.md` gets different rule than embedded core. Inconsistent output. |
| Suggested fix | Update `dosing_methods.md` to match `core_prompt.md`: drops always integer counts, never mL. |

---

## Closing Note

None of these are emergencies — the system has been running and generating prescriptions that doctors review and sign. But the CRITICAL items represent paths where a single AI mistake could reach the printed prescription without an independent check. Fixing CRITICAL-3 (10 lines of JS) closes the largest gap with the smallest change. The DoseEngine cross-validation (CRITICAL-1 + CRITICAL-2) is the next-most-impactful structural fix. After those two, the system has a defense-in-depth posture matching the responsibility it carries.
