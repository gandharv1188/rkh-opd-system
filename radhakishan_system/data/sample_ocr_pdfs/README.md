# Sample OCR Documents — Bucket Dump

> Downloaded 5 files from the Supabase `documents` bucket for OCR comparison/benchmarking.
> Each entry below includes the already-computed `ocr_summary` (via `process-document` Edge Function — Claude Sonnet 4 Vision) from `visits.attached_documents`.

## Images (0)

_None found in bucket._

## PDFs (5)

### PDF 1 — `pdf_RKH-2627_d8a0ca6f_prescription_1776414004622.pdf`

- **Original path:** `RKH-26270400217/d8a0ca6f-3f95-4e03-9531-9065c7ebe2db/prescription_1776414004622.pdf`
- **Original filename:** NIKUNJ OPD SLIP.pdf
- **Category:** prescription
- **Uploaded:** 2026-04-17T08:20:07.020Z
- **Size:** 1276758 bytes
- **Patient ID:** `RKH-26270400217`
- **Visit ID:** `d8a0ca6f-3f95-4e03-9531-9065c7ebe2db`
- **OCR diagnoses:** `Hyper Reactive Airways (J 44.9)`, `Pyrexia Under Investigation (Z 31.49)`
- **OCR medications:** `Levosalbutamol 1.25 NEBU (Iprasure) 2.5 thrice at 20 mins interval as needed`, `Levosalbutamol-Syrup (Kofsooth) 3.5 ml TDS 15 days`, `Prednisolone 15mg/5ml (Omnacortil Forte) 5 ml BD 5 days`, `Fexofenadine Syrup (Pedal) 7.5 ml BD 10 days`, `Paracetamol 250mg Syrup (Calpo) 3.5 ml TDS 5 days`, `Trumef 100mg 6.5 ml BD 5 days`, `Azithromycin 200 (Azicare) 3.5 ml OD 4 days`
- **Lab values extracted:** 0
- **Vaccinations extracted:** (n/a)

**OCR summary (Claude Sonnet 4 Vision):**

> 1-year 11-month-old male NIKUNJ with UHID 24250003531 presented with persistent fever, cough, and mild congestion. Initial diagnosis was Hyper Reactive Airways (J 44.9), later revised to Pyrexia Under Investigation (Z 31.49). Multiple medications prescribed including bronchodilators, antibiotics, steroids, and antipyretics. Investigations advised include complete hemogram, urine routine, Widal test, Typhidot, and CRP. Follow-up scheduled for 02-Jan-2026.

**Datalab Chandra output (paste below):**

<!-- Paste the raw Markdown returned by Datalab's /convert endpoint (Chandra engine, `accurate` mode) for this PDF between the fences below. Keep the fences so it renders as a code block. -->

```markdown
<!-- paste Datalab Markdown here -->
```

---

### PDF 2 — `pdf_RKH-2627_8e03cee2_discharge_summary_1776410560935.pdf`

- **Original path:** `RKH-26270400215/8e03cee2-62ff-4206-a227-d420cc95cfd5/discharge_summary_1776410560935.pdf`
- **Original filename:** MANKIRAT DISCHARGE SUMMARY.pdf
- **Category:** discharge_summary
- **Uploaded:** 2026-04-17T07:22:44.144Z
- **Size:** 7065489 bytes
- **Patient ID:** `RKH-26270400215`
- **Visit ID:** `8e03cee2-62ff-4206-a227-d420cc95cfd5`
- **OCR diagnoses:** `J18.9 - Pneumonia, unspecified organism (right-sided, resolving)`, `A41.9 - Sepsis, unspecified (resolved)`, `R56.8 - Other and unspecified convulsions (post-infectious seizure disorder)`
- **OCR medications:** `Feropenem 150 mg Every 8 hours 6 days`, `Doxycycline 2.5 mg/kg/dose Every 12 hours 7 days`, `Levetiracetam 2 mL Every 12 hours 2 years`
- **Lab values extracted:** 10
- **Vaccinations extracted:** 0

**OCR summary (Claude Sonnet 4 Vision):**

