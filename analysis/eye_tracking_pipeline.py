#!/usr/bin/env python3
"""
Notebook-friendly eye-tracking analytics pipeline.

Typical notebook usage:

    import pandas as pd
    from sqlalchemy import create_engine
    from eye_tracking_pipeline import EyeTrackingAnalysisPipeline

    engine = create_engine("postgresql://USER:PASSWORD@HOST:PORT/DATABASE")
    pipeline = EyeTrackingAnalysisPipeline(engine, "analysis_output")
    pipeline.run_all()

Environment variable fallback:
    DATABASE_URL
"""

from __future__ import annotations

import json
import math
import os
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import matplotlib

matplotlib.use("Agg")

import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
import seaborn as sns
from PIL import Image
from sqlalchemy import create_engine, text
from sqlalchemy.engine import Engine

try:
    import statsmodels.api as sm
    import statsmodels.tools.sm_exceptions as sm_exceptions
except Exception:  # pragma: no cover - optional dependency
    sm = None
    sm_exceptions = None

try:
    import plotly.graph_objects as go
except Exception:  # pragma: no cover - optional dependency
    go = None


sns.set_theme(style="whitegrid")


QUERY_MAP = {
    "participants": "select * from public.participants order by participant_number;",
    "sessions": "select * from public.sessions order by created_at;",
    "pages": "select * from public.pages order by page_id;",
    "page_options": "select * from public.page_options order by page_id, option_order;",
    "page_views": "select * from public.page_views order by session_id, page_id;",
    "gaze_data": "select * from public.gaze_data order by session_id, page_id, sample_timestamp, gaze_id;",
    "aoi_definitions": "select * from public.aoi_definitions order by page_id, aoi_type;",
    "choices": "select * from public.choices order by session_id, page_id;",
    "session_quality": "select * from public.session_quality_screening order by participant_number;",
    "session_exclusions": "select * from public.session_exclusion_reasons order by participant_number;",
    "clean_sessions": "select * from public.clean_sessions order by participant_number;",
    "analysis_page_choices": "select * from public.analysis_page_choices order by participant_number, page_id;",
    "choice_share": "select * from public.choice_share_analysis order by page_id, selected_option;",
    "aoi_metrics": """
        select
          am.*,
          p.case_id,
          p.case_family,
          p.template_type,
          p.stimulus_name,
          s.participant_id,
          participant.participant_number,
          participant.age_category,
          participant.province,
          participant.gender_identity,
          participant.shopping_frequency,
          participant.device_type,
          participant.retailer_familiarity
        from public.aoi_metrics am
        join public.pages p
          on p.page_id = am.page_id
        join public.sessions s
          on s.session_id = am.session_id
        join public.participants participant
          on participant.participant_id = s.participant_id
        order by participant.participant_number, am.page_id, am.aoi_type;
    """,
    "aoi_hits": "select * from public.aoi_hits order by session_id, page_id, sample_timestamp;",
    "benchmarks": "select * from public.family_template_benchmark_analysis order by case_family, template_type;",
}


def create_sqlalchemy_engine(connection_url: str | None = None) -> Engine:
    database_url = connection_url or os.environ.get("DATABASE_URL")
    if not database_url:
        raise RuntimeError(
            "Provide a PostgreSQL connection URL or set DATABASE_URL before running the analysis pipeline."
        )

    return create_engine(database_url)


@dataclass
class AnalysisArtifacts:
    output_dir: Path
    files: list[Path]


