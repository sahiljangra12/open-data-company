"""The Data Agent's own tools. No connectors, no third-party packages: each tool is a plain function that reads the
site's own files in docs/data or calls a public API that needs no key.

Every tool returns a dict that can be turned into JSON. TOOLS maps a name to its function; SPEC is the description the
model sees (the common function-calling format, which Ollama and most model services accept).
"""
import csv, json, math, re, urllib.parse, urllib.request
from functools import lru_cache
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "docs" / "data"
SITE = "https://sahiljangra12.github.io/open-data-company/"
UA = {"User-Agent": "open-data-company-agent (+https://github.com/sahiljangra12/open-data-company)"}
WORLD = {"OWID_WRL", "WLD"}
NICK = {"usa": "USA", "us": "USA", "u.s.": "USA", "america": "USA", "united states of america": "USA", "uk": "GBR",
        "britain": "GBR", "great britain": "GBR", "england": "GBR", "russia": "RUS", "south korea": "KOR", "korea": "KOR",
        "north korea": "PRK", "iran": "IRN", "vietnam": "VNM", "turkey": "TUR", "egypt": "EGY", "world": "WORLD",
        "global": "WORLD", "uae": "ARE", "drc": "COD", "congo": "COD", "czechia": "CZE", "czech republic": "CZE"}


# ---------- reading the site's files ----------

@lru_cache(None)
def manifest():
    return json.loads((DATA / "datasets.json").read_text(encoding="utf-8"))


def datasets():
    return {d["id"]: d for d in manifest()["datasets"]}


@lru_cache(None)
def countries():
    return json.loads((DATA / "countries.json").read_text(encoding="utf-8"))["countries"]


@lru_cache(8)
def rows(ds_id):
    d = datasets()[ds_id]
    with open(ROOT / "docs" / d["file"], newline="", encoding="utf-8") as f:
        return list(csv.DictReader(f))


def num(v):
    try:
        x = float(v)
        return x if math.isfinite(x) else None
    except (TypeError, ValueError):
        return None


def tidy(x):
    if x is None:
        return None
    return int(x) if float(x).is_integer() and abs(x) < 1e15 else float(f"{x:.6g}")


def ds_or_error(ds_id):
    D = datasets()
    if ds_id in D:
        return D[ds_id], None
    near = [i for i in D if ds_id and ds_id.lower().split("-")[0] in i][:5]
    return None, {"error": f"No dataset with id '{ds_id}'.", "did_you_mean": near or "use find_variables or search_datasets first"}


def column(d, var):
    for c in d["columns"]:
        if c["name"] == var:
            return c
    return None


def source_of(d):
    return {"dataset": d["id"], "title": d["title"], "source": d["source"], "licence": d["licence"], "file": SITE + d["file"]}


def entity_cols(d):
    e = d.get("entity") or {}
    return e.get("col"), e.get("label_col") or e.get("col")


def time_col(d):
    return (d.get("time") or {}).get("col")


def match_place(d, place):
    """The entity code in dataset d that a plain place name stands for, or None."""
    col, lab = entity_cols(d)
    if not col or not place:
        return None
    p = place.strip()
    key = NICK.get(p.lower(), p)
    seen = {}
    for r in rows(d["id"]):
        seen.setdefault(r[col], r.get(lab, r[col]))
    if key == "WORLD":
        for w in WORLD:
            if w in seen:
                return w
    for code, name in seen.items():
        if code.lower() == key.lower() or (name or "").lower() == key.lower():
            return code
    for code, name in seen.items():
        if (name or "").lower().startswith(key.lower()):
            return code
    return None


# ---------- tools over the site's data ----------

def search_datasets(query, n=8):
    words = [w for w in re.findall(r"[a-z0-9]+", query.lower()) if len(w) > 2]
    scored = []
    for d in manifest()["datasets"]:
        text = " ".join([d["title"], d["description"], d.get("domain", ""), d.get("region", ""), d["source"]]).lower()
        s = sum(text.count(w) for w in words)
        if s:
            scored.append((s, d))
    scored.sort(key=lambda t: -t[0])
    return {"datasets": [{"id": d["id"], "title": d["title"], "source": d["source"], "keys": d["keys"],
                          "covers": f'{(d.get("time") or {}).get("min", "")} to {(d.get("time") or {}).get("max", "")}',
                          "rows": d["rows"]} for _, d in scored[:n]],
            "total_datasets_on_site": len(manifest()["datasets"])}


