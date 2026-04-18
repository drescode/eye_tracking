#!/usr/bin/env python3
# -*- coding: utf-8 -*-

# %% [markdown]
# # Eye-Tracking Research Analysis Notebook
#
# This notebook-style Python file is designed for Jupyter Notebook, JupyterLab,
# or VS Code notebooks. It loads eye-tracking and survey data from PostgreSQL,
# cleans and structures the data, computes attention metrics, produces
# visualizations, runs statistical analyses, and exports reporting-ready outputs.
#
# The workflow is:
#
# `database import -> cleaning -> quality screening -> participant summaries ->`
# `choice analysis -> AOI metrics -> TTFF -> heatmaps -> pre-choice heatmaps ->`
# `scanpath/transition analysis -> segment comparisons -> predictive modelling ->`
# `benchmarking -> exportable insights`

# %% [markdown]
# ## Part 1 — Environment Setup

# %%
from __future__ import annotations

import json
import math
import os
import re
import textwrap
import warnings
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterable

import numpy as np
import pandas as pd
from PIL import Image
from scipy import ndimage, stats
from sqlalchemy import create_engine, inspect, text
from sqlalchemy.engine import Engine

import matplotlib.pyplot as plt
from matplotlib.patches import Rectangle
try:
    from IPython.display import display
except Exception:  # pragma: no cover - non-notebook fallback
    def display(obj: Any) -> None:  # type: ignore[redef]
        print(obj)

try:
    import plotly.graph_objects as go
except Exception:  # pragma: no cover - optional
    go = None

try:
    import statsmodels.api as sm
    from statsmodels.stats.outliers_influence import variance_inflation_factor
except Exception:  # pragma: no cover - optional
    sm = None
    variance_inflation_factor = None

try:
    from sklearn.cluster import KMeans
    from sklearn.ensemble import GradientBoostingClassifier, RandomForestClassifier
    from sklearn.impute import SimpleImputer
    from sklearn.metrics import accuracy_score, classification_report, confusion_matrix
    from sklearn.model_selection import train_test_split
    from sklearn.pipeline import Pipeline
    from sklearn.preprocessing import OneHotEncoder, StandardScaler
    from sklearn.compose import ColumnTransformer
except Exception:  # pragma: no cover - optional
    KMeans = None
    GradientBoostingClassifier = None
    RandomForestClassifier = None
    SimpleImputer = None
    accuracy_score = None
    classification_report = None
    confusion_matrix = None
    train_test_split = None
    Pipeline = None
    OneHotEncoder = None
    StandardScaler = None
    ColumnTransformer = None

warnings.filterwarnings("ignore", category=FutureWarning)
warnings.filterwarnings("ignore", category=UserWarning)
warnings.filterwarnings("ignore", category=RuntimeWarning)

pd.set_option("display.max_columns", 200)
pd.set_option("display.width", 200)
pd.set_option("display.max_rows", 200)
pd.set_option("display.float_format", lambda x: f"{x:,.4f}")

plt.style.use("default")


# %%
@dataclass
class NotebookConfig:
    # Database
    db_user: str = os.getenv("PGUSER", "postgres")
    db_password: str = os.getenv("PGPASSWORD", "")
    db_host: str = os.getenv("PGHOST", "localhost")
    db_port: int = int(os.getenv("PGPORT", "5432"))
    db_name: str = os.getenv("PGDATABASE", "postgres")
    database_url: str = os.getenv("DATABASE_URL", "")

    # Paths
    base_output_dir: Path = Path("/Users/andre/Desktop/research/analysis/notebook_output")
    screenshot_dir: Path = Path("/Users/andre/Desktop/research/assets/screenshots")
    background_fallback_color: str = "#FFFFFF"

    # Optional AOI label mappings
    aoi_label_mapping: dict[str, str] = None

    # Screening thresholds
    min_valid_samples: int = 50
    min_valid_ratio: float = 0.50
    min_pages_completed_ratio: float = 1.0
    min_session_duration_seconds: float = 20.0
    max_inter_sample_gap_ms: float = 250.0

    # Analysis toggles
    export_excel: bool = True
    generate_plotly_outputs: bool = True
    run_optional_advanced_methods: bool = False
    random_state: int = 42

    def __post_init__(self) -> None:
        if self.aoi_label_mapping is None:
            self.aoi_label_mapping = {
                "cta": "CTA",
                "call_to_action": "CTA",
                "product_image": "Product image",
                "image": "Product image",
                "brand": "Brand",
                "price": "Price",
                "headline": "Headline",
                "badge": "Badge",
                "outside_aoi": "Outside AOI",
            }


CONFIG = NotebookConfig()


# %%
def build_database_url(config: NotebookConfig) -> str:
    if config.database_url:
        return config.database_url

    if not config.db_password:
        raise ValueError(
            "No database password supplied. Set DATABASE_URL or configure db_password in NotebookConfig."
        )

    return (
        f"postgresql+psycopg2://{config.db_user}:{config.db_password}"
        f"@{config.db_host}:{config.db_port}/{config.db_name}"
    )


OUTPUT_DIRS = {
    "base": CONFIG.base_output_dir,
    "raw": CONFIG.base_output_dir / "raw_exports",
    "clean": CONFIG.base_output_dir / "clean_exports",
    "reports": CONFIG.base_output_dir / "reports",
    "figures": CONFIG.base_output_dir / "figures",
    "heatmaps": CONFIG.base_output_dir / "heatmaps",
    "tables": CONFIG.base_output_dir / "tables",
    "models": CONFIG.base_output_dir / "models",
}

for folder in OUTPUT_DIRS.values():
    folder.mkdir(parents=True, exist_ok=True)

print("Output folders ready:")
for name, folder in OUTPUT_DIRS.items():
    print(f"  {name:>8}: {folder}")


# %% [markdown]
# ## Part 2 — Database Connection and Imports

# %%
PRIMARY_RAW_TABLES = [
    "participant_sessions",
]

OPTIONAL_RELATIONAL_TABLES = [
    "participants",
    "sessions",
    "pages",
    "gaze_data",
    "aoi_definitions",
    "choices",
    "page_views",
    "page_options",
]


def create_sqlalchemy_engine_from_config(config: NotebookConfig) -> Engine:
    url = build_database_url(config)
    engine = create_engine(url, future=True, pool_pre_ping=True)
    return engine


def list_database_tables(engine: Engine) -> set[str]:
    return set(inspect(engine).get_table_names(schema="public"))


def load_table(engine: Engine, table_name: str) -> pd.DataFrame:
    return pd.read_sql(text(f"select * from public.{table_name}"), engine)


def load_source_tables(engine: Engine) -> dict[str, pd.DataFrame]:
    available_tables = list_database_tables(engine)

    missing_required = [table for table in PRIMARY_RAW_TABLES if table not in available_tables]
    if missing_required:
        raise RuntimeError(
            f"Missing required tables: {missing_required}. "
            "Make sure the PostgreSQL/Supabase schema has been applied."
        )

    loaded: dict[str, pd.DataFrame] = {}
    for table_name in PRIMARY_RAW_TABLES + OPTIONAL_RELATIONAL_TABLES:
        if table_name in available_tables:
            loaded[table_name] = load_table(engine, table_name)
        else:
            loaded[table_name] = pd.DataFrame()
    return loaded


def preview_dataframe(df: pd.DataFrame, name: str, head: int = 5) -> None:
    print(f"\n{name}: shape={df.shape}")
    if df.empty:
        print("  DataFrame is empty.")
        return
    display(df.head(head))
    display(df.dtypes.rename("dtype").to_frame())


def coerce_json_like(value: Any, fallback: Any) -> Any:
    if value is None or (isinstance(value, float) and np.isnan(value)):
        return fallback
    if isinstance(value, (dict, list)):
        return value
    if isinstance(value, str):
        stripped = value.strip()
        if not stripped:
            return fallback
        try:
            return json.loads(stripped)
        except json.JSONDecodeError:
            return fallback
    return fallback


def parse_price_numeric(value: Any) -> float | None:
    if value is None or (isinstance(value, float) and np.isnan(value)):
        return None
    match = re.search(r"[-+]?\d[\d,]*\.?\d*", str(value))
    if not match:
        return None
    try:
        return float(match.group(0).replace(",", ""))
    except ValueError:
        return None


def make_slug(value: Any) -> str:
    return re.sub(r"[^a-z0-9]+", "_", str(value).strip().lower()).strip("_")


def as_timestamp(value: Any) -> pd.Timestamp:
    return pd.to_datetime(value, errors="coerce", utc=True)


