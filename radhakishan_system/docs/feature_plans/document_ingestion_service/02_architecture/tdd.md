# Technical Design Document — DIS v1

> This is the authoritative architecture document. Every PR references a
> section here (`implements TDD §X.Y`). Changes to the TDD require an
> explicit architecture-review ticket.

## §1. Architectural style

**Hexagonal (Ports & Adapters)** with a thin event-driven core.

- **Core (business logic, pure):** ingestion state machine, confidence
  policy evaluator, promotion validator, audit log writer.
- **Ports (interfaces):** `OcrPort`, `StructuringPort`, `StoragePort`,
  `DatabasePort`, `QueuePort`, `SecretsPort`, `FileRouterPort`,
  `PreprocessorPort`.
- **Adapters (implementations):** one per port per environment.

**Why hexagonal and not layered MVC:** the explicit goal is
cloud-and-vendor portability. Ports are the contract; adapters change
when the environment changes; core never does.

**Secondary pattern:** CQRS-lite — staging (command side,
`ocr_extractions`) is separate from production (query side,
`lab_results`). Promotion is the explicit command that moves data
across the boundary.

## §2. High-level components

```
┌──────────────────────────────────────────────────────────────────┐
│                         DIS CORE                                  │
│                                                                   │
│   FileRouter → Preprocessor → OcrPort → StructuringPort          │
│                                                                   │
│   IngestionOrchestrator (state machine)                           │
│   ConfidencePolicy                                                │
│   PromotionService                                                │
│   AuditLogger                                                     │
│                                                                   │
└───────┬─────────────────────────┬─────────────────────┬──────────┘
        │                         │                     │
        ▼                         ▼                     ▼
┌───────────────┐     ┌────────────────────┐  ┌────────────────┐
│ StoragePort   │     │ DatabasePort       │  │ QueuePort      │
│               │     │                    │  │                │
│ Supabase → S3 │     │ Supabase → RDS     │  │ pg_cron → SQS  │
└───────────────┘     └────────────────────┘  └────────────────┘
```

## §3. Service boundary

- **Transport:** HTTPS, JSON.
- **Exposed API:** OpenAPI 3.1 spec in `04_api/openapi.yaml`.
- **Authentication:** bearer token (Supabase anon key on POC, Cognito JWT on prod). Never the service role key from the browser.
- **Authorization:** database RLS + service-role key on internal promotion paths.

The only browser-facing entry points are:

| Path | Purpose |
|------|---------|
| `POST /ingest` | Submit a new document. Returns `extraction_id` immediately. |
| `GET /extractions/:id` | Read extraction status + data for the verification UI. |
| `POST /extractions/:id/approve` | Nurse approves (optionally with edits). |
| `POST /extractions/:id/reject` | Nurse rejects with reason code. |
| `GET /extractions?status=pending_review` | Queue page. |
| `GET /admin/metrics` | Admin dashboard. Service-role only. |

Realtime status changes push through Supabase Realtime / (AWS: AppSync
subscriptions). Fallback: 5 s polling.

## §4. State machine

```
  uploaded
     │
     ├── (FileRouter: native PDF / DOCX / XLSX)
     │   ▼
     │  structuring
     │     │
     │     ▼
     │   ready_for_review  ──► verified  ──► promoted
     │     │                      │
     │     │                      └► (nurse rejects) rejected
     │     │
     │     └─(fail)──► failed
     │
     └── (FileRouter: scan / image)
          ▼
         preprocessing
          │
          ▼
         ocr
          │
          ▼
         structuring  ──► (as above)
```

All transitions are recorded in `ocr_audit_log`. Only valid transitions
are permitted in code — attempts to violate the state machine raise a
domain exception.

## §5. Idempotency

- **Ingest:** `POST /ingest` requires an `Idempotency-Key` header
  (client generates UUIDv4). The server stores the key in
  `ocr_extractions.idempotency_key UNIQUE`. Duplicate submission returns
  the existing row.
- **Approve/Reject:** same mechanism on state-changing endpoints to
  avoid double-promotion from network retries.
- **Promotion:** CS-11 duplicate-row check (patient + test + date + value).

## §6. Concurrency & locking

- Extraction rows carry a `version INT NOT NULL DEFAULT 1` column.
- Approve/reject sends the version; server uses optimistic lock
  (`UPDATE ... WHERE id = ? AND version = ?`).
- On conflict, return 409 with the current state; client reloads.

## §7. File routing decision tree

```
ext in (pdf)
 └ try pdf.js text extraction
    └ text length ≥ threshold (≥100 chars/page average)?
       ├ yes → path: NATIVE_TEXT
       └ no  → path: OCR_SCAN
ext in (jpg, jpeg, png, heic, webp, bmp, tiff)
 └ path: OCR_IMAGE
ext in (docx, doc)
 └ path: OFFICE_WORD
ext in (xlsx, xls, csv)
 └ path: OFFICE_SHEET
anything else
 └ reject (415 Unsupported Media Type)
```

