import os

import pandas as pd
from flask import Blueprint, jsonify, request
from services.kaggle_service import kaggle_service
from services.gdelt_service import extract_top_words, gdelt_service
from services.reliefweb_service import reliefweb_service
from services.worldbank_service import worldbank_service

climate_data_bp = Blueprint("climate_data_bp", __name__)


def _get_limit_arg(default: str = "100") -> int:
    limit = request.args.get("limit", default)
    try:
        limit_int = int(limit)
    except ValueError:
        raise ValueError("limit must be an integer")
    return max(1, min(limit_int, 500))


def _get_worldbank_data_response():
    worldbank_df = worldbank_service.get_climate_change_data()
    kaggle_df = _get_kaggle_data()

    # Merge by country-year so Kaggle features are available alongside WB metrics.
    data = worldbank_df.merge(kaggle_df, on=["country", "year"], how="outer")
    limit_int = _get_limit_arg("100")
    records = data.head(limit_int).to_dict(orient="records")
    return jsonify(records), 200


def _get_worldbank_meta_response():
    meta = worldbank_service.get_climate_meta()
    kaggle_df = _get_kaggle_data()
    kaggle_metrics = _get_kaggle_metric_columns(kaggle_df)

    kaggle_years = sorted(
        [int(y) for y in kaggle_df["year"].dropna().unique().tolist()]
    )
    kaggle_metric_years = {
        metric: sorted(
            [
                int(y)
                for y in kaggle_df.loc[kaggle_df[metric].notna(), "year"]
                .dropna()
                .unique()
                .tolist()
            ]
        )
        for metric in kaggle_metrics
    }

    merged_metrics = meta.get("metrics", []) + [
        m for m in kaggle_metrics if m not in set(meta.get("metrics", []))
    ]
    merged_years = sorted(set(meta.get("years", []) + kaggle_years))

    merged_metric_years = dict(meta.get("metricYears", {}))
    merged_metric_years.update(kaggle_metric_years)

    meta = {
        **meta,
        "years": merged_years,
        "metrics": merged_metrics,
        "metricYears": merged_metric_years,
    }
    return jsonify(meta), 200


def _get_kaggle_data_response():
    kaggle_df = _get_kaggle_data()
    limit_int = _get_limit_arg("500")
    records = kaggle_df.head(limit_int).to_dict(orient="records")
    return jsonify(records), 200


def _get_kaggle_meta_response():
    kaggle_df = _get_kaggle_data()
    kaggle_metrics = _get_kaggle_metric_columns(kaggle_df)

    kaggle_years = sorted(
        [int(y) for y in kaggle_df["year"].dropna().unique().tolist()]
    )

    kaggle_metric_years = {
        metric: sorted(
            [
                int(y)
                for y in kaggle_df.loc[kaggle_df[metric].notna(), "year"]
                .dropna()
                .unique()
                .tolist()
            ]
        )
        for metric in kaggle_metrics
    }

    meta = {
        "years": kaggle_years,
        "metrics": kaggle_metrics,
        "defaultMetric": kaggle_metrics[0] if kaggle_metrics else None,
        "metricYears": kaggle_metric_years,
    }
    return jsonify(meta), 200


def _get_kaggle_data() -> pd.DataFrame:
    df = kaggle_service.get_climate_change_data().copy()

    if "country" not in df.columns or "year" not in df.columns:
        raise RuntimeError("Kaggle dataset must include 'country' and 'year' columns")

    df["country"] = df["country"].astype(str).str.strip()
    df["year"] = pd.to_numeric(df["year"], errors="coerce")
    df = df.dropna(subset=["country", "year"])
    df["year"] = df["year"].astype(int)

    for column in _get_kaggle_metric_columns(df):
        df[column] = pd.to_numeric(df[column], errors="coerce")

    return df


