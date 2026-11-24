# Open Data Company (working name)

An open data portal built around one job: get someone from "I need data on X" to a clean file in a
few clicks. Search across every dataset, variable and country; choose variables, places and years;
check the table; download CSV, Excel, JSON or TSV. World data comes first. Site: GitHub Pages from `docs/`.

| Path | What it is |
|---|---|
| `docs/index.html` | Home: search, quick picks, dataset list with one-click download, live globe, ticker, counters, featured charts |
| `docs/explore.html` | Explorer: chip pickers for variables and places, time presets, conditions, merging, table, chart, summary, download bar |
| `docs/catalog.html` | Source catalog: the open sources being worked through |
| `docs/scorecard.html` | Load Forecast Scorecard (PJM, summer 2025 preview) |
| `scripts/build_datasets.py` | Fetches each dataset and writes `docs/data/sets/*.csv` and `docs/data/datasets.json` |
| `scripts/build_catalog.py` | Source list for the catalog |
| `scripts/build_scorecard.py` | PJM forecast-versus-actual scorecard |
| `scripts/build_land.mjs` | One-off: land points for the home page globe (`docs/data/land.json`) |
| `.github/workflows/refresh.yml` | Rebuilds everything every day and commits changes |

## How the portal works

Each dataset is one tidy CSV plus a manifest entry (keys, time column, every variable with its
title, unit and description, source and licence). The explorer reads the manifest and builds all
controls from it, so it needs no code changes when a dataset is added. Everything runs in the
visitor's browser; there is no server.

Two datasets can be merged when they share the same key columns (for example `code + year`).

## What is live, and what is not

- **Live:** the globe on the home page reads the US Geological Survey's public earthquake feed directly in the visitor's
  browser and re-reads it every minute. If the feed cannot be reached, the globe shows the last saved 24 hours instead and says so.
- **Daily:** every dataset, the ticker values and the featured charts are rebuilt once a day by the workflow
  (`docs/data/pulse.json` holds the small set of numbers the home page needs).
- **Estimates:** the three running counters spread the latest full-year figure evenly across the current year.
  They are labelled as estimates on the page.

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
The globe's land outline comes from Natural Earth (public domain) through the `world-atlas` package.
The typefaces are Barlow and Barlow Condensed (SIL Open Font License), served from `docs/fonts/`.
