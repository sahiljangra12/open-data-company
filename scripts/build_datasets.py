"""Build the downloadable datasets and their manifest (docs/data/datasets.json).

Each dataset is one tidy CSV in docs/data/sets/ plus a manifest entry describing its keys,
time column and every variable. To add a dataset: write a function that returns a spec
(see `spec()`), and add it to BUILDERS. A builder that fails keeps the previous file.
"""
import csv, io, json, re, sys, time, urllib.request
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SETS = ROOT / "docs" / "data" / "sets"
MANIFEST = ROOT / "docs" / "data" / "datasets.json"
PULSE = ROOT / "docs" / "data" / "pulse.json"
RAW = "https://raw.githubusercontent.com/"
UA = {"User-Agent": "open-data-company-pipeline (github.com/sahiljangra12/open-data-company)"}


C = ["USA", "CHN", "IND", "WLD"]
DEFAULTS = {  # what the explorer selects when a dataset is first opened
    "co2-and-greenhouse-gases": dict(default_vars=["co2", "co2_per_capita"], default_entities=C),
    "energy": dict(default_vars=["primary_energy_consumption", "renewables_share_elec"], default_entities=C),
    "world-bank-development": dict(default_vars=["population", "gdp_current_usd"], default_entities=C),
    "pjm-summer-peak-forecasts": dict(default_entities=["DOM", "AEP", "PJM RTO"]),
    "earthquakes-past-30-days": dict(default_vars=["magnitude", "place", "depth_km", "latitude", "longitude"],
                                     coverage="Rolling 30 days", chart="points"),
}


ORDER = ["co2-and-greenhouse-gases", "energy", "world-bank-development", "earthquakes-past-30-days", "crude-oil-prices",
         "natural-gas-prices", "pjm-summer-peak-forecasts"]            # order on the home page


def get(url, tries=3):
    for i in range(tries):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=120) as r:
                return r.read()
        except Exception:
            if i == tries - 1:
                raise
            time.sleep(3 * (i + 1))


def read_csv(url):
    return list(csv.DictReader(io.StringIO(get(url).decode("utf-8-sig"))))


def is_num(v):
    try:
        float(v)
        return True
    except ValueError:
        return False


