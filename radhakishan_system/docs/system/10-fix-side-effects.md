# 10 — Fix Side Effects (Plain Language)

> Companion document to `09-findings-and-action-plan.md`. Answers the question:
> "Other than fixing the IO problem, what else changes if we apply these fixes?"
>
> _Last updated: 2026-04-28_

You're asking the right question. "Will it work?" is one thing — "what else changes?" is what actually keeps a clinic running. Below is every system effect for each fix, good and bad.

---

## Fix #1 — Disable Supabase Realtime

**What this actually is:** Realtime is Supabase's feature that pushes live updates to your browser when a database row changes (like a chat app showing new messages instantly without refresh). Right now it's switched ON globally but listed for **zero tables** — so it's polling the WAL (the database's change log) every 3 seconds, finding nothing to send, and going back to sleep. Forever.

**The proposed change:** Turn the global Realtime feature OFF in the Supabase dashboard. Replace the one place in your code that tries to use it (`prescription-pad.html` lines ~3100–3189, the today's-patients dropdown) with a simple "refresh every 60 seconds" timer.

### What functionality will change?

| Place in app | Before | After |
|---|---|---|
| Today's patients dropdown on Prescription Pad | Was *supposed* to update live when reception adds a new patient. Doesn't actually work today (subscription connects but never fires because publication is empty). | Refreshes every 60 seconds. New patients appear within a minute. Better than today, because today they don't appear at all until manual reload. |
| Everything else | — | No change. Nothing else uses Realtime. |

### Side effects — the honest list

**Positive:**
- ~95% drop in IO budget — the whole reason we're doing this.
- Today's patients dropdown will actually update for the first time (it doesn't right now).
- One less WebSocket connection per browser tab — reduces the chance of stale connections breaking things during long clinic sessions.
- Cleaner logs — realtime errors stop appearing in the browser console.