def _get_kaggle_metric_columns(df: pd.DataFrame) -> list[str]:
    excluded = {"country", "year"}
    metric_columns: list[str] = []
    for column in df.columns:
        if column in excluded:
            continue
        if pd.api.types.is_numeric_dtype(df[column]):
            metric_columns.append(column)
    return metric_columns


def _get_kaggle_map_response(metric: str, year: int | None, agg: str):
    kaggle_df = _get_kaggle_data()
    kaggle_metrics = set(_get_kaggle_metric_columns(kaggle_df))
    if metric not in kaggle_metrics:
        raise ValueError(f"Unknown metric: {metric}")

    chosen_year: int | None
    if year is None:
        available_years = sorted(
            kaggle_df.loc[kaggle_df[metric].notna(), "year"]
            .astype(int)
            .unique()
            .tolist()
        )
        chosen_year = available_years[-1] if available_years else None
    else:
        chosen_year = int(year)

    filtered = kaggle_df
    if chosen_year is not None:
        filtered = kaggle_df[kaggle_df["year"] == chosen_year]

    grouped = getattr(filtered.groupby("country")[metric], agg)().reset_index()
    grouped = grouped.rename(columns={metric: "value"}).dropna(subset=["value"])

    return {
        "datasetRef": os.getenv("KAGGLE_CLIMATE_DATASET_REF", "algozee/climate-cahnge"),
        "year": chosen_year,
        "metric": metric,
        "agg": agg,
        "records": grouped.to_dict(orient="records"),
    }


def _get_worldbank_map_response():
    metric = request.args.get("metric")
    if not metric:
        return jsonify({"error": "Missing required query param: metric"}), 400

    agg = (request.args.get("agg") or "mean").lower()
    if agg not in {"mean", "median", "sum", "min", "max"}:
        return (
            jsonify({"error": "agg must be one of: mean, median, sum, min, max"}),
            400,
        )

    year_raw = request.args.get("year")
    if year_raw is None or year_raw == "":
        year_val = None
    else:
        try:
            year_val = int(year_raw)
        except ValueError:
            return jsonify({"error": "year must be an integer"}), 400

    worldbank_df = worldbank_service.get_climate_change_data()
    if metric in worldbank_df.columns:
        try:
            payload = worldbank_service.get_climate_map(metric, year=year_val, agg=agg)
            return jsonify(payload), 200
        except ValueError as e:
            return jsonify({"error": str(e)}), 400

    try:
        payload = _get_kaggle_map_response(metric, year=year_val, agg=agg)
        return jsonify(payload), 200
    except ValueError as e:
        return jsonify({"error": str(e)}), 400


