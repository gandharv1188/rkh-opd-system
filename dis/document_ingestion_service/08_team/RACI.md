# Team & RACI

> DIS is executed agentically. Humans hold veto authority on safety-tagged
> tickets and on the integration gate. The matrix below makes that
> explicit.

## Roles

| Role                                | Filled by                                                      | Primary responsibility                                                                                 |
| ----------------------------------- | -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| **Product Owner (PO)**              | Dr. Lokender Goyal (user)                                      | Scope, prioritization, clinical sign-off on phases                                                     |
| **Architect / Tech Lead / QA Lead** | Claude (orchestrator)                                          | Owns TDD, ticket backlog, review gates, DoD enforcement                                                |
| **Clinical Reviewer**               | Dr. Lokender Goyal (and any designated co-clinician)           | Second human review on every `clinical-safety` ticket; weekly sample audit                             |
| **Backend Agent(s)**                | `general-purpose` or `feature-dev:code-architect`              | Implement tickets in `dis/src/core/`, `dis/src/adapters/`, migrations                                  |
| **Frontend Agent**                  | `general-purpose` + `frontend-design:frontend-design`          | Verification UI (new page, not registration/pad)                                                       |
| **QA Agent**                        | `general-purpose`                                              | Write unit + integration + clinical-acceptance tests first (TDD)                                       |
| **SRE / Ops Agent**                 | `general-purpose`                                              | Runbooks, CI, monitoring, deploy automation                                                            |
| **Port Validator**                  | `agent-sdk-dev:agent-sdk-verifier-ts` or equivalent lint agent | Enforce "core imports no adapter" rule on every PR                                                     |
| **Security Reviewer**               | `/security-review` skill agent + human on demand               | Key handling, RLS policies, CI secret scans                                                            |
| **Integration Gatekeeper**          | Dr. Lokender Goyal (user)                                      | **Sole** authority to approve any ticket that modifies `web/`, existing Edge Functions, or live schema |

## RACI matrix

**R** = Responsible (does the work) · **A** = Accountable (owns outcome) · **C** = Consulted · **I** = Informed

| Activity                                 | PO      | Architect | Clinical Rev.      | Backend | Frontend | QA    | SRE   | Security | Integration Gate |
| ---------------------------------------- | ------- | --------- | ------------------ | ------- | -------- | ----- | ----- | -------- | ---------------- |
| Set scope & priorities                   | **A**   | R         | C                  | I       | I        | I     | I     | I        | —                |
| Write / change TDD                       | C       | **A**/R   | C                  | C       | C        | C     | C     | C        | —                |
| Implement a core/adapter ticket          | I       | A         | —                  | **R**   | —        | C     | —     | —        | —                |
| Implement verification UI ticket         | I       | A         | C                  | —       | **R**    | C     | —     | —        | —                |
| Write tests for a ticket                 | I       | A         | —                  | C       | C        | **R** | —     | —        | —                |
| Review clinical-safety ticket            | C       | A         | **R** (veto)       | C       | C        | C     | —     | —        | —                |
| Approve integration with existing system | **R**/A | C         | C                  | —       | —        | —     | —     | —        | **R** (gate)     |
| Migration dry-run / apply                | I       | A         | —                  | R       | —        | R     | **R** | —        | —                |
| Key rotation                             | I       | A         | —                  | —       | —        | —     | **R** | C        | —                |
| Security review                          | I       | A         | —                  | C       | C        | C     | C     | **R**    | —                |
| Rollout phase advance                    | **R**/A | R         | C (veto on safety) | I       | I        | C     | C     | I        | I                |
| Incident response                        | I       | A         | C (if clinical)    | R       | R        | R     | **R** | C        | —                |
| Weekly clinical audit                    | A       | I         | **R**              | —       | —        | —     | —     | —        | —                |

## Review gates (binding on every ticket)

See `08_team/review_gates.md` for the full checklist. Summary:

1. **Pre-start:** ticket has acceptance criteria, dependencies resolved, TDD reference.
2. **Test-first:** a failing test is committed before implementation starts.
3. **Code review:** another agent OR a human reviews the PR.
4. **Clinical-safety gate** (tickets tagged `clinical-safety`): human clinician signs off. **No exceptions.**
5. **Integration gate** (tickets tagged `integration`): user's explicit written approval required in the PR thread. **No exceptions.**
6. **Port validator:** automated check — core must not import any adapter.
7. **CI gate:** tests pass, migrations round-trip, no secrets in diff.
8. **DoD:** acceptance criteria checked, docs updated, changelog entry added.

## Ticket tags that alter the review path

| Tag               | Effect                                                                        |
| ----------------- | ----------------------------------------------------------------------------- |
| `clinical-safety` | Requires Clinical Reviewer sign-off (RACI row R). Maps to one of CS-1..CS-12. |
| `integration`     | Requires Integration Gatekeeper (user) sign-off. Cannot be auto-merged.       |
| `migration`       | Requires SRE + Architect joint review; includes CI round-trip test.           |
| `security`        | Requires Security Reviewer sign-off.                                          |
| `breaking`        | Requires ADR + Architect sign-off.                                            |
| `doc-only`        | No test requirement; still goes through code review.                          |

## Escalation

- **Blocked ticket > 24 h:** agent opens a clarification in `07_tickets/clarifications/`; Architect responds within 4 h business hours.
- **Clinical-safety concern raised mid-ticket:** stop immediately, escalate to Clinical Reviewer before any further commit.
- **Suspected data leak / key exposure:** trigger `09_runbooks/incident_response.md` SEV1 path; page Security Reviewer.

## Out-of-band duties

- **Weekly clinical audit:** Clinical Reviewer samples 10 verified extractions each Monday and compares to source. Results logged in `dis/audits/YYYY-WW.md`. Two consecutive weeks with >10% error rate triggers an investigation ticket.
- **Monthly cost review:** PO + Architect review `dis_cost_ledger`. If cost/doc exceeds target by 25%, open an optimization ticket.
- **Quarterly DR drill:** SRE executes `09_runbooks/dr_and_backup.md` restore procedure. Drill outcome logged.

## Hand-offs with the existing team

- **Reception clerk:** trained on new "Processing / Ready for review" status badge during opt-in phase. Training material in `06_rollout/comms_and_training.md`.
- **Nurse / verifier:** trained on the verification UI before opt-in. Dedicated onboarding session (recorded).
- **Doctor:** informed of the `AI` badge on lab rows. No training required; the badge is a passive indicator.
- **Admin / IT:** runbooks live in `09_runbooks/`; on-call rotation defined when we have > 1 admin.
