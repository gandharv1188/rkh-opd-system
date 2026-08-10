-- M-002 rollback: drop triggers, function, table.

drop trigger if exists trg_ocr_audit_log_no_delete on ocr_audit_log;
drop trigger if exists trg_ocr_audit_log_no_update on ocr_audit_log;
drop function if exists ocr_audit_log_immutable();
drop table if exists ocr_audit_log cascade;
