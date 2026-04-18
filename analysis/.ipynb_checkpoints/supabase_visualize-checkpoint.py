#!/usr/bin/env python3
"""
Fetch participant sessions from Supabase and generate basic study visuals.

Environment variables:
  SUPABASE_URL
  SUPABASE_SERVICE_ROLE_KEY
  SUPABASE_TABLE=participant_sessions   # optional
  OUTPUT_DIR=analysis_output            # optional

Install dependencies:
  pip install requests pandas matplotlib seaborn
"""

from __future__ import annotations

import os
from pathlib import Path

import matplotlib.pyplot as plt
import pandas as pd
import requests
import seaborn as sns


SUPABASE_URL = os.environ["SUPABASE_URL"].rstrip("/")
SUPABASE_SERVICE_ROLE_KEY = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
SUPABASE_TABLE = os.environ.get("SUPABASE_TABLE", "participant_sessions")
OUTPUT_DIR = Path(os.environ.get("OUTPUT_DIR", "analysis_output"))


def fetch_all_rows() -> list[dict]:
    headers = {
        "apikey": SUPABASE_SERVICE_ROLE_KEY,
        "Authorization": f"Bearer {SUPABASE_SERVICE_ROLE_KEY}",
    }
    select = (
        "participant_id,study_id,created_at,page_summary,"
        "total_valid_samples,total_invalid_samples"
    )

    rows: list[dict] = []
    offset = 0
    page_size = 1000

    while True:
        response = requests.get(
            f"{SUPABASE_URL}/rest/v1/{SUPABASE_TABLE}",
            headers=headers,
            params={
                "select": select,
                "order": "created_at.asc",
                "limit": page_size,
                "offset": offset,
            },
            timeout=30,
        )
        response.raise_for_status()
        batch = response.json()
        if not batch:
            break

        rows.extend(batch)
        if len(batch) < page_size:
            break
        offset += page_size

    return rows


def flatten_page_summary(rows: list[dict]) -> pd.DataFrame:
    flattened = []
    for row in rows:
        for page in row.get("page_summary", []):
            flattened.append(
                {
                    "participant_id": row["participant_id"],
                    "study_id": row["study_id"],
                    "created_at": row["created_at"],
                    "page_id": page.get("page_id"),
                    "image_set_id": page.get("image_set_id"),
                    "selection": page.get("selection"),
                    "selected_label": page.get("selected_label"),
                    "time_on_page_ms": page.get("time_on_page_ms", 0),
                    "valid_sample_count": page.get("valid_sample_count", 0),
                    "invalid_sample_count": page.get("invalid_sample_count", 0),
                }
            )

    return pd.DataFrame(flattened)


def save_choice_counts(df: pd.DataFrame) -> None:
    choice_df = (
        df.dropna(subset=["selection"])
        .groupby(["page_id", "selection"])
        .size()
        .reset_index(name="count")
    )

    if choice_df.empty:
        return

    plt.figure(figsize=(12, 6))
    sns.barplot(data=choice_df, x="page_id", y="count", hue="selection")
    plt.title("Selection counts by stimulus page")
    plt.xlabel("Stimulus page")
    plt.ylabel("Selections")
    plt.tight_layout()
    plt.savefig(OUTPUT_DIR / "choice_counts.png", dpi=200)
    plt.close()


def save_dwell_time_plot(df: pd.DataFrame) -> None:
    dwell_df = df.copy()
    dwell_df["time_on_page_seconds"] = dwell_df["time_on_page_ms"] / 1000.0

    if dwell_df.empty:
        return

    plt.figure(figsize=(12, 6))
    sns.boxplot(data=dwell_df, x="page_id", y="time_on_page_seconds")
    sns.stripplot(
        data=dwell_df,
        x="page_id",
        y="time_on_page_seconds",
        color="#875a38",
        alpha=0.35,
    )
    plt.title("Dwell time by stimulus page")
    plt.xlabel("Stimulus page")
    plt.ylabel("Seconds on page")
    plt.tight_layout()
    plt.savefig(OUTPUT_DIR / "dwell_time.png", dpi=200)
    plt.close()


def main() -> None:
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    rows = fetch_all_rows()
    page_df = flatten_page_summary(rows)

    page_df.to_csv(OUTPUT_DIR / "page_summary.csv", index=False)
    save_choice_counts(page_df)
    save_dwell_time_plot(page_df)

    print(f"Fetched {len(rows)} participant session rows from Supabase.")
    print(f"Saved outputs in: {OUTPUT_DIR.resolve()}")


if __name__ == "__main__":
    main()
