create extension if not exists pgcrypto;

create sequence if not exists public.participant_sessions_participant_number_seq;

create table if not exists public.participant_sessions (
  id uuid primary key default gen_random_uuid(),
  participant_number bigint not null
    default nextval('public.participant_sessions_participant_number_seq'),
  participant_id text not null unique,
  study_id text not null,
  consent_timestamp timestamptz null,
  completed_at timestamptz null,
  age_category text null,
  province text null,
  gender_identity text null,
  online_shopping_frequency text null,
  primary_shopping_device text null,
  retailer_familiarity text null,
  submission_source text null default 'github-pages',
  participant_profile jsonb not null default '{}'::jsonb,
  device_info jsonb not null default '{}'::jsonb,
  page_summary jsonb not null default '[]'::jsonb,
  total_valid_samples integer not null default 0,
  total_invalid_samples integer not null default 0,
  session_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter sequence public.participant_sessions_participant_number_seq
  owned by public.participant_sessions.participant_number;

create index if not exists idx_participant_sessions_study_id
  on public.participant_sessions (study_id);

create index if not exists idx_participant_sessions_completed_at
  on public.participant_sessions (completed_at desc);

create index if not exists idx_participant_sessions_participant_number
  on public.participant_sessions (participant_number);

create index if not exists idx_participant_sessions_age_category
  on public.participant_sessions (age_category);

create index if not exists idx_participant_sessions_province
  on public.participant_sessions (province);

create index if not exists idx_participant_sessions_valid_samples
  on public.participant_sessions (total_valid_samples desc);

alter table public.participant_sessions enable row level security;

drop policy if exists "anon_insert_participant_sessions" on public.participant_sessions;
create policy "anon_insert_participant_sessions"
on public.participant_sessions
for insert
to anon
with check (true);

drop policy if exists "anon_select_participant_sessions" on public.participant_sessions;
create policy "anon_select_participant_sessions"
on public.participant_sessions
for select
to anon
using (true);
