# Ticket Template — Verify-Driven

> Tickets in this repo follow **Verify-Driven Ticketing**. Every
> acceptance criterion has a machine-checkable `VERIFY:` step. No
> prose-only criteria. See
> [`../05_testing/verify_format.md`](../05_testing/verify_format.md)
> for the binding spec.

Every ticket copies this template into `backlog.md` (or into
`integration_hold.md` if `integration`-tagged).

---

### DIS-{ID} — {one-line summary}

- **Tags:** {comma-separated from 07_tickets/README.md}
- **Epic:** {A–H}
- **Depends on:** {DIS-###, …} or `none`
- **Blocks:** {DIS-###, …} or `none`
- **TDD ref:** {§§ from 02_architecture/tdd.md}
- **Clinical-safety ref:** {CS-## if applicable}
- **User-story ref:** {DIS-US-### if applicable}
- **Estimated effort:** {S / M / L — S = half-day, M = 1-2 days, L = 3-5 days}

**Description:**
{2-4 sentences. What, not how. Link to surrounding context.}

**Files allowed (exhaustive):**
CI rejects any PR that writes files outside this list (enforced from Wave 3+).

```yaml
files_allowed:
  - dis/src/core/foo.ts
  - dis/tests/unit/foo.test.ts
```

**Files the ticket may READ but not write:**
{e.g., `02_architecture/tdd.md`, existing `web/registration.html` for reference only}

**VERIFY (numbered machine-checkable steps, each completable in <5 min):**

Each step must be a copy-pasteable shell command with a literal
expected output (or regex). No prose acceptance criteria. A reviewer
re-runs these verbatim; the agent pastes actual outputs in the handoff
Verify report (see `../05_testing/verify_format.md` §2).

```
VERIFY-1: {one-line description of what is being proved}
  Command:  <exact shell command, copy-pasteable>
  Expect:   <literal expected output OR /regex/>
  Pass if:  <one-line pass criterion>

VERIFY-2: {…}
  Command:  …
  Expect:   …
  Pass if:  …

VERIFY-3: {…}
  Command:  …
  Expect:   …
  Pass if:  …
```

Example (delete when filling in):

```
VERIFY-1: dis/package.json declares "type": "module"
  Command:  grep '"type"' dis/package.json
  Expect:   "type": "module",
  Pass if:  grep exits 0 AND output contains the literal string above
```

**Out of scope (explicit — new tickets, not silent cuts):**

- …
- …

**Test plan:**

- Unit: {what's tested}
- Integration: {what's tested}
- Clinical acceptance: {CS-## mapped}

**Notes / gotchas:**
{optional — prior attempts, known pitfalls, non-obvious constraints}

**Review gates applicable:**

- [ ] Gate 1 Pre-start
- [ ] Gate 2 Test-first (skip only if `doc-only`)
- [ ] Gate 4 Automated checks
- [ ] Gate 5 Code review
- [ ] Gate 6a Clinical-safety (if tagged)
- [ ] Gate 6b Integration (if tagged — user approval required)
- [ ] Gate 6c Security (if tagged)
- [ ] Gate 6d Breaking (if tagged)
- [ ] Gate 7 DoD (includes session handoff file — see `../08_team/session_handoff.md`)
- [ ] VERIFY block present with ≥3 steps
- [ ] Every VERIFY step is a shell command (no prose)
- [ ] All VERIFY outputs pasted in the handoff (see `../08_team/session_handoff.md` §3)
- [ ] `files_allowed` list matches actual PR diff (CI-enforced from Wave 3+)

**Status:** Ready | In Progress | Blocked | In Review | Conditional Review | Done
