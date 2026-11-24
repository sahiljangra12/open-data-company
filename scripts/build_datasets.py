"""Build the downloadable datasets and their manifest (docs/data/datasets.json).

Each dataset is one tidy CSV in docs/data/sets/ plus a manifest entry describing its keys,
time column and every variable. To add a dataset: write a function that returns a spec
(see `spec()`), and add it to BUILDERS. A builder that fails keeps the previous file.
"""
import csv, hashlib, io, json, re, shutil, sys, tempfile, time, urllib.request
from collections import Counter
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SETS = ROOT / "docs" / "data" / "sets"
MANIFEST = ROOT / "docs" / "data" / "datasets.json"
PULSE = ROOT / "docs" / "data" / "pulse.json"
COUNTRIES = ROOT / "docs" / "data" / "countries.json"
LATEST = ROOT / "docs" / "data" / "latest"                 # newest value of every variable for every place: instant answers
CHANGELOG = ROOT / "docs" / "data" / "changelog.json"      # what each refresh changed
SAMPLE = ROOT / "docs" / "data" / "sample-countries.csv"   # demo file for the "Your data" page
CRON = "23 5 * * *"                                        # keep in step with .github/workflows/refresh.yml
RAW = "https://raw.githubusercontent.com/"
UA = {"User-Agent": "open-data-company-pipeline (github.com/sahiljangra12/open-data-company)"}


C = ["WLD", "CHN", "IND", "USA", "BRA", "NGA"]
DEFAULTS = {  # what the explorer selects first, and which places its chart shows when none are picked
    "co2-and-greenhouse-gases": dict(default_vars=["co2", "co2_per_capita"], chart_entities=C),
    "energy": dict(default_vars=["primary_energy_consumption", "renewables_share_elec"], chart_entities=C),
    "world-bank-development": dict(default_vars=["population", "gdp_per_capita", "life_expectancy"], chart_entities=C),
    "pjm-summer-peak-forecasts": dict(chart_entities=["PJM RTO", "DOM", "AEP", "COMED"]),
    "earthquakes-past-30-days": dict(default_vars=["magnitude", "place", "depth_km", "latitude", "longitude"],
                                     coverage="Rolling 30 days", chart="points"),
}


CADENCE = {  # how often each source itself changes; the site checks all of them every day
    "co2-and-greenhouse-gases": "Revised by Our World in Data a few times a year",
    "energy": "Revised by Our World in Data a few times a year",
    "world-bank-development": "Revised by the World Bank a few times a year",
    "global-temperature": "A new month about once a month",
    "atmospheric-co2": "A new month about once a month",
    "earthquakes-past-30-days": "Every day here; the globe on the home page is live",
    "crude-oil-prices": "New trading days about once a week",
    "natural-gas-prices": "New trading days about once a week",
    "pjm-summer-peak-forecasts": "Once a year, in January",
    "imf-world-economic-outlook": "Twice a year, in April and October", "imf-projections": "Twice a year, in April and October",
    "un-population": "Every two years", "un-population-projections": "Every two years",
    "human-development-index": "Once a year", "who-health-observatory": "Revised by WHO through the year", "penn-world-table": "Every few years",
    "us-economy-monthly": "New months through the month, as each agency reports", "us-economy-quarterly": "A new quarter every three months, then revised",
    "us-rates-and-currencies-daily": "Every business day", "us-national-debt": "Every business day", "us-climate-monthly": "A new month about once a month",
    "wikipedia-pageviews": "A new month at the start of each month", "research-papers-by-year": "Counts grow every day as papers are indexed",
    "research-papers-by-country": "Counts grow every day as papers are indexed", "biodiversity-records-by-year": "Records are added every day",
    "biodiversity-records-by-country": "Records are added every day", "github-activity-by-country": "A new quarter every three months",
    "us-federal-register": "Every business day", "us-fda-reports": "Every week or so", "clinical-trials-started": "Every day",
    "us-disaster-declarations": "Whenever a disaster is declared", "us-disaster-declarations-list": "Whenever a disaster is declared",
    "us-bank-failures": "Whenever a bank fails", "us-bank-failures-list": "Whenever a bank fails", "us-flu-hospital-admissions": "A new week every week",
    "us-nih-research-projects": "Every week",
    "europe-eurostat": "Revised by Eurostat through the year", "world-leading-indicators-and-exchange-rates": "A new month about once a month", "uk-economy-monthly": "A new month every month",
    "climate-trace-emissions": "A few times a year", "stack-overflow-activity": "Every day", "us-river-flow-monthly": "A new month every month", "us-drug-overdose-deaths": "A new month every month, about four months behind",
    "maryland-crime": "Rarely; the state's file ends in 2020", "us-mortgage-lending": "Once a year", "us-grid-demand-daily": "Every day", "us-congress-and-rulemaking": "Every day", "us-states-census": "Once a year, in September",
    "chicago-crime-monthly": "Every day, about a week behind", "nyc-traffic-crashes-monthly": "Every day", "us-federal-spending-by-agency": "Once a month",
}
WORLD_BANK_SETS = ["governance-indicators", "health-indicators", "education-indicators", "gender-indicators", "poverty-and-inequality", "environment-indicators",
                   "trade-and-finance", "technology-and-transport", "labour-indicators", "food-and-agriculture"]
OWID_SETS = ["democracy-and-rights", "conflict-and-security", "emissions-by-sector", "wellbeing-and-schooling", "forests-wildlife-and-plastic", "natural-disasters",
             "food-supply", "top-incomes", "space-and-ai", "renewable-capacity"]
