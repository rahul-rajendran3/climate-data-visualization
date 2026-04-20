from flask import Blueprint, jsonify, request
import os
import pandas as pd
from services.kaggle_service import kaggle_service
from services.reliefweb_service import reliefweb_service

climate_data_bp = Blueprint('climate_data_bp', __name__)


@climate_data_bp.route('/api/climate-data')
def get_climate_data():
    """
    API endpoint to get climate change data.
    Returns a JSON array of records (limited to 100 rows for safety).
    """
    try:
        data = kaggle_service.get_climate_change_data()
        limit = request.args.get('limit', '100')
        try:
            limit_int = int(limit)
        except ValueError:
            return jsonify({"error": "limit must be an integer"}), 400
        limit_int = max(1, min(limit_int, 500))

        records = data.head(limit_int).to_dict(orient='records')
        return jsonify(records), 200
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@climate_data_bp.route('/api/climate-meta')
def climate_meta():
    """Return metadata helpful for map visualizations (available years and numeric metrics)."""
    try:
        dataset_ref = os.getenv("KAGGLE_CLIMATE_DATASET_REF", "algozee/climate-cahnge")
        df = kaggle_service.get_climate_change_data()

        years = []
        if 'year' in df.columns:
            try:
                years = sorted([int(y) for y in df['year'].dropna().unique().tolist()])
            except Exception:
                years = sorted([str(y) for y in df['year'].dropna().unique().tolist()])

        excluded = {'year', 'country'}
        numeric_cols = [
            c for c in df.columns
            if c not in excluded and pd.api.types.is_numeric_dtype(df[c])
        ]

        return jsonify({
            "datasetRef": dataset_ref,
            "years": years,
            "metrics": numeric_cols,
            "defaultMetric": numeric_cols[0] if numeric_cols else None,
        }), 200
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@climate_data_bp.route('/api/climate-map')
def climate_map():
    """Choropleth-ready output: [{country, value}] for a given metric + year.

    Query params:
    - metric: numeric column name (required)
    - year: year to filter (optional; defaults to latest)
    - agg: mean|median|sum|min|max (optional; default mean)
    """
    metric = request.args.get('metric')
    if not metric:
        return jsonify({"error": "Missing required query param: metric"}), 400

    agg = (request.args.get('agg') or 'mean').lower()
    if agg not in {'mean', 'median', 'sum', 'min', 'max'}:
        return jsonify({"error": "agg must be one of: mean, median, sum, min, max"}), 400

    try:
        dataset_ref = os.getenv("KAGGLE_CLIMATE_DATASET_REF", "algozee/climate-cahnge")
        df = kaggle_service.get_climate_change_data()
        if metric not in df.columns:
            return jsonify({"error": f"Unknown metric: {metric}"}), 400
        if 'country' not in df.columns:
            return jsonify({"error": "Dataset is missing required column: country"}), 500
        if not pd.api.types.is_numeric_dtype(df[metric]):
            return jsonify({"error": f"Metric is not numeric: {metric}"}), 400

        # year handling
        year = request.args.get('year')
        if 'year' in df.columns:
            year_num = pd.to_numeric(df['year'], errors='coerce')
            if year is None:
                max_year = year_num.dropna().max()
                year_val = int(max_year) if pd.notna(max_year) else None
            else:
                try:
                    year_val = int(year)
                except Exception:
                    year_val = None

            if year_val is not None:
                df = df[year_num == year_val]
        else:
            year_val = None

        # group by country for choropleth
        grouped = getattr(df.groupby('country')[metric], agg)().reset_index()
        grouped = grouped.rename(columns={metric: 'value'})
        records = grouped.dropna(subset=['value']).to_dict(orient='records')

        return jsonify({
            "datasetRef": dataset_ref,
            "year": year_val,
            "metric": metric,
            "agg": agg,
            "records": records,
        }), 200
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@climate_data_bp.route('/api/climate-news')
def climate_news():
    """Return latest climate change news coverage for a hovered region.

    Query params:
    - country: country/region name (required; comes from GeoJSON feature properties)
    - limit: number of articles (optional; default 5; capped)
    """

    country = (request.args.get('country') or '').strip()
    if not country:
        return jsonify({"error": "Missing required query param: country"}), 400

    limit = request.args.get('limit', '5')
    try:
        limit_int = int(limit)
    except ValueError:
        return jsonify({"error": "limit must be an integer"}), 400

    try:
        articles = reliefweb_service.get_latest_climate_news(country, limit=limit_int)
        return jsonify({
            "country": country,
            "query": f"climate change {country}",
            "articles": articles,
        }), 200
    except PermissionError as e:
        cached = reliefweb_service.get_cached_latest_climate_news(country, limit=limit_int, allow_expired=True)
        if cached:
            return jsonify({
                "country": country,
                "query": f"climate change {country}",
                "articles": cached,
                "warning": "ReliefWeb access denied; showing cached results.",
            }), 200
        return jsonify({"error": str(e)}), 502
    except Exception as e:
        cached = reliefweb_service.get_cached_latest_climate_news(country, limit=limit_int, allow_expired=True)
        if cached:
            return jsonify({
                "country": country,
                "query": f"climate change {country}",
                "articles": cached,
                "warning": "ReliefWeb error; showing cached results.",
            }), 200
        return jsonify({"error": str(e)}), 500
