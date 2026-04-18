begin;

drop view if exists public.family_template_benchmark_analysis cascade;
drop view if exists public.aoi_metrics cascade;
drop view if exists public.aoi_hits cascade;
drop view if exists public.choice_share_analysis cascade;
drop view if exists public.analysis_page_choices cascade;
drop view if exists public.clean_sessions cascade;
drop view if exists public.session_exclusion_reasons cascade;
drop view if exists public.session_quality_screening cascade;

drop function if exists public.submit_experiment_session(jsonb) cascade;
drop function if exists public.normalize_aoi_type(text) cascade;
drop function if exists public.safe_double(text) cascade;
drop function if exists public.safe_integer(text) cascade;
drop function if exists public.safe_timestamptz(text) cascade;

drop table if exists public.choices cascade;
drop table if exists public.aoi_definitions cascade;
drop table if exists public.gaze_data cascade;
drop table if exists public.page_views cascade;
drop table if exists public.page_options cascade;
drop table if exists public.pages cascade;
drop table if exists public.sessions cascade;
drop table if exists public.participants cascade;

drop sequence if exists public.participant_number_seq cascade;

commit;