CADENCE.update({i: "Revised by the World Bank a few times a year" for i in WORLD_BANK_SETS})
CADENCE.update({i: "Revised by Our World in Data about once a year" for i in OWID_SETS})


# Home page order: the world first, then the United States; within each, the sets people ask about most.
ORDER = ["co2-and-greenhouse-gases", "energy", "world-bank-development", "global-temperature", "atmospheric-co2", "earthquakes-past-30-days",
         "imf-world-economic-outlook", "europe-eurostat", "un-population", "health-indicators", "who-health-observatory", "human-development-index", "democracy-and-rights",
         "governance-indicators", "education-indicators", "poverty-and-inequality", "gender-indicators", "labour-indicators", "wellbeing-and-schooling", "top-incomes",
         "trade-and-finance", "food-and-agriculture", "food-supply", "penn-world-table", "technology-and-transport", "environment-indicators", "emissions-by-sector",
         "climate-trace-emissions", "forests-wildlife-and-plastic", "natural-disasters", "conflict-and-security", "renewable-capacity", "space-and-ai", "research-papers-by-year", "research-papers-by-country",
         "wikipedia-pageviews", "stack-overflow-activity", "github-activity-by-country", "biodiversity-records-by-year", "biodiversity-records-by-country", "clinical-trials-started",
         "world-leading-indicators-and-exchange-rates", "uk-economy-monthly", "imf-projections", "un-population-projections",
         "crude-oil-prices", "natural-gas-prices", "us-economy-monthly", "us-economy-quarterly", "us-rates-and-currencies-daily", "us-national-debt", "us-mortgage-lending", "us-grid-demand-daily", "us-states-census",
         "us-climate-monthly", "us-flu-hospital-admissions", "us-drug-overdose-deaths", "us-nih-research-projects", "us-river-flow-monthly", "us-fda-reports", "us-disaster-declarations", "us-disaster-declarations-list", "us-federal-register", "us-congress-and-rulemaking",
         "us-federal-spending-by-agency", "us-bank-failures", "us-bank-failures-list", "chicago-crime-monthly", "nyc-traffic-crashes-monthly", "maryland-crime", "pjm-summer-peak-forecasts"]


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
    "SP.POP.0014.TO.ZS": ("population_under_15_share", "Population ages 0 to 14", "% of total"),
    "SP.POP.65UP.TO.ZS": ("population_65_plus_share", "Population ages 65 and above", "% of total"),
    "EN.POP.DNST": ("population_density", "Population density", "people per sq. km"),
    "SM.POP.NETM": ("net_migration", "Net migration", "people"),
    "NY.GNP.PCAP.CD": ("gni_per_capita", "GNI per capita, Atlas method", "current US$"),
    "NE.GDI.TOTL.ZS": ("investment_share_gdp", "Gross capital formation", "% of GDP"),
    "NY.GNS.ICTR.ZS": ("savings_share_gdp", "Gross savings", "% of GDP"),
    "GC.TAX.TOTL.GD.ZS": ("tax_revenue_share_gdp", "Tax revenue", "% of GDP"),
    "MS.MIL.XPND.GD.ZS": ("military_spending_share_gdp", "Military expenditure", "% of GDP"),
    "BN.CAB.XOKA.GD.ZS": ("current_account_share_gdp", "Current account balance", "% of GDP"),
    "PA.NUS.FCRF": ("exchange_rate", "Official exchange rate", "local currency per US$"),
    "GB.XPD.RSDV.GD.ZS": ("research_spending_share_gdp", "Research and development expenditure", "% of GDP"),
    "TX.VAL.TECH.MF.ZS": ("high_tech_exports_share", "High-technology exports", "% of manufactured exports"),
    "ST.INT.ARVL": ("tourist_arrivals", "International tourism, arrivals", "people"),
    "SE.PRM.ENRR": ("primary_enrollment", "School enrollment, primary", "% gross"),
    "SE.SEC.ENRR": ("secondary_enrollment", "School enrollment, secondary", "% gross"),
    "SE.TER.ENRR": ("tertiary_enrollment", "School enrollment, tertiary", "% gross"),
    "SH.DYN.MORT": ("under_5_mortality", "Mortality rate, under 5", "per 1,000 live births"),
    "SH.STA.MMRT": ("maternal_mortality", "Maternal mortality ratio", "per 100,000 live births"),
    "SH.MED.PHYS.ZS": ("physicians", "Physicians", "per 1,000 people"),
    "SH.IMM.MEAS": ("measles_immunization", "Immunization, measles", "% of children 12 to 23 months"),
    "SN.ITK.DEFC.ZS": ("undernourishment", "Prevalence of undernourishment", "% of population"),
    "SH.STA.BASS.ZS": ("basic_sanitation_access", "People using at least basic sanitation services", "% of population"),
    "EG.USE.ELEC.KH.PC": ("electricity_use_per_capita", "Electric power consumption", "kWh per person"),
    "EN.ATM.PM25.MC.M3": ("pm25_air_pollution", "PM2.5 air pollution, mean annual exposure", "micrograms per cubic meter"),
    "AG.LND.AGRI.ZS": ("agricultural_land_share", "Agricultural land", "% of land area"),
    "IT.CEL.SETS.P2": ("mobile_subscriptions", "Mobile cellular subscriptions", "per 100 people"),
    "SG.GEN.PARL.ZS": ("women_in_parliament", "Seats held by women in national parliaments", "%"),
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
    cols, rows = by_date([("brent_usd_per_barrel", f"{RAW}datasets/oil-prices/main/data/brent-daily.csv"),
                          ("wti_usd_per_barrel", f"{RAW}datasets/oil-prices/main/data/wti-daily.csv")])
    return spec("crude-oil-prices", "Crude oil benchmark prices, daily",
                "Daily spot prices for Brent, the international benchmark, and WTI, the US benchmark.",
                "World", "Energy", "US Energy Information Administration, via DataHub", "https://github.com/datasets/oil-prices",
                "Public domain (US federal data; PDDL packaging)", ["date"], "date", "date", None, ["date"] + cols, rows,
                dict(brent_usd_per_barrel=dict(title="Brent spot price", unit="US$ per barrel"),
                     wti_usd_per_barrel=dict(title="WTI spot price", unit="US$ per barrel")))


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


