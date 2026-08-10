# Epic F Sign-off Checklist

Epic F — Observability, Clinical Safety, Chaos, Runbooks. Final wrap-up checklist generated 2026-04-22 by DIS-175.

## Observability tickets

| Ticket  | Title                          | Handoff path              | Status     |
| ------- | ------------------------------ | ------------------------- | ---------- |
| DIS-146 | pino logger                    | dis/handoffs/DIS-146.md   | merged     |
| DIS-147 | OTel tracing                   | dis/handoffs/DIS-147.md   | merged     |
| DIS-148 | Metrics                        | dis/handoffs/DIS-148.md   | merged     |
| DIS-149 | Cost ledger                    | dis/handoffs/DIS-149.md   | merged     |
| DIS-150 | Alert webhook                  | dis/handoffs/DIS-150.md   | merged     |
| DIS-160 | Health deep endpoint           | dis/handoffs/DIS-160.md   | merged     |
| DIS-161 | PII redactor (CS-8)            | dis/handoffs/DIS-161.md   | merged     |
| DIS-162 | Audit integrity (CS-5)         | dis/handoffs/DIS-162.md   | merged     |
| DIS-164 | Trace sampling                 | dis/handoffs/DIS-164.md   | merged     |

## Clinical safety + chaos tickets

| Ticket  | Title                                          | Handoff path            | Status  |
| ------- | ---------------------------------------------- | ----------------------- | ------- |
| DIS-151 | Clinical safety guard — dosing bounds (CS-1)   | dis/handoffs/DIS-151.md | merged  |
| DIS-152 | Clinical safety guard — allergy check (CS-2)   | dis/handoffs/DIS-152.md | merged  |
| DIS-159 | Clinical safety guard — interaction check (CS-3) | dis/handoffs/DIS-159.md | merged  |
| DIS-165 | Clinical safety guard — renal bands (CS-4)     | dis/handoffs/DIS-165.md | merged  |
| DIS-166 | Chaos test — Claude API timeout                | dis/handoffs/DIS-166.md | merged  |
| DIS-167 | Chaos test — Supabase outage                   | dis/handoffs/DIS-167.md | merged  |
| DIS-170 | Clinician dry-run harness (CS-6)               | dis/handoffs/DIS-170.md | merged  |
| DIS-172 | Chaos test — OCR timeout                       | dis/handoffs/DIS-172.md | merged  |
| DIS-173 | Chaos test — Storage rate-limit                | dis/handoffs/DIS-173.md | merged  |

## Runbooks + docs

| Ticket  | Title                                      | Handoff path            | Status  |
| ------- | ------------------------------------------ | ----------------------- | ------- |
| DIS-153 | Runbook — ingestion pipeline failure       | dis/handoffs/DIS-153.md | merged  |
| DIS-154 | Runbook — Claude API outage                | dis/handoffs/DIS-154.md | merged  |
| DIS-155 | Runbook — Supabase outage                  | dis/handoffs/DIS-155.md | merged  |
| DIS-156 | Runbook — PII leak response                | dis/handoffs/DIS-156.md | merged  |
| DIS-157 | Runbook — cost spike response              | dis/handoffs/DIS-157.md | merged  |
| DIS-158 | Runbook — audit integrity breach           | dis/handoffs/DIS-158.md | merged  |
| DIS-169 | Security review checklist                  | dis/handoffs/DIS-169.md | merged  |
| DIS-174 | Ops handbook — on-call rotation            | dis/handoffs/DIS-174.md | merged  |

## HELD (pending user confirmation on staging Supabase project)

| Ticket  | Title                                      | Handoff path | Status |
| ------- | ------------------------------------------ | ------------ | ------ |
| DIS-145 | Apply M-001..M-008 to staging              | —            | HELD   |
| DIS-163 | Backup verify dry-run (staging)            | —            | HELD   |
| DIS-168 | Load test harness (staging)                | —            | HELD   |
| DIS-171 | Migration rehearsal (staging)              | —            | HELD   |

## Sign-off

- [ ] Architect review (batched Gate 6a for CS-tagged tickets: DIS-151, 152, 159, 161, 162, 165, 170)
- [ ] Clinician review (DIS-170 dry-run report)
- [ ] Security review (DIS-169 checklist)
- [ ] Load capacity confirmed (deferred pending DIS-168)
- [ ] Ready for Epic G integration (pending user GO)

## Notes

- All 26 non-staging Epic F tickets are merged to `feat/dis-plan`.
- 4 staging-dependent tickets (DIS-145, 163, 168, 171) are held awaiting user confirmation that the staging Supabase project is provisioned and isolated from production.
- CS-tagged tickets (clinical safety) require batched architect review at Gate 6a before Epic G kickoff.
- Epic G integration blocked on: (a) architect sign-off above, (b) clinician dry-run sign-off, (c) security checklist sign-off, (d) user GO.