> 2-year-old male Master Mankirat Kumar was admitted to PICU at Radhakishan Hospital, Kurukshetra on 22-Oct-2025 with severe right-sided pneumonia, sepsis and generalized tonic-clonic seizures, requiring ventilator support and close hemodynamic monitoring. Patient was managed with antibiotics (Levofloxacin, Linezolid, Azithromycin, Doxycycline), steroids, and anticonvulsant therapy (Levetiracetam). Multiple investigations including serial blood work, cultures, imaging studies were performed showing improvement in infection markers and resolution of pneumonia. Patient was successfully extubated on 25-Oct-2025, maintained stable oxygen saturation, became seizure-free and was discharged on 30-Oct-2025 in stable condition with oral medications including Feropenem syrup, Doxycycline capsule, and Levetiracetam syrup.

**Datalab Chandra output (paste below):**

<!-- Paste the raw Markdown returned by Datalab's /convert endpoint (Chandra engine, `accurate` mode) for this PDF between the fences below. Keep the fences so it renders as a code block. -->

```markdown
<!-- paste Datalab Markdown here -->
```

---

### PDF 3 — `pdf_RKH-2627_884e4d69_other_1776409742928.pdf`

- **Original path:** `RKH-26270400214/884e4d69-26a5-4f98-bdca-f565a7f63ffc/other_1776409742928.pdf`
- **Original filename:** RIYAAN OPD SLIP.pdf
- **Category:** other
- **Uploaded:** 2026-04-17T07:09:05.160Z
- **Size:** 2135411 bytes
- **Patient ID:** `RKH-26270400214`
- **Visit ID:** `884e4d69-26a5-4f98-bdca-f565a7f63ffc`
- **OCR diagnoses:** `Acute Gastroenteritis - mild, no dehydration`, `PYREXIA (R 50.9)`
- **OCR medications:** `Cefixime 10 mg/kg/day = 100 mg/day BD 7 days`, `Metronidazole 10 mg/kg/dose = 200 mg TDS 7 days`, `Ondansetron 0.15 mg/kg/dose = 3 mg TDS 3 days`, `Enterogermina 1 ampoule/day OD 7 days`, `ORS As per WHO guideline After every loose stool as needed`, `Zinc Sulfate 20 mg/day OD 14 days`
- **Lab values extracted:** 0
- **Vaccinations extracted:** (n/a)

**OCR summary (Claude Sonnet 4 Vision):**

> 7-year-old male patient Master Riyaan presented to Radhakishan Hospital with acute gastroenteritis manifesting as vomiting, loose stools, and mild fever for 1 day. Clinical examination revealed no signs of dehydration with normal vital signs and systemic examination. The child was diagnosed with acute gastroenteritis - mild, no dehydration. Treatment prescribed includes antibiotics (Cefixime, Metronidazole), antiemetic (Ondansetron), probiotics (Enterogermina), ORS, and Zinc sulfate. Follow-up advised after 3 days or earlier if symptoms worsen.

**Datalab Chandra output (paste below):**

<!-- Paste the raw Markdown returned by Datalab's /convert endpoint (Chandra engine, `accurate` mode) for this PDF between the fences below. Keep the fences so it renders as a code block. -->

```markdown
<!-- paste Datalab Markdown here -->
```

---

### PDF 4 — `pdf_RKH-2627_ce3e8d79_vaccination_card_1776408443392.pdf`

- **Original path:** `RKH-26270400210/ce3e8d79-ed5d-4a88-a767-e1d46bc1667f/vaccination_card_1776408443392.pdf`
- **Original filename:** PARVESH VAC C.pdf
- **Category:** vaccination_card
- **Uploaded:** 2026-04-17T06:47:25.612Z
- **Size:** 1585585 bytes
- **Patient ID:** `RKH-26270400210`
- **Visit ID:** `ce3e8d79-ed5d-4a88-a767-e1d46bc1667f`
- **OCR diagnoses:** (none)
- **OCR medications:** (none)
- **Lab values extracted:** 0
- **Vaccinations extracted:** (n/a)

