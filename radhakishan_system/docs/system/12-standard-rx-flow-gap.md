# 12 — Standard Rx flow: design intent vs. actual behaviour

> A focused trace of how the "Std Rx" chip in the Prescription Pad is wired,
> what the AI actually does with standard protocols, and why this combination
> is producing prescriptions with extra drugs the doctor never asked for.
>
> _Last updated: 2026-04-28_

This document follows the same shape as `09-findings-and-action-plan.md` and
`11-ai-implementation-audit.md`: trace the code, name the gap, show the
evidence, then recommend a fix.

---

## Section 1 — Designed flow (what the doctor expected)

The product owner's mental model of the "Std Rx" / "Standard Prescription"
control was:

1. The doctor sees a chip / button labelled **Std Rx** on the prescription
   pad.
2. The doctor either toggles it on, or selects a specific standard
   prescription (linked to an ICD-10 / diagnosis name) from the hospital's
   `standard_prescriptions` table.
3. On **Generate**, that selected standard prescription is sent **as
   explicit context** to the AI — i.e. the front-end says to the model:
   "the doctor has chosen *this* protocol, here are its first-line drugs,
   build the prescription around them."
4. The AI treats those drugs as **the doctor's intent**, not as a
   free-floating reference. Without the chip / selection, the AI does **not**
   pull a protocol on its own.

In short: standard-Rx selection is a deliberate, doctor-driven act, and the
AI is downstream of that act.

---

## Section 2 — Actual flow (what the code does)

The actual wiring is very different, and there are three independent paths
by which a standard protocol can end up driving the prescription. Only one
of them is under the doctor's control.

### 2.1 The "Std Rx" chip is a 1-bit nudge, not a selector

The chip itself is defined here:

- `web/prescription-pad.html:1910–1918` — `<div class="mod-chip on" id="chip-stdrx" onclick="toggleMod('stdrx')">Std Rx</div>`.
- The chip is part of an "Include in prescription" group of toggle chips
  (alongside Investigations, Vaccination, Growth, Diet, etc.).
- It is **on by default**: `web/prescription-pad.html:2157`
  (`activeMods = new Set(["inv", "stdrx", "growth"])`), and is re-added to
  the active set every time a patient is selected (`:3983`) and on the new-Rx
  reset path (`:7581`).
- `toggleMod('stdrx')` (`:4754`) just adds/removes the string `"stdrx"` from
  the `activeMods` set. It does **not** open a modal, does not let the
  doctor pick a protocol, and does not fetch anything.

There is no "select a standard prescription" UI on the prescription pad.
The hospital's standard prescriptions are managed on the separate page
`web/standard-rx.html`, which has no `postMessage`, no `window.open`, and no
bridge back to the pad — confirmed by grepping `postMessage|prescription-pad|opener|window\.open` in that file (no matches). Standard-rx.html is an
admin/CRUD page, not a selector that hands a protocol to the pad.

So the chip is a binary: "include standard Rx instructions in the prompt, or
don't." It carries no payload.

### 2.2 What the chip does at Generate time

When the doctor presses Generate, `generatePrescription()` runs at
`web/prescription-pad.html:4844`. The relevant lines are:

- `:4851` — `const sections = getSelectedSections();`
- `:4788–4807` — `getSelectedSections()` maps each active chip to a sentence.
  For `stdrx` the sentence is hard-coded:

  > `"USE STANDARD PRESCRIPTION — include ALL first-line drugs from the hospital standard protocol for this diagnosis. Do not omit any protocol drug."`

  (`web/prescription-pad.html:4790–4791`.)
- `:4852–4855` — that sentence is concatenated onto the doctor's clinical
  note as `INCLUDE THESE SECTIONS: ...`.
- `:4868` — `fullNote = note + sectionsNote + langNote + summaryNote`.
- `:4899–4903` — the POST body is exactly:

  ```js
  { clinical_note: fullNote, patient_allergies, patient_id }
  ```

  There is **no** `std_rx_context`, **no** `selected_standard_rx`, **no**
  `protocol_context` field. Nothing about *which* protocol — just a sentence
  saying "use the standard prescription for this diagnosis."

The chip therefore does one thing only: when on, it appends an English
sentence to the prompt that **instructs the AI to include every first-line
drug from the protocol**. When off, that sentence is missing — but, as we
will see in 2.4, the AI fetches and uses the protocol anyway.

### 2.3 The Edge Function destructures `std_rx_context` but it is never sent

In `supabase/functions/generate-prescription/index.ts:693–699`:

```ts
const {
  clinical_note,
  formulary_context,
  std_rx_context,
  patient_allergies,
  patient_id,
} = await req.json();
```

`std_rx_context` and `formulary_context` are destructured. They are then
**never referenced again** anywhere in the file (verified by grep:
`std_rx|standard_rx|protocol_context|selected_standard` returns no further
matches in the Edge Function for read use; the only later occurrence of
`get_standard_rx` is the tool definition and the executor switch case).

