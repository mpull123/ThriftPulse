-- One-time setup: store rejected trend candidates for audit/debugging.
create table if not exists trend_rejection_log (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  collector_source text not null,
  raw_title text,
  candidate_term text not null,
  rejection_reason text not null,
  metadata jsonb not null default '{}'::jsonb
);

create index if not exists trend_rejection_log_created_at_idx
  on trend_rejection_log (created_at desc);

create index if not exists trend_rejection_log_source_idx
  on trend_rejection_log (collector_source, created_at desc);

create index if not exists trend_rejection_log_reason_idx
  on trend_rejection_log (rejection_reason, created_at desc);

create index if not exists trend_rejection_log_candidate_idx
  on trend_rejection_log (candidate_term);

