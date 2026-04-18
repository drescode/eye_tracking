-- 1. Valid / invalid gaze ratio per session
select
  session_id,
  participant_id,
  participant_number,
  total_valid_samples,
  total_invalid_samples,
  valid_sample_ratio
from public.session_quality_screening
order by participant_number;

-- 2. Sessions with exclusion reasons
select
  session_id,
  participant_id,
  participant_number,
  total_valid_samples,
  total_invalid_samples,
  valid_sample_ratio,
  pages_completed,
  expected_pages,
  calibration_completed,
  exclusion_reasons
from public.session_exclusion_reasons
where exclusion_reason_count > 0
order by participant_number;

-- 3. Valid sessions only dataset
select *
from public.clean_sessions
order by participant_number;

-- 4. Create a physical clean-session snapshot table for export workflows
drop table if exists public.clean_sessions_snapshot;

create table public.clean_sessions_snapshot as
select *
from public.clean_sessions;

create index idx_clean_sessions_snapshot_session_id
  on public.clean_sessions_snapshot (session_id);

create index idx_clean_sessions_snapshot_participant_id
  on public.clean_sessions_snapshot (participant_id);

-- 5. Participant profile summary query
select
  age_category,
  province,
  gender_identity,
  shopping_frequency,
  device_type,
  retailer_familiarity,
  count(*) as participants
from public.participants
group by
  age_category,
  province,
  gender_identity,
  shopping_frequency,
  device_type,
  retailer_familiarity
order by participants desc;

-- 6. Choice share analysis starter
select *
from public.choice_share_analysis
order by page_id, selected_option;

-- 7. Page-level benchmark starter
select *
from public.family_template_benchmark_analysis
order by case_family, template_type;

-- 8. AOI metrics starter
select
  am.session_id,
  am.page_id,
  am.aoi_type,
  am.ttff_ms,
  am.dwell_time_ms,
  am.sample_hits
from public.aoi_metrics am
order by am.session_id, am.page_id, am.aoi_type;