def page_summary_lookup(entries: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    lookup: dict[str, dict[str, Any]] = {}
    for entry in entries:
        if isinstance(entry, dict) and entry.get("page_id"):
            lookup[str(entry["page_id"])] = entry
    return lookup


def derive_raw_session_tables(raw_sessions_df: pd.DataFrame) -> dict[str, pd.DataFrame]:
    participants_rows: list[dict[str, Any]] = []
    sessions_rows: list[dict[str, Any]] = []
    pages_by_id: dict[str, dict[str, Any]] = {}
    choices_rows: list[dict[str, Any]] = []
    gaze_rows: list[dict[str, Any]] = []
    aoi_rows: list[dict[str, Any]] = []
    page_view_rows: list[dict[str, Any]] = []
    page_option_rows: list[dict[str, Any]] = []

    gaze_id_counter = 1

    for raw_row in raw_sessions_df.to_dict(orient="records"):
        session_payload = coerce_json_like(raw_row.get("session_payload"), {})
        participant_profile = coerce_json_like(raw_row.get("participant_profile"), {})
        device_info = coerce_json_like(raw_row.get("device_info"), {})
        raw_page_summary = coerce_json_like(raw_row.get("page_summary"), [])
        if not isinstance(raw_page_summary, list):
            raw_page_summary = []
        summary_lookup = page_summary_lookup(raw_page_summary)

        session_id = str(raw_row.get("id"))
        participant_id = raw_row.get("participant_id")
        participant_number = raw_row.get("participant_number")

        participants_rows.append(
            {
                "participant_id": participant_id,
                "participant_number": participant_number,
                "age_category": raw_row.get("age_category") or participant_profile.get("ageCategory"),
                "province": raw_row.get("province") or participant_profile.get("province"),
                "gender_identity": raw_row.get("gender_identity") or participant_profile.get("genderIdentity"),
                "shopping_frequency": raw_row.get("online_shopping_frequency")
                or participant_profile.get("onlineShoppingFrequency"),
                "device_type": raw_row.get("primary_shopping_device")
                or participant_profile.get("primaryShoppingDevice"),
                "retailer_familiarity": raw_row.get("retailer_familiarity")
                or participant_profile.get("retailerFamiliarity"),
                "created_at": raw_row.get("created_at"),
            }
        )

        stimulus_plan = session_payload.get("stimulusPlan") or []
        payload_pages = session_payload.get("pages") or {}
        page_ids = list(
            dict.fromkeys(
                [
                    *(page.get("id") for page in stimulus_plan if isinstance(page, dict)),
                    *summary_lookup.keys(),
                    *payload_pages.keys(),
                ]
            )
        )

        total_duration_ms = 0
        pages_completed = 0

        for page_index, page_id in enumerate(page_ids):
            plan_page = next(
                (
                    page
                    for page in stimulus_plan
                    if isinstance(page, dict) and str(page.get("id")) == str(page_id)
                ),
                {},
            )
            page_record = payload_pages.get(page_id) or {}
            page_summary = summary_lookup.get(page_id) or {}

            case_family = (
                plan_page.get("familyId")
                or page_record.get("familyId")
                or page_summary.get("family_id")
                or page_summary.get("family_label")
            )
            template_type = (
                plan_page.get("template")
                or page_record.get("template")
                or page_summary.get("template")
            )
            case_id = (
                plan_page.get("caseId")
                or page_record.get("caseId")
                or page_summary.get("case_id")
            )
            stimulus_name = (
                plan_page.get("caseTitle")
                or page_record.get("caseTitle")
                or page_summary.get("case_title")
                or plan_page.get("title")
                or page_record.get("pageTitle")
                or page_id
            )

            options = plan_page.get("options") or []
            if page_id not in pages_by_id:
                pages_by_id[page_id] = {
                    "page_id": page_id,
                    "case_id": case_id,
                    "case_family": case_family,
                    "template_type": template_type,
                    "stimulus_name": stimulus_name,
                    "option_count": len(options),
                    "created_at": raw_row.get("created_at"),
                }

            for option_order, option in enumerate(options, start=1):
                option_id = option.get("id") or option.get("variantId") or f"{page_id}-option-{option_order}"
                page_option_rows.append(
                    {
                        "page_id": page_id,
                        "option_id": option_id,
                        "option_order": option_order,
                        "option_label": option.get("label"),
                        "option_title": option.get("title"),
                        "product_name": option.get("productName"),
                        "size_label": option.get("sizeLabel"),
                        "price_text": option.get("price"),
                        "price_numeric": parse_price_numeric(option.get("price")),
                        "retailer_label": option.get("retailerLabel"),
                        "cta_label": option.get("ctaLabel"),
                    }
                )

            for aoi_label in (plan_page.get("brief", {}) or {}).get("aoiDefinitions", []) or []:
                aoi_rows.append(
                    {
                        "aoi_id": f"{page_id}:{make_slug(aoi_label)}",
                        "page_id": page_id,
                        "aoi_type": make_slug(aoi_label),
                        "x_min": np.nan,
                        "x_max": np.nan,
                        "y_min": np.nan,
                        "y_max": np.nan,
                        "created_at": raw_row.get("created_at"),
                    }
                )

            phases = page_record.get("phases") or {}
            stimulus_phase = phases.get("stimulus") or {
                "startedAt": page_record.get("startedAt"),
                "endedAt": page_record.get("endedAt"),
                "timeOnPageMs": page_record.get("timeOnPageMs", 0),
                "gazePoints": page_record.get("gazePoints", []),
                "validSampleCount": page_record.get("validSampleCount", 0),
                "invalidSampleCount": page_record.get("invalidSampleCount", 0),
            }
            selection_phase = phases.get("selectionPopup") or {
                "startedAt": page_record.get("selectionPopupStartedAt"),
                "endedAt": page_record.get("selectionPopupEndedAt"),
                "timeOnPageMs": page_record.get("selectionPopupTimeOnPageMs", 0),
                "gazePoints": page_record.get("selectionPopupGazePoints", []),
                "validSampleCount": page_record.get("selectionPopupValidSampleCount", 0),
                "invalidSampleCount": page_record.get("selectionPopupInvalidSampleCount", 0),
            }

            stimulus_duration = (
                page_summary.get("time_on_page_ms")
                or stimulus_phase.get("timeOnPageMs")
                or page_record.get("timeOnPageMs")
                or 0
            )
            response_duration = (
                page_summary.get("selection_popup_time_on_page_ms")
                or selection_phase.get("timeOnPageMs")
                or page_record.get("selectionPopupTimeOnPageMs")
                or 0
            )
            total_page_duration = (
                page_summary.get("combined_time_on_page_ms")
                or stimulus_duration + response_duration
            )
            total_duration_ms += float(total_page_duration or 0)

            selection = page_summary.get("selection") or page_record.get("selection")
            selected_label = page_summary.get("selected_label") or page_record.get("selectedLabel")
            page_completed = bool(selection or total_page_duration or stimulus_phase.get("endedAt") or selection_phase.get("endedAt"))
            if page_completed:
                pages_completed += 1

            page_view_rows.append(
                {
                    "session_page_id": f"{session_id}:{page_id}",
                    "session_id": session_id,
                    "page_id": page_id,
                    "start_time": stimulus_phase.get("startedAt"),
                    "end_time": selection_phase.get("endedAt") or stimulus_phase.get("endedAt"),
                    "stimulus_duration": stimulus_duration,
                    "response_duration": response_duration,
                    "total_duration": total_page_duration,
                    "valid_samples": (
                        page_summary.get("combined_valid_sample_count")
                        or (stimulus_phase.get("validSampleCount") or 0)
                        + (selection_phase.get("validSampleCount") or 0)
                    ),
                    "invalid_samples": (
                        page_summary.get("combined_invalid_sample_count")
                        or (stimulus_phase.get("invalidSampleCount") or 0)
                        + (selection_phase.get("invalidSampleCount") or 0)
                    ),
                    "completed": page_completed,
                    "selection": selection,
                    "selected_label": selected_label,
                    "created_at": raw_row.get("created_at"),
                }
            )

            if selection:
                choices_rows.append(
                    {
                        "choice_id": f"{session_id}:{page_id}",
                        "session_id": session_id,
                        "page_id": page_id,
                        "selected_option": selection,
                        "response_time": total_page_duration,
                        "selected_label": selected_label,
                        "created_at": selection_phase.get("endedAt")
                        or stimulus_phase.get("endedAt")
                        or raw_row.get("completed_at")
                        or raw_row.get("created_at"),
                    }
                )

            for phase_name, phase_payload in [
                ("stimulus", stimulus_phase),
                ("selectionPopup", selection_phase),
            ]:
                phase_points = phase_payload.get("gazePoints") or []
                for sample_index, sample in enumerate(phase_points):
                    sample_dict = coerce_json_like(sample, {})
                    page_width = pd.to_numeric(sample_dict.get("pageWidth"), errors="coerce")
                    page_height = pd.to_numeric(sample_dict.get("pageHeight"), errors="coerce")
                    relative_x = pd.to_numeric(sample_dict.get("relativeX"), errors="coerce")
                    relative_y = pd.to_numeric(sample_dict.get("relativeY"), errors="coerce")
                    x_norm = (
                        float(relative_x / page_width)
                        if pd.notna(relative_x) and pd.notna(page_width) and page_width > 0
                        else np.nan
                    )
                    y_norm = (
                        float(relative_y / page_height)
                        if pd.notna(relative_y) and pd.notna(page_height) and page_height > 0
                        else np.nan
                    )
                    gaze_rows.append(
                        {
                            "gaze_id": gaze_id_counter,
                            "session_id": session_id,
                            "page_id": page_id,
                            "sample_timestamp": sample_dict.get("timestamp"),
                            "phase": phase_name,
                            "sample_index": sample_index,
                            "x_coord": sample_dict.get("rawX", sample_dict.get("x")),
                            "y_coord": sample_dict.get("rawY", sample_dict.get("y")),
                            "x_norm": x_norm,
                            "y_norm": y_norm,
                            "is_valid": bool(sample_dict.get("valid", False)),
                            "in_bounds": bool(sample_dict.get("inBounds", False)),
                            "elapsed_ms": sample_dict.get("elapsedTimeMs"),
                            "page_width": page_width,
                            "page_height": page_height,
                            "relative_x": relative_x,
                            "relative_y": relative_y,
                            "created_at": raw_row.get("created_at"),
                        }
                    )
                    gaze_id_counter += 1

        calibration_info = session_payload.get("calibration") or {}
        session_duration_ms = total_duration_ms
        start_time = (
            session_payload.get("createdAt")
            or raw_row.get("consent_timestamp")
            or raw_row.get("created_at")
        )
        end_time = raw_row.get("completed_at") or session_payload.get("completedAt")

        if pd.notna(as_timestamp(start_time)) and pd.notna(as_timestamp(end_time)):
            delta_ms = (as_timestamp(end_time) - as_timestamp(start_time)).total_seconds() * 1000.0
            if delta_ms > 0:
                session_duration_ms = delta_ms

        sessions_rows.append(
            {
                "session_id": session_id,
                "participant_id": participant_id,
                "participant_number": participant_number,
                "study_id": raw_row.get("study_id"),
                "start_time": start_time,
                "end_time": end_time,
                "calibration_completed": bool(calibration_info.get("completed")),
                "total_valid_samples": raw_row.get("total_valid_samples", 0),
                "total_invalid_samples": raw_row.get("total_invalid_samples", 0),
                "pages_completed": pages_completed,
                "expected_pages": len(page_ids),
                "session_duration": session_duration_ms,
                "submission_source": raw_row.get("submission_source"),
                "raw_payload": session_payload,
                "created_at": raw_row.get("created_at"),
                "updated_at": raw_row.get("completed_at") or raw_row.get("created_at"),
            }
        )

    derived = {
        "participant_sessions": raw_sessions_df.copy(),
        "participants": pd.DataFrame(participants_rows),
        "sessions": pd.DataFrame(sessions_rows),
        "pages": pd.DataFrame(list(pages_by_id.values())),
        "gaze_data": pd.DataFrame(gaze_rows),
        "aoi_definitions": pd.DataFrame(aoi_rows),
        "choices": pd.DataFrame(choices_rows),
        "page_views": pd.DataFrame(page_view_rows),
        "page_options": pd.DataFrame(page_option_rows),
    }

    expected_columns = {
        "participants": [
            "participant_id",
            "participant_number",
            "age_category",
            "province",
            "gender_identity",
            "shopping_frequency",
            "device_type",
            "retailer_familiarity",
            "created_at",
        ],
        "sessions": [
            "session_id",
            "participant_id",
            "participant_number",
            "study_id",
            "start_time",
            "end_time",
            "calibration_completed",
            "total_valid_samples",
            "total_invalid_samples",
            "pages_completed",
            "expected_pages",
            "session_duration",
            "submission_source",
            "raw_payload",
            "created_at",
            "updated_at",
        ],
        "pages": [
            "page_id",
            "case_id",
            "case_family",
            "template_type",
            "stimulus_name",
            "option_count",
            "created_at",
        ],
        "gaze_data": [
            "gaze_id",
            "session_id",
            "page_id",
            "sample_timestamp",
            "phase",
            "sample_index",
            "x_coord",
            "y_coord",
            "x_norm",
            "y_norm",
            "is_valid",
            "in_bounds",
            "elapsed_ms",
            "page_width",
            "page_height",
            "relative_x",
            "relative_y",
            "created_at",
        ],
        "aoi_definitions": [
            "aoi_id",
            "page_id",
            "aoi_type",
            "x_min",
            "x_max",
            "y_min",
            "y_max",
            "created_at",
        ],
        "choices": [
            "choice_id",
            "session_id",
            "page_id",
            "selected_option",
            "response_time",
            "selected_label",
            "created_at",
        ],
        "page_views": [
            "session_page_id",
            "session_id",
            "page_id",
            "start_time",
            "end_time",
            "stimulus_duration",
            "response_duration",
            "total_duration",
            "valid_samples",
            "invalid_samples",
            "completed",
            "selection",
            "selected_label",
            "created_at",
        ],
        "page_options": [
            "page_id",
            "option_id",
            "option_order",
            "option_label",
            "option_title",
            "product_name",
            "size_label",
            "price_text",
            "price_numeric",
            "retailer_label",
            "cta_label",
        ],
    }

    for table_name, columns in expected_columns.items():
        frame = derived[table_name]
        for column in columns:
            if column not in frame.columns:
                frame[column] = pd.Series(dtype="object")
        derived[table_name] = frame.loc[:, columns + [col for col in frame.columns if col not in columns]]

    return derived


engine = create_sqlalchemy_engine_from_config(CONFIG)
tables = load_source_tables(engine)

raw_participant_sessions = tables["participant_sessions"].copy()
derived_tables = derive_raw_session_tables(raw_participant_sessions)

participants = derived_tables["participants"].copy()
sessions = derived_tables["sessions"].copy()
pages = derived_tables["pages"].copy()
gaze_data = derived_tables["gaze_data"].copy()
aoi_definitions = derived_tables["aoi_definitions"].copy()
choices = derived_tables["choices"].copy()
page_views = derived_tables["page_views"].copy()
page_options = derived_tables["page_options"].copy()

for df_name, df in {
    "participant_sessions": raw_participant_sessions,
    "participants": participants,
    "sessions": sessions,
    "pages": pages,
    "gaze_data": gaze_data,
    "aoi_definitions": aoi_definitions,
    "choices": choices,
    "page_views": page_views,
    "page_options": page_options,
}.items():
    preview_dataframe(df, df_name)


# %%
def verify_key_relationships(
    participants_df: pd.DataFrame,
    sessions_df: pd.DataFrame,
    pages_df: pd.DataFrame,
    gaze_df: pd.DataFrame,
    aoi_df: pd.DataFrame,
    choices_df: pd.DataFrame,
) -> pd.DataFrame:
    checks: list[dict[str, Any]] = []

    checks.append(
        {
            "relationship": "participants -> sessions",
            "left_count": len(sessions_df),
            "unmatched_left_rows": int(
                sessions_df["participant_id"].isin(participants_df["participant_id"]).eq(False).sum()
            )
            if not sessions_df.empty
            else 0,
        }
    )
    checks.append(
        {
            "relationship": "sessions -> choices",
            "left_count": len(choices_df),
            "unmatched_left_rows": int(
                choices_df["session_id"].isin(sessions_df["session_id"]).eq(False).sum()
            )
            if not choices_df.empty
            else 0,
        }
    )
    checks.append(
        {
            "relationship": "sessions/pages -> gaze_data",
            "left_count": len(gaze_df),
            "unmatched_left_rows": int(
                (
                    gaze_df["session_id"].isin(sessions_df["session_id"]).eq(False)
                    | gaze_df["page_id"].isin(pages_df["page_id"]).eq(False)
                ).sum()
            )
            if not gaze_df.empty
            else 0,
        }
    )
    checks.append(
        {
            "relationship": "pages -> aoi_definitions",
            "left_count": len(aoi_df),
            "unmatched_left_rows": int(
                aoi_df["page_id"].isin(pages_df["page_id"]).eq(False).sum()
            )
            if not aoi_df.empty
            else 0,
        }
    )

    report = pd.DataFrame(checks)
    report["status"] = np.where(report["unmatched_left_rows"] == 0, "ok", "review")
    return report


relationship_report = verify_key_relationships(
    participants,
    sessions,
    pages,
    gaze_data,
    aoi_definitions,
    choices,
)
display(relationship_report)


# %%
participant_session_df = sessions.merge(
    participants,
    on="participant_id",
    how="left",
    suffixes=("_session", "_participant"),
)

session_choice_df = (
    choices.merge(sessions, on="session_id", how="left", suffixes=("", "_session"))
    .merge(participants, on="participant_id", how="left")
    .merge(pages, on="page_id", how="left", suffixes=("", "_page"))
)

gaze_with_page_df = (
    gaze_data.merge(sessions[["session_id", "participant_id", "start_time", "end_time"]], on="session_id", how="left")
    .merge(participants, on="participant_id", how="left")
    .merge(pages, on="page_id", how="left")
)

gaze_with_aoi_df = pd.DataFrame()
master_analysis_df = pd.DataFrame()

print("Analysis-ready DataFrame shells created:")
for name, df in {
    "participant_session_df": participant_session_df,
    "session_choice_df": session_choice_df,
    "gaze_with_page_df": gaze_with_page_df,
}.items():
    print(f"  {name}: {df.shape}")


# %% [markdown]
# ## Part 3 — Data Cleaning and Structuring

# %%
DATETIME_COLUMNS = [
    "created_at",
    "updated_at",
    "start_time",
    "end_time",
    "sample_timestamp",
]


def standardize_text_series(series: pd.Series, replacements: dict[str, str] | None = None) -> pd.Series:
    cleaned = (
        series.astype("string")
        .str.strip()
        .replace({"": pd.NA, "nan": pd.NA, "None": pd.NA, "null": pd.NA})
    )
    if replacements:
        cleaned = cleaned.str.lower().replace(replacements)
    return cleaned


def standardize_category_labels(df: pd.DataFrame) -> pd.DataFrame:
    out = df.copy()
    replacements = {
        "device_type": {
            "desktop": "Desktop",
            "desktop/laptop": "Desktop",
            "laptop": "Desktop",
            "laptop or desktop": "Desktop",
            "mobile": "Mobile",
            "smartphone": "Mobile",
            "tablet": "Tablet",
        },
        "gender_identity": {
            "male": "Man",
            "man": "Man",
            "female": "Woman",
            "woman": "Woman",
            "non-binary": "Non-binary",
        },
        "template_type": {
            "a": "A",
            "b": "B",
            "c": "C",
        },
        "case_family": {
            "brand-equity": "brand-equity",
            "brand equity": "brand-equity",
            "pricing": "pricing",
            "social-marketing": "social-marketing",
            "social marketing": "social-marketing",
            "product presentation": "product-presentation",
            "product-presentation": "product-presentation",
            "segmentation": "segmentation",
            "place and delivery messaging": "place-and-delivery",
            "place-and-delivery": "place-and-delivery",
        },
    }

    for column, mapping in replacements.items():
        if column in out.columns:
            out[column] = (
                standardize_text_series(out[column])
                .str.lower()
                .replace(mapping)
                .fillna(out[column])
            )

    if "province" in out.columns:
        out["province"] = standardize_text_series(out["province"]).str.title()

    if "age_category" in out.columns:
        out["age_category"] = standardize_text_series(out["age_category"]).str.replace("–", "-", regex=False)

    if "retailer_familiarity" in out.columns:
        out["retailer_familiarity"] = standardize_text_series(out["retailer_familiarity"]).str.title()

    return out


def coerce_datetime_columns(df: pd.DataFrame) -> pd.DataFrame:
    out = df.copy()
    for column in DATETIME_COLUMNS:
        if column in out.columns:
            out[column] = pd.to_datetime(out[column], errors="coerce", utc=True)
    return out


def drop_duplicate_rows(df: pd.DataFrame) -> tuple[pd.DataFrame, int]:
    before = len(df)
    cleaned = df.drop_duplicates().copy()
    return cleaned, before - len(cleaned)


def detect_coordinate_mode(df: pd.DataFrame) -> str:
    if {"x_norm", "y_norm"}.issubset(df.columns):
        x = df["x_norm"].dropna()
        y = df["y_norm"].dropna()
        if not x.empty and not y.empty and x.between(0, 1).all() and y.between(0, 1).all():
            return "normalized_columns"

    if {"x_coord", "y_coord"}.issubset(df.columns):
        x = df["x_coord"].dropna()
        y = df["y_coord"].dropna()
        if x.empty or y.empty:
            return "unknown"
        if x.between(0, 1).all() and y.between(0, 1).all():
            return "normalized_values"
        return "absolute_pixels_or_unknown"

    return "unknown"


def normalize_coordinates(df: pd.DataFrame) -> pd.DataFrame:
    out = df.copy()
    coord_mode = detect_coordinate_mode(out)
    out["coord_mode_detected"] = coord_mode

    if {"x_norm", "y_norm"}.issubset(out.columns) and coord_mode == "normalized_columns":
        out["x_norm_clean"] = pd.to_numeric(out["x_norm"], errors="coerce")
        out["y_norm_clean"] = pd.to_numeric(out["y_norm"], errors="coerce")
        return out

    if {"x_coord", "y_coord"}.issubset(out.columns) and coord_mode == "normalized_values":
        out["x_norm_clean"] = pd.to_numeric(out["x_coord"], errors="coerce")
        out["y_norm_clean"] = pd.to_numeric(out["y_coord"], errors="coerce")
        return out

    # Fall back to within-page min-max scaling if only absolute coordinates are available.
    if {"session_id", "page_id", "x_coord", "y_coord"}.issubset(out.columns):
        out["x_coord"] = pd.to_numeric(out["x_coord"], errors="coerce")
        out["y_coord"] = pd.to_numeric(out["y_coord"], errors="coerce")

        out["x_norm_clean"] = out.groupby(["session_id", "page_id"])["x_coord"].transform(
            lambda s: (s - s.min()) / (s.max() - s.min()) if s.notna().sum() >= 2 and s.max() != s.min() else np.nan
        )
        out["y_norm_clean"] = out.groupby(["session_id", "page_id"])["y_coord"].transform(
            lambda s: (s - s.min()) / (s.max() - s.min()) if s.notna().sum() >= 2 and s.max() != s.min() else np.nan
        )
        return out

    out["x_norm_clean"] = np.nan
    out["y_norm_clean"] = np.nan
    return out


def infer_page_start_times(gaze_df: pd.DataFrame, page_views_df: pd.DataFrame) -> pd.DataFrame:
    if not page_views_df.empty and {"session_id", "page_id", "start_time"}.issubset(page_views_df.columns):
        page_starts = page_views_df[["session_id", "page_id", "start_time"]].copy()
        page_starts = page_starts.rename(columns={"start_time": "page_start_time"})
        return page_starts

    page_starts = (
        gaze_df.groupby(["session_id", "page_id"], as_index=False)["sample_timestamp"]
        .min()
        .rename(columns={"sample_timestamp": "page_start_time"})
    )
    return page_starts


def compute_page_level_metrics(
    sessions_df: pd.DataFrame,
    gaze_df: pd.DataFrame,
    choices_df: pd.DataFrame,
    page_views_df: pd.DataFrame,
    pages_df: pd.DataFrame,
) -> pd.DataFrame:
    if not page_views_df.empty:
        page_metrics = page_views_df.copy()
        if "total_duration" in page_metrics.columns:
            page_metrics["page_view_duration"] = pd.to_numeric(page_metrics["total_duration"], errors="coerce") / 1000.0
        else:
            page_metrics["page_view_duration"] = np.nan
        if "response_time" not in page_metrics.columns and "response_duration" in page_metrics.columns:
            page_metrics["response_time"] = pd.to_numeric(page_metrics["response_duration"], errors="coerce")
        return page_metrics

    gaze_summary = (
        gaze_df.groupby(["session_id", "page_id"], as_index=False)
        .agg(
            page_start_time=("sample_timestamp", "min"),
            page_end_time=("sample_timestamp", "max"),
            valid_samples=("is_valid", lambda s: pd.Series(s).fillna(False).sum()),
            invalid_samples=("is_valid", lambda s: (~pd.Series(s).fillna(False)).sum()),
        )
    )
    gaze_summary["page_view_duration"] = (
        (gaze_summary["page_end_time"] - gaze_summary["page_start_time"]).dt.total_seconds()
    )

    if not choices_df.empty:
        choice_subset = choices_df[["session_id", "page_id", "response_time"]].copy()
        choice_subset["response_time"] = pd.to_numeric(choice_subset["response_time"], errors="coerce")
        gaze_summary = gaze_summary.merge(choice_subset, on=["session_id", "page_id"], how="left")

    return gaze_summary.merge(pages_df, on="page_id", how="left")


def build_session_exclusion_table(
    participants_df: pd.DataFrame,
    sessions_df: pd.DataFrame,
    page_metrics_df: pd.DataFrame,
    config: NotebookConfig,
) -> pd.DataFrame:
    out = sessions_df.copy()
    out = out.merge(participants_df, on="participant_id", how="left", suffixes=("", "_participant"))

    out["total_valid_samples"] = pd.to_numeric(out.get("total_valid_samples"), errors="coerce").fillna(0).astype(int)
    out["total_invalid_samples"] = pd.to_numeric(out.get("total_invalid_samples"), errors="coerce").fillna(0).astype(int)
    out["pages_completed"] = pd.to_numeric(out.get("pages_completed"), errors="coerce").fillna(0).astype(int)
    out["expected_pages"] = pd.to_numeric(out.get("expected_pages"), errors="coerce").fillna(0).astype(int)
    out["session_duration"] = pd.to_numeric(out.get("session_duration"), errors="coerce").fillna(0)

    out["total_samples"] = out["total_valid_samples"] + out["total_invalid_samples"]
    out["valid_ratio"] = np.where(
        out["total_samples"] > 0,
        out["total_valid_samples"] / out["total_samples"],
        np.nan,
    )
    out["session_duration_seconds"] = np.where(
        out["session_duration"] > 1000,
        out["session_duration"] / 1000.0,
        out["session_duration"],
    )
    out["completed_all_pages"] = np.where(
        out["expected_pages"] > 0,
        out["pages_completed"] >= np.ceil(out["expected_pages"] * config.min_pages_completed_ratio),
        False,
    )
    out["calibration_flag"] = out["calibration_completed"].fillna(False)
    out["usable_session_flag"] = True

    page_completion = (
        page_metrics_df.groupby("session_id", as_index=False)["page_id"].nunique()
        .rename(columns={"page_id": "observed_page_count"})
        if not page_metrics_df.empty and "session_id" in page_metrics_df.columns and "page_id" in page_metrics_df.columns
        else pd.DataFrame(columns=["session_id", "observed_page_count"])
    )
    out = out.merge(page_completion, on="session_id", how="left")
    out["observed_page_count"] = out["observed_page_count"].fillna(0).astype(int)

    reasons: list[list[str]] = []
    for row in out.itertuples():
        row_reasons: list[str] = []
        if row.total_valid_samples < config.min_valid_samples:
            row_reasons.append("too_few_valid_samples")
        if pd.notna(row.valid_ratio) and row.valid_ratio < config.min_valid_ratio:
            row_reasons.append("low_valid_ratio")
        if not row.completed_all_pages:
            row_reasons.append("incomplete_pages")
        if not row.calibration_flag:
            row_reasons.append("calibration_not_completed")
        if row.session_duration_seconds < config.min_session_duration_seconds:
            row_reasons.append("implausibly_short_duration")
        reasons.append(row_reasons)

    out["exclusion_reasons"] = reasons
    out["exclusion_reason_count"] = out["exclusion_reasons"].apply(len)
    out["usable_session_flag"] = out["exclusion_reason_count"].eq(0)
    return out


participants = coerce_datetime_columns(standardize_category_labels(participants))
sessions = coerce_datetime_columns(standardize_category_labels(sessions))
pages = coerce_datetime_columns(standardize_category_labels(pages))
gaze_data = coerce_datetime_columns(standardize_category_labels(gaze_data))
aoi_definitions = coerce_datetime_columns(standardize_category_labels(aoi_definitions))
choices = coerce_datetime_columns(standardize_category_labels(choices))
page_views = coerce_datetime_columns(standardize_category_labels(page_views))
page_options = coerce_datetime_columns(standardize_category_labels(page_options))

participants, participant_duplicate_count = drop_duplicate_rows(participants)
sessions, session_duplicate_count = drop_duplicate_rows(sessions)
pages, page_duplicate_count = drop_duplicate_rows(pages)
gaze_data, gaze_duplicate_count = drop_duplicate_rows(gaze_data)
aoi_definitions, aoi_duplicate_count = drop_duplicate_rows(aoi_definitions)
choices, choice_duplicate_count = drop_duplicate_rows(choices)

gaze_data = normalize_coordinates(gaze_data)
gaze_data["sample_timestamp"] = pd.to_datetime(gaze_data["sample_timestamp"], errors="coerce", utc=True)
gaze_data = gaze_data.sort_values(["session_id", "page_id", "sample_timestamp", "gaze_id"], kind="stable").reset_index(drop=True)

gaze_data["coords_in_unit_range"] = (
    gaze_data["x_norm_clean"].between(0, 1, inclusive="both")
    & gaze_data["y_norm_clean"].between(0, 1, inclusive="both")
)

page_metrics = compute_page_level_metrics(sessions, gaze_data, choices, page_views, pages)
session_exclusion_table = build_session_exclusion_table(participants, sessions, page_metrics, CONFIG)
clean_sessions = session_exclusion_table.loc[session_exclusion_table["usable_session_flag"]].copy()

print("Duplicate rows removed:")
print(
    {
        "participants": participant_duplicate_count,
        "sessions": session_duplicate_count,
        "pages": page_duplicate_count,
        "gaze_data": gaze_duplicate_count,
        "aoi_definitions": aoi_duplicate_count,
        "choices": choice_duplicate_count,
    }
)

display(session_exclusion_table.head())

# Rebuild joined analysis frames from cleaned tables so all downstream analyses use
# the standardized categories, deduplicated rows, and normalized coordinates.
participant_session_df = sessions.merge(
    participants,
    on="participant_id",
    how="left",
    suffixes=("_session", "_participant"),
)

session_choice_df = (
    choices.merge(sessions, on="session_id", how="left", suffixes=("", "_session"))
    .merge(participants, on="participant_id", how="left")
    .merge(pages, on="page_id", how="left", suffixes=("", "_page"))
)

gaze_with_page_df = (
    gaze_data.merge(sessions[["session_id", "participant_id", "start_time", "end_time"]], on="session_id", how="left")
    .merge(participants, on="participant_id", how="left")
    .merge(pages, on="page_id", how="left")
)


# %%
def export_csv(df: pd.DataFrame, path: Path) -> Path:
    df.to_csv(path, index=False)
    return path


raw_exports = {
    "participant_sessions_raw": export_csv(
        raw_participant_sessions,
        OUTPUT_DIRS["raw"] / "participant_sessions_raw.csv",
    ),
    "participants_raw": export_csv(participants, OUTPUT_DIRS["raw"] / "participants_raw.csv"),
    "sessions_raw": export_csv(sessions, OUTPUT_DIRS["raw"] / "sessions_raw.csv"),
    "pages_raw": export_csv(pages, OUTPUT_DIRS["raw"] / "pages_raw.csv"),
    "gaze_data_raw": export_csv(gaze_data, OUTPUT_DIRS["raw"] / "gaze_data_raw.csv"),
    "aoi_definitions_raw": export_csv(aoi_definitions, OUTPUT_DIRS["raw"] / "aoi_definitions_raw.csv"),
    "choices_raw": export_csv(choices, OUTPUT_DIRS["raw"] / "choices_raw.csv"),
}

clean_exports = {
    "participants_clean": export_csv(participants, OUTPUT_DIRS["clean"] / "participants_clean.csv"),
    "sessions_clean": export_csv(sessions, OUTPUT_DIRS["clean"] / "sessions_clean.csv"),
    "pages_clean": export_csv(pages, OUTPUT_DIRS["clean"] / "pages_clean.csv"),
    "gaze_data_clean": export_csv(gaze_data, OUTPUT_DIRS["clean"] / "gaze_data_clean.csv"),
    "aoi_definitions_clean": export_csv(aoi_definitions, OUTPUT_DIRS["clean"] / "aoi_definitions_clean.csv"),
    "choices_clean": export_csv(choices, OUTPUT_DIRS["clean"] / "choices_clean.csv"),
    "session_exclusion_table": export_csv(
        session_exclusion_table.assign(
            exclusion_reasons=session_exclusion_table["exclusion_reasons"].apply(lambda x: ", ".join(x))
        ),
        OUTPUT_DIRS["clean"] / "session_exclusion_table.csv",
    ),
    "clean_sessions": export_csv(clean_sessions, OUTPUT_DIRS["clean"] / "clean_sessions.csv"),
}


# %% [markdown]
# ## Part 4 — Data Quality Screening

# %%
quality_report_df = session_exclusion_table.copy()
quality_report_df["valid_ratio_pct"] = quality_report_df["valid_ratio"] * 100

valid_counts_per_participant = (
    quality_report_df.groupby(["participant_id", "participant_number"], as_index=False)
    .agg(
        total_valid_samples=("total_valid_samples", "sum"),
        total_invalid_samples=("total_invalid_samples", "sum"),
        session_count=("session_id", "nunique"),
    )
    .sort_values("participant_number")
)

fig, ax = plt.subplots(figsize=(12, 5))
ax.bar(
    valid_counts_per_participant["participant_number"].astype(str),
    valid_counts_per_participant["total_valid_samples"],
    color="#8a5a34",
)
ax.set_title("Valid samples per participant")
ax.set_xlabel("Participant number")
ax.set_ylabel("Total valid samples")
ax.tick_params(axis="x", rotation=90)
fig.tight_layout()
fig.savefig(OUTPUT_DIRS["figures"] / "quality_valid_samples_per_participant.png", dpi=220)

fig, ax = plt.subplots(figsize=(10, 5))
ax.hist(
    quality_report_df["valid_ratio"].dropna(),
    bins=20,
    color="#2c5c85",
    edgecolor="white",
)
ax.set_title("Distribution of valid sample ratios")
ax.set_xlabel("Valid ratio")
ax.set_ylabel("Session count")
fig.tight_layout()
fig.savefig(OUTPUT_DIRS["figures"] / "quality_valid_ratio_histogram.png", dpi=220)

exclusion_reason_long = (
    session_exclusion_table[["session_id", "participant_number", "exclusion_reasons"]]
    .explode("exclusion_reasons")
    .dropna(subset=["exclusion_reasons"])
)
exclusion_reason_counts = (
    exclusion_reason_long.groupby("exclusion_reasons", as_index=False)
    .size()
    .rename(columns={"size": "sessions_excluded"})
    .sort_values("sessions_excluded", ascending=False)
)

page_completion_rates = (
    session_exclusion_table.assign(
        page_completion_rate=np.where(
            session_exclusion_table["expected_pages"] > 0,
            session_exclusion_table["pages_completed"] / session_exclusion_table["expected_pages"],
            np.nan,
        )
    )[
        [
            "session_id",
            "participant_number",
            "pages_completed",
            "expected_pages",
            "page_completion_rate",
        ]
    ]
)

session_duration_summary = quality_report_df["session_duration_seconds"].describe().to_frame("session_duration_seconds")
page_duration_summary = (
    page_metrics["page_view_duration"].describe().to_frame("page_view_duration")
    if "page_view_duration" in page_metrics.columns
    else pd.DataFrame()
)

quality_summary_table = pd.DataFrame(
    {
        "metric": [
            "total_sessions",
            "usable_sessions",
            "excluded_sessions",
            "mean_valid_samples",
            "median_valid_ratio",
            "mean_session_duration_seconds",
        ],
        "value": [
            len(session_exclusion_table),
            int(session_exclusion_table["usable_session_flag"].sum()),
            int((~session_exclusion_table["usable_session_flag"]).sum()),
            quality_report_df["total_valid_samples"].mean(),
            quality_report_df["valid_ratio"].median(),
            quality_report_df["session_duration_seconds"].mean(),
        ],
    }
)

export_csv(valid_counts_per_participant, OUTPUT_DIRS["tables"] / "valid_counts_per_participant.csv")
export_csv(exclusion_reason_counts, OUTPUT_DIRS["tables"] / "exclusion_reason_counts.csv")
export_csv(page_completion_rates, OUTPUT_DIRS["tables"] / "page_completion_rates.csv")
export_csv(session_duration_summary.reset_index(), OUTPUT_DIRS["tables"] / "session_duration_summary.csv")
if not page_duration_summary.empty:
    export_csv(page_duration_summary.reset_index(), OUTPUT_DIRS["tables"] / "page_duration_summary.csv")
export_csv(quality_summary_table, OUTPUT_DIRS["reports"] / "quality_report_summary.csv")

display(quality_summary_table)
display(exclusion_reason_counts)


# %% [markdown]
# ## Part 5 — Participant Profile Summaries

# %%
PROFILE_COLUMNS = [
    "age_category",
    "province",
    "gender_identity",
    "shopping_frequency",
    "device_type",
    "retailer_familiarity",
]


def frequency_table(df: pd.DataFrame, column: str) -> pd.DataFrame:
    counts = df[column].fillna("Missing").value_counts(dropna=False).rename_axis(column).reset_index(name="count")
    counts["percentage"] = counts["count"] / counts["count"].sum() * 100
    return counts


participant_profile_tables = {
    column: frequency_table(participants, column) for column in PROFILE_COLUMNS if column in participants.columns
}

for column, table in participant_profile_tables.items():
    export_csv(table, OUTPUT_DIRS["tables"] / f"profile_{column}.csv")

profile_cross_tabs = {
    "age_by_province": pd.crosstab(
        participants["province"].fillna("Missing"),
        participants["age_category"].fillna("Missing"),
        margins=True,
    ),
    "device_by_shopping_frequency": pd.crosstab(
        participants["device_type"].fillna("Missing"),
        participants["shopping_frequency"].fillna("Missing"),
        margins=True,
    ),
}

for name, ctab in profile_cross_tabs.items():
    ctab.to_csv(OUTPUT_DIRS["tables"] / f"{name}.csv")

fig, axes = plt.subplots(3, 2, figsize=(16, 13))
axes = axes.flatten()
for ax, column in zip(axes, PROFILE_COLUMNS):
    if column not in participants.columns:
        ax.axis("off")
        continue
    table = participant_profile_tables[column]
    ax.bar(table[column].astype(str), table["count"], color="#8a5a34")
    ax.set_title(column.replace("_", " ").title())
    ax.tick_params(axis="x", rotation=45)
    ax.set_ylabel("Count")
for ax in axes[len(PROFILE_COLUMNS):]:
    ax.axis("off")
fig.tight_layout()
fig.savefig(OUTPUT_DIRS["figures"] / "participant_profile_count_plots.png", dpi=220)

age_by_province_pct = profile_cross_tabs["age_by_province"].drop(index="All", errors="ignore").drop(columns="All", errors="ignore")
age_by_province_pct = age_by_province_pct.div(age_by_province_pct.sum(axis=1), axis=0).fillna(0)
fig, ax = plt.subplots(figsize=(12, 6))
bottom = np.zeros(len(age_by_province_pct))
for age_group in age_by_province_pct.columns:
    ax.bar(age_by_province_pct.index, age_by_province_pct[age_group], bottom=bottom, label=age_group)
    bottom += age_by_province_pct[age_group].to_numpy()
ax.set_title("Age category composition by province")
ax.set_ylabel("Proportion")
ax.tick_params(axis="x", rotation=45)
ax.legend(title="Age category", bbox_to_anchor=(1.02, 1), loc="upper left")
fig.tight_layout()
fig.savefig(OUTPUT_DIRS["figures"] / "participant_profile_stacked_age_by_province.png", dpi=220)

device_by_frequency_pct = profile_cross_tabs["device_by_shopping_frequency"].drop(index="All", errors="ignore").drop(columns="All", errors="ignore")
device_by_frequency_pct = device_by_frequency_pct.div(device_by_frequency_pct.sum(axis=1), axis=0).fillna(0)
fig, ax = plt.subplots(figsize=(12, 6))
bottom = np.zeros(len(device_by_frequency_pct))
for freq in device_by_frequency_pct.columns:
    ax.bar(device_by_frequency_pct.index, device_by_frequency_pct[freq], bottom=bottom, label=freq)
    bottom += device_by_frequency_pct[freq].to_numpy()
ax.set_title("Shopping frequency mix by device type")
ax.set_ylabel("Proportion")
ax.tick_params(axis="x", rotation=45)
ax.legend(title="Shopping frequency", bbox_to_anchor=(1.02, 1), loc="upper left")
fig.tight_layout()
fig.savefig(OUTPUT_DIRS["figures"] / "participant_profile_stacked_device_by_frequency.png", dpi=220)


# %% [markdown]
# ## Part 6 — Choice Share Analysis

# %%
choice_enriched = session_choice_df.copy()

choice_summary = (
    choice_enriched.groupby(
        ["page_id", "case_id", "case_family", "template_type", "selected_option"],
        dropna=False,
        as_index=False,
    )
    .size()
    .rename(columns={"size": "count_selected"})
)
page_totals = choice_summary.groupby("page_id", as_index=False)["count_selected"].sum().rename(columns={"count_selected": "page_total"})
choice_summary = choice_summary.merge(page_totals, on="page_id", how="left")
choice_summary["share_selected"] = np.where(
    choice_summary["page_total"] > 0,
    choice_summary["count_selected"] / choice_summary["page_total"],
    np.nan,
)
choice_summary["top_option_flag"] = (
    choice_summary.groupby("page_id")["share_selected"].transform("max") == choice_summary["share_selected"]
)

export_csv(choice_summary, OUTPUT_DIRS["tables"] / "choice_share_summary.csv")

fig, ax = plt.subplots(figsize=(14, 6))
for option in sorted(choice_summary["selected_option"].dropna().unique()):
    subset = choice_summary.loc[choice_summary["selected_option"] == option]
    ax.bar(
        subset["page_id"].astype(str) + f" | {option}",
        subset["share_selected"],
        label=str(option),
    )
ax.set_title("Choice share by page and option")
ax.set_ylabel("Selection share")
ax.tick_params(axis="x", rotation=90)
fig.tight_layout()
fig.savefig(OUTPUT_DIRS["figures"] / "choice_share_by_page.png", dpi=220)

for subgroup in ["province", "age_category", "device_type", "retailer_familiarity"]:
    if subgroup not in choice_enriched.columns:
        continue
    subgroup_summary = (
        choice_enriched.groupby(
            [subgroup, "page_id", "case_id", "selected_option"],
            dropna=False,
            as_index=False,
        )
        .size()
        .rename(columns={"size": "count_selected"})
    )
    subgroup_totals = subgroup_summary.groupby([subgroup, "page_id"], as_index=False)["count_selected"].sum().rename(
        columns={"count_selected": "subgroup_page_total"}
    )
    subgroup_summary = subgroup_summary.merge(subgroup_totals, on=[subgroup, "page_id"], how="left")
    subgroup_summary["share_selected"] = np.where(
        subgroup_summary["subgroup_page_total"] > 0,
        subgroup_summary["count_selected"] / subgroup_summary["subgroup_page_total"],
        np.nan,
    )
    export_csv(subgroup_summary, OUTPUT_DIRS["tables"] / f"choice_share_by_{subgroup}.csv")

winning_options = choice_summary.loc[choice_summary["top_option_flag"]].sort_values(["page_id", "selected_option"])
publication_choice_summary = winning_options[
    ["page_id", "case_id", "selected_option", "count_selected", "share_selected"]
].rename(columns={"selected_option": "winning_option"})
export_csv(publication_choice_summary, OUTPUT_DIRS["reports"] / "which_version_won_by_case.csv")
display(publication_choice_summary)


# %% [markdown]
# ## Part 7 — AOI Mapping and Attention Metric Creation

# %%
def normalize_aoi_label(value: Any, mapping: dict[str, str]) -> str:
    if pd.isna(value):
        return "Outside AOI"
    slug = re.sub(r"[^a-z0-9]+", "_", str(value).strip().lower()).strip("_")
    return mapping.get(slug, str(value).replace("_", " ").title())


def prepare_aoi_definitions(aoi_df: pd.DataFrame, mapping: dict[str, str]) -> pd.DataFrame:
    out = aoi_df.copy()
    if out.empty:
        return out
    for col in ["x_min", "x_max", "y_min", "y_max"]:
        if col in out.columns:
            out[col] = pd.to_numeric(out[col], errors="coerce")
    out["aoi_label"] = out["aoi_type"].apply(lambda v: normalize_aoi_label(v, mapping))
    return out


def build_page_time_lookup(gaze_df: pd.DataFrame, page_views_df: pd.DataFrame) -> pd.DataFrame:
    starts = infer_page_start_times(gaze_df, page_views_df)
    if not page_views_df.empty and {"session_id", "page_id", "total_duration", "response_duration"}.issubset(page_views_df.columns):
        subset = page_views_df[["session_id", "page_id", "total_duration", "response_duration", "stimulus_duration"]].copy()
        subset["total_duration"] = pd.to_numeric(subset["total_duration"], errors="coerce")
        subset["response_duration"] = pd.to_numeric(subset["response_duration"], errors="coerce")
        subset["stimulus_duration"] = pd.to_numeric(subset["stimulus_duration"], errors="coerce")
        starts = starts.merge(subset, on=["session_id", "page_id"], how="left")
    return starts


def add_elapsed_time(gaze_df: pd.DataFrame, page_time_lookup: pd.DataFrame) -> pd.DataFrame:
    out = gaze_df.merge(page_time_lookup, on=["session_id", "page_id"], how="left")
    out["elapsed_ms"] = (
        (out["sample_timestamp"] - out["page_start_time"]).dt.total_seconds() * 1000.0
    )
    out["elapsed_ms"] = out["elapsed_ms"].clip(lower=0)
    return out


def map_gaze_points_to_aoi(
    gaze_df: pd.DataFrame,
    aoi_df: pd.DataFrame,
    config: NotebookConfig,
) -> tuple[pd.DataFrame, pd.DataFrame]:
    if gaze_df.empty:
        return pd.DataFrame(), pd.DataFrame()

    gaze_valid = gaze_df.copy()
    gaze_valid["x_norm_clean"] = pd.to_numeric(gaze_valid["x_norm_clean"], errors="coerce")
    gaze_valid["y_norm_clean"] = pd.to_numeric(gaze_valid["y_norm_clean"], errors="coerce")
    gaze_valid["is_valid"] = gaze_valid["is_valid"].fillna(False)

    if aoi_df.empty:
        outside = gaze_valid.copy()
        outside["aoi_type"] = "outside_aoi"
        outside["aoi_label"] = "Outside AOI"
        outside["inside_aoi"] = False
        return outside, pd.DataFrame()

    merged = gaze_valid.merge(aoi_df, on="page_id", how="left", suffixes=("", "_aoi"))
    inside = merged.loc[
        merged["x_norm_clean"].notna()
        & merged["y_norm_clean"].notna()
        & merged["x_min"].notna()
        & merged["x_max"].notna()
        & merged["y_min"].notna()
        & merged["y_max"].notna()
        & merged["x_norm_clean"].between(merged["x_min"], merged["x_max"])
        & merged["y_norm_clean"].between(merged["y_min"], merged["y_max"])
    ].copy()
    inside["inside_aoi"] = True

    matched_ids = inside["gaze_id"].dropna().unique()
    outside = gaze_valid.loc[~gaze_valid["gaze_id"].isin(matched_ids)].copy()
    outside["aoi_id"] = pd.NA
    outside["aoi_type"] = "outside_aoi"
    outside["aoi_label"] = "Outside AOI"
    outside["inside_aoi"] = False
    outside["x_min"] = np.nan
    outside["x_max"] = np.nan
    outside["y_min"] = np.nan
    outside["y_max"] = np.nan

    aoi_events = pd.concat([inside, outside], ignore_index=True, sort=False)
    aoi_events = aoi_events.sort_values(["session_id", "page_id", "sample_timestamp", "gaze_id"], kind="stable").reset_index(drop=True)

    aoi_events["next_timestamp"] = aoi_events.groupby(["session_id", "page_id"])["sample_timestamp"].shift(-1)
    gap = (aoi_events["next_timestamp"] - aoi_events["sample_timestamp"]).dt.total_seconds() * 1000.0
    aoi_events["sample_gap_ms"] = gap.clip(lower=0).fillna(0)
    aoi_events["sample_gap_ms_capped"] = aoi_events["sample_gap_ms"].clip(upper=config.max_inter_sample_gap_ms)

    aoi_events["aoi_label"] = aoi_events["aoi_label"].fillna(
        aoi_events["aoi_type"].apply(lambda v: normalize_aoi_label(v, config.aoi_label_mapping))
    )
    return aoi_events, inside


def build_fixation_proxy_table(aoi_events_df: pd.DataFrame) -> pd.DataFrame:
    if aoi_events_df.empty:
        return pd.DataFrame()

    events = aoi_events_df.sort_values(
        ["session_id", "page_id", "sample_timestamp", "gaze_id"],
        kind="stable",
    ).copy()

    events["prev_aoi"] = events.groupby(["session_id", "page_id"])["aoi_label"].shift(1)
    events["new_visit"] = (
        events["aoi_label"] != events["prev_aoi"]
    ) | events["prev_aoi"].isna()
    events["visit_sequence_id"] = events.groupby(["session_id", "page_id"])["new_visit"].cumsum()

    fixation_proxy = (
        events.groupby(["session_id", "page_id", "visit_sequence_id", "aoi_label"], as_index=False)
        .agg(
            aoi_type=("aoi_type", "first"),
            visit_start=("sample_timestamp", "min"),
            visit_end=("sample_timestamp", "max"),
            visit_samples=("gaze_id", "count"),
            visit_dwell_ms=("sample_gap_ms_capped", "sum"),
            first_elapsed_ms=("elapsed_ms", "min"),
            last_elapsed_ms=("elapsed_ms", "max"),
        )
    )
    fixation_proxy["return_index"] = fixation_proxy.groupby(["session_id", "page_id", "aoi_label"]).cumcount()
    return fixation_proxy


prepared_aoi_definitions = prepare_aoi_definitions(aoi_definitions, CONFIG.aoi_label_mapping)
page_time_lookup = build_page_time_lookup(gaze_data, page_views)
gaze_data = add_elapsed_time(gaze_data, page_time_lookup)
gaze_with_aoi_df, matched_aoi_hits_df = map_gaze_points_to_aoi(gaze_data, prepared_aoi_definitions, CONFIG)
fixation_proxy_df = build_fixation_proxy_table(gaze_with_aoi_df)

aoi_metric_df = (
    gaze_with_aoi_df.groupby(["session_id", "page_id", "aoi_label", "aoi_type"], as_index=False)
    .agg(
        total_dwell_time_ms=("sample_gap_ms_capped", "sum"),
        fixation_proxy_count=("aoi_label", "size"),
        ttff_ms=("elapsed_ms", "min"),
        first_elapsed_ms=("elapsed_ms", "min"),
        last_elapsed_ms=("elapsed_ms", "max"),
    )
)

page_total_dwell = aoi_metric_df.groupby(["session_id", "page_id"], as_index=False)["total_dwell_time_ms"].sum().rename(
    columns={"total_dwell_time_ms": "page_total_dwell_ms"}
)
aoi_metric_df = aoi_metric_df.merge(page_total_dwell, on=["session_id", "page_id"], how="left")
aoi_metric_df["dwell_share"] = np.where(
    aoi_metric_df["page_total_dwell_ms"] > 0,
    aoi_metric_df["total_dwell_time_ms"] / aoi_metric_df["page_total_dwell_ms"],
    np.nan,
)

first_aoi_viewed = (
    fixation_proxy_df.sort_values(["session_id", "page_id", "visit_start"])
    .groupby(["session_id", "page_id"], as_index=False)
    .first()[["session_id", "page_id", "aoi_label"]]
    .rename(columns={"aoi_label": "first_aoi_viewed"})
    if not fixation_proxy_df.empty
    else pd.DataFrame(columns=["session_id", "page_id", "first_aoi_viewed"])
)

aoi_visit_order = (
    fixation_proxy_df.sort_values(["session_id", "page_id", "visit_start"])
    .groupby(["session_id", "page_id"])["aoi_label"]
    .apply(list)
    .reset_index(name="aoi_visit_order")
    if not fixation_proxy_df.empty
    else pd.DataFrame(columns=["session_id", "page_id", "aoi_visit_order"])
)

aoi_returns = (
    fixation_proxy_df.groupby(["session_id", "page_id", "aoi_label"], as_index=False)
    .agg(number_of_returns=("return_index", lambda s: max(len(s) - 1, 0)))
    if not fixation_proxy_df.empty
    else pd.DataFrame(columns=["session_id", "page_id", "aoi_label", "number_of_returns"])
)

last_aoi_before_choice = pd.DataFrame(columns=["session_id", "page_id", "last_aoi_before_choice"])

export_csv(gaze_with_aoi_df, OUTPUT_DIRS["clean"] / "gaze_with_aoi.csv")
export_csv(aoi_metric_df, OUTPUT_DIRS["tables"] / "aoi_metrics.csv")
export_csv(fixation_proxy_df, OUTPUT_DIRS["tables"] / "fixation_proxy_table.csv")


# %% [markdown]
# ## Part 8 — Dwell Time Analysis

# %%
def choose_statistical_test(groups: list[np.ndarray]) -> str:
    clean_groups = [g[~np.isnan(g)] for g in groups if len(g[~np.isnan(g)]) > 0]
    if len(clean_groups) < 2:
        return "insufficient_data"

    normal_flags = []
    for group in clean_groups:
        if len(group) < 3:
            normal_flags.append(False)
            continue
        sample = group[: min(len(group), 5000)]
        try:
            normal_flags.append(stats.shapiro(sample).pvalue > 0.05)
        except Exception:
            normal_flags.append(False)

    if len(clean_groups) == 2:
        return "t_test" if all(normal_flags) else "mannwhitney"
    return "anova" if all(normal_flags) else "kruskal"


def run_group_comparison(data: pd.DataFrame, value_col: str, group_col: str) -> dict[str, Any]:
    subset = data[[group_col, value_col]].dropna()
    groups = [group[value_col].to_numpy() for _, group in subset.groupby(group_col)]
    test_name = choose_statistical_test(groups)

    result: dict[str, Any] = {"test": test_name, "group_col": group_col, "value_col": value_col}
    try:
        if test_name == "t_test" and len(groups) == 2:
            stat, p_value = stats.ttest_ind(groups[0], groups[1], equal_var=False, nan_policy="omit")
        elif test_name == "mannwhitney" and len(groups) == 2:
            stat, p_value = stats.mannwhitneyu(groups[0], groups[1], alternative="two-sided")
        elif test_name == "anova":
            stat, p_value = stats.f_oneway(*groups)
        elif test_name == "kruskal":
            stat, p_value = stats.kruskal(*groups)
        else:
            stat, p_value = np.nan, np.nan
    except Exception:
        stat, p_value = np.nan, np.nan

    result.update({"statistic": stat, "p_value": p_value, "group_count": len(groups)})
    return result


dwell_analysis_df = aoi_metric_df.copy()
if not dwell_analysis_df.empty:
    dwell_analysis_df = dwell_analysis_df.merge(
        session_choice_df[
            [
                "session_id",
                "page_id",
                "participant_id",
                "age_category",
                "province",
                "device_type",
                "selected_option",
                "case_family",
                "template_type",
                "case_id",
            ]
        ].drop_duplicates(),
        on=["session_id", "page_id"],
        how="left",
    )

    fig, axes = plt.subplots(1, 3, figsize=(18, 6))
    dwell_analysis_df.boxplot(column="total_dwell_time_ms", by="aoi_label", ax=axes[0], rot=45)
    axes[0].set_title("Dwell time by AOI")
    axes[0].set_xlabel("AOI")
    axes[0].set_ylabel("Dwell time (ms)")
    axes[0].get_figure().suptitle("")

    violin_data = [group["total_dwell_time_ms"].to_numpy() for _, group in dwell_analysis_df.groupby("aoi_label")]
    violin_labels = list(dwell_analysis_df["aoi_label"].dropna().unique())
    axes[1].violinplot(violin_data, showmeans=True, showextrema=True)
    axes[1].set_xticks(range(1, len(violin_labels) + 1))
    axes[1].set_xticklabels(violin_labels, rotation=45, ha="right")
    axes[1].set_title("AOI dwell time violin plot")
    axes[1].set_ylabel("Dwell time (ms)")

    axes[2].hist(dwell_analysis_df["total_dwell_time_ms"].dropna(), bins=30, color="#7c553a", edgecolor="white")
    axes[2].set_title("Distribution of AOI dwell time")
    axes[2].set_xlabel("Dwell time (ms)")
    axes[2].set_ylabel("Count")
    fig.tight_layout()
    fig.savefig(OUTPUT_DIRS["figures"] / "dwell_time_overview.png", dpi=220)

    dwell_stats_tests = pd.DataFrame(
        [
            run_group_comparison(dwell_analysis_df, "total_dwell_time_ms", group_col)
            for group_col in ["aoi_label", "age_category", "province", "device_type"]
            if group_col in dwell_analysis_df.columns
        ]
    )
    export_csv(dwell_analysis_df, OUTPUT_DIRS["tables"] / "dwell_analysis_dataset.csv")
    export_csv(dwell_stats_tests, OUTPUT_DIRS["reports"] / "dwell_time_statistical_tests.csv")
else:
    dwell_stats_tests = pd.DataFrame()


# %% [markdown]
# ## Part 9 — Time to First Fixation (TTFF) Analysis

# %%
def mean_ci(series: pd.Series, confidence: float = 0.95) -> tuple[float, float, float]:
    clean = pd.to_numeric(series, errors="coerce").dropna()
    if clean.empty:
        return np.nan, np.nan, np.nan
    mean_value = clean.mean()
    if len(clean) < 2:
        return mean_value, np.nan, np.nan
    sem = stats.sem(clean, nan_policy="omit")
    interval = stats.t.interval(confidence, len(clean) - 1, loc=mean_value, scale=sem)
    return mean_value, interval[0], interval[1]


ttff_df = aoi_metric_df.copy()
if not ttff_df.empty:
    ttff_df = ttff_df.merge(
        session_choice_df[
            [
                "session_id",
                "page_id",
                "participant_id",
                "age_category",
                "province",
                "device_type",
                "selected_option",
                "case_family",
                "template_type",
                "case_id",
            ]
        ].drop_duplicates(),
        on=["session_id", "page_id"],
        how="left",
    )

    ttff_summary = (
        ttff_df.groupby(["aoi_label", "case_family", "template_type"], as_index=False)
        .agg(
            mean_ttff_ms=("ttff_ms", "mean"),
            median_ttff_ms=("ttff_ms", "median"),
            count=("ttff_ms", "count"),
            std_ttff_ms=("ttff_ms", "std"),
        )
    )
    ci_values = ttff_summary.apply(
        lambda row: mean_ci(
            ttff_df.loc[
                (ttff_df["aoi_label"] == row["aoi_label"])
                & (ttff_df["case_family"] == row["case_family"])
                & (ttff_df["template_type"] == row["template_type"]),
                "ttff_ms",
            ]
        ),
        axis=1,
        result_type="expand",
    )
    ttff_summary[["mean_ttff_ms", "ci_low_ms", "ci_high_ms"]] = ci_values

    export_csv(ttff_summary, OUTPUT_DIRS["tables"] / "ttff_summary.csv")

    fig, ax = plt.subplots(figsize=(14, 6))
    for aoi_label, subset in ttff_summary.groupby("aoi_label"):
        ax.errorbar(
            subset["template_type"].astype(str) + " | " + subset["case_family"].astype(str),
            subset["mean_ttff_ms"],
            yerr=[
                subset["mean_ttff_ms"] - subset["ci_low_ms"],
                subset["ci_high_ms"] - subset["mean_ttff_ms"],
            ],
            fmt="o",
            capsize=4,
            label=aoi_label,
        )
    ax.set_title("Mean TTFF with confidence intervals")
    ax.set_ylabel("TTFF (ms)")
    ax.tick_params(axis="x", rotation=45)
    ax.legend(title="AOI")
    fig.tight_layout()
    fig.savefig(OUTPUT_DIRS["figures"] / "ttff_confidence_intervals.png", dpi=220)

    ttff_tests = pd.DataFrame(
        [
            run_group_comparison(ttff_df, "ttff_ms", group_col)
            for group_col in ["aoi_label", "case_family", "template_type", "age_category", "province", "device_type"]
            if group_col in ttff_df.columns
        ]
    )
    export_csv(ttff_tests, OUTPUT_DIRS["reports"] / "ttff_statistical_tests.csv")
else:
    ttff_summary = pd.DataFrame()
    ttff_tests = pd.DataFrame()


# %% [markdown]
# ## Part 10 — Heatmap Generation

# %%
def slugify(value: Any) -> str:
    return re.sub(r"[^a-z0-9]+", "_", str(value).strip().lower()).strip("_")


def load_page_background(page_id: str, config: NotebookConfig) -> tuple[np.ndarray, int, int]:
    candidates = [
        config.screenshot_dir / f"{page_id}.png",
        config.screenshot_dir / f"{page_id}.jpg",
        config.screenshot_dir / f"{page_id}.jpeg",
    ]
    for candidate in candidates:
        if candidate.exists():
            image = Image.open(candidate).convert("RGBA")
            width, height = image.size
            return np.array(image), width, height

    width, height = 1600, 900
    fallback = np.full((height, width, 4), 255, dtype=np.uint8)
    return fallback, width, height


def build_density_map(points_df: pd.DataFrame, width: int, height: int, bins: int = 200, smooth_sigma: float = 10.0) -> np.ndarray:
    if points_df.empty:
        return np.zeros((height, width))

    x = (points_df["x_norm_clean"].clip(0, 1) * (width - 1)).to_numpy()
    y = (points_df["y_norm_clean"].clip(0, 1) * (height - 1)).to_numpy()

    heatmap, x_edges, y_edges = np.histogram2d(x, y, bins=bins, range=[[0, width], [0, height]])
    heatmap = heatmap.T
    heatmap = ndimage.gaussian_filter(heatmap, sigma=smooth_sigma)
    if heatmap.max() > 0:
        heatmap = heatmap / heatmap.max()
    return heatmap


def save_heatmap_overlay(
    points_df: pd.DataFrame,
    page_id: str,
    output_path: Path,
    config: NotebookConfig,
    title: str | None = None,
) -> Path:
    background, width, height = load_page_background(page_id, config)
    density = build_density_map(points_df, width, height)

    fig, ax = plt.subplots(figsize=(width / 160, height / 160))
    ax.imshow(background)
    ax.imshow(density, cmap="jet", alpha=0.45, extent=[0, width, height, 0])
    ax.set_xlim(0, width)
    ax.set_ylim(height, 0)
    ax.axis("off")
    if title:
        ax.set_title(title)
    fig.tight_layout(pad=0)
    fig.savefig(output_path, dpi=220, bbox_inches="tight", pad_inches=0)
    plt.close(fig)
    return output_path


def subgroup_heatmap(
    gaze_df: pd.DataFrame,
    session_choice_df: pd.DataFrame,
    page_id: str,
    subgroup_filter: pd.Series,
    suffix: str,
    config: NotebookConfig,
) -> Path | None:
    subset = gaze_df.loc[(gaze_df["page_id"] == page_id) & subgroup_filter].copy()
    if subset.empty:
        return None
    return save_heatmap_overlay(
        subset,
        page_id,
        OUTPUT_DIRS["heatmaps"] / f"heatmap_{page_id}_{suffix}.png",
        config,
    )


valid_gaze_points = gaze_data.loc[
    gaze_data["is_valid"].fillna(False)
    & gaze_data["x_norm_clean"].between(0, 1, inclusive="both")
    & gaze_data["y_norm_clean"].between(0, 1, inclusive="both")
].copy()

choice_lookup = session_choice_df[["session_id", "page_id", "selected_option", "age_category", "device_type", "province"]].drop_duplicates()
valid_gaze_points = valid_gaze_points.merge(choice_lookup, on=["session_id", "page_id"], how="left")

heatmap_exports: list[str] = []
for page_id in sorted(valid_gaze_points["page_id"].dropna().unique()):
    page_points = valid_gaze_points.loc[valid_gaze_points["page_id"] == page_id]
    path = save_heatmap_overlay(
        page_points,
        page_id,
        OUTPUT_DIRS["heatmaps"] / f"heatmap_{page_id}_combined.png",
        CONFIG,
        title=f"Combined heatmap — {page_id}",
    )
    heatmap_exports.append(str(path))

    for option in sorted(page_points["selected_option"].dropna().unique()):
        option_points = page_points.loc[page_points["selected_option"] == option]
        if option_points.empty:
            continue
        path = save_heatmap_overlay(
            option_points,
            page_id,
            OUTPUT_DIRS["heatmaps"] / f"heatmap_{page_id}_selected_{slugify(option)}.png",
            CONFIG,
            title=f"Heatmap — {page_id} — selected {option}",
        )
        heatmap_exports.append(str(path))

    younger_points = page_points.loc[page_points["age_category"].astype("string").str.contains("18|24|25-34", case=False, na=False)]
    older_points = page_points.loc[~page_points.index.isin(younger_points.index)]
    if not younger_points.empty:
        heatmap_exports.append(
            str(
                save_heatmap_overlay(
                    younger_points,
                    page_id,
                    OUTPUT_DIRS["heatmaps"] / f"heatmap_{page_id}_younger.png",
                    CONFIG,
                    title=f"Heatmap — {page_id} — younger group",
                )
            )
        )
    if not older_points.empty:
        heatmap_exports.append(
            str(
                save_heatmap_overlay(
                    older_points,
                    page_id,
                    OUTPUT_DIRS["heatmaps"] / f"heatmap_{page_id}_older.png",
                    CONFIG,
                    title=f"Heatmap — {page_id} — older group",
                )
            )
        )

heatmap_manifest = pd.DataFrame({"heatmap_file": heatmap_exports})
export_csv(heatmap_manifest, OUTPUT_DIRS["reports"] / "heatmap_manifest.csv")


# %% [markdown]
# ## Part 11 — Choice-Conditional Heatmaps and Pre-Choice Attention

# %%
def derive_pre_choice_cutoff(
    page_view_row: pd.Series | None,
    choice_row: pd.Series | None,
) -> float | None:
    if page_view_row is not None:
        for column in ["total_duration", "stimulus_duration"]:
            if column in page_view_row and pd.notna(page_view_row[column]):
                return float(page_view_row[column])
    if choice_row is not None and "response_time" in choice_row and pd.notna(choice_row["response_time"]):
        return float(choice_row["response_time"])
    return None


page_view_lookup = page_views.set_index(["session_id", "page_id"]) if not page_views.empty else None
choice_lookup_indexed = choices.set_index(["session_id", "page_id"]) if not choices.empty else None

pre_choice_rows = []
for (session_id, page_id), group in valid_gaze_points.groupby(["session_id", "page_id"]):
    pv_row = page_view_lookup.loc[(session_id, page_id)] if page_view_lookup is not None and (session_id, page_id) in page_view_lookup.index else None
    choice_row = choice_lookup_indexed.loc[(session_id, page_id)] if choice_lookup_indexed is not None and (session_id, page_id) in choice_lookup_indexed.index else None
    cutoff_ms = derive_pre_choice_cutoff(pv_row, choice_row)
    if cutoff_ms is None:
        continue
    subset = group.loc[group["elapsed_ms"] <= cutoff_ms].copy()
    subset["pre_choice_cutoff_ms"] = cutoff_ms
    pre_choice_rows.append(subset)

pre_choice_gaze_df = pd.concat(pre_choice_rows, ignore_index=True) if pre_choice_rows else pd.DataFrame()
export_csv(pre_choice_gaze_df, OUTPUT_DIRS["clean"] / "pre_choice_gaze_data.csv")

pre_choice_aoi_events = pd.DataFrame()
pre_choice_aoi_metrics = pd.DataFrame()
pre_choice_first_look = pd.DataFrame()
if not pre_choice_gaze_df.empty:
    pre_choice_aoi_events, _ = map_gaze_points_to_aoi(pre_choice_gaze_df, prepared_aoi_definitions, CONFIG)
    pre_choice_fixation_proxy = build_fixation_proxy_table(pre_choice_aoi_events)

    pre_choice_aoi_metrics = (
        pre_choice_aoi_events.groupby(["session_id", "page_id", "aoi_label", "selected_option"], as_index=False)
        .agg(
            pre_choice_dwell_ms=("sample_gap_ms_capped", "sum"),
            pre_choice_ttff_ms=("elapsed_ms", "min"),
            pre_choice_sample_hits=("gaze_id", "count"),
        )
    )

    pre_choice_first_look = (
        pre_choice_fixation_proxy.sort_values(["session_id", "page_id", "visit_start"])
        .groupby(["session_id", "page_id"], as_index=False)
        .first()[["session_id", "page_id", "aoi_label"]]
        .rename(columns={"aoi_label": "pre_choice_first_aoi"})
    )

    export_csv(pre_choice_aoi_metrics, OUTPUT_DIRS["tables"] / "pre_choice_aoi_metrics.csv")
    export_csv(pre_choice_first_look, OUTPUT_DIRS["tables"] / "pre_choice_first_look.csv")

    for page_id, page_points in pre_choice_gaze_df.groupby("page_id"):
        save_heatmap_overlay(
            page_points,
            page_id,
            OUTPUT_DIRS["heatmaps"] / f"heatmap_{page_id}_pre_choice_combined.png",
            CONFIG,
            title=f"Pre-choice heatmap — {page_id}",
        )
        for option, option_points in page_points.groupby("selected_option"):
            if pd.isna(option) or option_points.empty:
                continue
            save_heatmap_overlay(
                option_points,
                page_id,
                OUTPUT_DIRS["heatmaps"] / f"heatmap_{page_id}_pre_choice_selected_{slugify(option)}.png",
                CONFIG,
                title=f"Pre-choice heatmap — {page_id} — selected {option}",
            )

        option_groups = {str(opt): grp for opt, grp in page_points.groupby("selected_option") if pd.notna(opt)}
        if len(option_groups) >= 2:
            options = list(option_groups.keys())[:2]
            bg, width, height = load_page_background(page_id, CONFIG)
            density_a = build_density_map(option_groups[options[0]], width, height)
            density_b = build_density_map(option_groups[options[1]], width, height)
            diff = density_a - density_b

            fig, ax = plt.subplots(figsize=(width / 160, height / 160))
            ax.imshow(bg)
            ax.imshow(diff, cmap="bwr", alpha=0.45, extent=[0, width, height, 0], vmin=-1, vmax=1)
            ax.axis("off")
            ax.set_title(f"Pre-choice difference heatmap — {options[0]} minus {options[1]}")
            fig.tight_layout(pad=0)
            fig.savefig(
                OUTPUT_DIRS["heatmaps"] / f"heatmap_{page_id}_pre_choice_difference_{slugify(options[0])}_minus_{slugify(options[1])}.png",
                dpi=220,
                bbox_inches="tight",
                pad_inches=0,
            )
            plt.close(fig)


# %% [markdown]
# ## Part 12 — Scanpath and Transition Analysis

# %%
transition_table = pd.DataFrame()
transition_matrix = pd.DataFrame()
scanpath_examples = pd.DataFrame()

if not fixation_proxy_df.empty:
    scanpath_events = fixation_proxy_df.sort_values(["session_id", "page_id", "visit_start"], kind="stable").copy()
    scanpath_events["next_aoi"] = scanpath_events.groupby(["session_id", "page_id"])["aoi_label"].shift(-1)
    scanpath_events["next_selected_option"] = scanpath_events.groupby(["session_id", "page_id"])["aoi_label"].shift(-1)
    transitions = scanpath_events.loc[scanpath_events["next_aoi"].notna()].copy()
    transition_table = (
        transitions.groupby(["aoi_label", "next_aoi"], as_index=False)
        .size()
        .rename(columns={"size": "transition_count", "aoi_label": "from_aoi", "next_aoi": "to_aoi"})
    )
    transition_totals = transition_table.groupby("from_aoi", as_index=False)["transition_count"].sum().rename(columns={"transition_count": "from_total"})
    transition_table = transition_table.merge(transition_totals, on="from_aoi", how="left")
    transition_table["transition_probability"] = np.where(
        transition_table["from_total"] > 0,
        transition_table["transition_count"] / transition_table["from_total"],
        np.nan,
    )

    export_csv(transition_table, OUTPUT_DIRS["tables"] / "transition_table.csv")

    transition_matrix = transition_table.pivot(index="from_aoi", columns="to_aoi", values="transition_probability").fillna(0)
    fig, ax = plt.subplots(figsize=(10, 8))
    cax = ax.imshow(transition_matrix.values, cmap="copper")
    ax.set_xticks(range(len(transition_matrix.columns)))
    ax.set_xticklabels(transition_matrix.columns, rotation=45, ha="right")
    ax.set_yticks(range(len(transition_matrix.index)))
    ax.set_yticklabels(transition_matrix.index)
    ax.set_title("AOI transition probability matrix")
    fig.colorbar(cax, ax=ax, shrink=0.8)
    fig.tight_layout()
    fig.savefig(OUTPUT_DIRS["figures"] / "transition_probability_matrix.png", dpi=220)

    scanpath_examples = (
        scanpath_events.groupby(["session_id", "page_id"])["aoi_label"]
        .apply(lambda s: " -> ".join(map(str, s.tolist())))
        .reset_index(name="scanpath_sequence")
    )
    export_csv(scanpath_examples, OUTPUT_DIRS["tables"] / "scanpath_sequences.csv")

    if CONFIG.generate_plotly_outputs and go is not None and not transition_table.empty:
        labels = pd.Index(pd.concat([transition_table["from_aoi"], transition_table["to_aoi"]])).unique()
        label_to_index = {label: idx for idx, label in enumerate(labels)}
        sankey = go.Figure(
            data=[
                go.Sankey(
                    node={"label": list(labels)},
                    link={
                        "source": transition_table["from_aoi"].map(label_to_index),
                        "target": transition_table["to_aoi"].map(label_to_index),
                        "value": transition_table["transition_count"],
                    },
                )
            ]
        )
        sankey.update_layout(title_text="AOI transition Sankey")
        sankey.write_html(OUTPUT_DIRS["figures"] / "transition_sankey.html")


# %% [markdown]
# ## Part 13 — Segment Comparison Analysis

# %%
segment_metrics_df = pd.DataFrame()
segment_tests_df = pd.DataFrame()

if not aoi_metric_df.empty:
    segment_metrics_df = aoi_metric_df.merge(
        participant_session_df[
            ["session_id", "participant_id", "participant_number", "age_category", "province", "gender_identity", "device_type", "shopping_frequency", "retailer_familiarity"]
        ],
        on="session_id",
        how="left",
    ).merge(
        pages[["page_id", "case_id", "case_family", "template_type", "stimulus_name"]],
        on="page_id",
        how="left",
    )

    export_csv(segment_metrics_df, OUTPUT_DIRS["tables"] / "segment_metrics_dataset.csv")

    segment_tests = []
    for segment_col in ["age_category", "province", "gender_identity", "device_type", "shopping_frequency", "retailer_familiarity"]:
        if segment_col not in segment_metrics_df.columns:
            continue
        counts = segment_metrics_df[segment_col].value_counts(dropna=False)
        if counts.max() < 2 or counts.size < 2:
            continue
        segment_tests.append(run_group_comparison(segment_metrics_df, "total_dwell_time_ms", segment_col))
        segment_tests.append(run_group_comparison(segment_metrics_df, "ttff_ms", segment_col))

    segment_tests_df = pd.DataFrame(segment_tests)
    export_csv(segment_tests_df, OUTPUT_DIRS["reports"] / "segment_comparison_tests.csv")

    fig, axes = plt.subplots(2, 2, figsize=(16, 10))
    plot_specs = [
        ("age_category", "total_dwell_time_ms", "Dwell by age category"),
        ("province", "ttff_ms", "TTFF by province"),
        ("device_type", "dwell_share", "Dwell share by device type"),
        ("retailer_familiarity", "total_dwell_time_ms", "Dwell by retailer familiarity"),
    ]
    for ax, (group_col, value_col, title) in zip(axes.flatten(), plot_specs):
        if group_col not in segment_metrics_df.columns or value_col not in segment_metrics_df.columns:
            ax.axis("off")
            continue
        grouped = segment_metrics_df[[group_col, value_col]].dropna()
        box_data = [grp[value_col].to_numpy() for _, grp in grouped.groupby(group_col)]
        labels = list(grouped[group_col].dropna().unique())
        if not box_data:
            ax.axis("off")
            continue
        ax.boxplot(box_data, labels=labels)
        ax.set_title(title)
        ax.tick_params(axis="x", rotation=45)
    fig.tight_layout()
    fig.savefig(OUTPUT_DIRS["figures"] / "segment_comparison_panels.png", dpi=220)


# %% [markdown]
# ## Part 14 — Choice-Attention Relationship Analysis

# %%
def pivot_aoi_features(aoi_metrics_df: pd.DataFrame) -> pd.DataFrame:
    if aoi_metrics_df.empty:
        return pd.DataFrame()

    wide = aoi_metrics_df.pivot_table(
        index=["session_id", "page_id"],
        columns="aoi_label",
        values=["total_dwell_time_ms", "ttff_ms", "dwell_share"],
        aggfunc="mean",
    )
    wide.columns = [
        f"{metric}__{slugify(aoi_label)}"
        for metric, aoi_label in wide.columns.to_flat_index()
    ]
    wide = wide.reset_index()
    return wide


def compute_vif(frame: pd.DataFrame) -> pd.DataFrame:
    if variance_inflation_factor is None or frame.empty:
        return pd.DataFrame()
    numeric = frame.select_dtypes(include=["number"]).dropna()
    if numeric.empty or numeric.shape[1] < 2:
        return pd.DataFrame()
    vif_df = pd.DataFrame(
        {
            "feature": numeric.columns,
            "vif": [variance_inflation_factor(numeric.values, i) for i in range(numeric.shape[1])],
        }
    )
    return vif_df


model_features = pivot_aoi_features(aoi_metric_df)
choice_model_dataset = (
    session_choice_df.merge(model_features, on=["session_id", "page_id"], how="left")
    .merge(
        participant_session_df[
            [
                "session_id",
                "participant_number",
                "age_category",
                "province",
                "gender_identity",
                "shopping_frequency",
                "device_type",
                "retailer_familiarity",
            ]
        ],
        on="session_id",
        how="left",
    )
)

choice_model_dataset["option_count"] = choice_model_dataset.groupby("page_id")["selected_option"].transform("nunique")
export_csv(choice_model_dataset, OUTPUT_DIRS["clean"] / "choice_model_dataset.csv")

model_summary_text = "Choice-attention models were not run."
model_feature_importance = pd.DataFrame()

if not choice_model_dataset.empty and choice_model_dataset["selected_option"].nunique() >= 2:
    numeric_feature_cols = [
        col
        for col in choice_model_dataset.columns
        if col.startswith("total_dwell_time_ms__")
        or col.startswith("ttff_ms__")
        or col.startswith("dwell_share__")
    ]
    categorical_feature_cols = [
        col
        for col in [
            "age_category",
            "province",
            "gender_identity",
            "shopping_frequency",
            "device_type",
            "retailer_familiarity",
            "case_family",
            "template_type",
        ]
        if col in choice_model_dataset.columns
    ]

    model_input = choice_model_dataset[["selected_option"] + numeric_feature_cols + categorical_feature_cols].dropna(
        subset=["selected_option"]
    ).copy()
    model_input[numeric_feature_cols] = model_input[numeric_feature_cols].apply(pd.to_numeric, errors="coerce")

    if sm is not None and numeric_feature_cols:
        encoded = pd.get_dummies(model_input[categorical_feature_cols], drop_first=True, dummy_na=False)
        X = pd.concat([model_input[numeric_feature_cols].fillna(0), encoded], axis=1)
        y = model_input["selected_option"].astype("category")
        X_const = sm.add_constant(X, has_constant="add")

        vif_table = compute_vif(X.fillna(0))
        if not vif_table.empty:
            export_csv(vif_table, OUTPUT_DIRS["reports"] / "choice_model_vif.csv")

        try:
            if y.nunique() == 2:
                y_binary = pd.Categorical(y).codes
                logit_model = sm.Logit(y_binary, X_const).fit(disp=False)
                model_summary_text = logit_model.summary().as_text()
                coef_df = logit_model.params.reset_index()
                coef_df.columns = ["feature", "coefficient"]
                export_csv(coef_df, OUTPUT_DIRS["reports"] / "choice_logit_coefficients.csv")
            else:
                y_multi = pd.Categorical(y)
                mnlogit_model = sm.MNLogit(y_multi.codes, X_const).fit(disp=False, maxiter=300)
                model_summary_text = mnlogit_model.summary().as_text()
                coef_df = mnlogit_model.params.T.reset_index().rename(columns={"index": "feature"})
                export_csv(coef_df, OUTPUT_DIRS["reports"] / "choice_multinomial_coefficients.csv")
        except Exception as exc:
            model_summary_text = f"Statsmodels choice model failed: {exc}"

    if (
        Pipeline is not None
        and ColumnTransformer is not None
        and SimpleImputer is not None
        and train_test_split is not None
        and RandomForestClassifier is not None
        and len(model_input) >= 10
    ):
        X = model_input[numeric_feature_cols + categorical_feature_cols].copy()
        y = model_input["selected_option"].astype("category")
        X_train, X_test, y_train, y_test = train_test_split(
            X,
            y,
            test_size=0.25,
            stratify=y if y.nunique() > 1 else None,
            random_state=CONFIG.random_state,
        )

        preprocessor = ColumnTransformer(
            transformers=[
                (
                    "numeric",
                    Pipeline(
                        steps=[
                            ("imputer", SimpleImputer(strategy="median")),
                            ("scaler", StandardScaler()),
                        ]
                    ),
                    numeric_feature_cols,
                ),
                (
                    "categorical",
                    Pipeline(
                        steps=[
                            ("imputer", SimpleImputer(strategy="most_frequent")),
                            ("onehot", OneHotEncoder(handle_unknown="ignore")),
                        ]
                    ),
                    categorical_feature_cols,
                ),
            ],
            remainder="drop",
        )

        rf_model = Pipeline(
            steps=[
                ("preprocess", preprocessor),
                ("model", RandomForestClassifier(n_estimators=300, random_state=CONFIG.random_state)),
            ]
        )
        rf_model.fit(X_train, y_train)
        y_pred = rf_model.predict(X_test)
        accuracy = accuracy_score(y_test, y_pred) if accuracy_score is not None else np.nan
        classification_text = classification_report(y_test, y_pred) if classification_report is not None else "Classification report unavailable."
        model_summary_text += (
            "\n\n=== Exploratory Random Forest ===\n"
            f"Accuracy: {accuracy:,.4f}\n\n"
            f"{classification_text}"
        )

        model = rf_model.named_steps["model"]
        feature_names = rf_model.named_steps["preprocess"].get_feature_names_out()
        model_feature_importance = pd.DataFrame(
            {
                "feature": feature_names,
                "importance": model.feature_importances_,
            }
        ).sort_values("importance", ascending=False)
        export_csv(model_feature_importance, OUTPUT_DIRS["reports"] / "choice_model_feature_importance.csv")

with open(OUTPUT_DIRS["models"] / "choice_attention_model_summary.txt", "w", encoding="utf-8") as handle:
    handle.write(model_summary_text)


# %% [markdown]
# ## Part 15 — Template- and Family-Level Benchmarking

# %%
benchmark_source = session_choice_df.merge(
    page_metrics[["session_id", "page_id", "page_view_duration", "valid_samples", "response_time"]].drop_duplicates()
    if not page_metrics.empty and "response_time" in page_metrics.columns
    else pd.DataFrame(columns=["session_id", "page_id", "page_view_duration", "valid_samples", "response_time"]),
    on=["session_id", "page_id"],
    how="left",
)

benchmark_source = benchmark_source.merge(
    aoi_metric_df.groupby(["session_id", "page_id"], as_index=False).agg(
        avg_aoi_dwell_ms=("total_dwell_time_ms", "mean"),
        avg_ttff_ms=("ttff_ms", "mean"),
    ),
    on=["session_id", "page_id"],
    how="left",
)

benchmarking_summary = (
    benchmark_source.groupby(["case_family", "template_type", "case_id"], as_index=False)
    .agg(
        response_time_ms=("response_time", "mean"),
        average_page_duration_seconds=("page_view_duration", "mean"),
        average_valid_samples=("valid_samples", "mean"),
        average_aoi_dwell_ms=("avg_aoi_dwell_ms", "mean"),
        average_ttff_ms=("avg_ttff_ms", "mean"),
        choice_concentration=("selected_option", lambda s: s.value_counts(normalize=True).max() if not s.empty else np.nan),
        n_choices=("selected_option", "count"),
    )
)
benchmarking_summary["conversion_rate_proxy"] = np.where(
    benchmarking_summary["n_choices"] > 0,
    1.0,
    0.0,
)
export_csv(benchmarking_summary, OUTPUT_DIRS["reports"] / "template_family_benchmarking.csv")

fig, axes = plt.subplots(1, 3, figsize=(18, 6))
for ax, value_col, title in zip(
    axes,
    ["response_time_ms", "average_aoi_dwell_ms", "average_ttff_ms"],
    ["Response time by template", "Average AOI dwell by template", "Average TTFF by template"],
):
    if benchmarking_summary.empty:
        ax.axis("off")
        continue
    for family, subset in benchmarking_summary.groupby("case_family"):
        ax.bar(
            subset["template_type"].astype(str) + f" | {family}",
            subset[value_col],
            label=str(family),
        )
    ax.set_title(title)
    ax.tick_params(axis="x", rotation=90)
axes[0].legend(title="Case family", bbox_to_anchor=(1.02, 1), loc="upper left")
fig.tight_layout()
fig.savefig(OUTPUT_DIRS["figures"] / "template_family_benchmark_panels.png", dpi=220)


# %% [markdown]
# ## Part 16 — Reporting Tables and Dashboard Exports

# %%
report_tables: dict[str, pd.DataFrame] = {
    "quality_summary": quality_summary_table,
    "exclusion_reasons": exclusion_reason_counts,
    "clean_sessions": clean_sessions,
    "choice_share_summary": choice_summary,
    "aoi_metrics": aoi_metric_df,
    "ttff_summary": ttff_summary,
    "transition_table": transition_table,
    "benchmarking_summary": benchmarking_summary,
}

if not pre_choice_aoi_metrics.empty:
    report_tables["pre_choice_aoi_metrics"] = pre_choice_aoi_metrics
if not segment_tests_df.empty:
    report_tables["segment_tests"] = segment_tests_df
if not model_feature_importance.empty:
    report_tables["model_feature_importance"] = model_feature_importance

for name, table in report_tables.items():
    export_csv(table, OUTPUT_DIRS["reports"] / f"{name}.csv")

if CONFIG.export_excel:
    workbook_path = OUTPUT_DIRS["reports"] / "eye_tracking_reporting_tables.xlsx"
    with pd.ExcelWriter(workbook_path, engine="openpyxl") as writer:
        for sheet_name, table in report_tables.items():
            safe_sheet_name = sheet_name[:31]
            table.to_excel(writer, sheet_name=safe_sheet_name, index=False)
    print(f"Excel workbook written to: {workbook_path}")


# %% [markdown]
# ## Part 17 — Interpretation and Insight Generation

# %%
def safe_pct(value: Any) -> str:
    if pd.isna(value):
        return "N/A"
    return f"{float(value) * 100:,.1f}%"


def build_interpretation_summary() -> dict[str, str]:
    summaries: dict[str, str] = {}

    if not publication_choice_summary.empty:
        top_choice = publication_choice_summary.sort_values("share_selected", ascending=False).iloc[0]
        summaries["choice_share"] = (
            f"The highest observed choice share came from page {top_choice['page_id']} "
            f"({top_choice['case_id']}), where {top_choice['winning_option']} led with "
            f"{safe_pct(top_choice['share_selected'])} of selections."
        )

    if not aoi_metric_df.empty:
        top_dwell = (
            aoi_metric_df.groupby("aoi_label", as_index=False)["total_dwell_time_ms"]
            .mean()
            .sort_values("total_dwell_time_ms", ascending=False)
            .head(1)
        )
        if not top_dwell.empty:
            row = top_dwell.iloc[0]
            summaries["top_attention"] = (
                f"The AOI holding the most average attention was {row['aoi_label']}, "
                f"with mean dwell of {row['total_dwell_time_ms']:,.1f} ms."
            )

    if not ttff_summary.empty:
        quickest = ttff_summary.sort_values("mean_ttff_ms", ascending=True).head(1)
        if not quickest.empty:
            row = quickest.iloc[0]
            summaries["quickest_first_look"] = (
                f"The fastest first-look pattern was observed for {row['aoi_label']} "
                f"within {row['case_family']} / template {row['template_type']}, "
                f"with mean TTFF of {row['mean_ttff_ms']:,.1f} ms."
            )

    if not benchmarking_summary.empty:
        benchmark = benchmarking_summary.sort_values("average_ttff_ms").iloc[0]
        summaries["benchmark"] = (
            f"Template benchmarking suggests {benchmark['template_type']} in "
            f"{benchmark['case_family']} guided the quickest average attention, "
            f"with mean TTFF of {benchmark['average_ttff_ms']:,.1f} ms."
        )

    if not pre_choice_aoi_metrics.empty:
        pre_choice = (
            pre_choice_aoi_metrics.groupby("aoi_label", as_index=False)["pre_choice_dwell_ms"]
            .mean()
            .sort_values("pre_choice_dwell_ms", ascending=False)
            .head(1)
        )
        if not pre_choice.empty:
            row = pre_choice.iloc[0]
            summaries["pre_choice"] = (
                f"Before making a choice, gaze clustered most strongly around {row['aoi_label']}, "
                f"with average pre-choice dwell of {row['pre_choice_dwell_ms']:,.1f} ms."
            )

    if not segment_tests_df.empty:
        stable_segments = segment_tests_df.loc[segment_tests_df["p_value"].fillna(1) < 0.05]
        if not stable_segments.empty:
            top_segment = stable_segments.iloc[0]
            summaries["segment_difference"] = (
                f"There was evidence of a subgroup difference for {top_segment['value_col']} "
                f"by {top_segment['group_col']} (p = {top_segment['p_value']:.4f}). "
                "This should be interpreted cautiously alongside subgroup sample sizes."
            )

    if "choice_attention_model_summary.txt" in [p.name for p in OUTPUT_DIRS["models"].iterdir() if p.is_file()]:
        summaries["choice_model"] = (
            "Attention-to-choice models were fitted and exported. Review the model summary and "
            "feature-importance files to see whether dwell, TTFF, or return behavior most strongly predicts selection."
        )

    return summaries


interpretation_summaries = build_interpretation_summary()
interpretation_markdown = "# Interpretation Summary\n\n" + "\n\n".join(
    f"- {summary}" for summary in interpretation_summaries.values()
)

with open(OUTPUT_DIRS["reports"] / "interpretation_summary.md", "w", encoding="utf-8") as handle:
    handle.write(interpretation_markdown)

print(interpretation_markdown)


# %% [markdown]
# ## Part 18 — Notebook Export Helpers

# %%
summary_manifest = pd.DataFrame(
    {
        "artifact_type": [
            "csv",
            "excel",
            "figures",
            "heatmaps",
            "reports",
            "models",
        ],
        "path": [
            str(OUTPUT_DIRS["clean"]),
            str(OUTPUT_DIRS["reports"] / "eye_tracking_reporting_tables.xlsx"),
            str(OUTPUT_DIRS["figures"]),
            str(OUTPUT_DIRS["heatmaps"]),
            str(OUTPUT_DIRS["reports"]),
            str(OUTPUT_DIRS["models"]),
        ],
    }
)
export_csv(summary_manifest, OUTPUT_DIRS["reports"] / "artifact_manifest.csv")


# %% [markdown]
# ## Part 19 — Optional Advanced Methods

# %%
advanced_outputs: dict[str, Any] = {}

if CONFIG.run_optional_advanced_methods:
    if not fixation_proxy_df.empty:
        advanced_outputs["fixation_proxy_summary"] = fixation_proxy_df.groupby("aoi_label", as_index=False).agg(
            mean_visit_dwell_ms=("visit_dwell_ms", "mean"),
            median_visit_dwell_ms=("visit_dwell_ms", "median"),
            visit_count=("visit_sequence_id", "count"),
        )
        export_csv(advanced_outputs["fixation_proxy_summary"], OUTPUT_DIRS["reports"] / "advanced_fixation_proxy_summary.csv")

    if KMeans is not None and not aoi_metric_df.empty:
        cluster_source = (
            aoi_metric_df.pivot_table(
                index="session_id",
                columns="aoi_label",
                values="total_dwell_time_ms",
                aggfunc="mean",
            )
            .fillna(0)
        )
        if len(cluster_source) >= 3:
            cluster_model = KMeans(n_clusters=min(3, len(cluster_source)), random_state=CONFIG.random_state, n_init="auto")
            labels = cluster_model.fit_predict(cluster_source)
            cluster_df = cluster_source.copy()
            cluster_df["attention_style_cluster"] = labels
            advanced_outputs["attention_style_clusters"] = cluster_df.reset_index()
            export_csv(advanced_outputs["attention_style_clusters"], OUTPUT_DIRS["reports"] / "advanced_attention_style_clusters.csv")

    if not ttff_df.empty:
        survival_like = ttff_df[["session_id", "page_id", "aoi_label", "ttff_ms"]].copy()
        survival_like["ttff_seconds"] = survival_like["ttff_ms"] / 1000.0
        advanced_outputs["ttff_survival_like"] = survival_like
        export_csv(survival_like, OUTPUT_DIRS["reports"] / "advanced_ttff_survival_like.csv")


# %% [markdown]
# ## Part 20 — Final Output Check

# %%
final_output_check = pd.DataFrame(
    {
        "question": [
            "What data is usable?",
            "Who are the participants?",
            "Which options were chosen?",
            "What did people look at?",
            "What did they look at before choosing?",
            "Does attention predict selection?",
            "How do templates and case families compare?",
        ],
        "output_source": [
            "clean_sessions.csv + quality_report_summary.csv",
            "profile_*.csv + participant_profile_count_plots.png",
            "choice_share_summary.csv + which_version_won_by_case.csv",
            "aoi_metrics.csv + heatmaps",
            "pre_choice_aoi_metrics.csv + pre-choice heatmaps",
            "choice_attention_model_summary.txt + feature importance",
            "template_family_benchmarking.csv + benchmark panels",
        ],
    }
)

export_csv(final_output_check, OUTPUT_DIRS["reports"] / "final_output_checklist.csv")
display(final_output_check)

print("\nNotebook pipeline complete.")
print(f"Main outputs written to: {OUTPUT_DIRS['base']}")
