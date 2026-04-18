create extension if not exists pgcrypto;

create sequence if not exists public.participant_number_seq;

create table if not exists public.participants (
  participant_id text primary key,
  participant_number bigint not null unique
    default nextval('public.participant_number_seq'),
  age_category text null,
  province text null,
  gender_identity text null,
  shopping_frequency text null,
  device_type text null,
  retailer_familiarity text null,
  created_at timestamptz not null default now()
);

alter sequence public.participant_number_seq
  owned by public.participants.participant_number;

create table if not exists public.sessions (
  session_id uuid primary key default gen_random_uuid(),
  participant_id text not null unique
    references public.participants(participant_id) on delete cascade,
  study_id text not null,
  start_time timestamptz null,
  end_time timestamptz null,
  calibration_completed boolean not null default false,
  total_valid_samples integer not null default 0,
  total_invalid_samples integer not null default 0,
  pages_completed integer not null default 0,
  expected_pages integer not null default 0,
  session_duration integer not null default 0,
  submission_source text not null default 'github-pages',
  raw_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint sessions_total_valid_non_negative check (total_valid_samples >= 0),
  constraint sessions_total_invalid_non_negative check (total_invalid_samples >= 0),
  constraint sessions_pages_completed_non_negative check (pages_completed >= 0),
  constraint sessions_expected_pages_non_negative check (expected_pages >= 0),
  constraint sessions_duration_non_negative check (session_duration >= 0)
);

create table if not exists public.pages (
  page_id text primary key,
  case_id text not null,
  case_family text not null,
  template_type text not null,
  stimulus_name text not null,
  option_count integer not null default 0,
  created_at timestamptz not null default now(),
  constraint pages_option_count_non_negative check (option_count >= 0)
);

create table if not exists public.page_options (
  page_id text not null
    references public.pages(page_id) on delete cascade,
  option_id text not null,
  option_order integer not null default 0,
  option_label text null,
  option_title text null,
  product_name text null,
  size_label text null,
  price_text text null,
  price_numeric double precision null,
  retailer_label text null,
  cta_label text null,
  primary key (page_id, option_id)
);

create table if not exists public.page_views (
  session_page_id uuid primary key default gen_random_uuid(),
  session_id uuid not null
    references public.sessions(session_id) on delete cascade,
  page_id text not null
    references public.pages(page_id) on delete cascade,
  start_time timestamptz null,
  end_time timestamptz null,
  stimulus_duration integer not null default 0,
  response_duration integer not null default 0,
  total_duration integer not null default 0,
  valid_samples integer not null default 0,
  invalid_samples integer not null default 0,
  completed boolean not null default false,
  selection text null,
  selected_label text null,
  created_at timestamptz not null default now(),
  unique (session_id, page_id),
  constraint page_views_stimulus_duration_non_negative check (stimulus_duration >= 0),
  constraint page_views_response_duration_non_negative check (response_duration >= 0),
  constraint page_views_total_duration_non_negative check (total_duration >= 0),
  constraint page_views_valid_samples_non_negative check (valid_samples >= 0),
  constraint page_views_invalid_samples_non_negative check (invalid_samples >= 0)
);

create table if not exists public.gaze_data (
  gaze_id bigint generated always as identity primary key,
  session_id uuid not null
    references public.sessions(session_id) on delete cascade,
  page_id text not null
    references public.pages(page_id) on delete cascade,
  sample_timestamp timestamptz not null,
  phase text not null default 'stimulus',
  sample_index integer not null default 0,
  x_coord double precision null,
  y_coord double precision null,
  x_norm double precision null,
  y_norm double precision null,
  is_valid boolean not null default false,
  in_bounds boolean not null default false,
  created_at timestamptz not null default now(),
  constraint gaze_data_phase_valid check (
    phase in ('stimulus', 'selection', 'selectionPopup')
  ),
  constraint gaze_data_sample_index_non_negative check (sample_index >= 0),
  constraint gaze_data_x_norm_range check (
    x_norm is null or (x_norm >= 0 and x_norm <= 1)
  ),
  constraint gaze_data_y_norm_range check (
    y_norm is null or (y_norm >= 0 and y_norm <= 1)
  )
);

