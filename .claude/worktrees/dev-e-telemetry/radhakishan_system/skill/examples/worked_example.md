# Complete Worked Example — Radhakishan Hospital

## COMPLETE WORKED EXAMPLE

**Doctor's note:** "Arjun, 8 months, 7.2 kg boy. Fever 3 days, pulling left ear. No allergy. Diagnosis: acute otitis media. Add paracetamol for fever."

**Doctor selected:** 1, 3 (Investigations + Vaccination status)

**Expected JSON output:**

```json
{
  "patient": {
    "name": "Arjun",
    "age": "8 months",
    "dob": "",
    "sex": "Male",
    "weight_kg": 7.2,
    "height_cm": null,
    "hc_cm": null,
    "guardian": ""
  },
  "vitals": {
    "temp_f": "101.2",
    "hr_per_min": null,
    "rr_per_min": null,
    "spo2_pct": null
  },
  "chief_complaints": "Fever for 3 days, pulling at left ear, irritable, decreased appetite",
  "clinical_history": "8-month-old male presenting with fever for 3 days (measured up to 101.2°F), progressive left ear pulling, associated irritability and decreased appetite. No vomiting, no diarrhoea, no rash, no seizures. No prior episodes. No recent antibiotic use.",
  "examination": "Febrile to touch. Left tympanic membrane bulging and erythematous. Right TM normal. Throat mildly congested. Chest clear bilaterally. Abdomen soft, non-tender. No rash. Well hydrated.",
  "neonatal": null,
  "diagnosis": [
    { "name": "Acute Otitis Media", "icd10": "H66.90", "type": "provisional" }
  ],
  "triage_score": 1,
  "triage_action": "Routine OPD",
  "medicines": [
    {
      "number": 1,
      "row1_en": "AMOXICILLIN SUSPENSION (250 mg / 5 ml)",
      "row2_en": "4 ml orally three times a day for 7 days. Give with or after food.",
      "row3_hi": "4 ml (लगभग एक चम्मच से कम) दिन में 3 बार 7 दिन तक खाने के बाद दें।",
      "calc": "80 mg/kg/day × 7.2 kg = 576 mg/day ÷ 3 = 192 mg/dose. 250 mg/5 ml → 3.84 ml → rounded to 4 ml",
      "flag": "",
      "dose_mg_per_kg": 80,
      "dose_per_day_divided": 3,
      "concentration_mg": 250,
      "concentration_per_ml": 5,
      "max_dose_single_mg": 1000,
      "formulation": "syrup",
      "method": "weight"
    },
    {
      "number": 2,
      "row1_en": "PARACETAMOL SUSPENSION (120 mg / 5 ml)",
      "row2_en": "4.5 ml orally every 6 hours as needed for fever. Do not give if temp < 38°C. Max 4 doses/day.",
      "row3_hi": "4.5 ml (लगभग एक चम्मच) बुखार होने पर हर 6 घंटे में मुँह से दें। 38°C से कम तापमान पर न दें। दिन में 4 बार से ज़्यादा न दें।",
      "calc": "15 mg/kg × 7.2 kg = 108 mg/dose. 120 mg/5 ml → 4.5 ml",
      "flag": "",
      "dose_mg_per_kg": 15,
      "dose_per_day_divided": 4,
      "concentration_mg": 120,
      "concentration_per_ml": 5,
      "max_dose_single_mg": 1000,
      "formulation": "syrup",
      "method": "weight"
    }
  ],
  "investigations": [
    {
      "name": "CBC with differential",
      "indication": "Fever >3 days, rule out bacterial infection",
      "urgency": "same-day"
    }
  ],
  "iv_fluids": [],
  "growth": null,
  "vaccinations": {
    "schedule_used": "IAP2024",
    "due": ["OPV 2 (due at 9 months)"],
    "overdue": [],
    "next_due": "MMR 1 + TCV 1 at 9 months",
    "notes": "All vaccines up to date per IAP 2024 schedule. OPV 2 due at 9 months."
  },
  "developmental": null,
  "diet": null,
  "counselling": [
    "Complete the full 7-day antibiotic course",
    "Danger signs explained"
  ],
  "referral": "",
  "safety": {
    "allergy_note": "NKDA",
    "interactions": "None found (Amoxicillin + Paracetamol — no interaction)",
    "max_dose_check": [
      {
        "drug": "AMOXICILLIN",
        "calculated_dose_mg": 192,
        "max_allowed_mg": 1000,
        "status": "PASS"
      },
      {
        "drug": "PARACETAMOL",
        "calculated_dose_mg": 108,
        "max_allowed_mg": 1000,
        "status": "PASS"
      }
    ],
    "flags": [],
    "overall_status": "SAFE"
  },
  "followup_days": 3,
  "doctor_notes": "Review in 3 days. If no improvement or worsening, consider tympanocentesis referral.",
  "nabh_compliant": true
}
```

Note: In actual output, do NOT wrap in markdown code fences. Output raw JSON directly.
