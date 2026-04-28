# H1 — Formulary SELECT * IO Hot-Spot Investigation

**Confidence:** **High** that narrowing the top query is safe and yields the biggest single win.

## What pg_stat_statements shows (top 5 formulary queries)

| # | Calls | Mean ms | Total sec | Cols selected | Where issued |
|---|------:|--------:|---------:|---|---|
| 1 | **1,597** | 978 | **1,562** | 9 cols incl. `dosing_bands`, `formulations`, `contraindications`, `interactions`, `black_box_warnings`, `notes`, `snomed_code`, `snomed_display`, `generic_name` | `web/prescription-pad.html:3057` (preloadKnowledge) |
| 2 | 255 | 572 | 146 | **22 cols** (full clinical payload) | `supabase/functions/generate-prescription/index.ts:272` (Strategy 2 fallback) |
| 3 | 943 | 144 | 136 | 7 cols (older preload variant, missing snomed_*) | older `prescription-pad.html` preload, now superseded |
| 4 | 173 | 287 | 50 | 22 cols + ilike OR (4 names) | `index.ts:253` (get_formulary tool, 4 drugs) |
| 5 | 152 | 247 | 38 | 22 cols + ilike OR (3 names) | `index.ts:253` (get_formulary tool, 3 drugs) |

Q1 alone is **78% of formulary IO time** (1,562 of ~1,930 sec).

## Per-query column usage audit

### Query 1 — `prescription-pad.html:3057` preloadKnowledge (the giant)
Fires once per page load, returns ALL ~530 active drugs with 9 columns including 4 large JSONB blobs. Stored in `formularyCache` keyed by generic_name. Used downstream:

| Column | Actually used? | Where |
|---|---|---|
| `generic_name` | YES | cache key, search list |
| `formulations` | YES | dose calc, form picker, brand match (lines 2220-2280, 2432, 5194, 7164) |
| `dosing_bands` | YES | `lookupDosing` (line 2863, 2876) |
| `contraindications` | **NO** | not referenced anywhere in prescription-pad |
| `interactions` | **NO** | not referenced anywhere in prescription-pad |
| `black_box_warnings` | **NO** | not referenced anywhere in prescription-pad |
| `notes` | **NO** | not referenced anywhere in prescription-pad |
| `snomed_code` | **NO** | not referenced anywhere in prescription-pad |
| `snomed_display` | **NO** | not referenced anywhere in prescription-pad |

Plus `brand_names` is **read at line 7156** but NOT selected — already silently undefined today (latent bug, unrelated to IO).

**4 of 9 columns are dead weight** — including the 4 biggest JSONB columns. Safety data (interactions, contraindications, BBW) is correctly fetched on-demand by the AI via `get_formulary` tool, so the preload doesn't need it.

### Query 2/4/5 — `generate-prescription/index.ts:243-315` get_formulary tool
22 columns selected, then run through `condenseDrugForAI` (line 176) before returning to Claude. Audit of condenser:
- Reads but ignores: `category`, `therapeutic_use` (NOT in selectCols, always undefined — latent bug)
- Reads & passes through: all 22 selected columns, conditionally
- `brand_names` is used at lines 281, 289 for fallback brand search before condense — must keep.

All 22 are actively used. Strategy-2 fallback (Q2) fetches **all active drugs** with full payload to client-side filter brand_names — this is a separate concern but only fires when Strategy 1 misses (255 calls vs 1597, less impactful).

## Top recommendation

**Narrow Query 1 first.** Drop `contraindications`, `interactions`, `black_box_warnings`, `notes`, `snomed_code`, `snomed_display` from the `prescription-pad.html:3057` SELECT. Keep `generic_name, formulations, dosing_bands` (and consider adding `brand_names` to fix the latent bug at line 7156). Expected impact: ≥70% reduction in formulary IO budget — those 4 JSONB blobs are the bulk of row width.

**Second win:** Replace Strategy-2 in `index.ts:272` (fetch-all-drugs to filter brand_names client-side) with a server-side `brand_names=cs.{...}` PostgREST array contains filter, or a small RPC. This eliminates the 22-column full-table scan.

## Risks / things to verify before narrowing

1. **No dynamic field access** detected — all reads are static `drug.fieldName`. Safe to drop columns.
2. The 4 dropped columns ARE still available to the AI via the `get_formulary` tool (which keeps the 22-col select). No clinical loss.
3. Latent bug: `brand_names` is read in prescription-pad but never selected. Narrowing won't break it (already broken). Optional fix: add `brand_names` to the slim select.
4. Latent bug in `condenseDrugForAI`: reads `category` / `therapeutic_use` that aren't in selectCols. Out of scope for IO fix but worth flagging.
5. Q3 (older 7-col variant, 943 calls, 136 sec) appears to be from a previous deploy still in cache stats — will age out naturally, no action needed.

## Files for reference (absolute)
- `E:/projects/AI-Enabled HMIS/radhakishan-prescription-system-folder/radhakishan-prescription-system/web/prescription-pad.html` (line 3057)
- `E:/projects/AI-Enabled HMIS/radhakishan-prescription-system-folder/radhakishan-prescription-system/supabase/functions/generate-prescription/index.ts` (lines 176, 243-315)
- `E:/projects/AI-Enabled HMIS/radhakishan-prescription-system-folder/radhakishan-prescription-system/web/formulary.html` (line 1790, `select=*` — admin page, low call volume, not in top 5)
