# Open Data Company (working name)

An open data site built around one job: get someone from "I need data on X" to a number they can cite or a clean
file they can use, in a few clicks. Light theme by default, dark on request. Site: GitHub Pages from `docs/`.

Five things a visitor can do:

1. **Ask Data AI** in plain words, typed or spoken, and get the answer with its year and its source (`ask.html`).
2. **Take a dataset**: choose variables, places and years, check the table, download CSV, Excel, JSON or TSV (`datasets.html`, `explore.html`).
3. **Test an idea** in Researcher mode: a recommended test with reasons, then the result with charts (`research.html`).
4. **Analyse their own file** in the browser, without uploading it (`mydata.html`).
5. **See how fresh the data is** and what each daily check changed (`updates.html`).

| Path | What it is |
|---|---|
| `docs/index.html` | Home: ask box, live Earth with today's daylight and earthquakes, ticker, the four ways in, datasets by topic, world map, counters, featured charts, update clock |
| `docs/ask.html` | Data AI: questions by typing or voice, answered from the datasets with source, chart and citation, and explained by an AI model |
| `docs/datasets.html` | Every dataset and every variable. Generated; readable without JavaScript; carries schema.org Dataset markup |
| `docs/explore.html` | Explorer: chip pickers for variables and places, time presets, conditions, merging, table, chart, summary, download bar |
| `docs/research.html` | Researcher mode: state a hypothesis, get a recommended test with reasons, run it, read results and charts |
| `docs/mydata.html` | Your data: open a local file, see a profile of every column, run nine analysis tools |
| `docs/updates.html` | Last check, next check, and the log of what each check changed |
| `docs/guide.html` | How to use each part, with pictures and common questions |
| `docs/catalog.html` | Source catalog: the open sources being worked through |
| `docs/scorecard.html` | Case study: a US power-grid load forecast scorecard (PJM, summer 2025) |
| `docs/llms.txt`, `docs/sitemap.xml` | Plain-text index of the data for AI systems and scripts; sitemap for search engines. Both generated |
| `docs/assets/core.js` | Shared helpers: light/dark switch, phone menu, dataset loader, chip picker |
| `docs/assets/earth.js` | The home page Earth: NASA day and night imagery with the real day/night line, one WebGL shader |
| `docs/assets/charts.js` | Small chart kit: lines, ranked bars, histogram, scatter, group strips, correlation grid |
| `docs/assets/concepts.js` | Plain words mapped to variables and country nicknames, shared by Data AI and Researcher mode |
| `docs/assets/readers.js` | File readers: delimited text, JSON, SPSS, Stata (own code); spreadsheets and Parquet (via `docs/vendor`) |
| `docs/assets/stats.js` | The statistics used by Researcher mode and Your data, in plain JavaScript |
| `tests/check_stats.py` | Checks `stats.js` against scipy, statsmodels and pymannkendall |
| `tests/check_readers.py` | Writes one table in 11 formats with pandas, pyarrow and pyreadstat and checks `readers.js` reads each back, in three time zones |
| `scripts/build_datasets.py` | Fetches each dataset; writes the CSVs, the manifest, latest values, the sample table and the change log |
| `scripts/build_site.py` | Stamps the shared header and footer into every page; writes `datasets.html`, `llms.txt`, `sitemap.xml` |
| `scripts/build_catalog.py` | Source list for the catalog |
| `scripts/build_scorecard.py` | PJM forecast-versus-actual scorecard |
| `scripts/build_land.mjs`, `scripts/build_worldmap.mjs` | One-off: land points for the fallback globe and country outlines for the map |
| `.github/workflows/refresh.yml` | Rebuilds everything every day and commits changes |
| `.github/workflows/check-stats.yml` | Runs both test suites when the statistics, the readers or the vendored libraries change |

## How the portal works

