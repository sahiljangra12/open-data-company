# Open Data Company (working name)

An open data portal: browse datasets, choose variables, places, years and filters, preview,
compare, merge, and download as CSV, Excel, JSON or TSV. Site: GitHub Pages from `docs/`.

| Path | What it is |
|---|---|
| `docs/index.html` | Home: the datasets available, with search |
| `docs/explore.html` | Explorer: select, filter, preview, compare, merge, download |
| `docs/catalog.html` | Source catalog: the open sources being worked through |
| `docs/scorecard.html` | Load Forecast Scorecard (PJM, summer 2025 preview) |
| `scripts/build_datasets.py` | Fetches each dataset and writes `docs/data/sets/*.csv` and `docs/data/datasets.json` |
| `scripts/build_catalog.py` | Source list for the catalog |
| `scripts/build_scorecard.py` | PJM forecast-versus-actual scorecard |
| `.github/workflows/refresh.yml` | Rebuilds everything every Monday and commits changes |

## How the portal works

Each dataset is one tidy CSV plus a manifest entry (keys, time column, every variable with its
title, unit and description, source and licence). The explorer reads the manifest and builds all
controls from it, so it needs no code changes when a dataset is added. Everything runs in the
visitor's browser; there is no server.

Two datasets can be merged when they share the same key columns (for example `code + year`).

## Add a dataset

1. In `scripts/build_datasets.py`, write a function that fetches the data and returns `spec(...)`.
2. Add it to `BUILDERS`.
3. Run `python scripts/build_datasets.py`. A builder that fails keeps the last good version.

Only add sources whose licence allows redistribution, and record the licence in the spec.

## Run locally

```
pip install openpyxl
python scripts/build_datasets.py
python -m http.server -d docs
```

## Scorecard method

Forecast: summer peak for year Y from the January Y PJM Load Forecast Report (Table B-1, normal weather).
Actual: weather-normalized summer peak for year Y from the January Y+1 report (Table F-3).
Error = (forecast - normalized actual) / normalized actual. Positive means the forecast was too high.

## Third-party code

`docs/vendor/xlsx.mini.min.js` is SheetJS Community Edition 0.18.5 (Apache 2.0), used only to write Excel files.