So even if the front-end were to populate `std_rx_context`, it would be
silently discarded. This is dead code from an earlier design.

### 2.4 The AI is told to fetch the protocol on every diagnosis

The system prompt the Edge Function loads is `core_prompt.md`. The relevant
instruction (`radhakishan_system/skill/core_prompt.md:9–14, 26`):

- Line 10: *"Always call `get_standard_rx` to fetch the hospital protocol
  for the diagnosis."*
- Line 12: *"If the doctor says 'standard prescription' … include **ALL
  first-line drugs** from the protocol …"*
- Line 13: *"If the doctor names specific drugs … use the protocol for dose
  guidance, investigations, counselling, and warning signs — but do NOT add
  extra drugs the doctor didn't mention."*
- Line 14: *"If the doctor mentions a diagnosis but no specific drugs … use
  the protocol's first-line drugs as the default treatment …"*
- Line 26: *"ALWAYS call `get_standard_rx` with the ICD-10 code …"*

The tool definition (`supabase/functions/generate-prescription/index.ts:90–108`) reinforces it:

> *"ALWAYS call this when a diagnosis is provided."*

So the AI is hard-instructed to fetch the standard protocol any time a
diagnosis is present, **whether or not the chip is on, and whether or not
the doctor referenced a standard**. The chip's only effect is to tip the
model from branch 2.4-line-13 ("don't add drugs the doctor didn't mention")
to branch 2.4-line-12 ("include ALL first-line drugs"). In practice these
branches blur — the model has the protocol's drug list in its context
window and a strong "this is the hospital's pre-approved plan" framing.

---

## Section 3 — The gap

| Step | Designed | Actual |
|---|---|---|
| 1. Pick a protocol | Doctor explicitly selects from `standard_prescriptions` | No selection UI on the pad. Chip is a binary toggle, on by default. |
| 2. Carry the choice | Selected protocol JSON included in POST body as `std_rx_context` | POST body has only `clinical_note`, `patient_allergies`, `patient_id`. No protocol field. |
| 3. Edge Function uses it | Reads `std_rx_context`, injects as `<doctor_selected_protocol>` block in user message | Destructures `std_rx_context` at line 696 and never reads it. Dead code. |
| 4. AI's source of protocol | Only what the doctor selected | AI calls `get_standard_rx` itself — system prompt says "ALWAYS call this when a diagnosis is provided." |
| 5. AI's role | Treats protocol drugs as the doctor's intent | Treats protocol drugs as recommendations to include, especially when the chip nudges it ("include ALL first-line drugs"). |
| 6. Doctor's two-drug note | Two drugs prescribed | Two drugs + the rest of the protocol's first-line drugs. |

Plain reading: the chip is cosmetic, the front-end carries no protocol
payload, the Edge Function would discard one even if sent, and the AI is
auto-fetching protocols on its own and being told to include everything in
them.

---

## Section 4 — Evidence the gap matters

Visit RKH-26270400352 (HETANSHI), prescription RX-260427-018, generated
2026-04-27. The doctor's dictated note (transcribed) was, in essence:

> *"Flomist nasal spray, one puff in each. twice daily for prolonged and
> I'll prescribe Levolin MDI 2 puff 6 hourly to be given for 15 to 20
> days."*

Two drugs explicitly named: Fluticasone (Flomist) nasal spray, and
Levosalbutamol (Levolin) MDI.

The AI emitted six drugs:

1. Fluticasone nasal spray — **doctor asked for it**
2. Levosalbutamol MDI — **doctor asked for it**
3. Levosalbutamol nebulisation — extra
4. Ipratropium nebulisation — extra
5. Budesonide MDI — extra
6. Fexofenadine syrup — extra

The four extras are exactly the drugs that the hospital's standard
pediatric asthma + allergic rhinitis protocol carries as first-line: short-acting
beta-agonist via nebuliser, anticholinergic adjunct, inhaled corticosteroid,
and a non-sedating antihistamine. This is not a coincidence and it is not
dose-engine drift — it is the protocol's drug list being copied into the
output.

This matches what Section 2 predicts: the chip was on (it is on by default),
which fed the AI the line *"include ALL first-line drugs from the hospital
standard protocol for this diagnosis"*; the AI called `get_standard_rx`
because the system prompt tells it to "always" do so; and the model took
"include ALL first-line drugs" literally.

This is the clinical safety gap previously named in the medication-omission
research: the AI is generating drugs the doctor did not order. In a
pediatric setting that is the wrong direction for any error — extra drugs
mean extra dose calculations, extra interactions, extra parental confusion,
and extra cost.

---

## Section 5 — Recommended fix

Three options, ranked.