create table if not exists public.aoi_definitions (
  aoi_id uuid primary key default gen_random_uuid(),
  page_id text not null
    references public.pages(page_id) on delete cascade,
  aoi_type text not null,
  x_min double precision null,
  x_max double precision null,
  y_min double precision null,
  y_max double precision null,
  created_at timestamptz not null default now(),
  unique (page_id, aoi_type),
  constraint aoi_x_min_range check (x_min is null or (x_min >= 0 and x_min <= 1)),
  constraint aoi_x_max_range check (x_max is null or (x_max >= 0 and x_max <= 1)),
  constraint aoi_y_min_range check (y_min is null or (y_min >= 0 and y_min <= 1)),
  constraint aoi_y_max_range check (y_max is null or (y_max >= 0 and y_max <= 1)),
  constraint aoi_x_order check (
    x_min is null or x_max is null or x_min <= x_max
  ),
  constraint aoi_y_order check (
    y_min is null or y_max is null or y_min <= y_max
  )
);

create table if not exists public.choices (
  choice_id uuid primary key default gen_random_uuid(),
  session_id uuid not null
    references public.sessions(session_id) on delete cascade,
  page_id text not null
    references public.pages(page_id) on delete cascade,
  selected_option text not null,
  response_time integer not null default 0,
  selected_label text null,
  created_at timestamptz not null default now(),
  unique (session_id, page_id),
  constraint choices_response_time_non_negative check (response_time >= 0)
);

create index if not exists idx_sessions_participant_id
  on public.sessions (participant_id);

create index if not exists idx_sessions_study_id
  on public.sessions (study_id);

create index if not exists idx_sessions_end_time
  on public.sessions (end_time desc);

create index if not exists idx_page_views_session_id
  on public.page_views (session_id);

create index if not exists idx_page_views_page_id
  on public.page_views (page_id);

create index if not exists idx_gaze_data_session_id
  on public.gaze_data (session_id);

create index if not exists idx_gaze_data_page_id
  on public.gaze_data (page_id);

create index if not exists idx_gaze_data_session_page_time
  on public.gaze_data (session_id, page_id, sample_timestamp);

create index if not exists idx_choices_session_id
  on public.choices (session_id);

create index if not exists idx_choices_page_id
  on public.choices (page_id);

create index if not exists idx_aoi_definitions_page_id
  on public.aoi_definitions (page_id);

create or replace function public.safe_timestamptz(value text)
returns timestamptz
language plpgsql
immutable
as $$
begin
  if value is null or btrim(value) = '' then
    return null;
  end if;

  return value::timestamptz;
exception
  when others then
    return null;
end;
$$;

create or replace function public.safe_integer(value text)
returns integer
language plpgsql
immutable
as $$
begin
  if value is null or btrim(value) = '' then
    return null;
  end if;

  return round(value::numeric)::integer;
exception
  when others then
    return null;
end;
$$;

create or replace function public.safe_double(value text)
returns double precision
language plpgsql
immutable
as $$
begin
  if value is null or btrim(value) = '' then
    return null;
  end if;

  return value::double precision;
exception
  when others then
    return null;
end;
$$;

create or replace function public.normalize_aoi_type(input_value text)
returns text
language sql
immutable
as $$
  select trim(both '_' from regexp_replace(lower(coalesce(input_value, 'unknown')), '[^a-z0-9]+', '_', 'g'));
$$;