Each dataset is one tidy CSV plus a manifest entry (keys, time column, every variable with its
title, unit and description, source and licence). The explorer reads the manifest and builds all
controls from it, so it needs no code changes when a dataset is added. Everything runs in the
visitor's browser; there is no server.

Two datasets can be merged when they share the same key columns (for example `code + year`).

## Data AI

`docs/ask.html` answers questions typed or spoken (the microphone uses the browser's speech recognition). Two engines
share the page:

- **The built-in lookup** matches the words of a question to a variable (a fixed list of synonyms in
  `docs/assets/concepts.js`, then a word search over every variable title) and to places, then reads the value from the
  data. It handles one number ("India life expectancy"), comparisons, rankings, a year, world series (oil price, global
  temperature, CO2 in the air) and recent earthquakes. It is instant and involves no AI.
- **The AI** takes everything else: why and how questions, follow-ups, unclear wording, topics outside the data. It is a
  Claude model behind one small serverless function in `ai/` (hosted on Netlify, credentials supplied by Netlify AI
  Gateway, so no key is stored anywhere). The model never holds the data. When it needs a figure it asks for a tool
  (`find_variables`, `get_values`, `rank`, `get_series`, `recent_earthquakes`); the visitor's browser runs the tool
  against the same files the rest of the site uses and sends the result back. The answer cards under an AI reply show
  what was read.

If the service is unreachable or its allowance is used up, the built-in lookup answers alone and offers the closest
variables, so a question always gets a way forward. Text the AI writes from general knowledge is labelled as such.

**Cost guard.** The function has a per-visitor rate limit, a cap on reply length, and a daily and monthly budget kept as
an append-only log in Netlify Blobs. Defaults: 0.03 USD a day and 0.25 USD a month (45 Netlify credits). Change them with
the environment variables `DATA_AI_DAILY_USD` and `DATA_AI_MONTHLY_USD` on the Netlify project; `DATA_AI_MODEL`,
`DATA_AI_PRICE_IN` and `DATA_AI_PRICE_OUT` switch the model. Setting `DATA_AI_URL` to an empty string in
`docs/assets/core.js` turns AI answers off.

**Deploying the service.** Everything Netlify needs is in `ai/` (`netlify.toml`, the function, a one-line landing page).
The workflow `.github/workflows/deploy-ai.yml` checks the function, uploads `ai/` to the Netlify project `open-data-ai`
when it is given a one-time upload address, and then tests the live service from a real browser. The same workflow run
without an address only tests the live service. Other ways to deploy: run `npx netlify deploy --prod` inside `ai/`, or
link the repository to the project in Netlify with the base directory set to `ai` (Netlify then skips builds for commits
that change nothing in `ai/`, so the daily data refresh costs no deploys).

| Check | What it covers |
|---|---|
| `tests/check_ai_service.mjs` | The real function and the real Anthropic SDK against a stand-in model server: request shape, input checks, budget guard. Spends nothing. |
| `tests/check_ai_live.py` | The real page in a headless browser against the live service: health, cross-site rules, and a set of questions answered end to end. Spends a fraction of a cent. |

## Your data

`mydata.html` reads a file in the visitor's browser. Nothing is sent anywhere. `readers.js` reads CSV and other
delimited text (delimiter, encoding and header row are worked out), JSON, JSON Lines, GeoJSON, SPSS `.sav`/`.zsav`
and Stata `.dta` itself; Excel, OpenDocument, Numbers and dBase go through SheetJS and Parquet through hyparquet,
both loaded only when needed (see `docs/vendor/README.md`). SAS and R files are not supported.

Each column is typed (number, date, category, text), profiled and drawn. Nine tools then run on any columns:
summary table, one column, compare groups, relationship, correlations, over time, two categories, totals by group,
before and after. Each picks its test from the shape of the data (for example rank-based tests for small or lopsided
groups) and says why. Results stack on the page so they can be compared.

```
pip install numpy pandas openpyxl pyarrow pyreadstat
python tests/check_readers.py
```

## Updates and the change log

Before each build the workflow keeps a copy of the current CSVs; afterwards `diff_dataset()` compares old and new by
key columns and appends one entry to `docs/data/changelog.json`: rows added and dropped, values revised, new
variables, the newest period, and a few examples of old and new values. The log keeps the most recent 120 checks.
`updates.html` and the home page read it. The schedule shown on the site (`CRON` in `build_datasets.py`) must match
the cron line in `.github/workflows/refresh.yml`.

`python scripts/build_datasets.py --derive` rebuilds only the derived files (latest values, sample, home page data)
from the CSVs already on disk, without fetching anything.

## Being found by search engines and AI systems

- `datasets.html` is plain HTML with schema.org `DataCatalog` and `Dataset` markup, which Google Dataset Search reads.
- Every page has a canonical address, a description and share-card tags; `sitemap.xml` lists the pages.
- `llms.txt` describes every dataset, variable and file address in plain text for AI systems and scripts.
- Search engines only read `robots.txt` at the root of a host, which for GitHub Pages is the `username.github.io`
  repository, not this one. To point crawlers here, add `Sitemap: https://sahiljangra12.github.io/open-data-company/sitemap.xml`
  to that repository's `robots.txt`, and submit the sitemap in Google Search Console.

## Researcher mode

A visitor picks (or types) a hypothesis of one of three kinds: a relationship, a trend, or a difference between groups.
The page loads the data, looks at its shape (how many places and years, skew, sample size) and recommends a method with
its reasons, for example fixed effects with errors clustered by country for a panel, a regression on changes for two
trending series, or a rank-based test for small or skewed groups. Alternatives are one click away. Running it gives a
plain-language result, the numbers, charts, checks on the method's assumptions and a list of what the result does not show.

The recommendations are rules written in `docs/assets/research.js`, not a language model. The typed-sentence reader
matches words to variables with a fixed list of synonyms.

Every statistic is computed in the browser by `docs/assets/stats.js`. Run the check after changing it:

```
pip install numpy scipy statsmodels pymannkendall
python tests/check_stats.py
```

It compares about 5,800 numbers with the reference libraries; they agree to better than one part in a billion.

Country groups (region, income group) come from the World Bank's country list (CC BY 4.0), fetched by the workflow into
`docs/data/countries.json`. The same list is used to leave regional totals out of cross-country analyses.

## What is live, and what is not

- **Live:** the Earth on the home page shows daylight and night-time lights where they are at this minute (the sun's
  position is computed in the browser), and reads the US Geological Survey's public earthquake feed directly in the visitor's
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
python scripts/build_site.py
python -m http.server -d docs
```

## Scorecard method

Forecast: summer peak for year Y from the January Y PJM Load Forecast Report (Table B-1, normal weather).
Actual: weather-normalized summer peak for year Y from the January Y+1 report (Table F-3).
Error = (forecast - normalized actual) / normalized actual. Positive means the forecast was too high.

## Third-party code

`docs/vendor/` holds SheetJS Community Edition 0.20.3 (Apache 2.0; reads and writes spreadsheets) and hyparquet
(MIT; reads Parquet). Versions and where each file came from are in `docs/vendor/README.md`.
The Earth photographs in `docs/img/` (the globe textures and the night-lights band) are NASA
Earth Observatory's Blue Marble and Black Marble imagery, which NASA releases without copyright; they were taken from the
`three-globe` package's examples and cropped. The pictures in the guide (`shot-*.jpg`) are screenshots of the site's own
pages; the four pictures in "Four ways to use it" on the home page are drawn as inline SVG in `docs/index.html`,
and the four topic pictures above the dataset list (`topic-*.svg`) are drawn for this site.
The fallback globe's land outline and the world map's country shapes come from Natural Earth (public domain) through the `world-atlas` package.
The typefaces are Barlow and Barlow Condensed (SIL Open Font License), served from `docs/fonts/`.
