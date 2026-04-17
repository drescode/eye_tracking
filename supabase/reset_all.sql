begin;

drop view if exists public.family_template_benchmark_analysis cascade;
drop view if exists public.choice_share_analysis cascade;
drop view if exists public.participant_session_quality_analysis cascade;
drop view if exists public.participant_profile_analysis cascade;
drop view if exists public.gaze_sample_analysis cascade;
drop view if exists public.page_phase_metric_analysis cascade;
drop view if exists public.page_aoi_definition_analysis cascade;
drop view if exists public.page_option_analysis cascade;
drop view if exists public.page_response_analysis cascade;

drop function if exists public.submit_participant_session(jsonb) cascade;
drop function if exists public.rebuild_normalized_participant_data() cascade;
drop function if exists public.normalize_participant_session(uuid) cascade;

drop table if exists public.gaze_samples cascade;
drop table if exists public.page_phase_metrics cascade;
drop table if exists public.page_aoi_definitions cascade;
drop table if exists public.page_options cascade;
drop table if exists public.page_responses cascade;
drop table if exists public.participant_sessions cascade;

drop sequence if exists public.participant_sessions_participant_number_seq cascade;

commit;
