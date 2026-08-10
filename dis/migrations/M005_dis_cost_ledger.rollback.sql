-- M-005 rollback: drop triggers, function, table.

drop trigger if exists trg_dis_cost_ledger_no_delete on dis_cost_ledger;
drop trigger if exists trg_dis_cost_ledger_no_update on dis_cost_ledger;
drop function if exists dis_cost_ledger_immutable();
drop table if exists dis_cost_ledger cascade;
