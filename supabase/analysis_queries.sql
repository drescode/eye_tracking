-- 1. Inspect the latest raw participant rows
select
  participant_number,
  participant_id,
  study_id,
  total_valid_samples,
  total_invalid_samples,
  completed_at,
  created_at
from public.participant_sessions
order by created_at desc;

-- 2. Valid / invalid ratio per participant session
select
  participant_number,
  participant_id,
  total_valid_samples,
  total_invalid_samples,
  case
    when (total_valid_samples + total_invalid_samples) > 0
      then total_valid_samples::numeric
        / (total_valid_samples + total_invalid_samples)::numeric
    else null
  end as valid_sample_ratio,
  jsonb_array_length(coalesce(page_summary, '[]'::jsonb)) as page_rows_in_summary,
  completed_at,
  created_at
from public.participant_sessions
order by created_at desc;

-- 3. Quick check for empty or incomplete-looking rows
select
  participant_number,
  participant_id,
  total_valid_samples,
  total_invalid_samples,
  case
    when session_payload = '{}'::jsonb then 'empty_session_payload'
    when page_summary = '[]'::jsonb then 'empty_page_summary'
    when completed_at is null then 'missing_completed_at'
    else 'looks_populated'
  end as row_status,
  created_at
from public.participant_sessions
order by created_at desc;

-- 4. Extract page-level summary rows directly from the raw table
select
  ps.participant_number,
  ps.participant_id,
  page_item->>'page_id' as page_id,
  page_item->>'case_id' as case_id,
  page_item->>'family_id' as family_id,
  page_item->>'template' as template_type,
  page_item->>'selection' as selection,
  (page_item->>'combined_time_on_page_ms')::numeric as combined_time_on_page_ms,
  (page_item->>'combined_valid_sample_count')::numeric as combined_valid_sample_count,
  (page_item->>'combined_invalid_sample_count')::numeric as combined_invalid_sample_count
from public.participant_sessions ps
cross join lateral jsonb_array_elements(coalesce(ps.page_summary, '[]'::jsonb)) as page_item
order by ps.participant_number, page_id;

-- 5. Extract valid gaze points directly from raw JSON for debugging
select
  ps.participant_number,
  ps.participant_id,
  page_entry.key as page_id,
  gaze_point->>'timestamp' as sample_timestamp,
  (gaze_point->>'relativeX')::numeric as relative_x,
  (gaze_point->>'relativeY')::numeric as relative_y,
  (gaze_point->>'pageWidth')::numeric as page_width,
  (gaze_point->>'pageHeight')::numeric as page_height,
  (gaze_point->>'valid')::boolean as is_valid
from public.participant_sessions ps
cross join lateral jsonb_each(coalesce(ps.session_payload->'pages', '{}'::jsonb)) as page_entry
cross join lateral jsonb_array_elements(coalesce(page_entry.value->'gazePoints', '[]'::jsonb)) as gaze_point
where coalesce((gaze_point->>'valid')::boolean, false) = true
order by ps.participant_number, page_id, sample_timestamp;
