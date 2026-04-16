create extension if not exists pgcrypto;

create table if not exists public.participant_sessions (
  id uuid primary key default gen_random_uuid(),
  participant_id text not null unique,
  study_id text not null,
  consent_timestamp timestamptz,
  completed_at timestamptz,
  submission_source text not null default 'github-pages',
  device_info jsonb not null default '{}'::jsonb,
  page_summary jsonb not null default '[]'::jsonb,
  total_valid_samples integer not null default 0,
  total_invalid_samples integer not null default 0,
  session_payload jsonb not null,
  created_at timestamptz not null default now()
);

alter table public.participant_sessions enable row level security;

drop policy if exists "Allow anonymous participant inserts" on public.participant_sessions;
create policy "Allow anonymous participant inserts"
on public.participant_sessions
for insert
to anon
with check (true);
