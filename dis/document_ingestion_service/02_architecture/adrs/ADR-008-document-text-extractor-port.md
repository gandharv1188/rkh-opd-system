# ADR-008 — `DocumentTextExtractorPort` as the file-router's dispatch target; `OcrPort` becomes one of its four routes

- **Status:** Accepted
- **Date:** 2026-04-22
- **Deciders:** Architect (Claude Opus 4.7), Product Owner
- **Supersedes:** none
- **Refines:** ADR-001 (port inventory), TDD §7 (file-router decision tree), `adapters.md` §Port inventory
- **Unblocks:** DIS-059, DIS-060, DIS-061 (teammate `dev-c-office-parsers` STOP-and-reported 2026-04-22)

## Context

TDD §7's file-router decision tree dispatches uploaded documents to **four** branches:

1. `NATIVE_TEXT` — PDFs with an embedded text layer; no OCR needed.
2. `OCR_IMAGE` — scans, photos, multi-page image files; OCR required.
3. `OFFICE_WORD` — `.docx` / `.doc`; parsed by a DOCX library.
4. `OFFICE_SHEET` — `.xlsx` / `.xls` / `.csv`; parsed by a spreadsheet library.

Only route 2 actually performs OCR (image → text). Routes 1, 3, 4 extract text that is already structured inside the source file.

Backlog tickets DIS-059 (native PDF), DIS-060 (OfficeWord), DIS-061 (OfficeSheet) were authored under the assumption that all four routes would implement `OcrPort`. Teammate `dev-c-office-parsers` during Wave-3a dispatch STOP-and-reported that this is a category error:

- `OcrPort.OcrProvider` is the closed union `'datalab' | 'claude-vision' | 'onprem-chandra'` — all of which do image-to-text. Widening it to include `'native-pdf'`, `'office-word'`, `'office-sheet'` would force the word "OCR" to mean "any text extraction", eroding a load-bearing type boundary.
- `adapters.md` §Port inventory lists only the three OCR adapters under `OcrPort`; the file-router (DIS-057) is listed separately but no port exists for what routes 1/3/4 actually need.
- `adapters.md` §Change control requires an ADR + port-version bump for any port interface change; the teammate correctly refused to do it inside the scope of three adapter tickets.

This ADR closes the gap.

Source documents bound by this decision:

- `02_architecture/tdd.md §7` — file-router decision tree.
- `02_architecture/tdd.md §9.1` — `OcrPort` contract.
- `02_architecture/adapters.md` §Port inventory + §Change control.
- `01_product/clinical_safety.md` CS-2 — rawResponse preserved byte-identically: applies uniformly across ALL routes, not just OCR.
- `dis/handoffs/sessions/SESSION_HANDOVER_2026-04-22` — teammate `dev-c-office-parsers` STOP report at Wave-3a.

## Decision

Introduce a new port `DocumentTextExtractorPort` (file: `dis/src/ports/document-text-extractor.ts`) as the file-router's dispatch target. Its contract is "take bytes + media type hints, return extracted text + a preserved rawResponse". It is **route-agnostic** — the same interface fits OCR, native PDF, DOCX, XLSX.

`OcrPort` is **not** removed. It stays as the narrower contract for image-to-text providers and remains one of the concrete implementations that a `DocumentTextExtractorPort` adapter may delegate to.

**Four binding rules:**

1. **`DocumentTextExtractorPort` is the new port the file-router exposes to the orchestrator.** The router's `routeAndExtract(bytes, mediaType, hints?)` returns `ExtractionResult`.
2. **Four adapters implement `DocumentTextExtractorPort`**, one per file-router branch:
   - `NativePdfTextAdapter` (DIS-059) — uses `pdfjs-dist` via the existing `core/native-pdf.ts` (DIS-033).
   - `OfficeWordAdapter` (DIS-060) — uses `mammoth`.
   - `OfficeSheetAdapter` (DIS-061) — uses `xlsx`.
   - `OcrBridgeAdapter` — delegates to whichever `OcrPort` implementation is currently wired (Datalab, Claude Vision, etc.). This is the **only** adapter that transitively depends on `OcrPort`.
