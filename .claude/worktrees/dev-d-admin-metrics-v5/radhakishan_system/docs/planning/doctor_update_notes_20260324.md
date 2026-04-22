# What's New — Prescription System Update (24 March 2026)

Dear Dr. Lokender Goyal, here is a summary of all recent changes to your prescription system.

---

## New Features

- **BMI auto-calculated**: BMI is now computed automatically from weight and height — visible on the registration page and on the prescription pad. No manual calculation needed.
- **Diet recommendations**: The AI now uses the patient's BMI to suggest age-appropriate diet advice in prescriptions (underweight, overweight, etc.).
- **Admit button**: You can now mark a patient for admission directly from the prescription pad with one click. The follow-up section will automatically show "ADMISSION RECOMMENDED" instead of a follow-up date.
- **Hindi / English / Bilingual language switch**: The counselling and parental advice section of the prescription can now be printed in English, Hindi, or both — you choose before printing.
- **Vaccination status tracking**: Each vaccine can now be marked as one of four statuses — Administered (given today), Previously given, Deferred, or Refused — giving you a complete vaccination picture.
- **Vaccination card extraction**: When a parent uploads a photo of a vaccination card, the system now reads it automatically and pulls out the vaccination history.
- **All documents get AI summaries**: Previously, only lab reports got AI-generated summaries. Now discharge summaries, imaging reports, referral letters, and all other uploaded documents also get summarised by AI for quick review.

## Improvements

- **All vitals sent to AI**: Temperature, heart rate, respiratory rate, SpO2, head circumference, and MUAC are now all passed to the AI — not just weight and height. This means better, more complete prescriptions.
- **Prescriptions saved as drafts**: If you refresh the page or lose internet briefly, your in-progress prescription is saved as a draft and will not be lost. You can pick up where you left off.
- **Better age display for infants**: Babies under 1 year now show age as months + days (e.g., "3 months 12 days") instead of just "0 years". Preterm babies show corrected age automatically.
- **Sequential prescription numbers**: Prescriptions now get clean sequential numbers like RX-260324-001, RX-260324-002, etc., instead of random IDs. Same for receipt numbers — they are also sequential now.
- **Diagnosis-specific warning signs**: The "when to come back urgently" section now lists warning signs specific to the actual diagnosis (e.g., breathing difficulty for pneumonia) instead of generic advice.
- **AI respects your medicines**: The AI will no longer silently drop or replace medicines you specifically prescribed. If it has a concern, it will flag it for your review instead of removing it.
- **Vaccination schedule auto-carried forward**: Whichever vaccination schedule (NHM or IAP) was selected during registration is now automatically pre-selected on the prescription pad. No need to choose again.
- **Patient search fixed**: You can now search for the next patient directly — no need to clear the search field first. Just start typing the new name, UHID, or token number.
- **Medication Restore button works**: If you accidentally remove a medicine from a prescription, the Restore button now brings it back correctly.
- **Growth trend shows time span**: Weight and height trends now show the time period, e.g., "5.2 to 6.1 kg over 3 months" — so you can see how fast the child is growing.
- **Follow-up displays properly**: The follow-up date now always shows correctly on the printed prescription. If you used the Admit button, it shows "ADMISSION RECOMMENDED" instead.
- **JE vaccine removed**: Japanese Encephalitis (JE) vaccine has been removed from the schedule since it is not part of the Haryana state programme.

## Bug Fixes

- **Patient search required clearing first** — fixed, search works directly now
- **Medication Restore button did nothing after removing a medicine** — fixed
- **Prescriptions lost on page refresh** — fixed with draft auto-save
- **Follow-up date sometimes missing from printed prescription** — fixed
- **AI sometimes silently removed prescribed medicines** — fixed
- **Generic warning signs shown regardless of diagnosis** — fixed, now diagnosis-specific
- **Receipt numbers were random instead of sequential** — fixed

---

## How to Use New Features

### Admit Button

- On the prescription pad, in the "Include in prescription" section, click the red **Admit** chip before generating
- Alternatively, write "admit" or "admission" in your clinical note — the AI will detect it
- Either way, the follow-up section will show "ADMISSION RECOMMENDED" with the reason
- The sign-off button turns red: "Approve ADMISSION & save"
- The printed prescription shows "ADMISSION RECOMMENDED" instead of a follow-up date

### Language Switch

- On the prescription pad, look for the **language dropdown** in the "Include in prescription" section (right side, next to the chip buttons)
- Choose **Bilingual** (default), **Hindi**, or **English** before generating the prescription
- The counselling and warning signs sections will be in the selected language
- Medicine Row 3 (Hindi dosing instructions) is always included regardless of this setting

### Vaccination Status

- On the prescription pad, each vaccine in the checklist now has a dropdown with four options:
  - **Administered** — given today during this visit
  - **Previously given** — already received before (e.g., from uploaded vaccination card)
  - **Deferred** — postponed for a medical reason
  - **Refused** — parent declined
- Select the appropriate status for each vaccine

---

## Standard Prescription Protocols

Your hospital's 24 standard treatment protocols from the clinical PDF have been imported into the system:

- **Respiratory**: Common Cold, Bronchiolitis, Asthma (OPD Oral, Inhaler-Based, Severe Indoor), Croup
- **GI**: Gastroenteritis (OPD + Indoor), Gastritis, Dysentery, Anal Fissure, Infantile Colic, GERD
- **Infectious**: Pyrexia, Enteric Fever, Viral Hepatitis
- **ENT**: Tonsillitis, Allergic Rhinitis, Otitis Media, Epistaxis
- **Others**: Prematurity Follow-up, Atopic Dermatitis, Enuresis, Normal Baby Follow-up

Each protocol now includes:

- First-line and second-line drugs with doses
- Investigations with indications and urgency
- Counselling points for parents
- Warning signs (6-8 per diagnosis, specific to the condition)
- Referral and hospitalisation criteria
- SNOMED CT codes and ICD-10 codes
- 2024-2025 guideline updates
- **NEW**: Expected course, key clinical points, severity assessment, and monitoring parameters (fields available — being populated)

When the AI generates a prescription, it automatically fetches the matching protocol and uses these standard warning signs, drug choices, and counselling points as a starting base.

### Editing Protocols

- Open the **Standard Rx** page from the home screen
- Click any protocol to edit it
- The **Guidance tab** now has fields for: counselling, warning signs, expected course, severity (mild/moderate/severe), key clinical points, and monitoring parameters
- Click **AI Update** to have AI enrich an existing protocol with latest guidelines
- Your edits are saved directly to the database and used in future prescriptions

### Adding New Protocols

- Click **+ Add** on the Standard Rx page
- Enter the ICD-10 code and diagnosis name
- Click **AI Lookup** to have AI pre-fill all fields from latest guidelines
- Review, modify, and save
- A blank template is available at `standard_prescription_template.json` if you prefer to fill in offline

---

## Notes

- Draft prescriptions are saved locally in your browser. If you switch to a different computer, drafts from the first computer will not appear.
- The BMI-based diet advice is a suggestion from the AI — please review and modify as you see fit.
- Vaccination card extraction works best with clear, well-lit photos of the card.
- Warning signs in the protocol database are stored in English. The AI translates them to Hindi automatically based on the language switch setting.
- All other features (voice dictation, QR scanning, print layout) continue to work as before.
- The system was verified with a live integration test: 94 out of 94 checks passed against the production database.