**Option A — Make `get_standard_rx` user-gated.**
Remove "ALWAYS call when a diagnosis is provided" from `core_prompt.md` and
the tool description. Add a `protocol_requested: true|false` flag (set by
the chip) into the user message. The AI calls `get_standard_rx` only when
the flag is true. Otherwise the AI treats the doctor's note as the complete
list of drugs.

**Option B — Pre-load the protocol from the front-end and remove the AI's
auto-fetch.**
The front-end already has `stdRxCache` populated at page load
(`web/prescription-pad.html:3052–3091`). When the chip is on AND a diagnosis
is identifiable from the note, look up the matching protocol from the cache
and embed it in the POST body inside a `<doctor_selected_protocol>` block
(populating the existing `std_rx_context` field, which the Edge Function
already destructures). Remove `get_standard_rx` from the AI's auto-callable
tool list. The model can no longer go fetch a protocol on its own; if the
front-end didn't put one in the message, there is no protocol.

**Option C — Keep auto-fetch, change the framing.**
Keep `get_standard_rx` as an AI tool. Rewrite the prompt so the protocol is
explicitly *reference-only*: "Use it for dose guidance, investigations,
counselling, warning signs, and ICD-10 / SNOMED codes. Do **not** copy the
drug list. The drug list comes from the doctor's note — only the doctor's
note." Remove the `stdrx` chip's "include ALL first-line drugs" sentence
entirely.

**Recommendation: Option B.** It maps cleanly onto the doctor's mental
model (explicit selection, explicit context, AI is downstream). It removes
the failure mode at the structural level — once the AI cannot reach
`get_standard_rx`, it cannot pull in extra protocol drugs no matter how the
prompt drifts. It also makes the existing `std_rx_context` destructure live
code instead of dead code. Option A is the lighter-touch alternative if the
team is not ready to change the tool surface; it still leaves the AI with a
fetch button it can press in error. Option C is the weakest — it relies on
prompt discipline alone to suppress a behaviour the model is currently very
confidently performing.

This is consistent with the medication-omission / drug-overshoot finding in
the AI implementation audit: when the AI is given a protocol drug list and
told "include ALL first-line drugs," the failure mode is over-prescription,
not under. Removing the AI's path to that drug list is the cleanest cure.

---

## Section 6 — Implementation sketch (Option B)

Not actual code — design only.

**Front-end (`web/prescription-pad.html`)**

- After `:4868` (`fullNote = ...`), if `activeMods.has('stdrx')`:
  - Try to identify an ICD-10 or diagnosis name from the doctor's note (the
    AI does this today; the front-end would need a light heuristic, e.g.,
    walk every key in `stdRxCache` and check for substring match in the
    note; if multiple match, pick the longest match or skip).
  - If a hit, build `std_rx_context = { icd10, diagnosis_name, first_line_drugs, second_line_drugs, investigations, counselling, warning_signs }` from `stdRxCache`.
  - If no hit, leave `std_rx_context` undefined and surface a small chip
    state ("Std Rx · no protocol matched") so the doctor knows the AI is
    flying without a protocol.
- `:4899–4903` payload becomes `{ clinical_note: fullNote, patient_allergies, patient_id, std_rx_context }`.
- Remove the `stdrx` entry from `getSelectedSections()` at `:4790–4791`. The
  protocol payload itself is now the signal; the AI does not need a sentence
  shouting at it.

**Edge Function (`supabase/functions/generate-prescription/index.ts`)**

- After `:723` (`let userMessage = clinical_note;`), append:

  ```text
  if (std_rx_context) userMessage += "\n\n<doctor_selected_protocol>\n" + JSON.stringify(std_rx_context, null, 2) + "\n</doctor_selected_protocol>"
  ```

- Remove `get_standard_rx` from the `tools` array (`:89–109`) and from
  `executeTool` (`:435–436`).
- Optional: keep the executor function but never expose it as a tool, so the
  capability remains for future use.

**Prompt (`radhakishan_system/skill/core_prompt.md`)**

- Replace the `STANDARD PROTOCOL USAGE` section (lines 9–14, 26) with:
  - "If `<doctor_selected_protocol>` is present in the user message, use it
    for dose ranges, investigations, counselling, warning signs, ICD-10,
    and SNOMED codes. The drug list comes from the doctor's note — do not
    add drugs from the protocol that the doctor did not mention. If the
    note explicitly says 'standard prescription' or 'as per protocol' AND a
    protocol is present, you may include all first-line drugs."
  - "If `<doctor_selected_protocol>` is absent, treat the doctor's note as
    the complete list of drugs. You have no protocol available."
- Remove "ALWAYS call `get_standard_rx`" from line 26.

**Validation**

- Re-run the HETANSHI case end-to-end. Expected: two drugs out (Fluticasone,
  Levosalbutamol MDI), zero extras.
- Spot-check three more visits where the doctor named drugs explicitly.
- Spot-check one visit where the doctor types only a diagnosis ("AOM right
  ear, treat as standard"). Expected: full protocol drug list, because the
  note explicitly invoked the standard.
