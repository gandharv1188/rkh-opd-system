# Setup Guide — Step by Step

## Radhakishan Hospital Prescription System

---

## Prerequisites

- Claude.ai Max Plan (active)
- Chrome browser (for voice dictation)
- Supabase account (free at supabase.com)

---

## Step 1: Supabase Project Setup (15 minutes)

1. Go to supabase.com → Sign up / Log in
2. Click "New Project"
   - Name: Radhakishan Hospital
   - Database Password: choose a strong password
   - Region: Southeast Asia (Singapore) — closest to India
3. Wait ~2 minutes for project to provision
4. Go to SQL Editor (left sidebar)
5. Click "New query"
6. Paste entire contents of `schema/radhakishan_supabase_schema.sql`
7. Click "Run" (Ctrl+Enter)
8. Verify: 7 tables created in Table Editor

### Get your credentials

- Project Settings → API
- Copy: Project URL (https://xxxx.supabase.co)
- Copy: anon/public key (long JWT string starting with eyJ)

### Create Storage bucket

- Storage (left sidebar) → New bucket
- Name: `prescriptions`
- Public: ON
- Click Create

### Configure CORS

- Project Settings → API → CORS
- Add allowed origin: `https://claude.ai`
- Save

---

## Step 2: Claude.ai Project Setup (5 minutes)

1. Go to claude.ai
2. Click "Projects" in sidebar
3. "New Project" → Name: "Radhakishan Hospital Rx"
4. Open project → Project Settings → Custom Instructions
5. Paste entire contents of `skill/radhakishan_prescription_skill.md`
6. Save
7. All conversations and artifacts inside this project will
   automatically use these clinical rules

---

## Step 3: Populate Formulary (30-60 minutes)

### Option A: Import from your JSON file

1. Open Formulary Import Tool artifact in Claude.ai
2. Enter Supabase URL and anon key → Connect
3. Paste your drug JSON array → Parse & Preview
4. Review validation status → Import all

### Option B: Manual entry

1. Open Formulary Manager artifact
2. Connect Supabase
3. Click "+ Add drug" for each drug
4. Fill in Identity, Formulations, Dosing bands, Safety tabs
5. Save

### Minimum recommended drugs to start pilot:

- AMOXICILLIN (suspension 125mg/5ml, 250mg/5ml)
- PARACETAMOL (suspension 120mg/5ml, 250mg/5ml)
- IBUPROFEN (suspension 100mg/5ml)
- AZITHROMYCIN (suspension 200mg/5ml)
- CETIRIZINE (syrup 5mg/5ml)
- SALBUTAMOL (syrup 2mg/5ml + MDI)
- PREDNISOLONE (syrup 5mg/5ml)
- ZINC (suspension 20mg/5ml)
- ORS (sachets)
- ALBENDAZOLE (tablet 400mg)
- GENTAMICIN (injection — for neonatal use)
- PHENOBARBITONE (injection + syrup)

---

## Step 4: Add Standard Prescription Protocols (30-60 minutes)

1. Open Standard Prescriptions Manager artifact
2. Connect Supabase
3. Click "+ Add protocol"
4. Search ICD-10 code or diagnosis name (auto-fills details)
5. Add first-line drugs with doses

### Priority diagnoses to add first (OPD common):

- J06.9 — Acute URTI (fever, viral)
- H66.0 — Acute Otitis Media
- J02.0 — Streptococcal pharyngitis
- J18.9 — Community Acquired Pneumonia (mild)
- A09 — Acute Gastroenteritis
- J45.0 — Asthma exacerbation
- R56.0 — Febrile convulsion
- D50 — Iron Deficiency Anaemia
- B82.0 — Worm infestation
- N39.0 — UTI

---

## Step 5: First Test Run (10 minutes)

1. Open Prescription Pad artifact (radhakishan_connected_prescription_system)
2. Enter Supabase URL + anon key → Connect
3. Verify: "X drugs and Y standard protocols loaded" message appears
4. Type test note:
   ```
   Arjun, 8 months, 7.2 kg boy. Fever 3 days, pulling left ear.
   No allergy. Diagnosis: acute otitis media. Add paracetamol for fever.
   ```
5. Click Generate
6. Verify: Amoxicillin and Paracetamol with correct doses appear
7. Check: Hindi instructions present on Row 3
8. Check: Dose calculation shown
9. Sign off → Verify prescription saved in Supabase Table Editor

---

## Step 6: Register Patients (ongoing)

Patients are registered:

- **Automatically** — when a new prescription is signed off without a selected patient
- **Manually** — via Patient Lookup → "+ New patient"

UHID format: RKH-YYMM##### (e.g. RKH-25260300001 — FY start + FY end + month + 5-digit sequential)

---

## Daily Workflow for Doctors

```
Morning:
1. Open Claude.ai → Radhakishan Hospital Rx project
2. Open Prescription Pad artifact
3. Enter Supabase credentials once (browser remembers session)

For each patient:
1. Search patient by name or UHID (or leave blank for new)
2. Select doctor name (Dr. Lokender / Dr. Swati)
3. Dictate or type clinical note
4. Tick any optional sections needed (investigations, growth, etc.)
5. Click Generate
6. Review prescription — edit any line directly
7. Use "Adjust dose" if weight changed or dose needs tweaking
8. Sign off → prescription auto-saved
9. Click "Send to Output" → Print → Hand to patient

End of day:
- All prescriptions automatically stored in Supabase
- Growth records updated
- Visit history complete
```

---

## Troubleshooting

| Problem             | Solution                                                                 |
| ------------------- | ------------------------------------------------------------------------ |
| "Connection failed" | Check URL format (no trailing slash) and key                             |
| "0 drugs loaded"    | Run SQL schema first; check formulary table exists                       |
| Voice not working   | Use Chrome; allow microphone permission                                  |
| Hindi not showing   | Check Claude API is responding; view raw JSON                            |
| PDF upload fails    | Check Supabase Storage bucket named 'prescriptions' exists and is public |
| CORS error          | Add https://claude.ai to Supabase CORS allowed origins                   |

---

_Radhakishan Hospital Prescription System | Setup Guide | Edition 2026_