create or replace function public.submit_experiment_session(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_participant_id text := coalesce(payload->>'participant_id', payload->'session_payload'->>'participantId');
  v_study_id text := coalesce(payload->>'study_id', payload->'session_payload'->>'studyId', 'unknown-study');
  v_profile jsonb := coalesce(payload->'participant_profile', payload->'session_payload'->'participantProfile', '{}'::jsonb);
  v_session_payload jsonb := coalesce(payload->'session_payload', '{}'::jsonb);
  v_page_summary jsonb := coalesce(payload->'page_summary', '[]'::jsonb);
  v_start_time timestamptz;
  v_end_time timestamptz;
  v_session_duration integer;
  v_pages_completed integer;
  v_expected_pages integer;
  v_total_valid integer;
  v_total_invalid integer;
  v_calibration_completed boolean;
  v_submission_source text := coalesce(payload->>'submission_source', 'github-pages');
  v_session_id uuid;
  v_participant_number bigint;
  v_page jsonb;
  v_page_id text;
  v_page_record jsonb;
  v_option jsonb;
  v_option_order integer;
  v_aoi jsonb;
  v_aoi_label text;
  v_aoi_type text;
  v_sample jsonb;
  v_sample_index integer;
  v_price_text text;
  v_page_title text;
begin
  if v_participant_id is null or btrim(v_participant_id) = '' then
    raise exception 'participant_id is required for submission';
  end if;

  v_start_time := coalesce(
    public.safe_timestamptz(v_session_payload->>'createdAt'),
    public.safe_timestamptz(payload->>'consent_timestamp'),
    now()
  );

  v_end_time := coalesce(
    public.safe_timestamptz(payload->>'completed_at'),
    public.safe_timestamptz(v_session_payload->>'completedAt'),
    public.safe_timestamptz(v_session_payload->>'updatedAt'),
    now()
  );

  v_expected_pages := coalesce(
    jsonb_array_length(coalesce(v_session_payload->'stimulusPlan', '[]'::jsonb)),
    jsonb_array_length(coalesce(v_page_summary, '[]'::jsonb)),
    0
  );

  v_pages_completed := coalesce(
    (select count(*)::integer from jsonb_each(coalesce(v_session_payload->'pages', '{}'::jsonb))),
    0
  );

  v_total_valid := coalesce(
    public.safe_integer(payload->>'total_valid_samples'),
    0
  );

  v_total_invalid := coalesce(
    public.safe_integer(payload->>'total_invalid_samples'),
    0
  );

  if v_total_valid = 0 and v_total_invalid = 0 then
    select
      coalesce(sum(coalesce((page_entry.value->>'validSampleCount')::integer, 0)), 0),
      coalesce(sum(coalesce((page_entry.value->>'invalidSampleCount')::integer, 0)), 0)
    into v_total_valid, v_total_invalid
    from jsonb_each(coalesce(v_session_payload->'pages', '{}'::jsonb)) as page_entry;
  end if;

  v_session_duration := coalesce(
    greatest(round(extract(epoch from (v_end_time - v_start_time)) * 1000.0)::integer, 0),
    (
      select coalesce(sum(coalesce((page_item->>'combined_time_on_page_ms')::integer, 0)), 0)
      from jsonb_array_elements(coalesce(v_page_summary, '[]'::jsonb)) as page_item
    ),
    0
  );

  v_calibration_completed := coalesce(
    (v_session_payload->'calibration'->>'completed')::boolean,
    false
  );

  insert into public.participants (
    participant_id,
    age_category,
    province,
    gender_identity,
    shopping_frequency,
    device_type,
    retailer_familiarity
  )
  values (
    v_participant_id,
    coalesce(nullif(payload->>'age_category', ''), nullif(v_profile->>'ageCategory', '')),
    coalesce(nullif(payload->>'province', ''), nullif(v_profile->>'province', '')),
    coalesce(nullif(payload->>'gender_identity', ''), nullif(v_profile->>'genderIdentity', '')),
    coalesce(
      nullif(payload->>'online_shopping_frequency', ''),
      nullif(v_profile->>'onlineShoppingFrequency', '')
    ),
    coalesce(
      nullif(payload->>'primary_shopping_device', ''),
      nullif(v_profile->>'primaryShoppingDevice', '')
    ),
    coalesce(
      nullif(payload->>'retailer_familiarity', ''),
      nullif(v_profile->>'retailerFamiliarity', '')
    )
  )
  on conflict (participant_id) do update set
    age_category = excluded.age_category,
    province = excluded.province,
    gender_identity = excluded.gender_identity,
    shopping_frequency = excluded.shopping_frequency,
    device_type = excluded.device_type,
    retailer_familiarity = excluded.retailer_familiarity
  returning participant_number into v_participant_number;

  insert into public.sessions (
    participant_id,
    study_id,
    start_time,
    end_time,
    calibration_completed,
    total_valid_samples,
    total_invalid_samples,
    pages_completed,
    expected_pages,
    session_duration,
    submission_source,
    raw_payload,
    updated_at
  )
  values (
    v_participant_id,
    v_study_id,
    v_start_time,
    v_end_time,
    v_calibration_completed,
    v_total_valid,
    v_total_invalid,
    v_pages_completed,
    v_expected_pages,
    v_session_duration,
    v_submission_source,
    payload,
    now()
  )
  on conflict (participant_id) do update set
    study_id = excluded.study_id,
    start_time = excluded.start_time,
    end_time = excluded.end_time,
    calibration_completed = excluded.calibration_completed,
    total_valid_samples = excluded.total_valid_samples,
    total_invalid_samples = excluded.total_invalid_samples,
    pages_completed = excluded.pages_completed,
    expected_pages = excluded.expected_pages,
    session_duration = excluded.session_duration,
    submission_source = excluded.submission_source,
    raw_payload = excluded.raw_payload,
    updated_at = now()
  returning session_id into v_session_id;

  for v_page in
    select value
    from jsonb_array_elements(coalesce(v_session_payload->'stimulusPlan', '[]'::jsonb))
  loop
    v_page_id := v_page->>'id';
    if v_page_id is null then
      continue;
    end if;

    v_page_title := coalesce(
      nullif(v_page->>'caseTitle', ''),
      nullif(v_page->>'title', ''),
      nullif(v_page->>'question', ''),
      v_page_id
    );

    insert into public.pages (
      page_id,
      case_id,
      case_family,
      template_type,
      stimulus_name,
      option_count
    )
    values (
      v_page_id,
      coalesce(v_page->>'caseId', v_page_id),
      coalesce(v_page->>'familyId', v_page->>'familyLabel', 'unknown-family'),
      coalesce(v_page->>'template', 'unknown'),
      v_page_title,
      coalesce(jsonb_array_length(coalesce(v_page->'options', '[]'::jsonb)), 0)
    )
    on conflict (page_id) do update set
      case_id = excluded.case_id,
      case_family = excluded.case_family,
      template_type = excluded.template_type,
      stimulus_name = excluded.stimulus_name,
      option_count = excluded.option_count;

    delete from public.page_options
    where page_id = v_page_id;

    v_option_order := 0;
    for v_option in
      select value
      from jsonb_array_elements(coalesce(v_page->'options', '[]'::jsonb))
    loop
      v_option_order := v_option_order + 1;
      v_price_text := nullif(v_option->>'price', '');

      insert into public.page_options (
        page_id,
        option_id,
        option_order,
        option_label,
        option_title,
        product_name,
        size_label,
        price_text,
        price_numeric,
        retailer_label,
        cta_label
      )
      values (
        v_page_id,
        coalesce(v_option->>'id', v_option->>'variantId', format('%s-option-%s', v_page_id, v_option_order)),
        v_option_order,
        nullif(v_option->>'label', ''),
        nullif(v_option->>'title', ''),
        nullif(v_option->>'productName', ''),
        nullif(v_option->>'sizeLabel', ''),
        v_price_text,
        case
          when v_price_text is null then null
          else public.safe_double(regexp_replace(v_price_text, '[^0-9\\.-]', '', 'g'))
        end,
        nullif(v_option->>'retailerLabel', ''),
        nullif(v_option->>'ctaLabel', '')
      );
    end loop;

    delete from public.aoi_definitions
    where page_id = v_page_id;

    for v_aoi in
      select value
      from jsonb_array_elements(coalesce(v_page->'brief'->'aoiDefinitions', '[]'::jsonb))
    loop
      if jsonb_typeof(v_aoi) = 'string' then
        v_aoi_label := trim(both '"' from v_aoi::text);
        v_aoi_type := public.normalize_aoi_type(v_aoi_label);
        insert into public.aoi_definitions (
          page_id,
          aoi_type,
          x_min,
          x_max,
          y_min,
          y_max
        )
        values (
          v_page_id,
          v_aoi_type,
          null,
          null,
          null,
          null
        )
        on conflict (page_id, aoi_type) do nothing;
      else
        v_aoi_label := coalesce(
          nullif(v_aoi->>'label', ''),
          nullif(v_aoi->>'name', ''),
          nullif(v_aoi->>'aoi_type', ''),
          'unknown'
        );
        v_aoi_type := public.normalize_aoi_type(v_aoi_label);

        insert into public.aoi_definitions (
          page_id,
          aoi_type,
          x_min,
          x_max,
          y_min,
          y_max
        )
        values (
          v_page_id,
          v_aoi_type,
          public.safe_double(v_aoi->>'x_min'),
          public.safe_double(v_aoi->>'x_max'),
          public.safe_double(v_aoi->>'y_min'),
          public.safe_double(v_aoi->>'y_max')
        )
        on conflict (page_id, aoi_type) do update set
          x_min = excluded.x_min,
          x_max = excluded.x_max,
          y_min = excluded.y_min,
          y_max = excluded.y_max;
      end if;
    end loop;
  end loop;

  delete from public.gaze_data
  where session_id = v_session_id;

  delete from public.choices
  where session_id = v_session_id;

  delete from public.page_views
  where session_id = v_session_id;

  for v_page_id, v_page_record in
    select key, value
    from jsonb_each(coalesce(v_session_payload->'pages', '{}'::jsonb))
  loop
    insert into public.page_views (
      session_id,
      page_id,
      start_time,
      end_time,
      stimulus_duration,
      response_duration,
      total_duration,
      valid_samples,
      invalid_samples,
      completed,
      selection,
      selected_label
    )
    values (
      v_session_id,
      v_page_id,
      public.safe_timestamptz(v_page_record->>'startedAt'),
      coalesce(
        public.safe_timestamptz(v_page_record->>'selectionPopupEndedAt'),
        public.safe_timestamptz(v_page_record->>'endedAt')
      ),
      coalesce(public.safe_integer(v_page_record->>'timeOnPageMs'), 0),
      coalesce(public.safe_integer(v_page_record->>'selectionPopupTimeOnPageMs'), 0),
      coalesce(public.safe_integer(v_page_record->>'timeOnPageMs'), 0)
        + coalesce(public.safe_integer(v_page_record->>'selectionPopupTimeOnPageMs'), 0),
      coalesce(public.safe_integer(v_page_record->>'validSampleCount'), 0)
        + coalesce(public.safe_integer(v_page_record->>'selectionPopupValidSampleCount'), 0),
      coalesce(public.safe_integer(v_page_record->>'invalidSampleCount'), 0)
        + coalesce(public.safe_integer(v_page_record->>'selectionPopupInvalidSampleCount'), 0),
      (
        coalesce(public.safe_integer(v_page_record->>'timeOnPageMs'), 0)
        + coalesce(public.safe_integer(v_page_record->>'selectionPopupTimeOnPageMs'), 0)
      ) > 0,
      nullif(v_page_record->>'selection', ''),
      nullif(v_page_record->>'selectedLabel', '')
    )
    on conflict (session_id, page_id) do update set
      start_time = excluded.start_time,
      end_time = excluded.end_time,
      stimulus_duration = excluded.stimulus_duration,
      response_duration = excluded.response_duration,
      total_duration = excluded.total_duration,
      valid_samples = excluded.valid_samples,
      invalid_samples = excluded.invalid_samples,
      completed = excluded.completed,
      selection = excluded.selection,
      selected_label = excluded.selected_label;

    if nullif(v_page_record->>'selection', '') is not null then
      insert into public.choices (
        session_id,
        page_id,
        selected_option,
        response_time,
        selected_label
      )
      values (
        v_session_id,
        v_page_id,
        v_page_record->>'selection',
        coalesce(public.safe_integer(v_page_record->>'selectionPopupTimeOnPageMs'), 0),
        nullif(v_page_record->>'selectedLabel', '')
      )
      on conflict (session_id, page_id) do update set
        selected_option = excluded.selected_option,
        response_time = excluded.response_time,
        selected_label = excluded.selected_label;
    end if;

    v_sample_index := 0;
    for v_sample in
      select value
      from jsonb_array_elements(coalesce(v_page_record->'gazePoints', '[]'::jsonb))
    loop
      v_sample_index := v_sample_index + 1;
      insert into public.gaze_data (
        session_id,
        page_id,
        sample_timestamp,
        phase,
        sample_index,
        x_coord,
        y_coord,
        x_norm,
        y_norm,
        is_valid,
        in_bounds
      )
      values (
        v_session_id,
        v_page_id,
        coalesce(public.safe_timestamptz(v_sample->>'timestamp'), v_start_time),
        'stimulus',
        v_sample_index,
        public.safe_double(v_sample->>'x'),
        public.safe_double(v_sample->>'y'),
        case
          when public.safe_double(v_sample->>'relativeX') is null
            or public.safe_double(v_sample->>'pageWidth') is null
            or public.safe_double(v_sample->>'pageWidth') = 0
          then null
          else public.safe_double(v_sample->>'relativeX') / public.safe_double(v_sample->>'pageWidth')
        end,
        case
          when public.safe_double(v_sample->>'relativeY') is null
            or public.safe_double(v_sample->>'pageHeight') is null
            or public.safe_double(v_sample->>'pageHeight') = 0
          then null
          else public.safe_double(v_sample->>'relativeY') / public.safe_double(v_sample->>'pageHeight')
        end,
        coalesce((v_sample->>'valid')::boolean, false),
        coalesce((v_sample->>'inBounds')::boolean, false)
      );
    end loop;

    for v_sample in
      select value
      from jsonb_array_elements(coalesce(v_page_record->'selectionPopupGazePoints', '[]'::jsonb))
    loop
      v_sample_index := v_sample_index + 1;
      insert into public.gaze_data (
        session_id,
        page_id,
        sample_timestamp,
        phase,
        sample_index,
        x_coord,
        y_coord,
        x_norm,
        y_norm,
        is_valid,
        in_bounds
      )
      values (
        v_session_id,
        v_page_id,
        coalesce(public.safe_timestamptz(v_sample->>'timestamp'), v_end_time),
        'selection',
        v_sample_index,
        public.safe_double(v_sample->>'x'),
        public.safe_double(v_sample->>'y'),
        case
          when public.safe_double(v_sample->>'relativeX') is null
            or public.safe_double(v_sample->>'pageWidth') is null
            or public.safe_double(v_sample->>'pageWidth') = 0
          then null
          else public.safe_double(v_sample->>'relativeX') / public.safe_double(v_sample->>'pageWidth')
        end,
        case
          when public.safe_double(v_sample->>'relativeY') is null
            or public.safe_double(v_sample->>'pageHeight') is null
            or public.safe_double(v_sample->>'pageHeight') = 0
          then null
          else public.safe_double(v_sample->>'relativeY') / public.safe_double(v_sample->>'pageHeight')
        end,
        coalesce((v_sample->>'valid')::boolean, false),
        coalesce((v_sample->>'inBounds')::boolean, false)
      );
    end loop;
  end loop;

  return jsonb_build_object(
    'session_id', v_session_id,
    'participant_id', v_participant_id,
    'participant_number', v_participant_number,
    'pages_completed', v_pages_completed,
    'total_valid_samples', v_total_valid,
    'total_invalid_samples', v_total_invalid
  );
end;
$$;

revoke all on function public.submit_experiment_session(jsonb) from public;
grant execute on function public.submit_experiment_session(jsonb) to anon, authenticated;

create or replace view public.session_quality_screening as
select
  s.session_id,
  s.participant_id,
  p.participant_number,
  p.age_category,
  p.province,
  p.gender_identity,
  p.shopping_frequency,
  p.device_type,
  p.retailer_familiarity,
  s.study_id,
  s.start_time,
  s.end_time,
  s.calibration_completed,
  s.total_valid_samples,
  s.total_invalid_samples,
  case
    when (s.total_valid_samples + s.total_invalid_samples) > 0
      then s.total_valid_samples::double precision
        / (s.total_valid_samples + s.total_invalid_samples)::double precision
    else null
  end as valid_sample_ratio,
  s.pages_completed,
  s.expected_pages,
  s.session_duration,
  s.submission_source,
  s.created_at
from public.sessions s
join public.participants p
  on p.participant_id = s.participant_id;

create or replace view public.session_exclusion_reasons as
select
  sqs.*,
  exclusion_meta.exclusion_reasons,
  cardinality(exclusion_meta.exclusion_reasons) as exclusion_reason_count
from public.session_quality_screening sqs
cross join lateral (
  select array_remove(array[
    case when sqs.total_valid_samples < 50 then 'low_valid_samples' end,
    case
      when sqs.valid_sample_ratio is not null and sqs.valid_sample_ratio < 0.50
        then 'low_valid_ratio'
    end,
    case when sqs.pages_completed < sqs.expected_pages then 'incomplete_pages' end,
    case when sqs.calibration_completed is false then 'missing_calibration' end
  ], null::text) as exclusion_reasons
) exclusion_meta;

create or replace view public.clean_sessions as
select *
from public.session_exclusion_reasons
where exclusion_reason_count = 0;

create or replace view public.analysis_page_choices as
select
  c.choice_id,
  c.session_id,
  c.page_id,
  p.case_id,
  p.case_family,
  p.template_type,
  p.stimulus_name,
  c.selected_option,
  c.selected_label,
  c.response_time,
  s.participant_id,
  participant.participant_number,
  participant.age_category,
  participant.province,
  participant.gender_identity,
  participant.shopping_frequency,
  participant.device_type,
  participant.retailer_familiarity
from public.choices c
join public.sessions s
  on s.session_id = c.session_id
join public.participants participant
  on participant.participant_id = s.participant_id
join public.pages p
  on p.page_id = c.page_id;

create or replace view public.choice_share_analysis as
select
  p.page_id,
  p.case_id,
  p.case_family,
  p.template_type,
  p.stimulus_name,
  c.selected_option,
  count(*) as selections,
  round(
    count(*)::numeric
    / nullif(sum(count(*)) over (partition by p.page_id), 0),
    4
  ) as selection_share
from public.choices c
join public.pages p
  on p.page_id = c.page_id
group by
  p.page_id,
  p.case_id,
  p.case_family,
  p.template_type,
  p.stimulus_name,
  c.selected_option;

create or replace view public.aoi_hits as
with ordered_samples as (
  select
    g.gaze_id,
    g.session_id,
    g.page_id,
    g.sample_timestamp,
    g.phase,
    g.x_coord,
    g.y_coord,
    g.x_norm,
    g.y_norm,
    g.is_valid,
    g.in_bounds,
    pv.start_time as page_start_time,
    lead(g.sample_timestamp) over (
      partition by g.session_id, g.page_id
      order by g.sample_timestamp, g.gaze_id
    ) as next_sample_timestamp
  from public.gaze_data g
  join public.page_views pv
    on pv.session_id = g.session_id
   and pv.page_id = g.page_id
  where g.is_valid = true
)
select
  os.gaze_id,
  os.session_id,
  os.page_id,
  a.aoi_id,
  a.aoi_type,
  os.sample_timestamp,
  greatest(
    extract(epoch from (
      coalesce(os.next_sample_timestamp, os.sample_timestamp) - os.sample_timestamp
    )) * 1000.0,
    0
  ) as sample_gap_ms,
  greatest(
    extract(epoch from (os.sample_timestamp - coalesce(os.page_start_time, os.sample_timestamp))) * 1000.0,
    0
  ) as elapsed_from_page_start_ms
from ordered_samples os
join public.aoi_definitions a
  on a.page_id = os.page_id
 and a.x_min is not null
 and a.x_max is not null
 and a.y_min is not null
 and a.y_max is not null
 and os.x_norm is not null
 and os.y_norm is not null
 and os.x_norm between a.x_min and a.x_max
 and os.y_norm between a.y_min and a.y_max;

create or replace view public.aoi_metrics as
select
  session_id,
  page_id,
  aoi_id,
  aoi_type,
  min(elapsed_from_page_start_ms) as ttff_ms,
  sum(least(sample_gap_ms, 250.0)) as dwell_time_ms,
  count(*) as sample_hits
from public.aoi_hits
group by session_id, page_id, aoi_id, aoi_type;

create or replace view public.family_template_benchmark_analysis as
select
  p.case_family,
  p.template_type,
  count(distinct pv.session_id) as sessions_seen,
  avg(pv.total_duration)::double precision as avg_page_duration_ms,
  avg(pv.valid_samples)::double precision as avg_valid_samples,
  avg(case when c.choice_id is not null then 1 else 0 end)::double precision as conversion_rate
from public.page_views pv
join public.pages p
  on p.page_id = pv.page_id
left join public.choices c
  on c.session_id = pv.session_id
 and c.page_id = pv.page_id
group by p.case_family, p.template_type;