3. **`OcrPort` retains its narrower shape.** No change to `OcrProvider` union, no change to `OcrResult`, no new member types. DIS-050 Datalab, DIS-051 Claude Haiku, DIS-052 Claude Vision (in-flight), DIS-062 on-prem stub continue to implement `OcrPort` unchanged.
4. **`ExtractionResult` is distinct from `OcrResult`.** It is a supertype-shaped structure:

   ```ts
   // dis/src/ports/document-text-extractor.ts
   export type ExtractionRoute =
     | 'native_text' | 'ocr_image' | 'office_word' | 'office_sheet';

   export interface ExtractionResult {
     readonly route: ExtractionRoute;
     readonly markdown: string;                // unified text output
     readonly pageCount: number;
     readonly rawResponse: unknown;            // CS-2 byte-identical preservation
     readonly providerDetails?: {              // optional — populated by the OCR bridge
       provider: OcrProvider;
       providerVersion: string;
       tokensUsed?: { input: number; output: number };
     };
     readonly latencyMs: number;
     readonly costMicroINR?: number;
   }

   export interface DocumentTextExtractorPort {
     routeAndExtract(input: ExtractionInput): Promise<ExtractionResult>;
   }
   ```

   Adapters that wrap `OcrPort` (the OCR bridge) populate `providerDetails`; native-PDF / office adapters leave it undefined.

## Consequences

**Enforced by:**

- New file `dis/src/ports/document-text-extractor.ts` authored under a new backlog ticket (proposed **DIS-058z** — see Follow-up tickets).
- Backlog entries for DIS-059, DIS-060, DIS-061 are rewritten in this same scope to target `DocumentTextExtractorPort` instead of `OcrPort`. The rewrite clarifies `provider: 'native-pdf'` etc. are NOT new `OcrProvider` members — they are `ExtractionRoute` values on the separate port.
- Existing DIS-057 `DefaultFileRouter` continues to return a route decision; the orchestrator (or a thin wrapper) invokes the new port once the route is known.
- Fitness rule `core_no_adapter_imports` is unchanged — the new port still lives in `ports/`.

**Becomes easier:**

- **The four file-router branches share one interface.** Orchestrator code paths collapse.
- **CS-2 enforcement is uniform.** All four routes preserve rawResponse byte-identically; one contract test in DIS-072's pattern covers all four.
- **Type system expresses the design.** `OcrPort` means OCR, nothing else; `DocumentTextExtractorPort` means "I get text out of a document". The compiler refuses to confuse them.
- **Future Phase-2 extraction providers** (e.g., Google Document AI, even though ADR-002 rejects it today) plug in without touching `OcrPort`.

**Becomes harder:**

- **One more port.** `adapters.md` inventory grows from 8 ports to 9.
- **A bridge adapter between ports.** `OcrBridgeAdapter` is a small wrapper but it's a new class with its own test surface.
- **Wiring complexity.** `src/wiring/supabase.ts` (DIS-079) now constructs 4 `DocumentTextExtractorPort` adapters + 1-or-more `OcrPort` adapters that the bridge selects among. Readable, but more lines.

**What this does NOT change:**

- `OcrPort` contract — unchanged; no port-version bump.
- `OcrResult` shape — unchanged.
- CS-2 byte-identical preservation — unchanged (now enforced uniformly via `ExtractionResult.rawResponse`).
- `DatalabChandraAdapter`, `ClaudeHaikuAdapter`, `SupabaseStorageAdapter`, `SupabasePostgresAdapter`, `ClaudeVisionAdapter` (in-flight), `DefaultFileRouter`, `DefaultPreprocessor` — all untouched.
- Portability thesis (`portability.md`) — no change; `DocumentTextExtractorPort` has identical semantics on Supabase and AWS.

**Future ADRs that would supersede this one:**

