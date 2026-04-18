# Eye-Tracking Analytics Pipeline

This folder turns the raw browser session payload into a notebook-friendly analytics workflow:

1. GitHub Pages study collects the participant session.
2. Supabase/PostgreSQL stores the session through `public.submit_experiment_session(payload jsonb)`.
3. The database normalizes the payload into relational tables.
4. Jupyter or Python scripts query the clean relational tables and views.
5. Charts, heatmaps, reports, and CSV exports are written to `analysis_output/`.

## Database setup

In Supabase SQL Editor:

1. Open [`/Users/andre/Desktop/research/supabase/reset_all.sql`](/Users/andre/Desktop/research/supabase/reset_all.sql), copy the full file contents, paste into a new query, and run it.
2. Open [`/Users/andre/Desktop/research/supabase/schema.sql`](/Users/andre/Desktop/research/supabase/schema.sql), copy the full file contents, paste into a new query, and run it.
3. Open [`/Users/andre/Desktop/research/supabase/analysis_queries.sql`](/Users/andre/Desktop/research/supabase/analysis_queries.sql) whenever you want starter quality-screening and export queries.

The schema creates:

- `participants`
- `sessions`
- `pages`
- `page_options`
- `page_views`
- `gaze_data`
- `aoi_definitions`
- `choices`

It also creates analysis views:

- `session_quality_screening`
- `session_exclusion_reasons`
- `clean_sessions`
- `analysis_page_choices`
- `choice_share_analysis`
- `aoi_hits`
- `aoi_metrics`
- `family_template_benchmark_analysis`

## Front-end submission flow

The browser sends one JSON payload, and the database function does the normalization:

- function: `public.submit_experiment_session(payload jsonb)`
- browser file: [`/Users/andre/Desktop/research/js/supabase-store.js`](/Users/andre/Desktop/research/js/supabase-store.js)

That function:

- upserts `participants`
- upserts `sessions`
- upserts `pages`
- upserts `page_options`
- loads `aoi_definitions`
- inserts `page_views`
- inserts `choices`
- inserts `gaze_data`

## Jupyter / Python setup

Install the analysis requirements:

```bash
pip install -r /Users/andre/Desktop/research/analysis/requirements.txt
```

Set your PostgreSQL connection string:

```bash
export DATABASE_URL="postgresql://USER:PASSWORD@HOST:PORT/DATABASE"
```

Then run the end-to-end analysis pipeline:

```bash
python /Users/andre/Desktop/research/analysis/supabase_visualize.py
```

## Notebook example

```python
import pandas as pd
from sqlalchemy import create_engine

from eye_tracking_pipeline import EyeTrackingAnalysisPipeline

engine = create_engine("postgresql://USER:PASSWORD@HOST:PORT/DATABASE")
pipeline = EyeTrackingAnalysisPipeline(engine, "analysis_output")

quality_df = pipeline.load_table("session_quality")
clean_df = pipeline.load_table("clean_sessions")
choices_df = pipeline.load_table("analysis_page_choices")
aoi_df = pipeline.load_table("aoi_metrics")

pipeline.run_all()
```

## Deliverables produced by the pipeline

The pipeline writes exportable files such as:

- `clean_sessions.csv`
- `quality_valid_samples_per_participant.png`
- `quality_exclusion_reasons.csv`
- `participant_profile_dashboard.png`
- `choice_share_grouped_bar.png`
- `aoi_dwell_time_boxplot_violin.png`
- `ttff_summary.csv`
- `ttff_mean_comparison.png`
- `heatmap_<page_id>_combined.png`
- `heatmap_<page_id>_selected_<option>.png`
- `scanpath_transition_matrix.csv`
- `scanpath_transition_heatmap.png`
- `segment_comparison_dwell.png`
- `choice_attention_model.txt`
- `template_family_benchmarking.png`
- `final_insights_report.md`

## AOI geometry note

TTFF and AOI dwell analysis require populated AOI bounds in `aoi_definitions`.

If a page only has AOI labels and no normalized coordinates (`x_min`, `x_max`, `y_min`, `y_max`), the pipeline will still run, but AOI-specific outputs such as TTFF, dwell, and scanpath metrics will be skipped with a clear note.
