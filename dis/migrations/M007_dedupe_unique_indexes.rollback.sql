-- M-007 rollback: drop the two partial unique indexes.

drop index if exists uniq_lab_dedupe;
drop index if exists uniq_vax_dedupe;