**OCR summary (Claude Sonnet 4 Vision):**

> Comprehensive immunization schedule chart from Radhakishan Hospital showing vaccination timeline from birth to adolescence. Only three birth vaccines have been documented as given: BCG, OPV-0, and Hepatitis B birth dose, all administered on dates in 2024 with a note indicating 'Given'. The document serves as a tracking template for complete childhood immunization with recommended ages for each vaccine from birth through 18 years.

**Datalab Chandra output (paste below):**

<!-- Paste the raw Markdown returned by Datalab's /convert endpoint (Chandra engine, `accurate` mode) for this PDF between the fences below. Keep the fences so it renders as a code block. -->

```markdown
<!-- paste Datalab Markdown here -->
```

---

### PDF 5 — `pdf_RKH-2627_ce3e8d79_prescription_1776408442786.pdf`

- **Original path:** `RKH-26270400210/ce3e8d79-ed5d-4a88-a767-e1d46bc1667f/prescription_1776408442786.pdf`
- **Original filename:** PARVESH OPD SLIP.pdf
- **Category:** prescription
- **Uploaded:** 2026-04-17T06:47:24.133Z
- **Size:** 560166 bytes
- **Patient ID:** `RKH-26270400210`
- **Visit ID:** `ce3e8d79-ed5d-4a88-a767-e1d46bc1667f`
- **OCR diagnoses:** `Cold`
- **OCR medications:** `Mometasone nasal spray 1 puff twice daily in each nostril continue as advised`, `Syrup Allegra 5 ml every 12 hours 10 days`, `Syrup Kofsooth 3.5 ml 8 hourly 15 days`
- **Lab values extracted:** 0
- **Vaccinations extracted:** (n/a)

**OCR summary (Claude Sonnet 4 Vision):**

> OPD treatment sheet for Yug Saini, an 8-month-old infant (DOB: 06-06-2024) with weight 12.690 kg, height 84 cm, OFC 45.8 cm. Patient presented with cold symptoms on 03.03.2026. Clinical examination showed nasal mucosa pale yellow, chest clinically clear, CNS conscious and alert. Family history notable for allergic rhinitis in maternal uncle. Prescribed medications include mometasone nasal spray, antihistamine syrup, and cough syrup for symptomatic management.

**Datalab Chandra output (paste below):**

<!-- Paste the raw Markdown returned by Datalab's /convert endpoint (Chandra engine, `accurate` mode) for this PDF between the fences below. Keep the fences so it renders as a code block. -->