Threshold is configurable via `DIS_NATIVE_TEXT_MIN_CHARS_PER_PAGE` (default 100).

## §8. Preprocessing pipeline (OCR paths only)

In order:

1. **Normalize container** — HEIC/WebP/BMP/TIFF → JPEG; multi-page TIFF → JPEG per frame.
2. **Deskew** — detect tilt via Hough lines; rotate to ≤ ±1°.
3. **Perspective correction** — corner detection; warp to rectangle.
4. **Blank-page detection** — drop pages with <0.5% ink density.
5. **Duplicate-page detection** — perceptual hash; drop near-duplicates.
6. **Resize** — max 1920 px longest side.
7. **Contrast enhancement** — adaptive histogram equalization (CLAHE).
8. **JPEG encode** — quality 85.
9. **Page count cap** — refuse if >50 pages (config: `DIS_MAX_PAGES`).

Emits `PreprocessedDocument { pages: Buffer[], dropped: {blank, duplicate}, original_page_count }`.

## §9. OCR adapters

### 9.1. Interface (`OcrPort`)

```ts
interface OcrPort {
  extract(input: OcrInput): Promise<OcrResult>;
}

type OcrInput = {
  pages: Buffer[];             // JPEGs, one per page
  mediaType: 'image/jpeg' | 'application/pdf';
  outputFormats: ('markdown' | 'json' | 'html')[];
  hints?: { languageCodes?: string[]; documentCategory?: string };
};

type OcrResult = {
  provider: 'datalab' | 'claude-vision' | 'onprem-chandra';
  providerVersion: string;
  rawResponse: unknown;        // stored verbatim
  markdown?: string;
  blocks?: Block[];            // from JSON output
  html?: string;
  pageCount: number;
  tokensUsed?: { input: number; output: number };
  costMicroINR?: number;
  latencyMs: number;
};

type Block = {
  id: string;
  blockType: 'text'|'section-header'|'caption'|'table'|'form'|
             'list-group'|'image'|'figure'|'equation-block'|
             'code-block'|'page-header'|'page-footer'|'complex-block';
  bbox: { page: number; x: number; y: number; w: number; h: number };
  content: string;
  confidence?: number;          // 0..1 where available
};
```

### 9.2. Implementations (v1)

- **`DatalabChandraAdapter`** — default. Submits to `/api/v1/convert` in
  `accurate` mode with `output_format=markdown,json`. Polls
  `/convert-result-check` with exponential backoff (1 s → 2 s → 4 s
  capped at 10 s, max 120 s total).
- **`ClaudeVisionAdapter`** — fallback. Mirrors the current
  `process-document` implementation. Used when `DIS_OCR_PROVIDER=claude`.
- **`OnpremChandraAdapter`** — stub only for v1. Implemented in a later
  phase.

### 9.3. Provider selection

Env var `DIS_OCR_PROVIDER` (`datalab` | `claude` | `onprem`). A per-
request override `x-ocr-provider` header is accepted only with the
service-role key (for benchmark tickets).

## §10. Structuring adapter

### 10.1. Interface (`StructuringPort`)

```ts
interface StructuringPort {
  structure(input: StructuringInput): Promise<StructuringResult>;
}

type StructuringInput = {
  markdown?: string;
  blocks?: Block[];
  documentCategory: string;
  patientContext?: { age_years?: number; sex?: 'M'|'F'; allergies?: string[] };
};

type StructuringResult = {
  provider: 'claude-haiku' | 'claude-sonnet' | 'claude-opus' | 'onprem';
  providerVersion: string;
  rawResponse: unknown;
  structured: ClinicalExtraction;   // the JSON schema in §11
  tokensUsed: { input: number; output: number };
  costMicroINR: number;
  latencyMs: number;
};
```

### 10.2. Implementations

- **`ClaudeHaikuAdapter`** — default. Prompt: existing `SYSTEM_PROMPT`
  adapted for text input, schema-validated output.
- **`ClaudeSonnetAdapter`** — escalation for low-confidence cases.
- The system prompt lives in `prompts/structuring.md`, versioned; the
  adapter sends the current version id with every request for audit.

## §11. Structured output schema (validated by JSON Schema)

