# Glossary

Terminology used consistently across all DIS documentation. Agents MUST
use these exact terms in code, tests, commits, and docs. No synonyms.

| Term                    | Definition                                                                                      |
| ----------------------- | ----------------------------------------------------------------------------------------------- | -------------- |
| **DIS**                 | Document Ingestion Service — the subject of this plan.                                          |
| **Ingestion**           | The complete lifecycle: upload → parse/OCR → structure → verify → promote.                      |
| **Extraction**          | A single row in `ocr_extractions` representing one document's full lifecycle state.             |
| **Extraction ID**       | UUID primary key of `ocr_extractions`. The canonical reference to an ingestion.                 |
| **Raw response**        | The unmodified JSON returned by the OCR provider (Datalab `/convert`).                          |
| **Structured data**     | The clinical JSON produced by the Structuring Adapter from the raw response.                    |
| **Block**               | A typed region of a document as emitted by Chandra: `{block_type, bbox, content, confidence?}`. |
| **Staging**             | The pre-verified state. Data exists in `ocr_extractions` only, not yet in clinical tables.      |
| **Promotion**           | The act of copying verified fields from `ocr_extractions` into `lab_results` / `vaccinations`.  |
| **Verification**        | Human review step: approve, edit-then-approve, or reject.                                       |
| **Auto-approval**       | Machine-executed promotion without human review when confidence thresholds are met.             |
| **Clinical tables**     | `lab_results`, `vaccinations`, and `visits.attached_documents` — anything a doctor consumes.    |
| **File Router**         | Component that decides native-text extraction vs. OCR vs. office-parser.                        |
| **Preprocessor**        | Component that deskews, compresses, drops blank pages before OCR.                               |
| **OCR Adapter**         | Pluggable provider of `OcrResult` (Datalab, on-prem Chandra, Claude Vision).                    |
| **Structuring Adapter** | Pluggable LLM that turns Markdown/blocks into clinical JSON (Claude Haiku default).             |
| **Port / Adapter**      | Hexagonal-architecture terms. **Port** = interface; **Adapter** = implementation.               |
| **Shadow mode**         | New pipeline runs in parallel with old one; output compared, not shown to users.                |
| **Kill switch**         | Feature flag that routes all traffic back to the legacy `process-document`.                     |
| **POC stack**           | Supabase (Edge Functions + Postgres + Storage).                                                 |
| **Prod stack**          | AWS (ECS/Lambda + RDS Postgres + S3).                                                           |
| **Native PDF**          | A PDF whose text is embedded as selectable characters (no OCR needed).                          |
| **Scan PDF**            | A PDF that is a wrapper around raster images — requires OCR.                                    |
| **Confidence gate**     | Policy that maps `(block_type, confidence_score) → auto_approve                                 | needs_review`. |
| **Ticket**              | A single unit of work tracked under `07_tickets/`.                                              |
| **DoD**                 | Definition of Done — the checklist every ticket must satisfy before merge.                      |
| **Clinical reviewer**   | The human clinician listed in `08_team/RACI.md` who reviews safety-tagged tickets.              |
