# Climate Data Visualization

The goal is to present climate data on an interactive map to highlight how climate change can affect users.

Project layout

- `frontend/` — React app (Vite + TypeScript) that will fetch data from the backend and visualize it on a map.
- `backend/` — Flask API that downloads and caches Kaggle datasets and serves JSON to the frontend.

Core behavior

- The backend downloads datasets from Kaggle into `backend/data/` and re-uses the local files on subsequent runs (file-based caching). No database is used.

Quick start

Prerequisites

- Node.js + npm
- Python 3.8+
- Kaggle API credentials (`KAGGLE_USERNAME` + `KAGGLE_API_TOKEN` from your downloaded `kaggle.json`)

Backend

1. Open a terminal and change to the backend folder:

```bash
cd backend
```

2. Create and activate a virtual environment:

macOS / Linux:

```bash
python3 -m venv .venv
source .venv/bin/activate
```

Windows (PowerShell):

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
```

3. Install Python dependencies:

```bash
pip install -r requirements.txt
```

4. Create a `.env` file in `backend/` and add your Kaggle credentials.

Example (in `backend/.env`):

```text
KAGGLE_USERNAME=your_username
KAGGLE_API_TOKEN=your_api_token
```

5. Start the Flask server:

```bash
flask --app app run --debug
```

By default the backend listens on `http://127.0.0.1:5001` (configured via `FLASK_RUN_PORT` in `backend/.env`). The dataset API endpoint is:

```
GET /api/climate-data?limit=100
```

This endpoint returns a JSON array of records (default 100 rows) from the `algozee/climate-cahnge` dataset. The backend caches the dataset under `backend/data/` after the first successful download, so subsequent requests mostly just load from disk.

Note: the first request after a fresh setup may take longer because it downloads the Kaggle dataset and extracts it.

Map-friendly endpoints

Metadata for building dropdowns (years + numeric metrics):

```
GET /api/climate-meta
```

Response shape:

```json
{
	"datasetRef": "algozee/climate-cahnge",
	"years": [2020, 2021, 2022],
	"metrics": ["co2_concentration_ppm", "global_avg_temperature"],
	"defaultMetric": "co2_concentration_ppm"
}
```

Choropleth-ready output grouped by country:

```
GET /api/climate-map?metric=co2_concentration_ppm
GET /api/climate-map?metric=co2_concentration_ppm&year=2020&agg=mean
```

Parameters:

- `metric` (required): a numeric column name (pick from `/api/climate-meta`)
- `year` (optional): defaults to latest year in the dataset
- `agg` (optional): one of `mean`, `median`, `sum`, `min`, `max` (default `mean`)

Response shape:

```json
{
	"datasetRef": "algozee/climate-cahnge",
	"year": 2020,
	"metric": "co2_concentration_ppm",
	"agg": "mean",
	"records": [
		{"country": "Australia", "value": 412.3},
		{"country": "Canada", "value": 411.1}
	]
}

```

Climate news

On hover, the choropleth can optionally fetch recent climate-change news coverage for the hovered country/region.

```
GET /api/climate-news?country=India&limit=5
```

Response shape:

```json
{
	"country": "India",
	"query": "climate change India",
	"articles": [
		{
			"title": "...",
			"url": "https://...",
			"source": "example.com",
			"date": "2026-04-19 12:34:56.000"
		}
	]
}
```

ReliefWeb note: This project uses ReliefWeb reports for the news hover panel. ReliefWeb requires an approved `appname`.

Set this in `backend/.env`:

```text
RELIEFWEB_APPNAME=your-approved-appname
```

Frontend

1. Open a terminal and change to the frontend folder:

```bash
cd frontend
```

2. Install npm packages:

```bash
npm install
```

3. Start the dev server:

```bash
npm run dev
```

The frontend will run on Vite's default port (usually `http://localhost:5173`). Configure the frontend to call the backend `http://127.0.0.1:5001/api/climate-data`.
