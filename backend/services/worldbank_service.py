from __future__ import annotations

import os
import re
from typing import Any, Dict, Optional

import pandas as pd


class WorldBankService:
    """Load and normalize World Bank indicator CSV data for API use."""

    # Keep only the six indicators requested for the app experience.
    _allowed_indicator_codes = {
        "AG.LND.AGRI.ZS",  # Agricultural land (% of land area)
        "ER.H2O.FWTL.K3",  # Annual freshwater withdrawals, total (billion cubic meters)
        "AG.LND.FRST.ZS",  # Forest area (% of land area)
        "SP.POP.TOTL",  # Population, total
        "SP.URB.TOTL",  # Urban population
        "EG.FEC.RNEW.ZS",  # Renewable energy consumption (% of total final energy consumption)
    }

    def __init__(self) -> None:
        backend_root = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
        default_csv = os.path.join(
            backend_root, "data", "API_19_DS2_en_csv_v2_8525.csv"
        )
        self._csv_path = os.getenv("WORLDBANK_CSV_PATH", default_csv)
        self._normalized_cache: Optional[pd.DataFrame] = None

        self._country_aliases = {
            "Bahamas, The": "Bahamas",
            "Congo, Dem. Rep.": "Democratic Republic of the Congo",
            "Congo, Rep.": "Republic of the Congo",
            "Cote d'Ivoire": "Ivory Coast",
            "Egypt, Arab Rep.": "Egypt",
            "Gambia, The": "Gambia",
            "Iran, Islamic Rep.": "Iran",
            "Korea, Dem. People's Rep.": "North Korea",
            "Korea, Rep.": "South Korea",
            "Kyrgyz Republic": "Kyrgyzstan",
            "Lao PDR": "Laos",
            "Russian Federation": "Russia",
            "Slovak Republic": "Slovakia",
            "Syrian Arab Republic": "Syria",
            "Turkiye": "Turkey",
            "United States": "USA",
            "Venezuela, RB": "Venezuela",
            "Viet Nam": "Vietnam",
            "Yemen, Rep.": "Yemen",
        }

    def _slugify_metric(self, value: str) -> str:
        text = (value or "").strip().lower()
        text = text.replace("&", " and ")
        text = text.replace("%", " percent ")
        text = re.sub(r"[^a-z0-9]+", "_", text)
        text = re.sub(r"_+", "_", text).strip("_")
        if not text:
            return "metric"
        if text[0].isdigit():
            return f"m_{text}"
        return text

    def _build_metric_mapping(self, indicators: pd.DataFrame) -> Dict[str, str]:
        mapping: Dict[str, str] = {}
        used: set[str] = set()

        for _, row in indicators.iterrows():
            indicator_code = str(row["indicator_code"])
            indicator_name = str(row["indicator_name"])

            base = self._slugify_metric(indicator_name)
            metric = base
            if metric in used:
                metric = f"{base}_{self._slugify_metric(indicator_code)}"

            mapping[indicator_code] = metric
            used.add(metric)

        return mapping

    def _load_normalized_dataframe(self) -> pd.DataFrame:
        if self._normalized_cache is not None:
            return self._normalized_cache.copy()

        raw = pd.read_csv(self._csv_path, skiprows=4, low_memory=False)

        required_cols = [
            "Country Name",
            "Country Code",
            "Indicator Name",
            "Indicator Code",
        ]
        missing = [c for c in required_cols if c not in raw.columns]
        if missing:
            raise RuntimeError(f"World Bank CSV is missing required columns: {missing}")

        year_cols = [
            c for c in raw.columns if isinstance(c, str) and re.fullmatch(r"\d{4}", c)
        ]
        if not year_cols:
            raise RuntimeError("World Bank CSV has no year columns.")

        data = raw[required_cols + year_cols].rename(
            columns={
                "Country Name": "country",
                "Country Code": "country_code",
                "Indicator Name": "indicator_name",
                "Indicator Code": "indicator_code",
            }
        )

        climate_data = data[
            data["indicator_code"].isin(self._allowed_indicator_codes)
        ].copy()

        if climate_data.empty:
            raise RuntimeError(
                "World Bank CSV does not contain the configured indicator codes."
            )

        indicators = (
            climate_data[["indicator_code", "indicator_name"]]
            .drop_duplicates()
            .sort_values(["indicator_name", "indicator_code"])
        )
        metric_by_code = self._build_metric_mapping(indicators)

        long_df = climate_data.melt(
            id_vars=["country", "country_code", "indicator_name", "indicator_code"],
            value_vars=year_cols,
            var_name="year",
            value_name="value",
        )

        long_df["year"] = pd.to_numeric(long_df["year"], errors="coerce").astype(
            "Int64"
        )
        long_df["value"] = pd.to_numeric(long_df["value"], errors="coerce")
        long_df["metric"] = long_df["indicator_code"].map(metric_by_code)
        long_df["country"] = long_df["country"].replace(self._country_aliases)

        long_df = long_df.dropna(subset=["year", "value", "metric"])
        long_df["year"] = long_df["year"].astype(int)

        wide_df = (
            long_df.pivot_table(
                index=["country", "year"],
                columns="metric",
                values="value",
                aggfunc="mean",
            )
            .reset_index()
            .sort_values(["year", "country"])
        )
        wide_df.columns.name = None

        self._normalized_cache = wide_df
        return wide_df.copy()

    def get_climate_change_data(self) -> pd.DataFrame:
        return self._load_normalized_dataframe()

    def get_climate_meta(self) -> Dict[str, Any]:
        df = self.get_climate_change_data()

        years = sorted([int(y) for y in df["year"].dropna().unique().tolist()])
        metrics = [c for c in df.columns if c not in {"country", "year"}]
        metric_years: Dict[str, list[int]] = {
            metric: sorted(
                [
                    int(y)
                    for y in df.loc[df[metric].notna(), "year"]
                    .dropna()
                    .unique()
                    .tolist()
                ]
            )
            for metric in metrics
        }

        preferred_terms = ["co2", "renewable", "temperature", "emission", "forest"]
        default_metric = None
        for term in preferred_terms:
            matched = next((m for m in metrics if term in m), None)
            if matched:
                default_metric = matched
                break
        if default_metric is None and metrics:
            default_metric = metrics[0]

        return {
            "datasetRef": os.path.basename(self._csv_path),
            "years": years,
            "metrics": metrics,
            "metricYears": metric_years,
            "defaultMetric": default_metric,
        }

    def get_climate_map(
        self, metric: str, *, year: Optional[int] = None, agg: str = "mean"
    ) -> Dict[str, Any]:
        df = self.get_climate_change_data()

        if metric not in df.columns:
            raise ValueError(f"Unknown metric: {metric}")

        if agg not in {"mean", "median", "sum", "min", "max"}:
            raise ValueError("agg must be one of: mean, median, sum, min, max")

        chosen_year: Optional[int]
        if year is None:
            available_years = sorted(
                df.loc[df[metric].notna(), "year"].astype(int).unique().tolist()
            )
            chosen_year = available_years[-1] if available_years else None
        else:
            chosen_year = int(year)

        filtered = df
        if chosen_year is not None:
            filtered = df[df["year"] == chosen_year]

        grouped = getattr(filtered.groupby("country")[metric], agg)().reset_index()
        grouped = grouped.rename(columns={metric: "value"}).dropna(subset=["value"])

        return {
            "datasetRef": os.path.basename(self._csv_path),
            "year": chosen_year,
            "metric": metric,
            "agg": agg,
            "records": grouped.to_dict(orient="records"),
        }


worldbank_service = WorldBankService()
