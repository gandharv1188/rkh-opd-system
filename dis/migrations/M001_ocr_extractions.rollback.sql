-- M-001 rollback: drop ocr_extractions + idempotency_keys.
-- CASCADE is intentional: audit/cost/FK tables added by later migrations
-- depend on ocr_extractions; rollbacks run in reverse order so those tables
-- are already gone when this executes, but CASCADE is a safety net.

drop table if exists ocr_extractions cascade;
drop table if exists idempotency_keys cascade;