class EyeTrackingAnalysisPipeline:
    def __init__(self, engine: Engine, output_dir: str | os.PathLike[str] = "analysis_output"):
        self.engine = engine
        self.output_dir = Path(output_dir)
        self.output_dir.mkdir(parents=True, exist_ok=True)
        self.tables: dict[str, pd.DataFrame] = {}
        self._artifacts: list[Path] = []

    def load_table(self, name: str) -> pd.DataFrame:
        if name in self.tables:
            return self.tables[name]

        query = QUERY_MAP[name]
        df = pd.read_sql(text(query), self.engine)

        datetime_columns = [
            column
            for column in df.columns
            if column.endswith("_time")
            or column.endswith("_timestamp")
            or column.endswith("_at")
            or column in {"start_time", "end_time"}
        ]
        for column in datetime_columns:
            if column in df.columns:
                df[column] = pd.to_datetime(df[column], errors="coerce", utc=True)

        self.tables[name] = df
        return df

    def load_all(self) -> dict[str, pd.DataFrame]:
        for name in QUERY_MAP:
            self.load_table(name)
        return self.tables

    def _record_artifact(self, path: Path) -> None:
        self._artifacts.append(path)

    def _write_dataframe(self, df: pd.DataFrame, filename: str) -> Path:
        path = self.output_dir / filename
        df.to_csv(path, index=False)
        self._record_artifact(path)
        return path

    def _save_figure(self, figure: plt.Figure, filename: str) -> Path:
        path = self.output_dir / filename
        figure.tight_layout()
        figure.savefig(path, dpi=220, bbox_inches="tight")
        plt.close(figure)
        self._record_artifact(path)
        return path

    def _write_text(self, content: str, filename: str) -> Path:
        path = self.output_dir / filename
        path.write_text(content, encoding="utf-8")
        self._record_artifact(path)
        return path

    def export_clean_dataset(self) -> pd.DataFrame:
        clean_sessions = self.load_table("clean_sessions")
        participants = self.load_table("participants")
        merged = clean_sessions.merge(
            participants,
            how="left",
            on="participant_id",
            suffixes=("_session", "_participant"),
        )
        self._write_dataframe(merged, "clean_sessions.csv")
        return merged

    def data_quality_screening(self) -> dict[str, pd.DataFrame]:
        quality = self.load_table("session_quality")
        exclusions = self.load_table("session_exclusions")

        figure, axis = plt.subplots(figsize=(12, 5))
        sns.barplot(
            data=quality,
            x="participant_number",
            y="total_valid_samples",
            color="#875a38",
            ax=axis,
        )
        axis.set_title("Valid gaze samples per participant")
        axis.set_xlabel("Participant number")
        axis.set_ylabel("Valid samples")
        axis.tick_params(axis="x", rotation=90)
        self._save_figure(figure, "quality_valid_samples_per_participant.png")

        exclusion_rows = exclusions.loc[exclusions["exclusion_reason_count"] > 0].copy()
        if not exclusion_rows.empty:
            exclusion_rows["exclusion_reasons"] = exclusion_rows["exclusion_reasons"].apply(
                lambda reasons: ", ".join(reasons or [])
            )
        self._write_dataframe(exclusion_rows, "quality_exclusion_reasons.csv")

        return {
            "quality": quality,
            "exclusions": exclusion_rows,
        }

    def participant_profile_summaries(self) -> pd.DataFrame:
        participants = self.load_table("participants")
        profile_columns = [
            "age_category",
            "province",
            "gender_identity",
            "shopping_frequency",
            "device_type",
            "retailer_familiarity",
        ]

        figure, axes = plt.subplots(3, 2, figsize=(16, 13))
        axes = axes.flatten()
        for axis, column in zip(axes, profile_columns):
            plot_data = participants[column].fillna("Missing")
            counts = plot_data.value_counts(dropna=False).reset_index()
            counts.columns = [column, "count"]
            sns.barplot(data=counts, x=column, y="count", color="#875a38", ax=axis)
            axis.set_title(column.replace("_", " ").title())
            axis.set_xlabel("")
            axis.set_ylabel("Count")
            axis.tick_params(axis="x", rotation=45)

        self._save_figure(figure, "participant_profile_dashboard.png")

        province_by_age = pd.crosstab(
            participants["province"].fillna("Missing"),
            participants["age_category"].fillna("Missing"),
        )
        province_by_age.to_csv(self.output_dir / "profile_province_by_age_crosstab.csv")
        self._record_artifact(self.output_dir / "profile_province_by_age_crosstab.csv")

        province_by_device = pd.crosstab(
            participants["province"].fillna("Missing"),
            participants["device_type"].fillna("Missing"),
        )
        province_by_device.to_csv(
            self.output_dir / "profile_province_by_device_crosstab.csv"
        )
        self._record_artifact(
            self.output_dir / "profile_province_by_device_crosstab.csv"
        )

        stacked = province_by_age.div(province_by_age.sum(axis=1), axis=0).fillna(0)
        figure, axis = plt.subplots(figsize=(12, 6))
        stacked.plot(kind="bar", stacked=True, ax=axis, colormap="copper")
        axis.set_title("Age composition by province")
        axis.set_xlabel("Province")
        axis.set_ylabel("Proportion")
        axis.legend(title="Age category", bbox_to_anchor=(1.02, 1), loc="upper left")
        self._save_figure(figure, "participant_profile_stacked_age_by_province.png")

        return participants

    def choice_share_analysis(self) -> pd.DataFrame:
        choice_share = self.load_table("choice_share")

        figure, axis = plt.subplots(figsize=(14, 6))
        sns.barplot(
            data=choice_share,
            x="page_id",
            y="selection_share",
            hue="selected_option",
            ax=axis,
        )
        axis.set_title("Choice share by page and selected option")
        axis.set_xlabel("Page")
        axis.set_ylabel("Share of selections")
        axis.tick_params(axis="x", rotation=45)
        axis.legend(title="Selected option", bbox_to_anchor=(1.02, 1), loc="upper left")
        self._save_figure(figure, "choice_share_grouped_bar.png")
        self._write_dataframe(choice_share, "choice_share_analysis.csv")

        return choice_share

    def dwell_time_analysis(self) -> pd.DataFrame:
        aoi_metrics = self.load_table("aoi_metrics")
        if aoi_metrics.empty:
            self._write_text(
                "No AOI metrics were available. Populate x/y AOI boundaries in aoi_definitions to compute dwell time metrics.",
                "dwell_time_analysis.txt",
            )
            return aoi_metrics

        figure, axes = plt.subplots(1, 2, figsize=(16, 6))
        sns.boxplot(data=aoi_metrics, x="aoi_type", y="dwell_time_ms", ax=axes[0])
        axes[0].set_title("AOI dwell time distribution")
        axes[0].set_xlabel("AOI type")
        axes[0].set_ylabel("Dwell time (ms)")
        axes[0].tick_params(axis="x", rotation=45)

        sns.violinplot(data=aoi_metrics, x="aoi_type", y="dwell_time_ms", ax=axes[1])
        axes[1].set_title("AOI dwell time density")
        axes[1].set_xlabel("AOI type")
        axes[1].set_ylabel("Dwell time (ms)")
        axes[1].tick_params(axis="x", rotation=45)
        self._save_figure(figure, "aoi_dwell_time_boxplot_violin.png")

        self._write_dataframe(aoi_metrics, "aoi_metrics.csv")
        return aoi_metrics

    def ttff_analysis(self) -> pd.DataFrame:
        aoi_metrics = self.load_table("aoi_metrics")
        if aoi_metrics.empty:
            self._write_text(
                "No AOI metrics were available. Populate x/y AOI boundaries in aoi_definitions to compute TTFF metrics.",
                "ttff_analysis.txt",
            )
            return aoi_metrics

        summary = (
            aoi_metrics.groupby(["case_family", "template_type", "aoi_type"], dropna=False)
            .agg(
                mean_ttff_ms=("ttff_ms", "mean"),
                median_ttff_ms=("ttff_ms", "median"),
                count=("ttff_ms", "size"),
                std_ttff_ms=("ttff_ms", "std"),
            )
            .reset_index()
        )
        summary["ci95_ms"] = 1.96 * (
            summary["std_ttff_ms"].fillna(0) / np.sqrt(summary["count"].clip(lower=1))
        )
        self._write_dataframe(summary, "ttff_summary.csv")

        figure, axis = plt.subplots(figsize=(14, 6))
        sns.pointplot(
            data=summary,
            x="aoi_type",
            y="mean_ttff_ms",
            hue="template_type",
            dodge=True,
            ax=axis,
        )
        axis.set_title("Mean TTFF by AOI type and template")
        axis.set_xlabel("AOI type")
        axis.set_ylabel("Mean TTFF (ms)")
        axis.tick_params(axis="x", rotation=45)
        self._save_figure(figure, "ttff_mean_comparison.png")

        return summary

    def heatmap_overlays(
        self,
        screenshot_map: dict[str, str | os.PathLike[str]] | None = None,
        segmented: bool = True,
    ) -> list[Path]:
        gaze_data = self.load_table("gaze_data")
        choices = self.load_table("choices")
        pages = self.load_table("pages")

        valid_points = gaze_data[
            gaze_data["is_valid"].fillna(False)
            & gaze_data["x_norm"].notna()
            & gaze_data["y_norm"].notna()
        ].copy()
        if valid_points.empty:
            self._write_text(
                "No valid normalized gaze points were available for heatmap generation.",
                "heatmap_generation.txt",
            )
            return []

        outputs: list[Path] = []
        screenshot_map = screenshot_map or {}
        page_lookup = pages.set_index("page_id").to_dict(orient="index")
        choice_lookup = choices[["session_id", "page_id", "selected_option"]].copy()

        for page_id, page_points in valid_points.groupby("page_id"):
            screenshot_path = screenshot_map.get(page_id)
            base_image, width, height = self._load_heatmap_background(screenshot_path)
            outputs.append(
                self._render_heatmap_image(
                    page_id,
                    page_points,
                    width,
                    height,
                    base_image,
                    suffix="combined",
                )
            )

            if segmented:
                segmented_points = page_points.merge(
                    choice_lookup,
                    on=["session_id", "page_id"],
                    how="left",
                )
                for option, option_points in segmented_points.groupby("selected_option"):
                    if pd.isna(option) or option_points.empty:
                        continue
                    outputs.append(
                        self._render_heatmap_image(
                            page_id,
                            option_points,
                            width,
                            height,
                            base_image,
                            suffix=f"selected_{option}",
                        )
                    )

            metadata = {
                "page_id": page_id,
                "stimulus_name": page_lookup.get(page_id, {}).get("stimulus_name"),
                "heatmap_files": [path.name for path in outputs if path.name.startswith(f"heatmap_{page_id}_")],
            }
            metadata_path = self.output_dir / f"heatmap_{page_id}_metadata.json"
            metadata_path.write_text(json.dumps(metadata, indent=2), encoding="utf-8")
            self._record_artifact(metadata_path)

        return outputs

    def _load_heatmap_background(
        self, screenshot_path: str | os.PathLike[str] | None
    ) -> tuple[np.ndarray, int, int]:
        if screenshot_path and Path(screenshot_path).exists():
            image = Image.open(screenshot_path).convert("RGBA")
            width, height = image.size
            return np.array(image), width, height

        width, height = 1600, 900
        blank = np.ones((height, width, 4), dtype=np.uint8) * 255
        return blank, width, height

    def _render_heatmap_image(
        self,
        page_id: str,
        points: pd.DataFrame,
        width: int,
        height: int,
        base_image: np.ndarray,
        suffix: str,
    ) -> Path:
        figure, axis = plt.subplots(figsize=(width / 160, height / 160))
        axis.imshow(base_image)
        axis.set_xlim(0, width)
        axis.set_ylim(height, 0)
        axis.axis("off")

        x_pixels = points["x_norm"].to_numpy() * width
        y_pixels = points["y_norm"].to_numpy() * height

        if len(points) >= 2:
            sns.kdeplot(
                x=x_pixels,
                y=y_pixels,
                fill=True,
                thresh=0.05,
                levels=50,
                cmap="rocket",
                alpha=0.55,
                bw_adjust=0.8,
                ax=axis,
            )
        else:
            axis.scatter(x_pixels, y_pixels, s=60, c="#a13f1f", alpha=0.8)

        path = self.output_dir / f"heatmap_{page_id}_{suffix}.png"
        figure.tight_layout(pad=0)
        figure.savefig(path, dpi=220, bbox_inches="tight", pad_inches=0)
        plt.close(figure)
        self._record_artifact(path)
        return path

    def scanpath_transition_analysis(self) -> pd.DataFrame:
        aoi_hits = self.load_table("aoi_hits")
        if aoi_hits.empty:
            self._write_text(
                "No AOI hits were available. Populate AOI boundaries to run scanpath and transition analysis.",
                "scanpath_transition_analysis.txt",
            )
            return aoi_hits

        hits = aoi_hits.sort_values(
            ["session_id", "page_id", "sample_timestamp", "gaze_id"]
        ).copy()
        hits["previous_aoi"] = hits.groupby(["session_id", "page_id"])["aoi_type"].shift(1)
        hits = hits.loc[hits["previous_aoi"].notna() & (hits["previous_aoi"] != hits["aoi_type"])]

        transitions = (
            hits.groupby(["previous_aoi", "aoi_type"], dropna=False)
            .size()
            .reset_index(name="transitions")
        )
        self._write_dataframe(transitions, "scanpath_transition_matrix.csv")

        pivot = transitions.pivot(
            index="previous_aoi", columns="aoi_type", values="transitions"
        ).fillna(0)
        figure, axis = plt.subplots(figsize=(10, 8))
        sns.heatmap(pivot, annot=True, fmt=".0f", cmap="copper", ax=axis)
        axis.set_title("AOI transition matrix")
        axis.set_xlabel("To AOI")
        axis.set_ylabel("From AOI")
        self._save_figure(figure, "scanpath_transition_heatmap.png")

        if go is not None and not transitions.empty:
            labels = pd.Index(
                pd.concat([transitions["previous_aoi"], transitions["aoi_type"]])
            ).unique()
            label_to_index = {label: index for index, label in enumerate(labels)}
            sankey = go.Figure(
                data=[
                    go.Sankey(
                        node={"label": list(labels)},
                        link={
                            "source": transitions["previous_aoi"].map(label_to_index),
                            "target": transitions["aoi_type"].map(label_to_index),
                            "value": transitions["transitions"],
                        },
                    )
                ]
            )
            sankey.update_layout(title_text="AOI transition Sankey")
            sankey_path = self.output_dir / "scanpath_transition_sankey.html"
            sankey.write_html(sankey_path)
            self._record_artifact(sankey_path)

        return transitions

    def segment_comparison_analysis(self) -> pd.DataFrame:
        aoi_metrics = self.load_table("aoi_metrics")
        if aoi_metrics.empty:
            page_views = self.load_table("page_views").merge(
                self.load_table("sessions")[["session_id", "participant_id"]],
                on="session_id",
                how="left",
            ).merge(
                self.load_table("participants"),
                on="participant_id",
                how="left",
            )
            page_views = page_views.rename(columns={"total_duration": "dwell_time_ms"})
            comparison = page_views[
                ["participant_id", "page_id", "dwell_time_ms", "age_category", "province", "device_type"]
            ].copy()
        else:
            comparison = aoi_metrics[
                [
                    "participant_id",
                    "page_id",
                    "aoi_type",
                    "dwell_time_ms",
                    "ttff_ms",
                    "age_category",
                    "province",
                    "device_type",
                ]
            ].copy()

        self._write_dataframe(comparison, "segment_comparison_dataset.csv")

        figure, axes = plt.subplots(1, 3, figsize=(18, 6))
        sns.boxplot(data=comparison, x="age_category", y="dwell_time_ms", ax=axes[0])
        axes[0].set_title("Dwell by age category")
        axes[0].tick_params(axis="x", rotation=45)

        sns.boxplot(data=comparison, x="province", y="dwell_time_ms", ax=axes[1])
        axes[1].set_title("Dwell by province")
        axes[1].tick_params(axis="x", rotation=45)

        sns.boxplot(data=comparison, x="device_type", y="dwell_time_ms", ax=axes[2])
        axes[2].set_title("Dwell by device type")
        axes[2].tick_params(axis="x", rotation=45)
        self._save_figure(figure, "segment_comparison_dwell.png")

        return comparison

    def choice_attention_relationship(self) -> str:
        choices = self.load_table("analysis_page_choices")
        aoi_metrics = self.load_table("aoi_metrics")

        if choices.empty or aoi_metrics.empty or sm is None:
            summary = (
                "Choice-attention logistic model was skipped because either AOI metrics are missing "
                "or statsmodels is not installed."
            )
            self._write_text(summary, "choice_attention_model.txt")
            return summary

        wide_metrics = (
            aoi_metrics.pivot_table(
                index=["session_id", "page_id"],
                columns="aoi_type",
                values=["dwell_time_ms", "ttff_ms"],
                aggfunc="mean",
            )
            .reset_index()
        )
        wide_metrics.columns = [
            "__".join(column).strip("_") if isinstance(column, tuple) else column
            for column in wide_metrics.columns
        ]

        model_df = choices.merge(wide_metrics, on=["session_id", "page_id"], how="inner")
        if model_df.empty or model_df["selected_option"].nunique() < 2:
            summary = (
                "Choice-attention logistic model was skipped because the merged dataset "
                "did not contain enough option variation."
            )
            self._write_text(summary, "choice_attention_model.txt")
            return summary

        predictor_columns = [
            column
            for column in model_df.columns
            if column.startswith("dwell_time_ms__") or column.startswith("ttff_ms__")
        ]
        model_input = model_df.dropna(subset=predictor_columns + ["selected_option"]).copy()
        if model_input.empty or len(predictor_columns) == 0:
            summary = (
                "Choice-attention logistic model was skipped because no AOI predictor columns were available."
            )
            self._write_text(summary, "choice_attention_model.txt")
            return summary

        endog = pd.Categorical(model_input["selected_option"]).codes
        exog = sm.add_constant(model_input[predictor_columns], has_constant="add")

        try:
            model = sm.MNLogit(endog, exog).fit(disp=False, maxiter=200)
            summary_text = model.summary().as_text()
        except Exception as exc:  # pragma: no cover - depends on data shape
            summary_text = f"Choice-attention logistic model failed: {exc}"

        self._write_text(summary_text, "choice_attention_model.txt")
        return summary_text

    def template_family_benchmarking(self) -> pd.DataFrame:
        benchmarks = self.load_table("benchmarks")
        self._write_dataframe(benchmarks, "template_family_benchmarks.csv")

        figure, axes = plt.subplots(1, 3, figsize=(18, 6))
        sns.barplot(
            data=benchmarks,
            x="case_family",
            y="avg_page_duration_ms",
            hue="template_type",
            ax=axes[0],
        )
        axes[0].set_title("Average dwell by family / template")
        axes[0].tick_params(axis="x", rotation=45)

        sns.barplot(
            data=benchmarks,
            x="case_family",
            y="avg_valid_samples",
            hue="template_type",
            ax=axes[1],
        )
        axes[1].set_title("Average valid samples by family / template")
        axes[1].tick_params(axis="x", rotation=45)

        sns.barplot(
            data=benchmarks,
            x="case_family",
            y="conversion_rate",
            hue="template_type",
            ax=axes[2],
        )
        axes[2].set_title("Conversion rate by family / template")
        axes[2].tick_params(axis="x", rotation=45)
        self._save_figure(figure, "template_family_benchmarking.png")

        return benchmarks

    def final_insights_report(self) -> str:
        quality = self.load_table("session_quality")
        choices = self.load_table("choice_share")
        benchmarks = self.load_table("benchmarks")

        total_sessions = len(quality)
        clean_sessions = len(self.load_table("clean_sessions"))
        avg_valid = quality["total_valid_samples"].mean() if not quality.empty else 0
        top_choice = (
            choices.sort_values("selection_share", ascending=False).head(1).to_dict("records")
            if not choices.empty
            else []
        )
        top_benchmark = (
            benchmarks.sort_values("conversion_rate", ascending=False)
            .head(1)
            .to_dict("records")
            if not benchmarks.empty
            else []
        )

        report_lines = [
            "# Final Insights Report",
            "",
            f"- Total sessions ingested: {total_sessions}",
            f"- Clean sessions retained: {clean_sessions}",
            f"- Average valid samples per session: {avg_valid:,.1f}",
        ]

        if top_choice:
            row = top_choice[0]
            report_lines.extend(
                [
                    "",
                    "## Highest choice share",
                    f"- Page: {row['page_id']}",
                    f"- Selected option: {row['selected_option']}",
                    f"- Share: {row['selection_share']:.2%}",
                ]
            )

        if top_benchmark:
            row = top_benchmark[0]
            report_lines.extend(
                [
                    "",
                    "## Best family/template benchmark",
                    f"- Family: {row['case_family']}",
                    f"- Template: {row['template_type']}",
                    f"- Conversion rate: {row['conversion_rate']:.2%}",
                ]
            )

        report_lines.extend(
            [
                "",
                "## Recommended reporting structure",
                "1. Lead with the quality/exclusion screen so readers understand the retained sample.",
                "2. Describe the participant mix by age, province, device type, and retailer familiarity.",
                "3. Show choice-share and benchmark charts before moving into AOI dwell and TTFF.",
                "4. Use combined and segmented heatmaps to contextualize the AOI metrics.",
                "5. Close with the choice-attention relationship model and case-family recommendations.",
            ]
        )

        report = "\n".join(report_lines)
        self._write_text(report, "final_insights_report.md")
        return report

    def run_all(
        self,
        screenshot_map: dict[str, str | os.PathLike[str]] | None = None,
    ) -> AnalysisArtifacts:
        self.load_all()
        self.export_clean_dataset()
        self.data_quality_screening()
        self.participant_profile_summaries()
        self.choice_share_analysis()
        self.dwell_time_analysis()
        self.ttff_analysis()
        self.heatmap_overlays(screenshot_map=screenshot_map, segmented=True)
        self.scanpath_transition_analysis()
        self.segment_comparison_analysis()
        self.choice_attention_relationship()
        self.template_family_benchmarking()
        self.final_insights_report()
        return AnalysisArtifacts(output_dir=self.output_dir, files=self._artifacts.copy())


def main() -> None:
    engine = create_sqlalchemy_engine()
    pipeline = EyeTrackingAnalysisPipeline(engine)
    artifacts = pipeline.run_all()
    print(f"Analysis outputs saved to: {artifacts.output_dir.resolve()}")
    for artifact in artifacts.files:
        print(f"- {artifact}")


if __name__ == "__main__":
    main()
