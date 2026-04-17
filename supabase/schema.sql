create extension if not exists pgcrypto;

create table if not exists public.participant_sessions (
  id uuid primary key default gen_random_uuid(),
  participant_id text not null unique,
  study_id text not null,
  consent_timestamp timestamptz,
  completed_at timestamptz,
  age_category text,
  province text,
  gender_identity text,
  online_shopping_frequency text,
  primary_shopping_device text,
  retailer_familiarity text,
  submission_source text not null default 'github-pages',
  participant_profile jsonb not null default '{}'::jsonb,
  device_info jsonb not null default '{}'::jsonb,
  page_summary jsonb not null default '[]'::jsonb,
  total_valid_samples integer not null default 0,
  total_invalid_samples integer not null default 0,
  session_payload jsonb not null,
  created_at timestamptz not null default now()
);

alter table public.participant_sessions
  add column if not exists age_category text,
  add column if not exists province text,
  add column if not exists gender_identity text,
  add column if not exists online_shopping_frequency text,
  add column if not exists primary_shopping_device text,
  add column if not exists retailer_familiarity text,
  add column if not exists participant_profile jsonb not null default '{}'::jsonb;

alter table public.participant_sessions enable row level security;

create index if not exists participant_sessions_study_id_idx
  on public.participant_sessions (study_id);

create index if not exists participant_sessions_province_idx
  on public.participant_sessions (province);

create index if not exists participant_sessions_age_category_idx
  on public.participant_sessions (age_category);

drop policy if exists "Allow anonymous participant inserts" on public.participant_sessions;
create policy "Allow anonymous participant inserts"
on public.participant_sessions
for insert
to anon
with check (true);