```jsonc
{
  "document_type": "lab_report | prescription | discharge_summary | radiology | vaccination_card | other",
  "summary": "string",
  "document_date": "YYYY-MM-DD | null",
  "lab_name": "string | null",
  "labs": [{
    "test_name_raw": "string",
    "test_name_normalized": "string",
    "value_text": "string",
    "value_numeric": "number | null",
    "unit": "string | null",
    "reference_range": "string | null",
    "flag": "normal | low | high | critical | unknown",
    "test_category": "Hematology | Biochemistry | Microbiology | Imaging | Other",
    "test_date": "YYYY-MM-DD | null",
    "confidence": "number 0..1"
  }],
  "medications": [{
    "drug": "string",
    "dose": "string | null",
    "frequency": "string | null",
    "duration": "string | null",
    "confidence": "number 0..1"
  }],
  "diagnoses": [{
    "text": "string",
    "icd10": "string | null",
    "confidence": "number 0..1"
  }],
  "vaccinations": [{
    "vaccine_name_raw": "string",
    "vaccine_name_normalized": "string",
    "dose_number": "integer | null",
    "date_given": "YYYY-MM-DD | null",
    "site": "string | null",
    "batch_no": "string | null",
    "confidence": "number 0..1"
  }],
  "clinical_notes": "string | null"
}
```

JSON Schema file: `schemas/clinical_extraction.v1.json`. Schema version
is stored on the extraction row — migrations create a new version, never
edit in place.

## §12. Confidence policy

Stored as JSON in `dis_confidence_policy` table:

```jsonc
{
  "version": 1,
  "enabled": false,
  "rules": [
    { "field": "labs", "auto_approve_if": "confidence >= 0.95 AND block_type = 'table'" },
    { "field": "vaccinations", "auto_approve_if": "confidence >= 0.90" },
    { "field": "medications", "auto_approve_if": false },
    { "field": "diagnoses", "auto_approve_if": false },
    { "field": "summary", "auto_approve_if": true }
  ],
  "activated_by": "user_id",
  "activated_at": "2026-..."
}
```

`enabled: false` at launch. Until CS-7 review says otherwise, every
extraction is `pending_review`.

## §13. Promotion service

Inputs: verified extraction + versioned payload.
Outputs: rows in `lab_results`, `vaccinations`, updates to
`visits.attached_documents`.

Guards (CS-10, CS-11):
1. For `document_type=discharge_summary`, dedupe `labs[]` by
   `test_name_normalized`, keeping the latest `test_date`.
2. For every row, check `(patient_id, test_name, test_date, value_numeric)`
   — if a row exists, skip and log.
3. Insert in a single DB transaction per extraction. If any insert
   fails, the entire transaction rolls back and the extraction returns
   to `pending_review`.

## §14. Observability

- **Structured logs** (JSON Lines) — every request gets a correlation
  ID; the full pipeline carries it.
- **Metrics** (Prometheus-compatible on AWS, `pg_stat_statements` +
  custom table on Supabase) — counters for each state transition,
  histograms for adapter latency, gauges for queue depth.
- **Tracing** — OpenTelemetry SDK, no-op exporter in POC, OTLP in prod.
- **Cost tracking** — every adapter call records `costMicroINR` into a
  ledger table `dis_cost_ledger`. Admin dashboard aggregates.

## §15. Error model

See `04_api/error_model.md`. Summary:

- All errors return JSON with `{code, message, request_id, correlation_id}`.
- HTTP status reflects the class: 4xx for client, 5xx for server.
- Provider outages return 502 with the provider name and the fallback
  recommendation.
- Validation errors return 422 with field-level details.

## §16. Security

- API keys in Secrets Adapter (Supabase secrets / AWS Secrets Manager).
- No keys in code, no keys in logs, no keys in error messages.
- Signed upload URLs only — the browser never POSTs multipart to DIS;
  it PUTs to a signed URL and then calls `POST /ingest` with the URL.
- Content-Security-Policy headers on the verification UI.
- Audit log is append-only, enforced by DB trigger.

## §17. Portability contract

Every port has an adapter for Supabase (POC) and an adapter for AWS
(prod). See `02_architecture/portability.md` for the matrix.

Porting checklist:
1. Set env vars to AWS adapter names.
2. Run migrations on RDS (same SQL).
3. Deploy service image to ECS/Lambda.
4. Switch DNS.
5. Kill switch stays as escape hatch for one week.

## §18. Non-functional targets

| Attribute | Target |
|-----------|--------|
| P50 ingest latency (return extraction_id) | <1 s |
| P95 end-to-end to `ready_for_review` | <90 s |
| Availability | 99.5% during business hours |
| Per-document cost (OCR + structuring) | ≤ ₹0.40 |
| Recovery Time Objective (kill-switch to legacy) | <5 min |
| Data retention for raw responses | indefinite (compliance archive) |

## §19. What the legacy pipeline does that DIS must keep doing

- Accept base64 or URL-based image inputs (backward-compat during shadow mode).
- Write `ocr_summary` / `ocr_diagnoses` / `ocr_medications` into
  `visits.attached_documents` exactly as today — the registration and
  prescription pages already read from these.
- Preserve the pad-mode endpoint untouched (see non-goal #1).

## §20. What DIS deliberately does differently

- Raw model response stored permanently.
- No writes to `lab_results` / `vaccinations` until verification.
- Idempotency enforced.
- Duplicate guard before promotion.
- Confidence-gated auto-approval opt-in.
- Adapter-based vendor/cloud independence.