@climate_data_bp.route("/api/climate-data")
def get_climate_data():
    """
    API endpoint to get climate change data.
    Returns a JSON array of records (limited to 100 rows for safety).
    """
    try:
        return _get_worldbank_data_response()
    except ValueError as e:
        return jsonify({"error": str(e)}), 400
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@climate_data_bp.route("/api/climate-meta")
def climate_meta():
    """Return metadata helpful for map visualizations (available years and numeric metrics)."""
    try:
        return _get_worldbank_meta_response()
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@climate_data_bp.route("/api/climate-map")
def climate_map():
    """Choropleth-ready output: [{country, value}] for a given metric + year.

    Query params:
    - metric: numeric column name (required)
    - year: year to filter (optional; defaults to latest)
    - agg: mean|median|sum|min|max (optional; default mean)
    """
    try:
        return _get_worldbank_map_response()
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@climate_data_bp.route("/api/worldbank-data")
def worldbank_data():
    """World Bank dataset endpoint alias for climate-data."""
    try:
        return _get_worldbank_data_response()
    except ValueError as e:
        return jsonify({"error": str(e)}), 400
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@climate_data_bp.route("/api/worldbank-meta")
def worldbank_meta():
    """World Bank metadata endpoint alias for climate-meta."""
    try:
        return _get_worldbank_meta_response()
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@climate_data_bp.route("/api/worldbank-map")
def worldbank_map():
    """World Bank choropleth endpoint alias for climate-map."""
    try:
        return _get_worldbank_map_response()
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@climate_data_bp.route("/api/kaggle-data")
def kaggle_data():
    """Kaggle climate dataset records only."""
    try:
        return _get_kaggle_data_response()
    except ValueError as e:
        return jsonify({"error": str(e)}), 400
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@climate_data_bp.route("/api/kaggle-meta")
def kaggle_meta():
    """Kaggle metadata (years and numeric metrics) only."""
    try:
        return _get_kaggle_meta_response()
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@climate_data_bp.route("/api/climate-news")
def climate_news():
    """Return latest climate change news coverage for a hovered region.

    Query params:
    - country: country/region name (required; comes from GeoJSON feature properties)
    - limit: number of articles (optional; default 5; capped)
    """

    country = (request.args.get("country") or "").strip()
    if not country:
        return jsonify({"error": "Missing required query param: country"}), 400

    limit = request.args.get("limit", "5")
    try:
        limit_int = int(limit)
    except ValueError:
        return jsonify({"error": "limit must be an integer"}), 400

    try:
        articles = reliefweb_service.get_latest_climate_news(country, limit=limit_int)
        return (
            jsonify(
                {
                    "country": country,
                    "query": f"climate change {country}",
                    "articles": articles,
                }
            ),
            200,
        )
    except PermissionError as e:
        cached = reliefweb_service.get_cached_latest_climate_news(
            country, limit=limit_int, allow_expired=True
        )
        if cached:
            return (
                jsonify(
                    {
                        "country": country,
                        "query": f"climate change {country}",
                        "articles": cached,
                        "warning": "ReliefWeb access denied; showing cached results.",
                    }
                ),
                200,
            )
        return jsonify({"error": str(e)}), 502
    except Exception as e:
        cached = reliefweb_service.get_cached_latest_climate_news(
            country, limit=limit_int, allow_expired=True
        )
        if cached:
            return (
                jsonify(
                    {
                        "country": country,
                        "query": f"climate change {country}",
                        "articles": cached,
                        "warning": "ReliefWeb error; showing cached results.",
                    }
                ),
                200,
            )
        return jsonify({"error": str(e)}), 500


@climate_data_bp.route("/api/climate-news-wordmap")
def climate_news_wordmap():
    """Return a global word cloud for climate-change news.

    Query params:
    - timespan: e.g. 1week, 7d, 24h (optional; default 24h)
    - maxrecords: number of articles to sample (optional; default 80; capped to 250)
    - top: number of words to return (optional; default 60; capped to 120)
    """

    timespan = (request.args.get("timespan") or "24h").strip() or "24h"

    maxrecords_raw = request.args.get("maxrecords", "80")
    try:
        maxrecords = int(maxrecords_raw)
    except ValueError:
        return jsonify({"error": "maxrecords must be an integer"}), 400
    maxrecords = max(1, min(maxrecords, 250))

    top_raw = request.args.get("top", "60")
    try:
        top = int(top_raw)
    except ValueError:
        return jsonify({"error": "top must be an integer"}), 400
    top = max(1, min(top, 120))

    try:
        articles = gdelt_service.get_latest_climate_articles(
            maxrecords=maxrecords,
            timespan=timespan,
        )
        titles = [a.get("title", "") for a in articles if isinstance(a, dict)]
        words = extract_top_words([t for t in titles if isinstance(t, str)], top=top)

        return (
            jsonify(
                {
                    "timespan": timespan,
                    "maxrecords": maxrecords,
                    "query": '"climate change" OR "global warming" (English sources)',
                    "articleCount": len(articles),
                    "articles": articles,
                    "words": words,
                }
            ),
            200,
        )
    except Exception as e:
        return jsonify({"error": str(e)}), 502