def temperature():
    cell = {}
    for r in read_csv(f"{RAW}datasets/global-temp/main/data/monthly.csv"):
        col = {"GISTEMP": "nasa_anomaly_c", "GCAG": "noaa_anomaly_c"}.get(r["Source"])
        if col and re.fullmatch(r"\d{4}-\d{2}", r["Year"]) and r["Mean"] not in ("", None):
            cell.setdefault(r["Year"] + "-01", {})[col] = r["Mean"]
    try:                                                    # a third, independent record; the dataset still builds without it
        prev = 0
        for line in get("https://berkeley-earth-temperature.s3.us-west-1.amazonaws.com/Global/Land_and_Ocean_complete.txt").decode("utf-8", "replace").splitlines():
            p = line.split()
            if line.startswith("%") or len(p) < 3 or not p[0].isdigit():
                continue
            if int(p[0]) < prev:
                break                                       # the file repeats with a second way of treating sea ice; keep the first
            prev = int(p[0])
            if is_num(p[2]) and p[2].lower() != "nan":
                cell.setdefault(f"{p[0]}-{int(p[1]):02d}-01", {})["berkeley_anomaly_c"] = float(p[2])
    except Exception as e:
        print("  Berkeley Earth not loaded:", str(e)[:80])
    cols = ["nasa_anomaly_c", "noaa_anomaly_c"] + (["berkeley_anomaly_c"] if any("berkeley_anomaly_c" in v for v in cell.values()) else [])
    rows = [[m] + [v.get(c, "") for c in cols] for m, v in sorted(cell.items())]
    return spec("global-temperature", "Global temperature, monthly",
                "How much warmer or cooler the planet's surface was each month than a long-term average, from NASA, NOAA and Berkeley Earth.",
                "World", "Climate and environment", "NASA GISTEMP and NOAA Climate at a Glance, via DataHub; Berkeley Earth",
                "https://github.com/datasets/global-temp", "NASA and NOAA columns: US federal data (CC BY 4.0 packaging). Berkeley Earth column: CC BY-NC 4.0, non-commercial use only", ["month"], "month", "date", None,
                ["month"] + cols, rows,
                dict(nasa_anomaly_c=dict(title="Global temperature against the 1951-1980 average (NASA)", unit="°C",
                                         description="GISTEMP global land-ocean temperature index: difference from the 1951 to 1980 mean."),
                     noaa_anomaly_c=dict(title="Global temperature against the 20th-century average (NOAA)", unit="°C",
                                         description="NOAA global land and ocean temperature anomaly: difference from the 20th-century average."),
                     berkeley_anomaly_c=dict(title="Global temperature against the 1951-1980 average (Berkeley Earth)", unit="°C",
                                             description="Berkeley Earth global land and ocean temperature: difference from the 1951 to 1980 mean. Licensed CC BY-NC 4.0.")))


def co2ppm():
    cell = {}

    def take(url, picks):
        rows = list(csv.reader(io.StringIO(get(url).decode("utf-8-sig"))))[1:]   # header labels do not match the columns; use positions
        for r in rows:
            if len(r) > max(i for i, _ in picks) and re.fullmatch(r"\d{4}-\d{2}", r[0]):
                for i, col in picks:
                    if is_num(r[i]) and 250 < float(r[i]) < 700:                # skip fill values such as -99.99
                        cell.setdefault(r[0] + "-01", {})[col] = r[i]
    take(f"{RAW}datasets/co2-ppm/main/data/co2-mm-mlo.csv", [(2, "mauna_loa_ppm"), (3, "mauna_loa_trend_ppm")])
    take(f"{RAW}datasets/co2-ppm/main/data/co2-mm-gl.csv", [(2, "global_ppm"), (4, "global_trend_ppm")])
    cols = ["mauna_loa_ppm", "mauna_loa_trend_ppm", "global_ppm", "global_trend_ppm"]
    rows = [[m] + [v.get(c, "") for c in cols] for m, v in sorted(cell.items())]
    return spec("atmospheric-co2", "CO2 in the atmosphere, monthly",
                "The concentration of carbon dioxide in the air, measured at Mauna Loa since 1958 and averaged across the globe since 1979.",
                "World", "Climate and environment", "NOAA Global Monitoring Laboratory, via DataHub", "https://github.com/datasets/co2-ppm",
                "Public domain (US federal data; PDDL packaging)", ["month"], "month", "date", None, ["month"] + cols, rows,
                dict(mauna_loa_ppm=dict(title="CO2 at Mauna Loa", unit="parts per million", description="Monthly mean CO2 at Mauna Loa Observatory, Hawaii."),
                     mauna_loa_trend_ppm=dict(title="CO2 at Mauna Loa, seasonal cycle removed", unit="parts per million"),
                     global_ppm=dict(title="CO2, global average", unit="parts per million", description="Monthly mean over marine surface sites worldwide."),
                     global_trend_ppm=dict(title="CO2, global average, seasonal cycle removed", unit="parts per million")))