```markdown
NIKUNJ UHID 24250003531 PUNDRI KAITHAL

26-Dec-2025 12:48 PM

Case No: 58708

Age: 1 Yrs 11.Mths 18 Days/Male | DOB: 08/01/2024

Mobile: 9896520069, Address: Reg. Time 5:00 PM OPD Entry 5:14 PM

Weight: 13.3 Kg [9.65 - 14.4]

Temp: 97 °F

## **Complaints and findings:**

• C/O :

Fever High grade since last night

Cold

Cough

• O/E :

Throat Mild Congestion

chest clinically clear, Nasal mucoa pale yellow

**Diagnosis:** Hyper Reactive Airways (J 44.9)

**Rx**

Period  
Qty

|                                                                                                   |              |               |               |                    |     |
| ------------------------------------------------------------------------------------------------- | ------------ | ------------- | ------------- | ------------------ | --- |
| 1. <b>LEVOSALBUTAMOL I 1.25 NEBU (IPRASURE)</b> [Levosalbutamol sulphate and ipratropium bromide] | 2.5          |               |               |                    |     |
| NEBULIZE THRIICE AT 20 MINTS INTERVAL                                                             |              |               |               |                    |     |
| 2. <b>Sy. LEVOSALBUTAMOL SYRUP (KOFSOOTH)</b> [LEVOSALBUTAMOL, AMBROXOL AND GUAIPHENESIN]         | 3.5 ml (6am) | 3.5 ml (2pm)  | 3.5 ml (10pm) | 15 Days (2 bottle) |     |
| Give thrice daily morning, afternoon, evening                                                     |              |               |               |                    |     |
| 3. <b>Sy. PREDNISOLONE 15MG/5 ML(OMNACORTIL FORTE)</b> [PREDNISOLONE SODIUM PHOSPHATE]            | 5 ml (9am)   | ---           | 5 ml (9pm)    | 5 Days (1 bottle)  |     |
| 4. <b>Sy. FEXOFENADINE SYRUP (PEDAL)</b> [FEXOFENADINE HYDROCHLORIDE]                             | 3.5 ml (6am) | 3.5 ml (12pm) | 3.5 ml (6pm)  | 10 Days (3 bottle) |     |
| One spoon twice daily morning, evening                                                            |              |               |               |                    |     |
| 5. <b>Sy. PARACETAMOL 250 MG SYRUP (CALPO)</b> [PARACETAMOL]                                      | 3.5 ml (6am) | 3.5 ml (12pm) | 3.5 ml (6pm)  | 5 Days (1 bottle)  |     |
| 6. <b>Sy. Trumef 100 mg</b>                                                                       | 6.5 ml (6am) | 6.5 ml (12pm) | 6.5 ml (6pm)  | 5 Days (1 bottle)  |     |
| 7. <b>Sy. AZITHROMYCIN 200 (AZICARE)</b> [Azithromycin ]                                          | 3.5 ml (9am) | ---           | ---           | 4 Days (1 bottle)  |     |

**Next Visit On:** 02-Jan-2026 (Friday)

In case of Emergenc,y contact at 7206029516, 7206013516,01744-251441,270516

**Dr. Lokender Goyal**  
23168 PMC

3

NIKUNJ UHID 24250003531 PUNDRI KAITHAL

31-Dec-2025 01:40 PM

Case No: 58708

Age: 1 Yrs 11 Mths 23 Days/Male | DOB: 08/01/2024

Mobile: 9896520069, Address: Reg. Time 5:00 Pm OPD Entry 5:14 Pm

| Weight       | Height        | BMI       | Temp    |
| ------------ | ------------- | --------- | ------- |
| 13 Kg        | 84.1 Cm       | 18.38 BSA | 97.3 °F |
| [9.8 - 14.7] | [80.1 - 90.5] | 0.55      |         |

## **Complaints and findings:**

• C/O :

Fever persistent  
Cough no relief

• O/E :

Throat Mild Congestion  
chest clinically clear

**Diagnosis:** PYREXIA UNDER INVESTIGATION (Z 31.49)

**Rx**

Period  
Qty

- 1. **LEVOSALBUTAMOL I 1.25 NEBU (IPRASURE)** [Levosalbutamol sulphate and ipratropium bromide] 2.5  
     20 मिनट की इंटरव्यू के दौरान इस विषय को देखें
- 2. **Sy. Trumef 100 mg** 6.5 मिलीलीटर 6.5 मिलीलीटर 6.5 मिलीलीटर 5 दिन  
     6.5 मिलीलीटर 6.5 मिलीलीटर (शाम को 6) (रात को 12) (1 bottle)  
     (सुबह को 6) (दोपहर में 12)
- 3. **Sy. FEXOFENADINE SYRUP (PEDAL)** [FEXOFENADINE HYDROCHLORIDE] --- 7.5 मिलीलीटर 10 दिन  
     7.5 मिलीलीटर (रात को 9) (3 bottle)  
     (सुबह को 9)

## **Investigation Advised:**

WIDAL TEST, Typhidot, CRP QUANTITATIVE, COMPLETE HEAMOGRAM, URINE ROUTINE & MICROSCOPIC

In case of Emergncy contact at 7206029516, 7206013516, 01744-251441, 270516

**Dr. Lokender Goyal**  
23168 PMC

Generated with AXON Software

_Dr. Lakhg open_

OSOLIN NASAL DROPS हर घंटे में 5 बूंदें

ICARVOL PLUS हर 4 घंटे में 1 बूंद तोकर खाली पेट लें
```

---