def find_variables(query, n=8):
    words = [w for w in re.findall(r"[a-z0-9]+", query.lower()) if len(w) > 1]
    out = []
    for d in manifest()["datasets"]:
        for c in d["columns"]:
            if c.get("type") != "num":
                continue
            title = (c["title"] + " " + c["name"].replace("_", " ")).lower()
            s = sum(3 for w in words if w in title) + sum(1 for w in words if w in (c.get("description") or "").lower())
            if s:
                out.append((s - len(title) / 400, d, c))
    out.sort(key=lambda t: -t[0])
    return {"variables": [{"dataset": d["id"], "variable": c["name"], "title": c["title"], "unit": c.get("unit", ""),
                           "keys": d["keys"], "covers": f'{(d.get("time") or {}).get("min", "")} to {(d.get("time") or {}).get("max", "")}',
                           "source": d["source"]} for _, d, c in out[:n]]}


def describe_dataset(dataset):
    d, err = ds_or_error(dataset)
    if err:
        return err
    return {**source_of(d), "description": d["description"], "keys": d["keys"], "time": d.get("time"), "rows": d["rows"],
            "variables": [{"name": c["name"], "title": c["title"], "unit": c.get("unit", "")} for c in d["columns"]][:60]}


def get_values(dataset, variable, places, year=None):
    d, err = ds_or_error(dataset)
    if err:
        return err
    c = column(d, variable)
    if not c:
        return {"error": f"'{variable}' is not a variable of {dataset}.", "variables": [x["name"] for x in d["columns"]][:40]}
    col, lab = entity_cols(d)
    t = time_col(d)
    if not col:
        return {"error": f"{dataset} has no places; use get_series for it."}
    out = []
    for p in (places or [])[:8]:
        code = match_place(d, p)
        if not code:
            out.append({"place": p, "error": "not found in this dataset"})
            continue
        best = None
        for r in rows(d["id"]):
            if r[col] != code or num(r.get(variable)) is None:
                continue
            if year is not None and str(r.get(t)) != str(year):
                continue
            if best is None or str(r.get(t)) > str(best.get(t)):
                best = r
        out.append({"place": best.get(lab) if best else p, "code": code,
                    "value": tidy(num(best[variable])) if best else None, "when": best.get(t) if best else None})
    return {"variable": c["title"], "unit": c.get("unit", ""), "values": out, **source_of(d)}


def rank(dataset, variable, order="desc", n=10, year=None):
    d, err = ds_or_error(dataset)
    if err:
        return err
    c = column(d, variable)
    if not c:
        return {"error": f"'{variable}' is not a variable of {dataset}."}
    col, lab = entity_cols(d)
    t = time_col(d)
    if not col:
        return {"error": f"{dataset} has no places to rank."}
    iso = countries() if col == "code" else None
    best = {}
    for r in rows(d["id"]):
        v = num(r.get(variable))
        if v is None or (iso is not None and r[col] not in iso):
            continue
        if year is not None and str(r.get(t)) != str(year):
            continue
        k = r[col]
        if k not in best or str(r.get(t)) > str(best[k][1]):
            best[k] = (v, r.get(t), r.get(lab, k))
    items = sorted(best.values(), key=lambda x: x[0], reverse=(order != "asc"))[: max(1, min(int(n), 25))]
    return {"variable": c["title"], "unit": c.get("unit", ""), "order": "highest first" if order != "asc" else "lowest first",
            "note": "Countries only; regional totals left out." if iso is not None else "",
            "ranking": [{"place": p, "value": tidy(v), "when": w} for v, w, p in items], "places_with_data": len(best), **source_of(d)}


