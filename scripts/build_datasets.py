"""Build the downloadable datasets and their manifest (docs/data/datasets.json).

Each dataset is one tidy CSV in docs/data/sets/ plus a manifest entry describing its keys,
time column and every variable. To add a dataset: write a function that returns a spec
(see `spec()`), and add it to BUILDERS. A builder that fails keeps the previous file.
"""
import csv, io, json, re, sys, time, urllib.request
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SETS = ROOT / "docs" / "data" / "sets"
MANIFEST = ROOT / "docs" / "data" / "datasets.json"
RAW = "https://raw.githubusercontent.com/"
UA = {"User-Agent": "open-data-company-pipeline (github.com/sahiljangra12/open-data-company)"}


C = ["USA", "CHN", "IND", "WLD"]
DEFAULTS = {  # what the explorer selects when a dataset is first opened
    "co2-and-greenhouse-gases": dict(default_vars=["co2", "co2_per_capita"], default_entities=C),
    "energy": dict(default_vars=["primary_energy_consumption", "renewables_share_elec"], default_entities=C),
    "world-bank-development": dict(default_vars=["population", "gdp_current_usd"], default_entities=C),
    "pjm-summer-peak-forecasts": dict(default_entities=["DOM", "AEP", "PJM RTO"]),
}


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


BUILDERS = [
    lambda: owid("co2-and-greenhouse-gases", "co2-data", "co2", "CO2 and greenhouse gas emissions",
                 "Annual emissions by country: CO2 by fuel and sector, per-capita and cumulative figures, methane, nitrous oxide, and each country's share of the world total.",
                 "Climate and emissions"),
    lambda: owid("energy", "energy-data", "energy", "Energy production, consumption and electricity mix",
                 "Annual energy data by country: primary energy, electricity generation by source, shares of coal, gas, nuclear, solar and wind, and per-capita use.",
                 "Energy"),
    worldbank, oil, gas, pjm,
]


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
    MANIFEST.write_text(json.dumps({"datasets": out}, indent=1, ensure_ascii=False))
    sys.exit(1 if failed and not out else 0)


if __name__ == "__main__":
    main()
