# Open Data Company (working name)

Data products built from open US and world data. Site: GitHub Pages from `docs/`.

| Path | What it is |
|---|---|
| `docs/` | The website: home, data catalog, load forecast scorecard |
| `scripts/build_catalog.py` | Source list for the catalog; writes `docs/data/catalog.json` |
| `scripts/build_scorecard.py` | Reads PJM load report tables; writes `docs/data/scorecard.json` |
| `data/raw/pjm/` | PJM Load Forecast Report tables (January 2025 and 2026), as published |

## Rebuild

```
pip install openpyxl
python scripts/build_catalog.py
python scripts/build_scorecard.py
```

## Scorecard method

Forecast: summer peak for year Y from the January Y PJM Load Forecast Report (Table B-1, normal weather).
Actual: weather-normalized summer peak for year Y from the January Y+1 report (Table F-3).
Error = (forecast - normalized actual) / normalized actual. Positive means the forecast was too high.
The preview covers Y = 2025 only.

## Catalog licence column

A starting point, not legal advice. Check each source's own terms before commercial use.