BUILDERS = [
    lambda: owid("co2-and-greenhouse-gases", "co2-data", "co2", "CO2 and greenhouse gas emissions",
                 "Annual emissions by country: CO2 by fuel and sector, per-capita and cumulative figures, methane, nitrous oxide, and each country's share of the world total.",
                 "Climate and environment"),
    lambda: owid("energy", "energy-data", "energy", "Energy production, consumption and electricity mix",
                 "Annual energy data by country: primary energy, electricity generation by source, shares of coal, gas, nuclear, solar and wind, and per-capita use.",
                 "Energy"),
    worldbank, temperature, co2ppm, quakes, oil, gas, pjm,
]
BUILDER_NAMES = ["co2", "energy", "worldbank", "temperature", "co2ppm", "quakes", "oil", "gas", "pjm"]


# ---------- country reference: World Bank regions and income groups ----------

def build_countries():
    """The World Bank's list of economies with region and income group (CC BY 4.0).
    Used to leave out regional totals in cross-country work and to compare groups of countries."""
    old = json.loads(COUNTRIES.read_text()) if COUNTRIES.exists() else {"countries": {}}
    try:
        j = json.loads(get("https://api.worldbank.org/v2/country?format=json&per_page=400"))
        out = {}
        for c in j[1]:
            region = ((c.get("region") or {}).get("value") or "").strip()
            if not region or region == "Aggregates":
                continue
            row = dict(name=c["name"], region=region)
            income = ((c.get("incomeLevel") or {}).get("value") or "").strip()
            if income and income not in ("Not classified", "Aggregates"):
                row["income"] = income
            out[c["id"]] = row
        if len(out) < 150:
            raise ValueError(f"only {len(out)} countries returned")
        if "XKX" in out:
            out["OWID_KOS"] = dict(out["XKX"])                 # Our World in Data's code for Kosovo
    except Exception as e:
        print("  country list not refreshed:", str(e)[:100])
        return old["countries"]
    new = dict(source="World Bank country and lending groups, CC BY 4.0", countries=out)
    if {k: v for k, v in old.items() if k != "built"} != new:
        COUNTRIES.write_text(json.dumps(dict(new, built=date.today().isoformat()), separators=(",", ":"), ensure_ascii=False))
        print(f"countries: {len(out)} listed, {sum(1 for v in out.values() if v.get('income'))} with an income group")
    return out


# ---------- home page data: latest values, sparklines and featured series ----------

def pull(ds, wants):
    """wants: list of (code or None, column). Returns {(code, col): [(time, float), ...]} from the built CSV."""
    path, out = SETS / f"{ds}.csv", {w: [] for w in wants}
    if not path.exists():
        return out
    with open(path, encoding="utf-8") as f:
        r = csv.reader(f)
        h = {c: i for i, c in enumerate(next(r))}
        tcol = h.get("year", h.get("date", h.get("month", h.get("time"))))
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


def map_layer(ds, col, title, unit, real, decimals=1):
    """Latest year in which at least 140 real countries have a value."""
    path = SETS / f"{ds}.csv"
    if not path.exists() or not real:
        return None
    by = {}
    with open(path, encoding="utf-8") as f:
        r = csv.reader(f)
        h = {c: i for i, c in enumerate(next(r))}
        if col not in h:
            return None
        for row in r:
            if row[h[col]] != "" and row[h["code"]] in real:
                by.setdefault(row[h["year"]], {})[row[h["code"]]] = round(float(row[h[col]]), 3)
    good = [y for y in sorted(by) if len(by[y]) >= 140]
    if not good:
        return None
    y = good[-1]
    return dict(id=col, dataset=ds, title=title, unit=unit, year=y, decimals=decimals, values=by[y])


