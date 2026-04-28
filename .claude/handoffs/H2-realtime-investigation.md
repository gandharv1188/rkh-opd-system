# H2 — Realtime IO Depletion Investigation

**Status:** Verified (read-only). Confidence: **High**.

## Definitive answer: Is Realtime used by ANY client?

**Partial — exactly one usage, on a table that is NOT in the publication.**

- `web/prescription-pad.html` (lines 3100–3189): opens a raw WebSocket to `/realtime/v1/websocket`, joins topic `realtime:public:visits`, requests `postgres_changes` for INSERTs on `public.visits`. Used to silently refresh the doctor's "today's patients" dropdown when reception registers a new visit.
- No other Realtime usage anywhere — searched all `web/*.html`, `supabase/functions/*/index.ts`, and `radhakishan_system/**/*.{js,ts,html}` for `.channel(`, `.subscribe(`, `supabase.realtime`, `postgres_changes`, `broadcast`, `presence`. Zero hits outside that one file.
- No Edge Function consumes Realtime. The "document ingestion service" referenced in CLAUDE.md is an agentic-team protocol artifact, not a runtime subscriber.

## Tables currently in `supabase_realtime` publication

**ZERO tables.** `SELECT … FROM pg_publication_tables WHERE pubname='supabase_realtime'` returned 0 rows.

The publication exists but is empty. The one client (prescription-pad) is asking the server to push INSERTs on `public.visits`, but `visits` is not in the publication, so it would receive nothing even when connected.

## Active subscription count

`SELECT count(*) FROM realtime.subscription` = **0** at investigation time. No client subscriptions registered in the realtime schema.

## Replication slots

One active logical slot: `supabase_realtime_messages_replication_slot_v2_86_3_1` (plugin `pgoutput`, active=true). This is the Supabase-managed slot used by the Realtime service for broadcast/presence message replay — created automatically by the platform regardless of publication contents.

## Why pg_stat_statements still shows 1.1M `realtime.subscription` polling calls

The Realtime service polls `realtime.subscription` continuously to discover client subscription rows, independent of whether any client is connected and independent of publication contents. The polling load is intrinsic to the Realtime service running on the project — not driven by app traffic. With 0 subscribers and 0 published tables, those 1.1M+ calls and 4,312 sec of total time are pure overhead producing no value.

## Recommendation

**Safe to drop the publication entirely (or leave empty — same effect).** The single client subscription on `public.visits` is already non-functional (table not published), so removing/disabling Realtime breaks nothing observable. To eliminate the Realtime polling load you must **disable the Realtime service for the project in the Supabase dashboard** — DDL alone (DROP PUBLICATION) will not stop the service from polling `realtime.subscription`.

If Realtime is kept on:
- Do NOT add `visits` (or any other table) to the publication. WAL decode + RLS-per-row evaluation will multiply the IO problem.
- Replace the prescription-pad WebSocket with a 30–60 sec `setInterval(loadTodayPatients, 60000)` poll. This is what the code already silently falls back to (the WS never delivers messages today).

## Risk assessment

- **prescription-pad "today's patients" auto-refresh**: already broken (no publication). Switching to a 60 sec poll is strictly better than current behavior. Doctor still sees new visits within 1 minute. **Low risk.**
- **No other features touch Realtime.** ABDM, FHIR, Edge Functions, Print Station, registration — all use plain REST. **No collateral risk.**

## Files referenced

- `E:/projects/AI-Enabled HMIS/radhakishan-prescription-system-folder/radhakishan-prescription-system/web/prescription-pad.html` (lines 3100–3189)
- `E:/projects/AI-Enabled HMIS/radhakishan-prescription-system-folder/radhakishan-prescription-system/.claude/worktrees/h2-realtime/sql/` (SQL artifacts used)