def get_series(dataset, variable, place=None, start=None, end=None):
    d, err = ds_or_error(dataset)
    if err:
        return err
    c = column(d, variable)
    if not c:
        return {"error": f"'{variable}' is not a variable of {dataset}."}
    col, lab = entity_cols(d)
    t = time_col(d)
    code = None
    if col:
        code = match_place(d, place or "World")
        if not code:
            return {"error": f"Place '{place}' not found in {dataset}."}
    pts = []
    for r in rows(d["id"]):
        if col and r[col] != code:
            continue
        v, w = num(r.get(variable)), str(r.get(t))
        if v is None or (start and w < str(start)) or (end and w > str(end) + "~"):
            continue
        pts.append((w, v))
    pts.sort()
    if not pts:
        return {"error": "No values for that choice.", **source_of(d)}
    step = max(1, len(pts) // 24)
    sample = pts[::step]
    if sample[-1] != pts[-1]:
        sample.append(pts[-1])
    lo, hi = min(pts, key=lambda p: p[1]), max(pts, key=lambda p: p[1])
    return {"variable": c["title"], "unit": c.get("unit", ""), "place": place or ("World" if col else None),
            "first": {"when": pts[0][0], "value": tidy(pts[0][1])}, "last": {"when": pts[-1][0], "value": tidy(pts[-1][1])},
            "lowest": {"when": lo[0], "value": tidy(lo[1])}, "highest": {"when": hi[0], "value": tidy(hi[1])},
            "points": [[w, tidy(v)] for w, v in sample], "count": len(pts), **source_of(d)}


def recent_changes(checks=1):
    log = json.loads((DATA / "changelog.json").read_text(encoding="utf-8"))
    out = []
    for run in log.get("runs", [])[: max(1, min(int(checks), 5))]:
        out.append({"at": run.get("at"), "changed": [
            {"dataset": c.get("id"), "title": c.get("title"), "rows": c.get("rows"), "added": c.get("added"), "removed": c.get("removed"),
             "revised_cells": c.get("revised_cells"), "newest": c.get("latest_to"), "examples": (c.get("examples") or [])[:3]}
            for c in run.get("changed", [])[:12]]})
    return {"checks": out, "log": SITE + "data/changelog.json"}


# ---------- live public APIs (no key) ----------

def fetch_json(url, timeout=20):
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode("utf-8"))


def world_bank_live(indicator, country="WLD", years=5):
    """Straight from the World Bank API, for indicators the site does not hold or to check the newest release."""
    country = NICK.get(country.lower(), country) if country else "WLD"
    country = "WLD" if country == "WORLD" else country
    url = (f"https://api.worldbank.org/v2/country/{urllib.parse.quote(country)}/indicator/{urllib.parse.quote(indicator)}"
           f"?format=json&mrv={max(1, min(int(years), 20))}")
    try:
        meta, data = fetch_json(url)
    except Exception as ex:  # noqa: BLE001 - any failure is reported to the model as data
        return {"error": f"World Bank API did not answer: {ex}"}
    if not data:
        return {"error": "No data for that indicator and country.", "hint": "Indicator codes look like SP.POP.TOTL or EN.ATM.CO2E.PC"}
    return {"indicator": data[0]["indicator"]["value"], "country": data[0]["country"]["value"],
            "values": [{"year": x["date"], "value": x["value"]} for x in data], "source": "World Bank API (live)",
            "url": url.replace("format=json&", "")}


def earthquakes_live(min_magnitude=4.5, period="day"):
    period = period if period in ("hour", "day", "week", "month") else "day"
    feed = {2.5: "2.5", 4.5: "4.5"}.get(float(min_magnitude), "4.5" if float(min_magnitude) >= 4.5 else "2.5")
    url = f"https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/{feed}_{period}.geojson"
    try:
        g = fetch_json(url)
    except Exception as ex:  # noqa: BLE001
        return {"error": f"USGS feed did not answer: {ex}"}
    q = [f["properties"] for f in g["features"] if (f["properties"].get("mag") or 0) >= float(min_magnitude)]
    q.sort(key=lambda p: -(p.get("mag") or 0))
    from datetime import datetime, timezone
    return {"count": len(q), "period": f"past {period}", "min_magnitude": float(min_magnitude),
            "strongest": [{"magnitude": p["mag"], "place": p["place"],
                           "time_utc": datetime.fromtimestamp(p["time"] / 1000, timezone.utc).strftime("%Y-%m-%d %H:%M")} for p in q[:8]],
            "source": "US Geological Survey (live feed)", "url": url}


