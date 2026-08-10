# DIS Comms and Training Plan

> Humans, not code. This document specifies who hears what, when, and
> how they get trained. Every phase transition in `rollout_plan.md`
> has a corresponding section here.
>
> References: `rollout_plan.md`, `feature_flags.md`, `kill_switch.md`,
> `clinical_safety.md`, `01_product/user_stories.md`.

## Audiences

| Audience                  | Who                                                    | What they care about                                                                   |
| ------------------------- | ------------------------------------------------------ | -------------------------------------------------------------------------------------- |
| Reception clerks          | Front-desk staff who upload documents                  | Is the upload button the same? What do I do if it fails?                               |
| Nurses                    | Clinical staff who verify extractions (DIS-US-010…015) | New queue page, side-by-side verification UI, reject reasons                           |
| Treating doctors          | Pediatricians at the OPD                               | Are the labs I see still trustworthy? What does the "AI" badge mean? (DIS-US-020, 021) |
| Hospital admin            | Owner / ops lead                                       | Volume, cost, incidents, rollout progress                                              |
| Engineering               | The build team                                         | Technical detail, flag state, runbooks                                                 |
| Clinical lead (Dr. Goyal) | Sign-off authority per CS-# and RACI                   | Safety posture, incidents, exit-criteria readiness                                     |

## Who needs to know at each phase

### Phase 0 (internal dev + test)

- **Engineering:** full detail.
- **Clinical lead:** informed monthly that Phase 0 is ongoing;
  participates in adversarial fixture review.
- Everyone else: nothing yet.

### Phase 1 (shadow mode)

- **Reception:** email 3 days before go-live — "DIS is running in the
  background. Upload experience is unchanged. Legacy pipeline still
  displays the AI summary as you see today."
- **Nurses:** the same email, with a note that the nurse queue is
  coming in Phase 2.
- **Doctors:** no change to workflow; the lab results they see come
  exclusively from the legacy pipeline or direct manual entry. No
  comms required.
- **Admin:** weekly status report starting week 1 (see format below).
- **Clinical lead:** weekly agreement-metrics review.

### Phase 2 (opt-in)

- **Opted-in reception clerks (2–6 named users):** 1:1 walkthrough,
  20 min. Covers upload, new status badges (⏳ / ✓ / ⚠), retry, and
  "who to call if it looks wrong".
- **Nurses:** mandatory 30-min group training on verification UI
  (see "Nurse training checklist" below). Plus written quick-ref card
  printed for each station.
- **Non-opted-in reception:** "nothing changes for you yet" email.
- **Doctors:** 10-minute standup note — "You may now see a small AI
  badge on some lab rows. These are verified by a nurse before they
  reach you. Treat them like any other lab value; judgement applies."
- **Admin + clinical lead:** daily during week 1, weekly thereafter.

### Phase 3 (default)

- **All reception:** 20-min session, one per shift. Same content as the
  Phase 2 opt-in 1:1. Quick-ref card updated.
- **Nurses:** refresher + focus on edge cases collected during Phase 2
  (illegible docs, duplicate flags, wrong-patient detection).
- **Doctors:** formal bulletin — "DIS is now the default path. Verified
  AI-extracted labs may appear more frequently. The AI badge stays."
- **Admin + clinical lead:** weekly status continues; sign-off meeting
  at the end of the 14-day soak.

### Phase 4 (legacy removal)

- **Engineering** only. Brief note in hospital change log.

---

## Training materials checklist

Everything listed must exist before the relevant phase can begin.

### Reception-clerk pack (before Phase 2 opt-in, before Phase 3 default)

- [ ] 1-page PDF quick-ref: upload flow, status badges, retry button,
      max file size (`DIS_MAX_UPLOAD_MB` = 20 MB), supported formats
      (DIS-US-001).
- [ ] 3-minute screen-recording walkthrough of uploading a typical
      lab report during registration.
- [ ] Troubleshooting cheat-sheet: "What to do if you see ⚠ Needs
      attention" (answer: it's fine, the nurse will handle it).
- [ ] Phone / chat extension for on-call engineer.

### Nurse verification-UI pack (before Phase 2)

- [ ] Written walkthrough of the queue page (DIS-US-010).
- [ ] Screenshots (light + dark) of:
  - Queue page with confidence badges
  - Side-by-side verification view (DIS-US-011)
  - Edit-in-place UI (DIS-US-013)
  - Reject modal with reason codes (DIS-US-014:
    `illegible | wrong_patient | not_medical | duplicate | other`)
  - Duplicate-document banner (DIS-US-015)
- [ ] **5-minute video** end-to-end: nurse logs in, opens queue, picks
      a lab report, compares values, edits one, approves, watches the
      success toast ("Wrote N rows to lab_results").
- [ ] Hands-on practice dataset: 20 fixture documents in a training
      project. Nurses must correctly verify 18/20 and reject the
      2 adversarial ones (wrong-patient and duplicate) before going
      live.
- [ ] Printed quick-ref card per workstation listing:
  - When to edit vs reject
  - Reject reason definitions
  - CS-# rules in plain English ("If you reject, that document cannot
    be used — reception must re-upload.")
  - Who to call for help

### Doctor pack (before Phase 2)

- [ ] 1-paragraph note in the weekly clinical bulletin.
- [ ] Screenshot of the new "AI" badge on a lab row (DIS-US-021) and
      hover state showing verifier name + time.
- [ ] Reminder of CS-12: doctors NEVER see unverified OCR data. The
      prescription pad and `generate-prescription` tool both filter
      `verification_status = 'verified'`.

### Admin pack (before Phase 2)

