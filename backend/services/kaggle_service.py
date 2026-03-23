import os
import glob
import zipfile
import pandas as pd
import requests
from typing import Optional
from dotenv import load_dotenv

# Load backend/.env reliably
BACKEND_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
load_dotenv(dotenv_path=os.path.join(BACKEND_ROOT, ".env"))


class KaggleService:
    def _dataset_cache_dir(self, dataset_ref: str) -> str:
        data_root = os.path.join(BACKEND_ROOT, "data")
        os.makedirs(data_root, exist_ok=True)
        return os.path.join(data_root, dataset_ref.replace("/", "__"))

    def get_dataset_dataframe(self, dataset_ref: str, *, expected_file: Optional[str] = None) -> pd.DataFrame:
        """Download (if needed), cache, and load a dataset into a DataFrame.

        Picks `expected_file` if present, otherwise chooses a reasonable CSV.
        """
        dataset_dir = self._dataset_cache_dir(dataset_ref)

        cached_csvs = glob.glob(os.path.join(dataset_dir, "**", "*.csv"), recursive=True)
        if not cached_csvs:
            self.download_dataset(dataset_ref, output_dir=dataset_dir)

        if expected_file:
            expected_matches = glob.glob(
                os.path.join(dataset_dir, "**", expected_file),
                recursive=True,
            )
            if expected_matches:
                return pd.read_csv(expected_matches[0])

        csv_files = glob.glob(os.path.join(dataset_dir, "**", "*.csv"), recursive=True)
        if not csv_files:
            raise FileNotFoundError(f"Dataset downloaded but no CSV files found in '{dataset_dir}'.")

        chosen = None
        for c in csv_files:
            if "climate" in os.path.basename(c).lower():
                chosen = c
                break
        if chosen is None:
            chosen = csv_files[0]

        return pd.read_csv(chosen)

    def download_dataset(self, dataset_ref: str, output_dir: str) -> None:
        """Download a Kaggle dataset zip and extract it into `output_dir`.

        This backend follows a "load with caching" approach:
        - If the dataset has already been downloaded and extracted into `backend/data/`,
          we just load from disk.
        - Otherwise we download once and cache locally.
        """
        username = os.environ.get("KAGGLE_USERNAME")
        api_key = os.environ.get("KAGGLE_API_TOKEN")
        if not username or not api_key:
            raise RuntimeError(
                "Missing Kaggle credentials. Set KAGGLE_USERNAME and KAGGLE_API_TOKEN in backend/.env"
            )

        if "/" not in dataset_ref:
            raise ValueError("dataset_ref must look like 'owner/dataset-slug'")
        owner, slug = dataset_ref.split("/", 1)

        os.makedirs(output_dir, exist_ok=True)
        zip_path = os.path.join(output_dir, "archive.zip")

        url = f"https://www.kaggle.com/api/v1/datasets/download/{owner}/{slug}"
        resp = requests.get(url, auth=(username, api_key), stream=True, timeout=120)

        if resp.status_code != 200:
            try:
                message = resp.json().get("message") or resp.text
            except Exception:
                message = resp.text
            raise RuntimeError(f"Failed to download dataset '{dataset_ref}': {resp.status_code} {message}")

        with open(zip_path, "wb") as f:
            for chunk in resp.iter_content(chunk_size=1024 * 1024):
                if chunk:
                    f.write(chunk)

        with zipfile.ZipFile(zip_path, "r") as zip_ref:
            zip_ref.extractall(output_dir)
        try:
            os.remove(zip_path)
        except OSError:
            pass

    def get_climate_change_data(self):
        """Load the default climate dataset (cached locally after first download)."""
        dataset_ref = os.getenv("KAGGLE_CLIMATE_DATASET_REF", "algozee/climate-cahnge")
        expected_file = "climate_change_indicators.csv"
        try:
            return self.get_dataset_dataframe(dataset_ref, expected_file=expected_file)
        except Exception as e:
            raise RuntimeError(f"Failed to load dataset '{dataset_ref}': {e}")


kaggle_service = KaggleService()
