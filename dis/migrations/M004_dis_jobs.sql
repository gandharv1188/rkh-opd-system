-- M-004: dis_jobs — lightweight Postgres-backed job queue (POC / Supabase only).
--
-- On AWS this migration should be skipped — SQS replaces this table
-- (see portability.md and migrations.md §M-004). There is no runtime check
-- inside the SQL for DIS_STACK because dbmate has no env-gating primitive;
-- the caller (dis/scripts/migrate.sh or equivalent) is expected to filter
-- M004 out when DIS_STACK != 'supabase'. The handoff §4 documents the wrapper
-- expectation.

create table dis_jobs (
  id            uuid primary key default gen_random_uuid(),
  topic         text not null,
  payload       jsonb not null,
  scheduled_for timestamptz not null default now(),
  available_at  timestamptz not null default now(),
  run_at        timestamptz,
  status        text not null default 'pending'
                check (status in ('pending','running','done','failed','dead')),
  attempts      int not null default 0,
  max_attempts  int not null default 5,
  locked_until  timestamptz,
  locked_by     text,
  last_error    text,
  completed_at  timestamptz,
  created_at    timestamptz not null default now()
);

create index idx_dis_jobs_ready
  on dis_jobs(topic, available_at)
  where completed_at is null;

create index idx_dis_jobs_status on dis_jobs(status);
