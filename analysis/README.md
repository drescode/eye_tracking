# Eye-Tracking Analytics Pipeline

This project now uses a simple, reliable raw-session collection flow:

1. The GitHub Pages study collects one full participant session in the browser.
2. The website writes one row into `public.participant_sessions`.
3. Python/Jupyter loads `participant_sessions` and restructures the raw JSON into:
   - `participants_clean`
   - `sessions_clean`
   - `pages_clean`
   - `choices_clean`
   - `gaze_data_clean`
   - AOI, TTFF, dwell, heatmap, and pre-choice analysis outputs

The database stays simple and stable. The heavier transformation work happens in Python, where it is easier to debug, export, and iterate on for academic reporting.

## Database setup

In Supabase SQL Editor, run these in order:

1. Open [/Users/andre/Desktop/research/supabase/reset_all.sql](/Users/andre/Desktop/research/supabase/reset_all.sql), copy the full contents, paste into a new query, and run it.
2. Open [/Users/andre/Desktop/research/supabase/schema.sql](/Users/andre/Desktop/research/supabase/schema.sql), copy the full contents, paste into a new query, and run it.
3. Verify collection with:

```sql
select * from public.participant_sessions order by created_at desc;
```

The working write target is:

- `public.participant_sessions`

That table stores:

- participant identity and profile fields
- valid/invalid sample totals
- page summary JSON
- full `session_payload` JSON

## Front-end submission flow

The browser submits directly into `participant_sessions`:

- browser file: [/Users/andre/Desktop/research/js/supabase-store.js](/Users/andre/Desktop/research/js/supabase-store.js)
- method: direct insert with returned `participant_number`

This keeps data capture simple and robust:

- no RPC normalization dependency
- no multi-table write requirement during collection
- one complete raw row per finished participant

## Jupyter / Python workflow

Install the analysis requirements:

```bash
pip install -r /Users/andre/Desktop/research/analysis/requirements.txt
```

Set your database connection:

```bash
export DATABASE_URL="postgresql://USER:PASSWORD@HOST:PORT/DATABASE"
```

Then open the main notebook-style analysis script:

```bash
/Users/andre/Desktop/research/analysis/eye_tracking_research_notebook.py
```

This notebook now treats `participant_sessions` as the primary source of truth and derives the logical analysis tables locally.

## What the notebook derives automatically

From `participant_sessions`, the notebook reconstructs:

- `participants`
- `sessions`
- `pages`
- `choices`
- `gaze_data`
- `page_views`
- `page_options`
- placeholder `aoi_definitions` rows when AOI labels exist in the session brief metadata

It then produces:

- exclusion tables
- clean sessions
- participant profile summaries
- choice-share summaries
- dwell and TTFF outputs
- combined and subgroup heatmaps
- pre-choice heatmaps by selected option
- transition / scanpath summaries
- segment comparisons
- predictive choice models
- exportable CSV and Excel outputs

## Output location

The notebook writes outputs to:

- `/Users/andre/Desktop/research/analysis/notebook_output`

## Important AOI note

The raw-session pipeline supports AOI analysis best when you have real normalized AOI bounds (`x_min`, `x_max`, `y_min`, `y_max`) available for each page.

If only AOI labels are available and no geometry is defined, the notebook still runs, but:

- heatmaps still work
- page-level gaze metrics still work
- AOI-specific dwell / TTFF / transition analyses may be limited or skipped

That keeps collection reliable without blocking the rest of the research workflow.
