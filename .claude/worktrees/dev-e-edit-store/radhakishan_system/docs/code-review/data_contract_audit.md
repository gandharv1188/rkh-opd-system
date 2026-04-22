# Data Contract Audit — Frontend ↔ Backend ↔ AI

**Date:** 2026-03-24
**Method:** Static contract analysis — traced every field from frontend to DB to Edge Function to AI and back

---

## Audit Results

### Verified PASS (no issues)

| Contract                                                                      | Status                                                                                                                                                        |
| ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Registration vitals → visits table                                            | PASS — all 11 vital fields saved correctly                                                                                                                    |
| Registration BP fields → visits table                                         | PASS — bp_systolic, bp_diastolic, map_mmhg saved                                                                                                              |
| Prescription pad → reads visits vitals                                        | PASS — all fields in SELECT clause                                                                                                                            |
| Prescription pad → clinical note includes all vitals                          | PASS — ctx string includes weight, height, BMI, temp, HR, RR, SpO2, BP, HC, MUAC                                                                              |
| Prescription pad → Edge Function payload                                      | PASS — clinical_note, patient_allergies, patient_id                                                                                                           |
| Edge Function → Claude tools                                                  | PASS — all 5 tools return correct fields                                                                                                                      |
| Edge Function → get_previous_rx includes admission_recommended, warning_signs | PASS                                                                                                                                                          |
| AI JSON → renderReview() renders all sections                                 | PASS — medicines, investigations, iv_fluids, growth, vaccinations, developmental, diet, referral, neonatal, counselling, warning_signs, admission_recommended |
| AI JSON → printRx() renders all sections                                      | PASS — same as renderReview                                                                                                                                   |
| Print station → admission_recommended, warning_signs                          | PASS — added in latest commit                                                                                                                                 |
| signOff → prescriptions table                                                 | PASS — generated_json, medicines, investigations, vaccinations, growth                                                                                        |
| signOff → visits update                                                       | PASS — diagnosis_codes, clinical_notes, triage_score                                                                                                          |
| signOff → growth_records                                                      | PASS — all z-score fields                                                                                                                                     |
| signOff → vaccinations (given_today + previously_given)                       | PASS                                                                                                                                                          |
| vax_schedule → saved at registration, read at prescription pad                | PASS                                                                                                                                                          |
| Language instruction → passed to AI                                           | PASS                                                                                                                                                          |
| Admit chip → INCLUDE SECTIONS → AI                                            | PASS                                                                                                                                                          |

### Issues Found and Fixed (2026-03-24)

| Issue                                                                                                       | Fix Applied                                   |
| ----------------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| Schema drift: `consultation_fee`, `payment_mode`, `payment_status`, `procedures` missing from committed SQL | Added to visits table in schema SQL           |
| Core prompt vitals schema missing `bp_systolic`, `bp_diastolic`, `map_mmhg`                                 | Added to vitals JSON object in core_prompt.md |

### Known Schema Drift (live DB has columns not in SQL)

The live Supabase database has these columns that were added via ALTER TABLE directly. They are now documented in the committed schema SQL:

- `bp_systolic`, `bp_diastolic`, `map_mmhg` (added earlier)
- `bmi`, `vax_schedule`, `receipt_no` (added in this session)
- `consultation_fee`, `payment_mode`, `payment_status`, `procedures` (added in this commit)

### Unused AI Output Fields (by design)

These fields are generated by the AI but not displayed. They exist in `generated_json` for FHIR/ABDM future use:

- `medicines[].snomed_code`, `medicines[].snomed_display` — for FHIR MedicationRequest
- `medicines[].method`, `medicines[].dose_mg_per_kg`, `medicines[].concentration_*` — for dose verification audit
- `diagnosis[].snomed_code` — for FHIR Condition resource

### False Positives in Initial Audit

The automated audit flagged these as failures, but they were already fixed in earlier commits:

- "Vitals not passed to AI" — FIXED in Section A (ctx string includes all vitals)
- "iv_fluids not rendered" — EXISTS at lines 4498, 5480
- "admission_recommended not in renderReview" — EXISTS at line 4565
- "vax_schedule never retrieved" — EXISTS at line 3085