- [ ] Access to `/admin/metrics` endpoint (DIS-US-030).
- [ ] Walkthrough of the weekly status report template (below).
- [ ] Copy of `kill_switch.md` with contacts filled in.

---

## Rollback announcement template

Used when `DIS_KILL_SWITCH` has been flipped in production.

```
Subject: [DIS] Temporary rollback to legacy document pipeline — <date, HH:MM IST>

Team,

At <HH:MM IST> today, we reverted new document uploads from the
Document Ingestion Service (DIS) to the previous pipeline. This was
done to protect patient safety while we investigate
<one-sentence summary: e.g., "an elevated edit rate on lab
extractions observed since this morning's prompt deploy">.

What this means for you:
- Reception: upload experience is unchanged. Continue as normal.
- Nurses: the verification queue remains open. Please continue to
  verify or reject the <N> items already in the queue. No new items
  will appear until we restore DIS.
- Doctors: no change to the prescription pad. Lab values remain
  accurate; only verified labs are shown, as always.

Timeline:
- <HH:MM> — Signal detected: <metric that tripped>.
- <HH:MM> — Kill switch flipped by <on-call name>.
- <HH:MM> — Legacy confirmed active (all three signals green per
  kill_switch.md).

Next steps:
- RCA document: 09_runbooks/incidents/<date>-dis-killed.md
- Expected shadow-mode re-soak: <hours>
- Clinical-lead sign-off required before DIS returns to service.

Questions → <engineering lead> / <clinical lead>.
```

---

## Clinical-safety-incident escalation path

Triggered when any staff member suspects a CS-# violation (wrong
patient, wrong value, unverified data reaching a doctor, etc.).

```
Reporter (any staff)
  │
  ▼
Nurse on shift / Reception lead            ← first responder
  │  (logs incident in paper ledger + WhatsApp to on-call)
  ▼
On-call engineer                           ← pages within 15 min
  │  (if clinical-safety class: flip kill switch FIRST, investigate SECOND)
  ▼
Engineering lead                           ← called within 30 min
  │
  ▼
Clinical lead (Dr. Lokender Goyal)         ← called within 1 h for any
  │                                          suspected CS-1..CS-12 violation
  ▼
RCA + corrective action + shadow-mode re-soak per kill_switch.md
```

Paging contacts (to be populated before Phase 2):

| Role             | Name               | Phone   | Backup |
| ---------------- | ------------------ | ------- | ------ |
| On-call engineer | TBD                | TBD     | TBD    |
| Engineering lead | TBD                | TBD     | TBD    |
| Clinical lead    | Dr. Lokender Goyal | on file | TBD    |
| Reception lead   | TBD                | TBD     | TBD    |
| Nurse lead       | TBD                | TBD     | TBD    |

No staff member is ever penalised for reporting a suspected incident.
False alarms are expected and useful — they validate the escalation
path.

---

## Weekly status report format (during rollout)

Published every Monday 10:00 IST to `#dis-rollout` and emailed to
admin + clinical lead. Length: ≤ 1 page.

```
## DIS Weekly Status — Week of <date>

**Phase:** <0 / 1 / 2 / 3 / 4>
**Days in phase:** <N>
**Decision this week:** <Hold / Advance to next phase / Rollback>

### Volume
- Uploads routed through DIS: <N>   (vs legacy: <N>)
- Verified extractions: <N>
- Rejected: <N> (breakdown by reason code)
- Failed: <N>

### Metrics vs exit criteria
| Metric | Target | This week | Status |
|--------|--------|-----------|--------|
| P95 end-to-end latency | ≤ 90 s | <value> | ✓ / ✗ |
| Per-document cost | ≤ ₹0.40 | <value> | ✓ / ✗ |
| Edit rate | ≤ 15% (Phase 2) / ≤ 12% (Phase 3) | <value> | ✓ / ✗ |
| Reject rate | ≤ 10% (Phase 2) / ≤ 8% (Phase 3) | <value> | ✓ / ✗ |
| Hard-error rate | ≤ 3% (Phase 1) / ≤ 2% (Phase 3) | <value> | ✓ / ✗ |
| Clinician-audit "verified-but-wrong" | 0 | <value> | ✓ / ✗ |
| Queue depth (business hours) | < 20 | <value> | ✓ / ✗ |

### Incidents
- Kill-switch flips: <count, with summary>
- CS-# incidents: <count, with IDs>
- Near-misses flagged by nurse team: <count>

### Changes this week
- Flag changes (from `dis_config_audit`): <list>
- Prompt or schema changes: <list>
- Opt-in operator list changes: <added / removed>

### Clinician audit (CS-# out-of-band safeguard)
- Extractions sampled: <10>
- Findings: <none / …>

### Next week's plan
- <bullet>
- <bullet>

**Sign-off:** <engineering lead>, <clinical lead>
```

---

## Feedback channels for staff during rollout

- WhatsApp group `RKH DIS Rollout` (reception + nurses + eng + clinical
  lead).
- A clipboard at the nurse station titled "DIS: what went wrong this
  shift" — paper, deliberately low-friction.
- Weekly 15-min standup every Friday for the first 4 weeks of Phase 2.

All feedback items are triaged within one business day and either
logged as a ticket or answered on the thread.

---

## Training completion tracking

A simple spreadsheet maintained by the reception lead and nurse lead:

| Staff | Role | Reception pack done | Nurse pack done | Hands-on 18/20 passed | Cleared for phase |
| ----- | ---- | ------------------- | --------------- | --------------------- | ----------------- |
| …     | …    | <date>              | <date>          | <date>                | 2 / 3             |

No one routes traffic through DIS (Phase 2 opt-in) or is assigned to
the verification queue until their row is complete.