def spec(id, title, description, region, domain, source, source_url, licence, keys, time_col, time_type,
         entity, header, rows, meta):
    """Write the CSV and return the manifest entry. `meta` maps column -> dict(title, unit, description)."""
    assert rows, id
    with open(SETS / f"{id}.csv", "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(header)
        w.writerows(rows)
    idx = {c: i for i, c in enumerate(header)}
    cols = []
    for c in header:
        if c in keys or (entity and c == entity["label_col"]):
            continue
        vals = [r[idx[c]] for r in rows if r[idx[c]] not in ("", None)]
        if not vals:
            continue
        m = meta.get(c, {})
        cols.append(dict(name=c, title=m.get("title") or c.replace("_", " ").capitalize(), unit=m.get("unit", ""),
                         description=(m.get("description") or "")[:400],
                         type="num" if all(is_num(str(v)) for v in vals[:2000]) else "str", filled=len(vals)))
    t = [str(r[idx[time_col]]) for r in rows]
    out = dict(id=id, title=title, description=description, region=region, domain=domain, source=source,
               source_url=source_url, licence=licence, file=f"data/sets/{id}.csv", keys=keys,
               time=dict(col=time_col, type=time_type, min=min(t), max=max(t)), entity=entity, rows=len(rows),
               columns=cols, bytes=(SETS / f"{id}.csv").stat().st_size, built=date.today().isoformat())
    out["coverage"] = t0[:4] if (t0 := min(t))[:4] == max(t)[:4] else f"{t0[:4]} to {max(t)[:4]}"
    out.update(DEFAULTS.get(id, {}))
    if entity:
        out["entities"] = len({r[idx[entity["col"]]] for r in rows})
    return out


def owid(id, repo, stem, title, description, domain):
    data = read_csv(f"{RAW}owid/{repo}/master/owid-{stem}-data.csv")
    book = {r["column"]: r for r in read_csv(f"{RAW}owid/{repo}/master/owid-{stem}-codebook.csv")}
    var = [c for c in data[0] if c not in ("country", "year", "iso_code")]
    rows = []
    for r in data:
        code = r["iso_code"] or ("WLD" if r["country"] == "World" else "OWID_" + re.sub(r"[^A-Z0-9]+", "_", r["country"].upper()).strip("_"))
        rows.append([code, r["country"], r["year"]] + [r[c] for c in var])
    meta = {c: dict(title=b.get("title"), unit=b.get("unit"), description=b.get("description")) for c, b in book.items()}
    return spec(id, title, description, "World", domain, "Our World in Data", f"https://github.com/owid/{repo}",
                "CC BY 4.0 (Our World in Data; underlying sources listed per variable in the OWID codebook)",
                ["code", "year"], "year", "year", dict(col="code", label_col="country", label="Country or region"),
                ["code", "country", "year"] + var, rows, meta)


WB = {  # indicator id: (column, title, unit)
    "SP.POP.TOTL": ("population", "Population, total", "people"),
    "SP.POP.GROW": ("population_growth", "Population growth", "% per year"),
    "NY.GDP.MKTP.CD": ("gdp_current_usd", "GDP", "current US$"),
    "NY.GDP.MKTP.KD.ZG": ("gdp_growth", "GDP growth", "% per year"),
    "NY.GDP.PCAP.CD": ("gdp_per_capita", "GDP per capita", "current US$"),
    "NY.GDP.PCAP.PP.CD": ("gdp_per_capita_ppp", "GDP per capita, PPP", "current international $"),
    "FP.CPI.TOTL.ZG": ("inflation", "Inflation, consumer prices", "% per year"),
    "SL.UEM.TOTL.ZS": ("unemployment", "Unemployment (modeled ILO estimate)", "% of labor force"),
    "SL.TLF.CACT.FE.ZS": ("female_labor_participation", "Labor force participation, female", "% of women 15+"),
    "NE.EXP.GNFS.ZS": ("exports_share_gdp", "Exports of goods and services", "% of GDP"),
    "NE.IMP.GNFS.ZS": ("imports_share_gdp", "Imports of goods and services", "% of GDP"),
    "BX.KLT.DINV.WD.GD.ZS": ("fdi_inflows_share_gdp", "Foreign direct investment, net inflows", "% of GDP"),
    "NV.AGR.TOTL.ZS": ("agriculture_share_gdp", "Agriculture, value added", "% of GDP"),
    "NV.IND.TOTL.ZS": ("industry_share_gdp", "Industry, value added", "% of GDP"),
    "NV.SRV.TOTL.ZS": ("services_share_gdp", "Services, value added", "% of GDP"),
    "SP.DYN.LE00.IN": ("life_expectancy", "Life expectancy at birth", "years"),
    "SP.DYN.IMRT.IN": ("infant_mortality", "Infant mortality rate", "per 1,000 live births"),
    "SP.DYN.TFRT.IN": ("fertility_rate", "Fertility rate", "births per woman"),
    "SP.URB.TOTL.IN.ZS": ("urban_population_share", "Urban population", "% of total"),
    "SH.XPD.CHEX.GD.ZS": ("health_spending_share_gdp", "Current health expenditure", "% of GDP"),
    "SE.XPD.TOTL.GD.ZS": ("education_spending_share_gdp", "Government expenditure on education", "% of GDP"),
    "SE.ADT.LITR.ZS": ("adult_literacy", "Adult literacy rate", "% of people 15+"),
    "SI.POV.GINI": ("gini_index", "Gini index", "0-100"),
    "SI.POV.DDAY": ("extreme_poverty_share", "Poverty headcount at the international poverty line", "% of population"),
    "EG.ELC.ACCS.ZS": ("electricity_access", "Access to electricity", "% of population"),
    "EG.FEC.RNEW.ZS": ("renewable_energy_share", "Renewable energy consumption", "% of final energy"),
    "IT.NET.USER.ZS": ("internet_users", "Individuals using the Internet", "% of population"),
    "SH.H2O.BASW.ZS": ("basic_water_access", "People using at least basic drinking water services", "% of population"),
    "AG.LND.FRST.ZS": ("forest_area_share", "Forest area", "% of land area"),
}


def worldbank():
    cell, names, got, missed = {}, {}, [], []
    for ind, (col, _, _) in WB.items():
        try:
            page, pages, seen = 1, 1, 0
            while page <= pages:
                j = json.loads(get(f"https://api.worldbank.org/v2/country/all/indicator/{ind}?format=json&per_page=20000&date=1960:2035&page={page}"))
                pages = int(j[0]["pages"])
                for it in j[1] or []:
                    code = it.get("countryiso3code")
                    if code and it.get("value") is not None:
                        cell.setdefault((code, int(it["date"])), {})[col] = it["value"]
                        names[code] = it["country"]["value"]
                        seen += 1
                page += 1
            if not seen:
                raise ValueError("no values")
            got.append(col)
        except Exception as e:
            missed.append(f"{ind}: {str(e)[:80]}")
            if len(missed) >= 3 and not got:
                break                                     # API unreachable, stop trying
    note = ""
    if missed:
        print("  World Bank indicators not loaded:", "; ".join(missed[:5]))
    if not got:   # API unreachable: fall back to the World Bank series mirrored on GitHub
        prev = SETS / "world-bank-development.csv"
        if prev.exists() and len(prev.open(encoding="utf-8").readline().split(",")) > 5:
            raise RuntimeError("World Bank API unreachable; keeping the last full build")
        for col, repo, f in (("population", "population", "population.csv"), ("gdp_current_usd", "gdp", "gdp.csv")):
            for r in read_csv(f"{RAW}datasets/{repo}/main/data/{f}"):
                cell.setdefault((r["Country Code"], int(r["Year"])), {})[col] = r["Value"]
                names[r["Country Code"]] = r["Country Name"]
            got.append(col)
        note = " Only population and GDP are loaded in this build; the full indicator set loads when the World Bank API is reachable."
    rows = [[c, names[c], y] + [v.get(col, "") for col in got] for (c, y), v in sorted(cell.items())]
    meta = {col: dict(title=t, unit=u, description=f"World Bank indicator {ind}.") for ind, (col, t, u) in WB.items()}
    return spec("world-bank-development", "World development indicators",
                "Core economic, social and infrastructure indicators for every country and World Bank region, by year." + note,
                "World", "Economy and development", "World Bank, World Development Indicators", "https://data.worldbank.org",
                "CC BY 4.0", ["code", "year"], "year", "year", dict(col="code", label_col="country", label="Country or region"),
                ["code", "country", "year"] + got, rows, meta)


def by_date(series):
    cell = {}
    for col, url in series:
        for r in read_csv(url):
            if r.get("Price") not in ("", None):
                cell.setdefault(r["Date"], {})[col] = r["Price"]
    cols = [c for c, _ in series]
    return cols, [[d] + [v.get(c, "") for c in cols] for d, v in sorted(cell.items())]


def oil():
    cols, rows = by_date([("wti_usd_per_barrel", f"{RAW}datasets/oil-prices/main/data/wti-daily.csv"),
                          ("brent_usd_per_barrel", f"{RAW}datasets/oil-prices/main/data/brent-daily.csv")])
    return spec("crude-oil-prices", "Crude oil spot prices, daily", "Daily WTI (Cushing, Oklahoma) and Brent (Europe) spot prices.",
                "US", "Energy", "US Energy Information Administration, via DataHub", "https://github.com/datasets/oil-prices",
                "Public domain (US federal data; PDDL packaging)", ["date"], "date", "date", None, ["date"] + cols, rows,
                dict(wti_usd_per_barrel=dict(title="WTI spot price", unit="US$ per barrel"),
                     brent_usd_per_barrel=dict(title="Brent spot price", unit="US$ per barrel")))


def gas():
    cols, rows = by_date([("henry_hub_usd_per_mmbtu", f"{RAW}datasets/natural-gas/main/data/daily.csv")])
    return spec("natural-gas-prices", "Natural gas spot price, daily", "Daily Henry Hub natural gas spot price, the US benchmark.",
                "US", "Energy", "US Energy Information Administration, via DataHub", "https://github.com/datasets/natural-gas",
                "Public domain (US federal data; PDDL packaging)", ["date"], "date", "date", None, ["date"] + cols, rows,
                dict(henry_hub_usd_per_mmbtu=dict(title="Henry Hub spot price", unit="US$ per million Btu")))


def pjm():
    import openpyxl
    cell, skip = {}, ("DIVERSITY",)

    def sheet(y, name):
        wb = openpyxl.load_workbook(ROOT / "data" / "raw" / "pjm" / f"{y}-load-report-tables.xlsx", read_only=True, data_only=True)
        rows = [list(r) for r in wb[name].iter_rows(values_only=True)]
        h = next(i for i, r in enumerate(rows) if any(isinstance(c, str) and re.match(r"(Metered|Summer) 20\d\d", c.strip()) for c in r))
        return rows[h], [r for r in rows[h + 1:] if isinstance(r[0], str) and r[0].strip() and isinstance(r[1], (int, float)) and not r[0].startswith(skip)]

    for v in (2025, 2026):
        h, rows = sheet(v, "Table B1")
        for r in rows:
            z = r[0].strip()
            cell.setdefault((z, v - 1), {})["metered_peak_mw"] = round(r[1])
            for i, c in enumerate(h):
                if isinstance(c, int) and isinstance(r[i], (int, float)):
                    cell.setdefault((z, c), {})[f"forecast_jan{v}_mw"] = round(r[i])
        _, rows = sheet(v, "Table F3")
        for r in rows:
            cell.setdefault((r[0].strip(), v - 1), {})["normalized_peak_mw"] = round(r[1])
    cols = ["forecast_jan2025_mw", "forecast_jan2026_mw", "metered_peak_mw", "normalized_peak_mw"]
    rows = [[z, y] + [v.get(c, "") for c in cols] for (z, y), v in sorted(cell.items())]
    return spec("pjm-summer-peak-forecasts", "PJM summer peak load: forecasts and actuals by zone",
                "Summer peak demand for each PJM transmission zone: the forecasts published in January 2025 and January 2026, "
                "with metered and weather-normalized actual peaks for 2024 and 2025.",
                "US", "Energy", "PJM Load Forecast Reports, January 2025 and 2026", "https://www.pjm.com/planning/resource-adequacy-planning/load-forecast-dev-process",
                "Public PJM report tables; check PJM's terms before commercial redistribution", ["zone", "year"], "year", "year",
                dict(col="zone", label_col="zone", label="Zone"), ["zone", "year"] + cols, rows,
                dict(forecast_jan2025_mw=dict(title="Summer peak forecast, January 2025 report", unit="MW"),
                     forecast_jan2026_mw=dict(title="Summer peak forecast, January 2026 report", unit="MW"),
                     metered_peak_mw=dict(title="Metered summer peak", unit="MW"),
                     normalized_peak_mw=dict(title="Weather-normalized summer peak", unit="MW")))


def quakes():
    j = json.loads(get("https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/2.5_month.geojson"))
    rows = []
    for f in j["features"]:
        p, g = f["properties"], f["geometry"]["coordinates"]
        if p.get("time") is None or p.get("mag") is None:
            continue
        t = datetime.fromtimestamp(p["time"] / 1000, timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
        blank = lambda v: "" if v is None else v
        rows.append([f["id"], t, p["mag"], blank(p.get("place")), round(g[1], 4), round(g[0], 4), blank(g[2]),
                     blank(p.get("magType")), blank(p.get("type")), blank(p.get("sig")), blank(p.get("tsunami")),
                     blank(p.get("felt")), blank(p.get("url"))])
    rows.sort(key=lambda r: r[1])
    return spec("earthquakes-past-30-days", "Earthquakes, past 30 days",
                "Every earthquake of magnitude 2.5 or greater recorded worldwide in the past 30 days, with location, depth and magnitude.",
                "World", "Natural hazards", "US Geological Survey, Earthquake Hazards Program",
                "https://earthquake.usgs.gov/earthquakes/feed/", "Public domain (US federal data)", ["id", "time"], "time", "date", None,
                ["id", "time", "magnitude", "place", "latitude", "longitude", "depth_km", "magnitude_type", "event_type",
                 "significance", "tsunami_flag", "felt_reports", "url"], rows,
                dict(magnitude=dict(title="Magnitude"), place=dict(title="Nearest place"),
                     latitude=dict(title="Latitude", unit="degrees"), longitude=dict(title="Longitude", unit="degrees"),
                     depth_km=dict(title="Depth", unit="km"), magnitude_type=dict(title="Magnitude type"),
                     event_type=dict(title="Event type"), significance=dict(title="Significance score", unit="0-1000",
                     description="USGS score combining magnitude, felt reports and estimated impact."),
                     tsunami_flag=dict(title="Tsunami flag", description="1 if the event was in an oceanic region and may warrant tsunami information; not a warning."),
                     felt_reports=dict(title="Felt reports", unit="reports"), url=dict(title="USGS event page")))


BUILDERS = [
    lambda: owid("co2-and-greenhouse-gases", "co2-data", "co2", "CO2 and greenhouse gas emissions",
                 "Annual emissions by country: CO2 by fuel and sector, per-capita and cumulative figures, methane, nitrous oxide, and each country's share of the world total.",
                 "Climate and emissions"),
    lambda: owid("energy", "energy-data", "energy", "Energy production, consumption and electricity mix",
                 "Annual energy data by country: primary energy, electricity generation by source, shares of coal, gas, nuclear, solar and wind, and per-capita use.",
                 "Energy"),
    worldbank, oil, gas, pjm, quakes,
]


# ---------- home page data: latest values, sparklines and featured series ----------

def pull(ds, wants):
    """wants: list of (code or None, column). Returns {(code, col): [(time, float), ...]} from the built CSV."""
    path, out = SETS / f"{ds}.csv", {w: [] for w in wants}
    if not path.exists():
        return out
    with open(path, encoding="utf-8") as f:
        r = csv.reader(f)
        h = {c: i for i, c in enumerate(next(r))}
        tcol = h.get("year", h.get("date", h.get("time")))
        ecol = h.get("code", h.get("zone"))
        by = {}
        for code, col in wants:
            if col in h:
                by.setdefault(code, []).append(col)
        for row in r:
            for col in by.get(row[ecol] if ecol is not None else None, ()):
                v = row[h[col]]
                if v != "":
                    out[(row[ecol] if ecol is not None else None, col)].append((row[tcol], float(v)))
    return out


def thin(pts, n):
    if len(pts) <= n:
        return pts
    step = len(pts) / n
    return [pts[int(i * step)] for i in range(n - 1)] + [pts[-1]]


def nice(v, kind):
    if kind == "usd":
        return f"${v:,.2f}"
    if kind == "pct":
        return f"{v:.1f}%"
    if kind == "one":
        return f"{v:.1f}"
    for lim, word in ((1e12, "trillion"), (1e9, "billion"), (1e6, "million")):
        if abs(v) >= lim:
            return f"{v / lim:.2f} {word}"
    return f"{v:,.0f}"


def build_pulse():
    co2 = pull("co2-and-greenhouse-gases", [("WLD", "co2"), ("WLD", "co2_per_capita")])
    en = pull("energy", [("WLD", c) for c in ("solar_share_elec", "wind_share_elec", "coal_share_elec", "electricity_generation",
                                              "primary_energy_consumption", "renewables_share_elec")])
    wb = pull("world-bank-development", [(c, "population") for c in ("WLD", "IND", "CHN", "USA")] +
              [("WLD", "gdp_current_usd"), ("WLD", "gdp_per_capita"), ("WLD", "life_expectancy")])
    oil = pull("crude-oil-prices", [(None, "wti_usd_per_barrel"), (None, "brent_usd_per_barrel")])
    gas = pull("natural-gas-prices", [(None, "henry_hub_usd_per_mmbtu")])
    pj = pull("pjm-summer-peak-forecasts", [(z, "forecast_jan2026_mw") for z in ("DOM", "AEP", "PJM RTO")])
    X = "explore.html#d="

    def tick(label, pts, kind, unit, href, scale=1.0, points=False):
        if len(pts) < 2:
            return None
        (t1, v1), (t0, v0) = pts[-1], pts[-2]
        daily = len(t1) > 4
        asof = datetime.strptime(t1, "%Y-%m-%d").strftime("%b %-d, %Y") if daily else t1
        change = (v1 - v0) if points else (100 * (v1 - v0) / v0 if v0 else 0)
        return dict(label=label, display=nice(v1 * scale, kind), unit=unit, asof=asof,
                    change=round(change, 2), change_unit="points" if points else "%",
                    versus="previous trading day" if daily else t0, href=href,
                    spark=[round(v, 4) for _, v in thin(pts[-60:] if daily else pts[-30:], 30)])

    tickers = [t for t in (
        tick("WTI crude oil", oil[(None, "wti_usd_per_barrel")], "usd", "per barrel", X + "crude-oil-prices"),
        tick("Brent crude oil", oil[(None, "brent_usd_per_barrel")], "usd", "per barrel", X + "crude-oil-prices"),
        tick("Henry Hub natural gas", gas[(None, "henry_hub_usd_per_mmbtu")], "usd", "per million Btu", X + "natural-gas-prices"),
        tick("World CO2 emissions", co2[("WLD", "co2")], "num", "tonnes a year", X + "co2-and-greenhouse-gases&v=co2&e=WLD", 1e6),
        tick("World population", wb[("WLD", "population")], "num", "people", X + "world-bank-development&v=population&e=WLD"),
        tick("World GDP", wb[("WLD", "gdp_current_usd")], "num", "US dollars", X + "world-bank-development&v=gdp_current_usd&e=WLD"),
        tick("Solar share of world electricity", en[("WLD", "solar_share_elec")], "pct", "", X + "energy&v=solar_share_elec&e=WLD", points=True),
        tick("Wind share of world electricity", en[("WLD", "wind_share_elec")], "pct", "", X + "energy&v=wind_share_elec&e=WLD", points=True),
        tick("Coal share of world electricity", en[("WLD", "coal_share_elec")], "pct", "", X + "energy&v=coal_share_elec&e=WLD", points=True),
        tick("World life expectancy", wb[("WLD", "life_expectancy")], "one", "years", X + "world-bank-development&v=life_expectancy&e=WLD"),
    ) if t]

    def since(pts, start):
        return [[t, round(v, 4)] for t, v in pts if t >= start]

    def story(id, tab, title, note, unit, x, href, series, decimals=1):
        series = [dict(name=n, pts=p) for n, p in series if len(p) > 1]
        return dict(id=id, tab=tab, title=title, note=note, unit=unit, x=x, href=href, decimals=decimals, series=series) if series else None

    five = (date.today() - timedelta(days=5 * 365)).isoformat()
    week = lambda pts: thin(since(pts, five), 260)
    stories = [s for s in (
        story("co2", "CO2", "Global CO2 emissions since 1900", "Billion tonnes a year, fossil fuels and industry. Our World in Data.",
              "billion tonnes", "year", X + "co2-and-greenhouse-gases&v=co2&e=WLD&f=1900",
              [("World", [[t, round(v / 1000, 3)] for t, v in co2[("WLD", "co2")] if t >= "1900"])]),
        story("renewables", "Solar and wind", "Solar and wind in the world's electricity", "Share of electricity generation, percent. Our World in Data.",
              "%", "year", X + "energy&v=solar_share_elec,wind_share_elec&e=WLD&f=2000",
              [("Wind", since(en[("WLD", "wind_share_elec")], "2000")), ("Solar", since(en[("WLD", "solar_share_elec")], "2000"))]),
        story("oil", "Oil", "Crude oil prices, past five years", "US dollars per barrel, spot. US Energy Information Administration.",
              "$", "date", X + "crude-oil-prices&f=" + five,
              [("WTI", week(oil[(None, "wti_usd_per_barrel")])), ("Brent", week(oil[(None, "brent_usd_per_barrel")]))], 2),
        story("gas", "Natural gas", "US natural gas price, past five years", "US dollars per million Btu, Henry Hub spot. US Energy Information Administration.",
              "$", "date", X + "natural-gas-prices&f=" + five, [("Henry Hub", week(gas[(None, "henry_hub_usd_per_mmbtu")]))], 2),
        story("population", "Population", "India, China and the United States", "Population in billions. World Bank.",
              "billion", "year", X + "world-bank-development&v=population&e=IND,CHN,USA",
              [(n, [[t, round(v / 1e9, 4)] for t, v in wb[(c, "population")]]) for n, c in (("India", "IND"), ("China", "CHN"), ("United States", "USA"))], 2),
        story("grid", "Power grid", "Forecast peak demand in two data-center zones", "Summer peak in gigawatts, PJM's January 2026 forecast.",
              "GW", "year", X + "pjm-summer-peak-forecasts&v=forecast_jan2026_mw&e=DOM,AEP",
              [(n, [[t, round(v / 1000, 2)] for t, v in pj[(z, "forecast_jan2026_mw")]]) for n, z in (("Dominion", "DOM"), ("AEP", "AEP"))]),
    ) if s]

    def spark(label, pts, n=60):
        return dict(label=label, pts=[round(v, 4) for _, v in thin(pts, n)]) if len(pts) > 1 else None

    sparks = {k: v for k, v in {
        "co2-and-greenhouse-gases": spark("World CO2 emissions since 1950", [p for p in co2[("WLD", "co2")] if p[0] >= "1950"]),
        "energy": spark("World energy consumption", en[("WLD", "primary_energy_consumption")]),
        "world-bank-development": spark("World GDP per person", wb[("WLD", "gdp_per_capita")] or wb[("WLD", "gdp_current_usd")]),
        "crude-oil-prices": spark("WTI, past year", oil[(None, "wti_usd_per_barrel")][-250:]),
        "natural-gas-prices": spark("Henry Hub, past year", gas[(None, "henry_hub_usd_per_mmbtu")][-250:]),
        "pjm-summer-peak-forecasts": spark("PJM forecast peak to 2046", pj[("PJM RTO", "forecast_jan2026_mw")]),
    }.items() if v}

    counters = {}
    if co2[("WLD", "co2")]:
        y, v = co2[("WLD", "co2")][-1]
        counters["co2"] = dict(year=int(y), per_year=v * 1e6)                      # tonnes
    if en[("WLD", "electricity_generation")]:
        y, v = en[("WLD", "electricity_generation")][-1]
        counters["electricity"] = dict(year=int(y), per_year=v * 1e6)             # MWh
    if len(wb[("WLD", "population")]) > 1:
        (y0, v0), (y1, v1) = wb[("WLD", "population")][-2:]
        counters["population"] = dict(year=int(y1), value=v1, growth=v1 / v0 - 1)  # mid-year estimate

    out = dict(built=datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"), tickers=tickers, stories=stories, sparks=sparks, counters=counters)

    qpath = SETS / "earthquakes-past-30-days.csv"
    if qpath.exists():
        with open(qpath, encoding="utf-8") as f:
            q = list(csv.DictReader(f))
        if q:
            last = q[-1]["time"]
            cut = (datetime.strptime(last, "%Y-%m-%dT%H:%M:%SZ") - timedelta(hours=24)).strftime("%Y-%m-%dT%H:%M:%SZ")
            out["quakes"] = dict(asof=last, minimum_magnitude=2.5, events=[
                [float(r["longitude"]), float(r["latitude"]), float(r["magnitude"]), r["time"], r["place"]] for r in q if r["time"] >= cut])
            days = {}
            for r in q:
                days[r["time"][:10]] = days.get(r["time"][:10], 0) + 1
            out["sparks"]["earthquakes-past-30-days"] = dict(label="Earthquakes a day, magnitude 2.5 and up", pts=[n for _, n in sorted(days.items())][1:-1] or [1, 1])

    old = json.loads(PULSE.read_text()) if PULSE.exists() else {}
    if {k: v for k, v in old.items() if k != "built"} == {k: v for k, v in out.items() if k != "built"}:
        return                                                                   # nothing changed; keep the old stamp
    PULSE.write_text(json.dumps(out, separators=(",", ":"), ensure_ascii=False))
    print(f"pulse: {len(tickers)} tickers, {len(stories)} stories, {len(sparks)} sparklines, quakes: {'yes' if 'quakes' in out else 'no'}")


def main():
    SETS.mkdir(parents=True, exist_ok=True)
    old = {d["id"]: d for d in json.loads(MANIFEST.read_text())["datasets"]} if MANIFEST.exists() else {}
    out, failed = [], []
    for b in BUILDERS:
        try:
            d = b()
            if old.get(d["id"]) and {k: v for k, v in old[d["id"]].items() if k != "built"} == {k: v for k, v in d.items() if k != "built"}:
                d["built"] = old[d["id"]]["built"]          # unchanged data keeps its date
            out.append(d)
            print(f"ok   {d['id']}: {d['rows']} rows, {len(d['columns'])} variables")
        except Exception as e:
            failed.append(str(e)[:200])
            print("FAIL", str(e)[:200])
    keep = {d["id"] for d in out}
    out += [d for i, d in old.items() if i not in keep]     # a failed build keeps the last good version
    out.sort(key=lambda d: ORDER.index(d["id"]) if d["id"] in ORDER else len(ORDER))
    MANIFEST.write_text(json.dumps({"datasets": out}, indent=1, ensure_ascii=False))
    build_pulse()
    sys.exit(1 if failed and not out else 0)


if __name__ == "__main__":
    main()