def weather_live(place):
    try:
        geo = fetch_json("https://geocoding-api.open-meteo.com/v1/search?count=1&name=" + urllib.parse.quote(place))
        if not geo.get("results"):
            return {"error": f"Could not find a place called {place}."}
        g = geo["results"][0]
        w = fetch_json(f"https://api.open-meteo.com/v1/forecast?latitude={g['latitude']}&longitude={g['longitude']}"
                       "&current=temperature_2m,relative_humidity_2m,precipitation,wind_speed_10m&daily=temperature_2m_max,temperature_2m_min,precipitation_sum&forecast_days=3&timezone=auto")
    except Exception as ex:  # noqa: BLE001
        return {"error": f"Open-Meteo did not answer: {ex}"}
    return {"place": f"{g['name']}, {g.get('country', '')}", "current": w.get("current"), "units": w.get("current_units"),
            "next_days": w.get("daily"), "source": "Open-Meteo (live, CC BY 4.0)"}


TOOLS = {f.__name__: f for f in (search_datasets, find_variables, describe_dataset, get_values, rank, get_series,
                                  recent_changes, world_bank_live, earthquakes_live, weather_live)}


def fn(name, desc, props, required=()):
    return {"type": "function", "function": {"name": name, "description": desc,
            "parameters": {"type": "object", "properties": props, "required": list(required)}}}


S, I = {"type": "string"}, {"type": "integer"}
SPEC = [
    fn("search_datasets", "Find datasets on the site by topic words.", {"query": S}, ["query"]),
    fn("find_variables", "Find variables (columns) by plain words. Returns dataset id and variable name to use in the other tools.", {"query": S}, ["query"]),
    fn("describe_dataset", "Source, licence, years covered and the variables of one dataset.", {"dataset": S}, ["dataset"]),
    fn("get_values", "Value of one variable for up to 8 places: the newest value, or the value in a given year.",
       {"dataset": S, "variable": S, "places": {"type": "array", "items": S}, "year": I}, ["dataset", "variable", "places"]),
    fn("rank", "Countries ranked by one variable (regional totals left out). order: desc or asc.",
       {"dataset": S, "variable": S, "order": {"type": "string", "enum": ["desc", "asc"]}, "n": I, "year": I}, ["dataset", "variable"]),
    fn("get_series", "One variable over time for one place (or a world series: leave place empty). start and end are years or dates.",
       {"dataset": S, "variable": S, "place": S, "start": S, "end": S}, ["dataset", "variable"]),
    fn("recent_changes", "What the latest daily data checks changed: rows added, values revised, newest entries.", {"checks": I}),
    fn("world_bank_live", "Live call to the World Bank API for an indicator code (e.g. SP.POP.TOTL) and an ISO3 country code.",
       {"indicator": S, "country": S, "years": I}, ["indicator"]),
    fn("earthquakes_live", "Live USGS earthquakes. min_magnitude 2.5 or 4.5; period hour, day, week or month.",
       {"min_magnitude": {"type": "number"}, "period": S}),
    fn("weather_live", "Live current weather and a 3-day forecast for a named place (Open-Meteo).", {"place": S}, ["place"]),
]


def call(name, args, limit=2500):
    """Run one tool and return its result as JSON text, cut to a size the free model tier can take."""
    if name not in TOOLS:
        return json.dumps({"error": f"No tool named {name}."})
    try:
        out = TOOLS[name](**(args or {}))
    except TypeError as ex:
        out = {"error": f"Bad arguments: {ex}"}
    except Exception as ex:  # noqa: BLE001 - the model gets the error and can try again
        out = {"error": f"{type(ex).__name__}: {ex}"}
    text = json.dumps(out, ensure_ascii=False, default=str)
    return text if len(text) <= limit else text[:limit] + '…"(cut)"'