**Negative / risk:**
- **If you ever want live updates in the future** (e.g., reception adds a patient → doctor's screen shows them instantly without refresh), you'd need to turn Realtime back on. This is a one-toggle reversal, no data lost, but worth knowing.
- The 60-second poll has a worst case: if reception registers a patient at 10:00:00 and the doctor's dropdown last refreshed at 09:59:55, the doctor sees the patient at 10:00:55 — up to 60 seconds late. In practice, the doctor almost always opens the patient by name search, not the dropdown, so this is theoretical.
- The 60-second poll itself uses a tiny bit of IO (one cheap query per minute per open tab). Trivial — orders of magnitude less than what we save — but it's not literally zero.

**Neutral:**
- The dashboard toggle affects all future tables too. If a future feature needs Realtime, the engineer must remember to turn it back on. Should be noted in `CLAUDE.md`.

---

## Fix #2 — Auto-save dirty check

**What this actually is:** Right now, while a doctor is typing the clinical note, the app saves the note in two ways:

1. **Debounced save:** 3 seconds after the doctor stops typing, save.
2. **Periodic save:** Every 30 seconds, save the whole row to the database — *whether or not* anything changed since last save.

The waste is method #2. If the doctor pauses for 5 minutes (phone call, examining the child), method #2 fires 10 times and saves the same unchanged text 10 times.

**The proposed change:** Before sending the periodic save, compare the current text to the last-saved text. If identical, skip the save. The 30-second timer still runs — it just doesn't always fire a database call.

### What functionality will change?

**Nothing visible to the doctor.** The "Saved HH:MM" indicator in the tab bar will keep updating only when something genuinely changed. The crash-safety guarantee stays the same.

### Side effects — the honest list

**Positive:**
- ~80% fewer writes on `visits.raw_dictation` — the largest write source goes from 12,555 dirty pages over 6 weeks to ~2,500.
- Less WAL bloat → faster Supabase backups, smaller log shipping.
- Less wear on the database's autovacuum cycle on the `visits` table.
- Faster page on the doctor's side — fewer network calls means less risk of network blip causing "Save failed" indicator.

**Negative / risk:**
- **The dirty-check logic must be correct.** If we wrongly think the text is unchanged when it actually changed, we skip a save. Worst case: the next keystroke fires another debounced save anyway, so we lose at most a few seconds of typing in a crash window.
- **String comparison cost** — comparing a long dictation string in JS every 30 seconds is microseconds, negligible.
- If we change the comparison method later (e.g., add a hash), there's a small chance of false-equality on edge characters. Plain string equality (`===`) is safest.

**Neutral:**
- The change is reversible in 2 minutes if any issue.

---

## Fix #3 — Narrow formulary preload

**What this actually is:** When the Prescription Pad loads, it asks Supabase for a list of all 680 drugs with **9 columns of data**. Six of those columns are huge text blobs (interactions, contraindications, black-box warnings, notes, etc.) that the page never displays — they're just sitting in browser memory unused. The AI tool that generates prescriptions still needs all the columns, but it makes its own separate call. The page's preload is wasteful.

**The proposed change:** Page preload asks for only 3 columns (`generic_name`, `formulations`, `dosing_bands`). The other 6 are dropped from that one fetch.

### What functionality will change?

**For the doctor:**
- **Page loads ~80× faster** for the formulary fetch step (164ms → 2ms server-side, plus less network bytes to transfer).
- Drug dropdown / search becomes more responsive on slow internet (clinic on bad day).
- Less memory used in the browser tab — useful on older PCs.

**For prescription generation:**
- **No change.** The AI tool (`get_formulary` inside the Edge Function) still pulls every column it needs. It's a different code path. We did NOT touch that.

### Side effects — the honest list

**Positive:**
- Faster page load (the doctor will feel this immediately).
- Lower CPU on Supabase (less JSON serialization).
- Less data over the wire (faster on mobile / weak Wi-Fi).

**Negative / risk:**
- **If any code on the Prescription Pad reads one of the 6 dropped columns** (e.g., shows interactions as a tooltip on hover), it would silently get `undefined`. We need to grep the file for `.interactions`, `.contraindications`, `.black_box_warnings`, `.notes`, `.snomed_code`, `.snomed_display` before deploying. If anything reads them, we either keep that column or move that feature to a separate on-demand fetch.
- This is a one-line fetch URL change. If we get it wrong, revert is instant.

**Neutral:**
- The IO budget barely moves (~0.5%). Almost the whole win is page snappiness, not IO.

**Verification before deploying:**
- Open the Prescription Pad in Chrome.
- Generate a prescription end-to-end: search a drug → drug appears → AI generates → interaction warning fires → contraindication alert fires → allergy check fires.
- If all those still work with the trimmed preload, ship it.

---

## Fix #4 — Trigram indexes (SKIP)

**What this is:** The original doc proposed adding fancy fuzzy-search indexes on drug/diagnosis/patient names. Each keystroke in a search box currently scans the whole table.

**Why we said skip:** The tables are tiny (drug list = 680 rows in 335 pages of memory). The "scan" is happening entirely in cache, not from disk. Adding an index would speed it up imperceptibly, take some database storage, and require a migration. **Not worth the risk for ~zero IO benefit.**

### Side effect of skipping

- Search stays fast enough for clinic use today.
- If `patients` table grows past 50,000 rows in 2-3 years, **then** we revisit just that one index. Not now.

---

## Combined: what happens after all three fixes ship

**For the doctor and reception staff:**
- Pages feel snappier (Fix #3 — most noticeable).
- Auto-save indicator behaves the same (Fix #2 — invisible).
- Today's patients dropdown actually works for the first time (Fix #1 — small visible win).
- **No clinical workflow changes. No data loss risk. No re-training needed.**

**For Supabase:**
- IO budget warning should clear within 24 hours.
- Database load drops dramatically.
- WAL bloat reduces.
- Backups get smaller.

**For future you:**
- If you ever want live updates (chat-style features, live dashboards) you'll need to flip Realtime back on for the specific tables you want — not a problem, just a flag in your head.
- The autosave dirty-check is one of those "set and forget" wins that pays compounding returns over years.

---

## What I worry about (full disclosure)

1. **Fix #3** — small chance one of the 6 dropped columns is being read somewhere we didn't grep. Five minutes of code search prevents this.
2. **Fix #1** — if a future engineer assumes Realtime is on (because the SDK suggests it), they'll spend an hour debugging why their subscription doesn't fire. A note in `CLAUDE.md` prevents this.
3. **Fix #2** — `===` string comparison on a multi-paragraph dictation is fast enough, but if anyone later replaces it with `JSON.stringify()` of objects with key order issues, false-mismatches could cause excess saves (back to baseline — not worse than today, but the win evaporates). Use plain string equality, not deep equality.

---

_End of side-effects analysis._
