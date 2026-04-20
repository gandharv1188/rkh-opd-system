# Ticket Template

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

**Files the ticket will touch:**
{exact list — agents may not touch anything else}

- `dis/src/core/foo.ts`
- `dis/tests/unit/foo.test.ts`

**Files the ticket may READ but not write:**
{e.g., `02_architecture/tdd.md`, existing `web/registration.html` for reference only}

**Acceptance criteria (numbered, each testable):**

1. …
2. …
3. …

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
- [ ] Gate 7 DoD

**Status:** Ready | In Progress | Blocked | In Review | Conditional Review | Done
