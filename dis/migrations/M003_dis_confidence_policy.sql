-- M-003: dis_confidence_policy — single-row config table.
--
-- CS-7: confidence policy is config, not code. Runtime reads the most recent
-- row with enabled=true; seeded row starts disabled so the pipeline never
-- auto-approves until an admin explicitly flips it.
--
-- Only one row is active at a time: active := (deactivated_at IS NULL AND enabled = true).
-- Partial unique index enforces at most one "currently active" row.

create table dis_confidence_policy (
  id              uuid primary key default gen_random_uuid(),
  version         int not null,
  policy          jsonb not null,
  rules           jsonb,
  enabled         boolean not null default false,
  activated_by    uuid,
  activated_at    timestamptz,
  deactivated_at  timestamptz,
  created_at      timestamptz not null default now()
);

create unique index uniq_dis_confidence_policy_active
  on dis_confidence_policy ((true))
  where deactivated_at is null and enabled = true;

-- Seed: disabled row, version 1, empty policy.
insert into dis_confidence_policy (version, policy, rules, enabled)
values (1, '{}'::jsonb, '[]'::jsonb, false);
