# Error Model

Single consistent error envelope across all endpoints.

## Envelope

```jsonc
{
  "error": {
    "code": "UPPER_SNAKE",            // stable machine-readable
    "message": "Human-readable short message.",
    "details": { /* optional structured context */ },
    "retryable": true | false,
    "request_id": "uuid",             // server-assigned per request
    "correlation_id": "uuid"          // pipeline-wide, crosses services
  }
}
```

## HTTP status mapping

| Status                       | When                                                                        |
| ---------------------------- | --------------------------------------------------------------------------- |
| 400 `INVALID_ARGUMENT`       | Malformed request body or params.                                           |
| 401 `UNAUTHENTICATED`        | Missing or invalid auth.                                                    |
| 403 `FORBIDDEN`              | Authenticated but insufficient role for action.                             |
| 404 `NOT_FOUND`              | Extraction/patient/visit not found.                                         |
| 409 `CONFLICT`               | Idempotency collision, version mismatch, invalid state transition.          |
| 413 `PAYLOAD_TOO_LARGE`      | File > 20 MB.                                                               |
| 415 `UNSUPPORTED_MEDIA_TYPE` | Extension not on the allowlist.                                             |
| 422 `VALIDATION_FAILED`      | Payload valid shape but fails domain rules (e.g., required edit missing).   |
| 429 `RATE_LIMITED`           | Per-user or global throttle.                                                |
| 500 `INTERNAL`               | Unhandled server error.                                                     |
| 502 `UPSTREAM_FAILED`        | OCR/structuring provider returned an error. Includes `provider` in details. |
| 503 `UNAVAILABLE`            | Kill switch active or maintenance mode.                                     |
| 504 `UPSTREAM_TIMEOUT`       | Provider did not respond within timeout.                                    |

## Error codes — full list

### Client errors (4xx)

- `INVALID_ARGUMENT` — generic bad input.
- `MISSING_IDEMPOTENCY_KEY` — required header absent.
- `IDEMPOTENCY_KEY_CONFLICT` — same key already used for a different body.
- `UNSUPPORTED_MEDIA_TYPE` — file extension not in the allowlist.
- `PAYLOAD_TOO_LARGE` — size cap exceeded.
- `VERSION_CONFLICT` — optimistic lock failed; current state is returned in `details`.
- `INVALID_STATE_TRANSITION` — trying to approve a rejected extraction, etc.
- `DUPLICATE_DOCUMENT` — content hash already verified. `details.prior_extraction_id`.
- `PATIENT_NOT_FOUND`, `VISIT_NOT_FOUND`.
- `VALIDATION_FAILED` — schema validation on edits. `details.errors: [{field_path, rule, message}]`.

### Server / provider errors (5xx)

- `OCR_PROVIDER_UNAVAILABLE` — `details.provider`, `details.retry_after_sec`.
- `OCR_PROVIDER_TIMEOUT` — Datalab polling exceeded max wait.
- `STRUCTURING_PROVIDER_FAILED` — Haiku error / JSON drift.
- `STRUCTURING_SCHEMA_INVALID` — model returned unparseable or non-conforming JSON after N retries.
- `PROMOTION_FAILED` — DB transaction rolled back. `details.reason`.
- `INTERNAL` — catch-all; triggers alert.

## Retry policy

- `retryable: true` for 5xx, 429, 502, 504.
- Client SHOULD retry with exponential backoff (base 1 s, factor 2, cap
  30 s, jitter ±20%) and reuse the same `Idempotency-Key`.
- Server MUST deduplicate retries via the idempotency key.

## Logging

Every response logs:

- `method, path, status, duration_ms, request_id, correlation_id, error.code (if any)`.
- No PII in logs — `patient_id` only, not name or UHID.

## Client behaviors for specific codes

- `VERSION_CONFLICT` → re-GET the extraction, re-render the form, let
  the nurse re-submit. Never auto-retry.
- `DUPLICATE_DOCUMENT` → show the warning banner (DIS-US-015). Approval
  proceeds only with `override_duplicates: true` in the payload.
- `OCR_PROVIDER_UNAVAILABLE` → UI shows "AI reader is temporarily
  unavailable — we'll retry in the background." Background job retries
  per retry policy.