- Removing `OcrPort` entirely and folding its methods into `DocumentTextExtractorPort` would be a new ADR. No current pressure — `OcrPort` is the correct narrower contract for its specific adapters (retry-once on schema invalid, provider-selection env var `DIS_OCR_PROVIDER`, rate-limit taxonomy).
- Expanding `ExtractionRoute` to include a 5th branch (e.g., `dicom` or `hl7`) would NOT need a new ADR — the route union is open to extension by backlog ticket, not architectural decision.

## Alternatives considered

### Widen `OcrProvider` union to include `native-pdf`, `office-word`, `office-sheet`

**Rejected because:** category error. `OcrPort` would no longer mean OCR. The union would need to be either "anything that extracts text" (an over-broad port) or "OCR + file-kind-that-is-not-OCR" (a leaky abstraction). The teammate STOP-report correctly identified this. Also: `OcrPort`-specific concerns like `OcrProviderRateLimitedError` (DIS-050a) make no sense for a native-PDF parser.

### Make every file-router branch invoke `OcrPort` via some compatibility adapter

**Rejected because:** same category error, just further hidden. The compatibility adapter for native-PDF would have to synthesize a `provider: 'native-pdf'` on `OcrResult`, which is exactly the type we just said isn't valid.

### Keep three separate un-portified adapters and have the router call them directly

**Rejected because:** violates ADR-001 (hexagonal). The core cannot know about concrete adapters; it depends on ports only. A router that dispatches to three named classes is adapter-import-from-core.

### Collapse everything into the existing `FileRouterPort`

**Rejected because:** `FileRouterPort` today is a *decision* port — it returns a route tag (`'NATIVE_TEXT'` etc.), not extracted text. Making it also return extracted text bundles two responsibilities (SRP). Separating route decision (DIS-057) from extraction (DIS-058z + DIS-059/060/061) keeps each class small and testable.

## Follow-up tickets

- **DIS-058z (new, Ready)** — Author `dis/src/ports/document-text-extractor.ts` with the interface above + a fake in `tests/helpers/fake-adapters.ts` (`FakeDocumentTextExtractorAdapter`). Wave 3b prerequisite.
- **DIS-059 (rewrite existing, Ready-after-058z)** — `NativePdfTextAdapter` implements `DocumentTextExtractorPort` with `route: 'native_text'`, backed by `core/native-pdf.ts` (DIS-033). rawResponse = extracted-pages structure.
- **DIS-060 (rewrite existing, Ready-after-058z)** — `OfficeWordAdapter` implements `DocumentTextExtractorPort` with `route: 'office_word'`, backed by `mammoth`.
- **DIS-061 (rewrite existing, Ready-after-058z)** — `OfficeSheetAdapter` implements `DocumentTextExtractorPort` with `route: 'office_sheet'`, backed by `xlsx`.
- **DIS-059o (new, Ready-after-058z)** — `OcrBridgeAdapter` implements `DocumentTextExtractorPort` with `route: 'ocr_image'`, delegates to the wired `OcrPort`. Falls out of this ADR but not yet in backlog.
- **DIS-074 (existing in backlog)** — extend the shared `DatabasePort` contract test to also cover the new port when Wave 3b's contract-test slice lands.
- **`adapters.md`** — add `DocumentTextExtractorPort` row to the Port inventory table; add `OcrBridgeAdapter` row alongside the four extractors. Text amendment scope: small; propose for the same PR that introduces DIS-058z.
- **`tdd.md §7`** — append one sentence after the decision-tree diagram noting that the router returns a route tag + the orchestrator calls `DocumentTextExtractorPort.routeAndExtract` with that tag. Text amendment scope: small; same PR.

## Notes for the next orchestrator

The teammate `dev-c-office-parsers` already committed one artifact (`296eca8 test(dis): DIS-059 add failing tests for NativePdfTextAdapter`) on branch `feat/dev-c-office-parsers` before reporting STOP. That branch was dismissed; the test file asserts `provider: 'native-pdf'` which, under this ADR, should instead assert `route: 'native_text'`. When Wave 3b re-dispatches, the test file can be re-authored against the new port; the design intent (exercising NativePdfTextAdapter through a fixture + asserting preserved rawResponse) survives.