def build_pulse(real=None):
    W = "WLD"
    co2 = pull("co2-and-greenhouse-gases", [(W, "co2")])
    en = pull("energy", [(W, c) for c in ("solar_share_elec", "wind_share_elec", "coal_share_elec", "electricity_generation", "primary_energy_consumption")])
    big5 = (("India", "IND"), ("China", "CHN"), ("United States", "USA"), ("Indonesia", "IDN"), ("Pakistan", "PAK"))
    life4 = (("Japan", "JPN"), ("World", W), ("India", "IND"), ("Nigeria", "NGA"))
    wb = pull("world-bank-development", [(c, "population") for _, c in big5] + [(c, "life_expectancy") for _, c in life4] +
              [(W, "population"), (W, "gdp_current_usd"), (W, "gdp_per_capita")])
    oil = pull("crude-oil-prices", [(None, "brent_usd_per_barrel"), (None, "wti_usd_per_barrel")])
    gas = pull("natural-gas-prices", [(None, "henry_hub_usd_per_mmbtu")])
    pj = pull("pjm-summer-peak-forecasts", [("PJM RTO", "forecast_jan2026_mw")])
    tm = pull("global-temperature", [(None, "nasa_anomaly_c")])[(None, "nasa_anomaly_c")]
    pp = pull("atmospheric-co2", [(None, "mauna_loa_ppm")])[(None, "mauna_loa_ppm")]
    X = "explore.html#d="

    by_year = {}
    for m, v in tm:
        by_year.setdefault(m[:4], []).append(v)
    temp_years = [(y, sum(v) / 12) for y, v in sorted(by_year.items()) if len(v) == 12]     # complete years only

    def tick(label, pts, show, unit, href, lag=1, versus=None, change="%", monthly=False):
        if len(pts) <= lag:
            return None
        (t1, v1), (t0, v0) = pts[-1], pts[-1 - lag]
        if len(t1) == 4:
            asof = t1
        else:
            asof = datetime.strptime(t1, "%Y-%m-%d").strftime("%b %Y" if monthly else "%b %-d, %Y")
        delta = 100 * (v1 - v0) / v0 if change == "%" and v0 else v1 - v0
        return dict(label=label, display=show(v1), unit=unit, asof=asof, change=round(delta, 2), change_unit=change,
                    versus=versus or (t0 if len(t0) == 4 else "the day before"), href=href,
                    spark=[round(v, 4) for _, v in thin(pts[-60:], 30)])

    big = lambda scale=1.0: (lambda v: nice(v * scale, "num"))
    usd = lambda v: f"${v:,.2f}"
    pct = lambda v: f"{v:.1f}%"
    tickers = [t for t in (
        tick("World CO2 emissions", co2[(W, "co2")], big(1e6), "tonnes a year", X + "co2-and-greenhouse-gases&v=co2&e=WLD"),
        tick("Global temperature", temp_years, lambda v: f"{v:+.2f} °C", "against the 1951 to 1980 average", X + "global-temperature", change=" °C"),
        tick("CO2 in the air", pp, lambda v: f"{v:.1f} ppm", "at Mauna Loa", X + "atmospheric-co2", lag=12, versus="a year earlier", change=" ppm", monthly=True),
        tick("World population", wb[(W, "population")], big(), "people", X + "world-bank-development&v=population&e=WLD"),
        tick("World GDP", wb[(W, "gdp_current_usd")], lambda v: "$" + nice(v, "num"), "", X + "world-bank-development&v=gdp_current_usd&e=WLD"),
        tick("World life expectancy", wb[(W, "life_expectancy")], lambda v: f"{v:.1f}", "years", X + "world-bank-development&v=life_expectancy&e=WLD"),
        tick("Solar share of world electricity", en[(W, "solar_share_elec")], pct, "", X + "energy&v=solar_share_elec&e=WLD", change=" points"),
        tick("Wind share of world electricity", en[(W, "wind_share_elec")], pct, "", X + "energy&v=wind_share_elec&e=WLD", change=" points"),
        tick("Coal share of world electricity", en[(W, "coal_share_elec")], pct, "", X + "energy&v=coal_share_elec&e=WLD", change=" points"),
        tick("Brent crude oil", oil[(None, "brent_usd_per_barrel")], usd, "per barrel", X + "crude-oil-prices"),
        tick("WTI crude oil", oil[(None, "wti_usd_per_barrel")], usd, "per barrel", X + "crude-oil-prices"),
        tick("US natural gas", gas[(None, "henry_hub_usd_per_mmbtu")], usd, "per million Btu", X + "natural-gas-prices"),
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
              [("World", [[t, round(v / 1000, 3)] for t, v in co2[(W, "co2")] if t >= "1900"])]),
        story("temperature", "Temperature", "Global temperature since 1880", "Yearly average, °C warmer or cooler than the 1951 to 1980 average. NASA.",
              "°C", "year", X + "global-temperature&v=nasa_anomaly_c", [("World", [[y, round(v, 3)] for y, v in temp_years])], 2),
        story("renewables", "Solar and wind", "Solar and wind in the world's electricity", "Share of electricity generation, percent. Our World in Data.",
              "%", "year", X + "energy&v=solar_share_elec,wind_share_elec&e=WLD&f=2000",
              [("Wind", since(en[(W, "wind_share_elec")], "2000")), ("Solar", since(en[(W, "solar_share_elec")], "2000"))]),
        story("life", "Life expectancy", "Life expectancy since 1960", "Years at birth. World Bank.",
              "years", "year", X + "world-bank-development&v=life_expectancy&e=" + ",".join(c for _, c in life4),
              [(n, [[t, round(v, 2)] for t, v in wb[(c, "life_expectancy")]]) for n, c in life4]),
        story("population", "Population", "The five most populous countries", "Population in billions. World Bank.",
              "billion", "year", X + "world-bank-development&v=population&e=" + ",".join(c for _, c in big5),
              [(n, [[t, round(v / 1e9, 4)] for t, v in wb[(c, "population")]]) for n, c in big5], 2),
        story("oil", "Oil", "Crude oil prices, past five years", "US dollars per barrel, spot. US Energy Information Administration.",
              "$", "date", X + "crude-oil-prices&f=" + five,
              [("Brent", week(oil[(None, "brent_usd_per_barrel")])), ("WTI", week(oil[(None, "wti_usd_per_barrel")]))], 2),
    ) if s]

    def spark(label, pts, n=60):
        return dict(label=label, pts=[round(v, 4) for _, v in thin(pts, n)]) if len(pts) > 1 else None

    sparks = {k: v for k, v in {
        "co2-and-greenhouse-gases": spark("World CO2 emissions since 1950", [p for p in co2[(W, "co2")] if p[0] >= "1950"]),
        "energy": spark("World energy consumption", en[(W, "primary_energy_consumption")]),
        "world-bank-development": spark("World GDP per person", wb[(W, "gdp_per_capita")] or wb[(W, "gdp_current_usd")]),
        "global-temperature": spark("Yearly anomaly since 1880", temp_years),
        "atmospheric-co2": spark("Mauna Loa since 1958", pp, 80),
        "crude-oil-prices": spark("Brent, past year", oil[(None, "brent_usd_per_barrel")][-250:]),
        "natural-gas-prices": spark("Henry Hub, past year", gas[(None, "henry_hub_usd_per_mmbtu")][-250:]),
        "pjm-summer-peak-forecasts": spark("PJM forecast peak to 2046", pj[("PJM RTO", "forecast_jan2026_mw")]),
    }.items() if v}

    for d in (json.loads(MANIFEST.read_text())["datasets"] if MANIFEST.exists() else []):   # every other dataset: its first measure, for the world or as its one series
        nums = [c for c in d["columns"] if c["type"] == "num"]
        if d["id"] in sparks or not nums:
            continue
        c = next((x for x in nums if x["name"] in (d.get("default_vars") or [])), nums[0])
        try:
            if d.get("entity") and d["keys"] == ["code", "year"]:
                pts, label = pull(d["id"], [(W, c["name"])])[(W, c["name"])], f"World: {c['title']}"
            elif not d.get("entity") and d["keys"] == [d["time"]["col"]]:
                pts, label = pull(d["id"], [(None, c["name"])])[(None, c["name"])], c["title"]
                pts = pts[:-1] if d.get("partial") else pts                       # the year in progress would look like a collapse
            else:
                continue
            s = spark(label, pts[-720:])
            if s:
                sparks[d["id"]] = s
        except Exception as e:
            print(f"  no sparkline for {d['id']}: {str(e)[:80]}")

    counters = {}
    if co2[(W, "co2")]:
        y, v = co2[(W, "co2")][-1]
        counters["co2"] = dict(year=int(y), per_year=v * 1e6)                      # tonnes
    if en[(W, "electricity_generation")]:
        y, v = en[(W, "electricity_generation")][-1]
        counters["electricity"] = dict(year=int(y), per_year=v * 1e6)             # MWh
    if len(wb[(W, "population")]) > 1:
        (y0, v0), (y1, v1) = wb[(W, "population")][-2:]
        counters["population"] = dict(year=int(y1), value=v1, growth=v1 / v0 - 1)  # mid-year estimate

    out = dict(built=datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"), tickers=tickers, stories=stories, sparks=sparks, counters=counters)
    ea = pull("world-bank-development", [(W, "electricity_access")])[(W, "electricity_access")]
    if len(ea) > 5:                                                              # the fact shown on the night-lights photo
        by, y1 = dict(ea), ea[-1][0]
        y0 = str(int(y1) - 20) if str(int(y1) - 20) in by else ea[0][0]
        out["band"] = dict(value=round(ea[-1][1], 1), year=y1, before=round(by[y0], 1), before_year=y0)
    real = set(real or {})                                                       # real countries only, no regional totals
    out["maps"] = [m for m in (
        map_layer("world-bank-development", "life_expectancy", "Life expectancy", "years", real),
        map_layer("co2-and-greenhouse-gases", "co2_per_capita", "CO2 per person", "tonnes a year", real),
        map_layer("world-bank-development", "gdp_per_capita", "GDP per person", "US$", real, 0),
        map_layer("energy", "renewables_share_elec", "Renewable electricity", "% of generation", real),
        map_layer("world-bank-development", "internet_users", "People online", "% of population", real),
    ) if m]

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
    print(f"pulse: {len(tickers)} tickers, {len(stories)} stories, {len(sparks)} sparklines, {len(out['maps'])} maps, quakes: {'yes' if 'quakes' in out else 'no'}")


# ---------- change log: what a refresh changed, dataset by dataset ----------

def same(a, b):
    if a == b:
        return True
    try:
        x, y = float(a), float(b)
    except ValueError:
        return False
    return abs(x - y) <= 1e-9 * max(1.0, abs(x), abs(y))


def show(v):
    """A value as a person would write it."""
    try:
        x = float(v)
    except ValueError:
        return str(v)[:80]
    if x != x:
        return ""
    if x == int(x) and abs(x) < 1e15:
        return f"{int(x):,}" if abs(x) >= 10000 else str(int(x))
    return f"{x:,.0f}" if abs(x) >= 10000 else f"{x:.4g}"


def read_rows(path):
    with open(path, encoding="utf-8", newline="") as f:
        r = csv.reader(f)
        return next(r), list(r)


def diff_dataset(d, old_path, new_path):
    """Compare two builds of one dataset. Returns None when nothing changed, else a summary a person can read."""
    if hashlib.sha1(Path(old_path).read_bytes()).digest() == hashlib.sha1(Path(new_path).read_bytes()).digest():
        return None
    oh, orows = read_rows(old_path)
    nh, nrows = read_rows(new_path)
    oi, ni = {c: i for i, c in enumerate(oh)}, {c: i for i, c in enumerate(nh)}
    keys, tcol = d["keys"], d["time"]["col"]
    titles = {c["name"]: c["title"] for c in d["columns"]}
    out = dict(id=d["id"], title=d["title"], rows=len(nrows), added=0, removed=0, revised_cells=0, revised_rows=0,
               cols_added=[titles.get(c, c) for c in nh if c not in oi], cols_removed=[c for c in oh if c not in ni])
    if any(k not in oi or k not in ni for k in keys):
        return dict(out, note="The table was rebuilt with a new layout.")
    lab = d["entity"]["label_col"] if d.get("entity") else ("place" if "place" in ni else None)

    def where(r, idx):
        t = r[idx[tcol]]
        t = t[:16].replace("T", " ") + " UTC" if "T" in t else t
        return f"{r[idx[lab]]}, {t}" if lab and lab in idx and r[idx[lab]] else t

    old = {tuple(r[oi[k]] for k in keys): r for r in orows}
    shared = [c for c in nh if c in oi and c not in keys and c != lab]
    lead = [c for c in (d.get("default_vars") or []) + [c["name"] for c in d["columns"] if c["type"] == "num"] if c in ni]
    per_col, revised, fresh = Counter(), [], []
    for r in nrows:
        o = old.pop(tuple(r[ni[k]] for k in keys), None)
        if o is None:
            out["added"] += 1
            fresh.append(r)
            continue
        hit = False
        for c in shared:
            a, b = o[oi[c]], r[ni[c]]
            if not same(a, b):
                out["revised_cells"] += 1
                per_col[c] += 1
                hit = True
                if len(revised) < 5000:
                    revised.append((r[ni[tcol]], c, a, b, where(r, ni)))
        out["revised_rows"] += hit
    out["removed"] = len(old)
    ot, nt = [r[oi[tcol]] for r in orows], [r[ni[tcol]] for r in nrows]
    if ot and nt and max(ot) != max(nt):
        out["latest_from"], out["latest_to"] = max(ot), max(nt)
    out["top"] = [[titles.get(c, c), n] for c, n in per_col.most_common(4)]
    ex = []
    for r in sorted(fresh, key=lambda r: r[ni[tcol]], reverse=True)[:3]:        # newest added rows
        c = next((c for c in lead if r[ni[c]] != ""), None)
        if c:
            ex.append(dict(where=where(r, ni), what=titles.get(c, c), new=show(r[ni[c]])))
    seen = set()
    for t, c, a, b, w in sorted(revised, key=lambda x: (c_rank(x[1], lead), x[0]), reverse=True):   # newest revisions, lead variables first
        if c in seen or len(ex) >= 6:
            continue
        seen.add(c)
        ex.append(dict(where=w, what=titles.get(c, c), old=show(a), new=show(b)))
    out["examples"] = ex
    if not (out["added"] or out["removed"] or out["revised_cells"] or out["cols_added"] or out["cols_removed"]):
        return None                                                             # same data, different bytes
    return out


def c_rank(col, lead):
    return -lead.index(col) if col in lead else -len(lead) - 1


def log_run(manifest, old_dir, failed, at=None):
    """Append one entry to the change log by comparing the fresh CSVs with the copies saved before the build."""
    log = json.loads(CHANGELOG.read_text()) if CHANGELOG.exists() else {"runs": []}
    changed, same_ids = [], []
    for d in manifest:
        new, old = ROOT / "docs" / d["file"], Path(old_dir) / f"{d['id']}.csv"
        if not old.exists():
            changed.append(dict(id=d["id"], title=d["title"], rows=d["rows"], new_dataset=True))
            continue
        x = diff_dataset(d, old, new)
        if x:
            changed.append(x)
        else:
            same_ids.append(d["id"])
    run = dict(at=at or datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"), changed=changed, unchanged=same_ids)
    if failed:
        run["failed"] = failed
    log = dict(cron=CRON, runs=([run] + log.get("runs", []))[:120])
    CHANGELOG.write_text(json.dumps(log, separators=(",", ":"), ensure_ascii=False))
    print(f"change log: {len(changed)} changed, {len(same_ids)} unchanged")
    return run


# ---------- newest value of every variable for every place ----------

def sig(v, n=6):
    x = float(f"{v:.{n}g}")
    return int(x) if x == int(x) and abs(x) < 1e15 else x


def build_latest(manifest):
    """For country-and-year datasets: each place's newest value of each variable, and the value ten years before it."""
    LATEST.mkdir(parents=True, exist_ok=True)
    for d in manifest:
        if d["keys"] != ["code", "year"]:
            continue
        h, rows = read_rows(ROOT / "docs" / d["file"])
        i = {c: k for k, c in enumerate(h)}
        codes = [p[0] for p in d["places"]]
        pos = {c: k for k, c in enumerate(codes)}
        out = {}
        for c in d["columns"]:
            if c["type"] != "num":
                continue
            by = {}
            for r in rows:
                if r[i[c["name"]]] != "":
                    by.setdefault(r[i["code"]], {})[int(r[i["year"]])] = float(r[i[c["name"]]])
            y, v, p = [None] * len(codes), [None] * len(codes), [None] * len(codes)
            for code, s in by.items():
                yy = max(s)
                y[pos[code]], v[pos[code]] = yy, sig(s[yy])
                if yy - 10 in s:
                    p[pos[code]] = sig(s[yy - 10])
            out[c["name"]] = dict(y=y, v=v, p=p)
        text = json.dumps(dict(dataset=d["id"], built=d["built"], codes=codes, vars=out), separators=(",", ":"))
        path = LATEST / f"{d['id']}.json"
        if not path.exists() or path.read_text() != text:
            path.write_text(text)
    print("latest values written for", ", ".join(d["id"] for d in manifest if d["keys"] == ["code", "year"]))


def build_sample(real):
    """A small, real table for trying the 'Your data' page: one row per country for one recent year."""
    wants = [("world-bank-development", c) for c in ("population", "gdp_per_capita", "life_expectancy", "under_5_mortality", "internet_users", "urban_population_share")] + \
            [("co2-and-greenhouse-gases", "co2_per_capita"), ("energy", "renewables_share_elec")]
    if not real:
        return
    data = {}
    for ds in {w[0] for w in wants}:
        path = SETS / f"{ds}.csv"
        if not path.exists():
            return
        h, rows = read_rows(path)
        i = {c: k for k, c in enumerate(h)}
        for _, c in [w for w in wants if w[0] == ds]:
            if c not in i:
                return
            for r in rows:
                if r[i[c]] != "" and r[i["code"]] in real:
                    data.setdefault(c, {}).setdefault(r[i["year"]], {})[r[i["code"]]] = r[i[c]]
    years = [y for y in sorted(data["gdp_per_capita"]) if len(data["gdp_per_capita"][y]) >= 150 and len(data["life_expectancy"].get(y, {})) >= 150]
    if not years:
        return
    y = years[-1]
    with open(SAMPLE, "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["country", "code", "region", "income_group", "year"] + [c for _, c in wants])
        for code, c in sorted(real.items(), key=lambda kv: kv[1]["name"]):
            if code.startswith("OWID_"):
                continue
            w.writerow([c["name"], code, c["region"], c.get("income", ""), y] + [data[v].get(y, {}).get(code, "") for _, v in wants])
    print("sample table written for", y)


def describe(d):
    """A close look at one freshly built dataset, for trying a new source."""
    h, rows = read_rows(SETS / f"{d['id']}.csv")
    print(f"     {d['title']} | {d['source']} | {d['domain']} | {d['bytes'] / 1e6:.2f} MB | {d['time']['min']} to {d['time']['max']}" + (f" | {d.get('entities')} places" if d.get("entity") else ""))
    for c in d["columns"][:60]:
        print(f"       {c['name']} | {c['title']} | unit={c['unit']!r} | {c['type']} | filled {c['filled']}")
    for r in rows[:2] + rows[-2:]:
        print("       row:", ",".join(str(x) for x in r)[:260])


def main():
    global SETS
    derive_only = "--derive" in sys.argv                    # rebuild only the derived files from the CSVs already on disk
    trying = "--try" in sys.argv                            # build into a scratch folder and print what came back; nothing is kept
    only = sys.argv[sys.argv.index("--only") + 1].split(",") if "--only" in sys.argv else None
    if trying:
        SETS = Path(tempfile.mkdtemp())
    import sources                                          # the builders for the wider catalog; they use the helpers above
    if "--probe-owid" in sys.argv:
        sources.owid_probe(sys.argv[sys.argv.index("--probe-owid") + 1].split(","))
        return
    builders = list(zip(BUILDER_NAMES + sources.NAMES, BUILDERS + sources.BUILDERS))
    SETS.mkdir(parents=True, exist_ok=True)
    before = tempfile.mkdtemp()
    for f in SETS.glob("*.csv"):
        shutil.copy(f, before)
    was = json.loads(MANIFEST.read_text()) if MANIFEST.exists() else {"datasets": []}
    old = {d["id"]: d for d in was["datasets"]}
    out, failed = [], []
    for name, b in ([] if derive_only else builders):
        if only and name not in only:
            continue
        started = time.time()
        try:
            res = b()
            for d in (res if isinstance(res, list) else [res]):
                skip = ("built", "places", "default_vars", "chart_entities", "coverage", "chart", "default_entities", "cadence")
                if old.get(d["id"]) and {k: v for k, v in old[d["id"]].items() if k not in skip} == {k: v for k, v in d.items() if k not in skip}:
                    d["built"] = old[d["id"]]["built"]      # unchanged data keeps its date
                out.append(d)
                print(f"ok   {d['id']}: {d['rows']} rows, {len(d['columns'])} variables, {time.time() - started:.0f}s", flush=True)
                if trying:
                    describe(d)
        except Exception as e:
            if type(e).__name__ == "NeedsKey":            # a free key the owner has not added yet: not a failure
                print(f"wait {name}: no key named {e} yet", flush=True)
                continue
            failed.append(f"{name}: {str(e)[:180]}")
            print(f"FAIL {name}: {str(e)[:200]} ({time.time() - started:.0f}s)", flush=True)
    if trying:
        print(f"\n{len(out)} datasets built, {len(failed)} builders failed:", "; ".join(f.split(':')[0] for f in failed))
        shutil.rmtree(SETS, ignore_errors=True)
        return
    keep = {d["id"] for d in out}
    out += [d for i, d in old.items() if i not in keep]     # a failed build keeps the last good version
    out.sort(key=lambda d: ORDER.index(d["id"]) if d["id"] in ORDER else len(ORDER))
    for d in out:
        if d["id"] not in DEFAULTS and d.get("entity") and d["keys"] == ["code", "year"]:
            d["chart_entities"] = C                         # a country table with nothing chosen for it: the same six places as the others
        d.update(DEFAULTS.get(d["id"], {}))
        d["cadence"] = CADENCE.get(d["id"], "")
        d.pop("default_entities", None)
        if d.get("entity"):
            with open(ROOT / "docs" / d["file"], encoding="utf-8") as f:
                r = csv.reader(f)
                h = next(r)
                ci, li = h.index(d["entity"]["col"]), h.index(d["entity"]["label_col"])
                d["places"] = sorted({(row[ci], row[li]) for row in r}, key=lambda p: p[1])
    now = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    if derive_only:                                         # nothing was fetched, so the time of the last real check stands
        log = json.loads(CHANGELOG.read_text()) if CHANGELOG.exists() else {}
        now = was.get("checked") or (log.get("runs") or [{}])[0].get("at") or now
    MANIFEST.write_text(json.dumps({"checked": now, "cron": CRON, "datasets": out}, indent=1, ensure_ascii=False))
    real = (json.loads(COUNTRIES.read_text())["countries"] if COUNTRIES.exists() else {}) if derive_only else build_countries()
    build_pulse(real)
    build_latest(out)
    build_sample(real)
    if not derive_only:
        log_run(out, before, failed, now)
    shutil.rmtree(before, ignore_errors=True)
    sys.exit(1 if failed and not out else 0)


if __name__ == "__main__":
    main()
