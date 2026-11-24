"""More datasets, one builder for each source in the catalog that can be read without an account or key.

Every builder returns one spec or a list of specs (see `spec()` in build_datasets.py) and is added to BUILDERS at the
foot of this file. Three shapes are used, because the rest of the site already understands them:

  country_year()  one row per country and year          -> lookups, comparisons, rankings, maps, charts, the AI
  series()        one row per date, a column per measure -> latest reading, history, charts, the AI
  table()         anything else (lists, agencies)        -> the explorer

A builder that fails keeps the files from the last good run, so one source being down never breaks the site.
Fetching is polite: one request at a time, a pause between requests to the same host, and for sources that are asked
year by year only the recent years are fetched again; older years are read back from the file already on disk.
"""
import csv, gzip, io, json, os, re, sys, time, urllib.parse, urllib.request
from datetime import date, datetime, timezone

bd = sys.modules["__main__"] if hasattr(sys.modules.get("__main__"), "spec") else __import__("build_datasets")
RAW, SETS = bd.RAW, bd.SETS
THIS_YEAR = date.today().year
PD = "Public domain (US federal data)"
COUNTRY = dict(col="code", label_col="country", label="Country or region")


# ---------- helpers ----------
def fetch(url, headers=None, data=None, tries=3, timeout=150):
    h = dict(bd.UA)
    h.update(headers or {})
    for i in range(tries):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=h, data=data), timeout=timeout) as r:
                raw = r.read()
                return gzip.decompress(raw) if r.headers.get("Content-Encoding") == "gzip" else raw
        except Exception:
            if i == tries - 1:
                raise
            time.sleep(4 * (i + 1))


def J(url, **kw):
    return json.loads(fetch(url, **kw))


def text(url, **kw):
    return fetch(url, **kw).decode("utf-8-sig", "replace")


def slug(s, n=52):
    s = re.sub(r"[^a-z0-9]+", "_", s.lower().replace("%", " pct ").replace("$", " usd ")).strip("_")
    return s if len(s) <= n else s[:n].rsplit("_", 1)[0]


def num(v, n=7):
    """A float rounded to n significant figures, written without needless digits; '' for missing."""
    if v in ("", None):
        return ""
    try:
        x = float(v)
    except (TypeError, ValueError):
        return ""
    if x != x or x in (float("inf"), float("-inf")):
        return ""
    x = float(f"{x:.{n}g}")
    return int(x) if x == int(x) and abs(x) < 1e15 else x


def split_unit(label):
    """'Hospital beds (per 1,000 people)' -> ('Hospital beds', 'per 1,000 people')."""
    m = re.match(r"^(.*\S)\s*\(([^()]+)\)\s*$", label.strip())
    t, u = (m.group(1), m.group(2)) if m else (label.strip(), "")
    k = u.rfind(", %")
    if k > 0:                                               # 'modeled estimate, % of children under 5' -> the unit starts at the percent sign
        t, u = f"{t} ({u[:k]})", u[k + 2:]
    if not u and re.search(r"share held by", t, re.I):
        u = "% of all income"
    return t, u


_iso = {}


def iso():
    """ISO 3166 two-letter and UN M49 numeric codes -> three-letter codes, and English names."""
    if not _iso:
        a2, m49, name = {}, {}, {}
        for r in csv.DictReader(io.StringIO(text(f"{RAW}datasets/country-codes/main/data/country-codes.csv"))):
            a3 = r.get("ISO3166-1-Alpha-3")
            if not a3:
                continue
            if r.get("ISO3166-1-Alpha-2"):
                a2[r["ISO3166-1-Alpha-2"]] = a3
            if r.get("M49"):
                m49[str(int(float(r["M49"])))] = a3
            name[a3] = r.get("CLDR display name") or r.get("official_name_en") or a3
        a2.setdefault("XK", "XKX")
        name.setdefault("XKX", "Kosovo")
        a2.setdefault("NA", "NAM")                          # read as "not available" by some CSV tools; make sure it is there
        _iso.update(a2=a2, m49=m49, name=name)
    return _iso


def prior(id, key=0):
    """Rows of the file from the last run, keyed by one column: lets a builder fetch only what is new."""
    path = SETS / f"{id}.csv"
    if not path.exists():
        return [], {}
    with open(path, newline="", encoding="utf-8") as f:
        r = csv.reader(f)
        h = next(r)
        return h, {row[key]: dict(zip(h, row)) for row in r}


def country_year(id, title, description, domain, source, source_url, licence, cell, names, meta, cols, region="World", min_rows=200):
    """cell: {(code, year): {column: value}}; names: {code: label}."""
    cols = [c for c in cols if any(c in v for v in cell.values())]
    rows = [[c, names.get(c, c), y] + [num(v.get(col)) for col in cols] for (c, y), v in sorted(cell.items())]
    rows = [r for r in rows if any(x != "" for x in r[3:])]
    assert len(rows) >= min_rows, f"{id}: only {len(rows)} rows"
    return bd.spec(id, title, description, region, domain, source, source_url, licence, ["code", "year"], "year", "year",
                   COUNTRY, ["code", "country", "year"] + cols, rows, meta)


def series(id, title, description, region, domain, source, source_url, licence, cell, meta, cols, step, min_rows=12):
    """cell: {'YYYY-MM-DD': {column: value}}; step says how far apart the dates are: day, week, month, quarter or year."""
    cols = [c for c in cols if any(c in v for v in cell.values())]
    rows = [[d] + [num(v.get(c)) for c in cols] for d, v in sorted(cell.items())]
    rows = [r for r in rows if any(x != "" for x in r[1:])]
    assert len(rows) >= min_rows, f"{id}: only {len(rows)} rows"
    assert all(re.fullmatch(r"\d{4}-\d{2}-\d{2}", r[0]) for r in rows), f"{id}: a date is not YYYY-MM-DD"
    out = bd.spec(id, title, description, region, domain, source, source_url, licence, ["date"], "date", "date", None,
                  ["date"] + cols, rows, meta)
    out["step"] = step
    return out


def table(id, title, description, region, domain, source, source_url, licence, keys, time_col, time_type, entity, header, rows, meta, min_rows=5):
    assert len(rows) >= min_rows, f"{id}: only {len(rows)} rows"
    k = [header.index(c) for c in keys]
    assert len({tuple(r[i] for i in k) for r in rows}) == len(rows), f"{id}: key columns do not identify a row"
    return bd.spec(id, title, description, region, domain, source, source_url, licence, keys, time_col, time_type, entity, header, rows, meta)


# ---------- World Bank: themed sets of indicators ----------
def wb_codes(source):
    """Every indicator id the World Bank lists for one of its databases."""
    out, page, pages = {}, 1, 1
    while page <= pages:
        j = J(f"https://api.worldbank.org/v2/indicator?source={source}&format=json&per_page=1000&page={page}")
        pages = int(j[0]["pages"])
        for it in j[1] or []:
            out[it["id"]] = it.get("name", "")
        page += 1
    return out


def wb_data360(database, ind):
    """The same figures from the World Bank's newer Data360 service, for databases that have moved there."""
    got, names, skip = {}, {}, 0
    code = f"WB_{database}_" + ind.replace(".", "_")
    while True:
        j = J(f"https://data360api.worldbank.org/data360/data?DATABASE_ID=WB_{database}&INDICATOR={code}&skip={skip}")
        rows = j.get("value") or []
        for r in rows:
            c, y, v = r.get("REF_AREA"), str(r.get("TIME_PERIOD", ""))[:4], num(r.get("OBS_VALUE"))
            if c and y.isdigit() and v is not None:
                got[(c, int(y))] = v
        skip += len(rows)
        if not rows or skip >= int(j.get("count", 0)):
            break
        time.sleep(0.1)
    return got


def wb_set(id, title, description, domain, source, codes, source_param=None, relabel=None, source_url="https://data.worldbank.org", data360=None, labels=None):
    """One country-and-year table from a list of World Bank indicator codes. Titles and units come from the World Bank itself."""
    cell, names, meta, cols, missed = {}, {}, {}, [], []
    listed = {}
    if source_param:
        try:
            listed = wb_codes(source_param)
        except Exception as e:
            print(f"  {id}: could not list database {source_param}: {str(e)[:80]}")
    flat = lambda x: re.sub(r"[^A-Z0-9]", "", x.upper())
    for ind in codes:
        try:
            page, pages, got, label = 1, 1, {}, ""
            real = ind if (not listed or ind in listed) else next((k for k in listed if flat(k).endswith(flat(ind))), ind)
            base = f"https://api.worldbank.org/v2/country/all/indicator/{real}?format=json&per_page=20000"
            try:
                while page <= pages:
                    j = None
                    for q in ([f"&source={source_param}", "&date=1960:2035"] if source_param else ["&date=1960:2035"]):     # databases other than the main one reject a date range
                        j = J(f"{base}{q}&page={page}")
                        if isinstance(j, list) and len(j) >= 2:
                            break
                    if not isinstance(j, list) or len(j) < 2:
                        raise ValueError(str(j)[:120])
                    pages = int(j[0]["pages"])
                    for it in j[1] or []:
                        code = it.get("countryiso3code")
                        if code and it.get("value") is not None:
                            got[(code, int(it["date"]))] = it["value"]
                            names[code] = it["country"]["value"]
                            label = label or it["indicator"]["value"]
                    page += 1
            except Exception:
                if not data360:
                    raise
                got = wb_data360(data360, ind)
                label = (labels or {}).get(ind, ind)
            if len(got) < 50:
                raise ValueError(f"{len(got)} values")
            t, u = relabel(label, ind) if relabel else split_unit(label)
            col = slug(t)
            if col in meta:
                col = slug(t, 40) + "_" + slug(ind.split(".")[-1])
            meta[col] = dict(title=t, unit=u, description=f"World Bank indicator {ind}: {label}.")
            cols.append(col)
            for k, v in got.items():
                cell.setdefault(k, {})[col] = v
        except Exception as e:
            missed.append(f"{ind}: {str(e)[:70]}")
        time.sleep(0.15)
    if missed:
        print(f"  {id}: {len(missed)} of {len(codes)} indicators not loaded:", "; ".join(missed[:8]))
        if listed:
            print(f"  {id}: database {source_param} lists {len(listed)} codes, for example {list(listed)[:14]}")
    assert len(cols) >= max(3, len(codes) // 2), f"{id}: only {len(cols)} of {len(codes)} indicators loaded"
    if not names or len(names) < len({k[0] for k in cell}):
        known = iso()["name"]
        for c in {k[0] for k in cell}:
            names.setdefault(c, known.get(c, c))
    return country_year(id, title, description, domain, source, source_url, "CC BY 4.0", cell, names, meta, cols)


WGI = {"CC": "Control of corruption", "GE": "Government effectiveness", "PV": "Political stability and absence of violence", "RQ": "Regulatory quality", "RL": "Rule of law", "VA": "Voice and accountability"}


def wgi_label(label, ind):
    name = WGI[ind.split(".")[0]]
    if ind.endswith(".EST"):
        return name, "estimate, about -2.5 (weak) to 2.5 (strong)"
    kind = label.split(" - ", 1)[-1].strip() if " - " in label else "governance score, 0 to 100"
    return (f"{name}, score out of 100", "score, 0 (weakest) to 100 (strongest)") if "100" in kind else (f"{name}, {kind[:1].lower() + kind[1:]}", "")


WB_SETS = [
    ("governance-indicators", "Governance: corruption, rule of law, stability and three more",
     "Six measures of how countries are governed, each as an estimate and as a score out of 100, for the years since 1996.",
     "Government and finance", "World Bank, Worldwide Governance Indicators",
     ["CC.EST", "CC.SC", "GE.EST", "GE.SC", "PV.EST", "PV.SC", "RQ.EST", "RQ.SC", "RL.EST", "RL.SC", "VA.EST", "VA.SC"],
     dict(source_param=3, relabel=wgi_label, source_url="https://www.worldbank.org/en/publication/worldwide-governance-indicators", data360="WGI",
          labels={a + b: f"{n}: {k}" for a, n in WGI.items() for b, k in ((".EST", "governance estimate"), (".SC", "governance score, 0 to 100"))})),
    ("health-indicators", "Health: spending, disease, mothers and children, causes of death",
     "Health systems and outcomes by country and year, compiled by the World Bank from the World Health Organization, UNICEF and UN agencies.",
     "Health", "World Bank, World Development Indicators (WHO, UNICEF and UN sources)",
     ["SH.XPD.CHEX.PC.CD", "SH.XPD.OOPC.CH.ZS", "SH.XPD.GHED.GD.ZS", "SH.MED.BEDS.ZS", "SH.MED.NUMW.P3", "SH.IMM.IDPT", "SH.TBS.INCD", "SH.DYN.AIDS.ZS",
      "SH.MLR.INCD.P3", "SH.STA.STNT.ME.ZS", "SH.STA.WAST.ZS", "SH.STA.OWGH.ME.ZS", "SH.ANM.ALLW.ZS", "SH.STA.BRTC.ZS", "SP.ADO.TFRT", "SH.DYN.NMRT",
      "SP.DYN.CDRT.IN", "SP.DYN.CBRT.IN", "SH.DTH.COMM.ZS", "SH.DTH.NCOM.ZS", "SH.DTH.INJR.ZS", "SH.STA.SUIC.P5", "SH.STA.TRAF.P5", "SH.PRV.SMOK",
      "SH.ALC.PCAP.LI", "SH.STA.DIAB.ZS", "SH.DYN.NCOM.ZS", "SH.H2O.SMDW.ZS", "SH.STA.SMSS.ZS", "SH.STA.AIRP.P5",
      "SP.DYN.LE00.FE.IN", "SP.DYN.LE00.MA.IN", "SH.STA.ANVC.ZS", "SP.DYN.CONU.ZS"], {}),
    ("education-indicators", "Education: enrolment, completion, literacy, teachers and learning",
     "Schooling by country and year, compiled by the World Bank from the UNESCO Institute for Statistics.",
     "People and society", "World Bank, World Development Indicators (UNESCO Institute for Statistics)",
     ["SE.PRE.ENRR", "SE.PRM.NENR", "SE.PRM.CMPT.ZS", "SE.SEC.NENR", "SE.SEC.CMPT.LO.ZS", "SE.ADT.1524.LT.ZS", "SE.ADT.LITR.FE.ZS", "SE.ADT.LITR.MA.ZS",
      "SE.PRM.UNER", "SE.PRM.UNER.ZS", "SE.PRM.ENRL.TC.ZS", "SE.SEC.ENRL.TC.ZS", "SE.XPD.TOTL.GB.ZS", "SE.ENR.PRSC.FM.ZS", "SE.ENR.TERT.FM.ZS",
      "SE.COM.DURS", "SE.PRM.TCAQ.ZS", "SE.LPV.PRIM", "SE.TER.CUAT.BA.ZS", "SE.SEC.CUAT.UP.ZS", "HD.HCI.OVRL", "SE.TER.ENRR.FE"], {}),
    ("gender-indicators", "Women and men: work, law, management, marriage and money",
     "How women's lives compare with men's by country and year: work, legal rights, leadership, marriage and access to finance.",
     "People and society", "World Bank, World Development Indicators and Gender Data Portal",
     ["SL.TLF.CACT.MA.ZS", "SL.TLF.CACT.FM.ZS", "SL.EMP.SMGT.FE.ZS", "SP.M18.2024.FE.ZS", "SG.VAW.1549.ZS", "IC.FRM.FEMO.ZS",
      "SL.UEM.TOTL.FE.ZS", "SL.UEM.TOTL.MA.ZS", "FX.OWN.TOTL.FE.ZS", "FX.OWN.TOTL.MA.ZS", "SP.POP.TOTL.FE.ZS", "SL.EMP.WORK.FE.ZS", "SL.EMP.VULN.FE.ZS",
      "SE.SEC.ENRR.FE", "SG.GEN.MNST.ZS"], {}),
    ("poverty-and-inequality", "Poverty and inequality: poverty lines, income shares, shared prosperity",
     "Who is poor and how income is shared, by country and year, from household surveys compiled by the World Bank.",
     "People and society", "World Bank, Poverty and Inequality Platform, via World Development Indicators",
     ["SI.POV.LMIC", "SI.POV.UMIC", "SI.POV.NAHC", "SI.POV.GAPS", "SI.DST.FRST.20", "SI.DST.05TH.20", "SI.DST.10TH.10", "SI.DST.FRST.10",
      "SI.DST.50MD", "SI.POV.SOPO", "EN.POP.SLUM.UR.ZS"], {}),
    ("environment-indicators", "Environment: protected land and sea, water, threatened species, land",
     "Nature and natural resources by country and year, compiled by the World Bank from FAO, the IUCN Red List, AQUASTAT and UN Environment.",
     "Climate and environment", "World Bank, World Development Indicators (FAO, IUCN, AQUASTAT and UN sources)",
     ["ER.PTD.TOTL.ZS", "ER.LND.PTLD.ZS", "ER.MRN.PTMR.ZS", "AG.LND.FRST.K2", "ER.H2O.FWTL.ZS", "ER.H2O.FWTL.K3", "ER.H2O.INTR.PC", "ER.H2O.FWST.ZS",
      "EN.MAM.THRD.NO", "EN.BIR.THRD.NO", "EN.FSH.THRD.NO", "EN.HPT.THRD.NO", "EN.ATM.PM25.MC.ZS", "AG.LND.ARBL.ZS", "AG.LND.ARBL.HA.PC",
      "AG.LND.TOTL.K2", "AG.SRF.TOTL.K2", "NY.GDP.TOTL.RT.ZS", "NY.GDP.FRST.RT.ZS", "AG.LND.EL5M.ZS", "EN.POP.EL5M.ZS", "EG.USE.PCAP.KG.OE",
      "EG.CFT.ACCS.ZS", "EG.ELC.ACCS.RU.ZS", "AG.LND.PRCP.MM", "EN.GHG.ALL.PC.CE.AR5"], {}),
    ("trade-and-finance", "Trade, money and government finance",
     "Trade, debt, reserves, remittances, banking and public finances by country and year.",
     "Economy and development", "World Bank, World Development Indicators (IMF, WTO, UNCTAD and national sources)",
     ["NE.TRD.GNFS.ZS", "TX.VAL.MRCH.CD.WT", "TM.VAL.MRCH.CD.WT", "TG.VAL.TOTL.GD.ZS", "TM.TAX.MRCH.WM.AR.ZS", "BX.TRF.PWKR.DT.GD.ZS", "BX.TRF.PWKR.CD.DT",
      "FI.RES.TOTL.CD", "DT.DOD.DECT.GN.ZS", "GC.DOD.TOTL.GD.ZS", "GC.XPN.TOTL.GD.ZS", "GC.REV.XGRT.GD.ZS", "FS.AST.PRVT.GD.ZS", "CM.MKT.LCAP.GD.ZS",
      "FR.INR.LEND", "FR.INR.RINR", "FB.BNK.CAPA.ZS", "FB.AST.NPER.ZS", "FX.OWN.TOTL.ZS", "FB.CBK.BRCH.P5", "FB.ATM.TOTL.P5", "BX.KLT.DINV.CD.WD",
      "BM.KLT.DINV.WD.GD.ZS", "DT.ODA.ODAT.GN.ZS", "DT.ODA.ODAT.PC.ZS", "NY.GDP.DEFL.KD.ZG", "PA.NUS.PPP", "NY.GDP.MKTP.PP.CD", "NY.GDP.MKTP.KD",
      "NY.GDP.PCAP.KD", "NY.GDP.PCAP.KD.ZG", "NE.CON.PRVT.ZS", "NE.CON.GOVT.ZS", "IC.BUS.NDNS.ZS", "LP.LPI.OVRL.XQ"], {}),
    ("technology-and-transport", "Technology and transport: broadband, patents, research, flights, ports, rail",
     "How connected and inventive countries are, by year: internet and phones, patents and research, air, sea and rail traffic, tourism.",
     "Science and technology", "World Bank, World Development Indicators (ITU, WIPO, UNESCO, ICAO and UN sources)",
     ["IT.NET.BBND.P2", "IT.NET.SECR.P6", "IT.MLT.MAIN.P2", "IP.PAT.RESD", "IP.PAT.NRES", "IP.JRN.ARTC.SC", "SP.POP.SCIE.RD.P6",
      "TX.VAL.TECH.CD", "TX.VAL.ICTG.ZS.UN", "BX.GSR.CCIS.ZS", "IS.AIR.PSGR", "IS.AIR.DPRT", "IS.AIR.GOOD.MT.K1", "IS.SHP.GOOD.TU", "IS.RRS.TOTL.KM",
      "IS.RRS.PASG.KM", "ST.INT.RCPT.CD", "ST.INT.DPRT"], {}),
    ("labour-indicators", "Work: employment, youth out of work, sectors and kinds of jobs",
     "Jobs by country and year: who works, in which sector and on what terms, from International Labour Organization estimates compiled by the World Bank.",
     "People and society", "World Bank, World Development Indicators (International Labour Organization, ILOSTAT)",
     ["SL.EMP.TOTL.SP.ZS", "SL.TLF.CACT.ZS", "SL.UEM.1524.ZS", "SL.UEM.NEET.ZS", "SL.AGR.EMPL.ZS", "SL.IND.EMPL.ZS", "SL.SRV.EMPL.ZS", "SL.EMP.SELF.ZS",
      "SL.EMP.WORK.ZS", "SL.EMP.VULN.ZS", "SL.TLF.TOTL.IN", "SL.GDP.PCAP.EM.KD", "SL.TLF.0714.ZS", "SL.UEM.ADVN.ZS", "SL.TLF.PART.ZS", "SL.EMP.MPYR.ZS"], {}),
    ("food-and-agriculture", "Food and farming: yields, production, fisheries, hunger",
     "Farming and food by country and year, compiled by the World Bank from the Food and Agriculture Organization (FAOSTAT).",
     "Economy and development", "World Bank, World Development Indicators (Food and Agriculture Organization, FAOSTAT)",
     ["AG.YLD.CREL.KG", "AG.PRD.CREL.MT", "AG.PRD.FOOD.XD", "AG.PRD.CROP.XD", "AG.PRD.LVSK.XD", "AG.CON.FERT.ZS", "ER.FSH.PROD.MT", "ER.FSH.AQUA.MT",
      "ER.FSH.CAPT.MT", "AG.LND.IRIG.AG.ZS", "AG.LND.CREL.HA", "SN.ITK.SVFI.ZS", "SN.ITK.MSFI.ZS", "NV.AGR.EMPL.KD", "TM.VAL.FOOD.ZS.UN",
      "TX.VAL.FOOD.ZS.UN", "SP.RUR.TOTL.ZS", "SP.RUR.TOTL"], {}),
]


# ---------- IMF World Economic Outlook ----------
IMF = [  # code, column, title, unit, multiply by
    ("NGDP_RPCH", "real_gdp_growth", "Real GDP growth (IMF)", "% per year", 1),
    ("NGDPD", "gdp", "GDP, current prices (IMF)", "current US$", 1e9),
    ("NGDPDPC", "gdp_per_person", "GDP per person, current prices (IMF)", "current US$", 1),
    ("PPPPC", "gdp_per_person_ppp", "GDP per person, purchasing power parity (IMF)", "current international $", 1),
    ("PPPSH", "share_of_world_gdp", "Share of world GDP, purchasing power parity (IMF)", "% of world GDP", 1),
    ("PCPIPCH", "inflation", "Inflation, average consumer prices (IMF)", "% per year", 1),
    ("PCPIEPCH", "inflation_end_of_year", "Inflation, end of year (IMF)", "% per year", 1),
    ("LUR", "unemployment_rate", "Unemployment rate (IMF)", "% of labor force", 1),
    ("LP", "population", "Population (IMF)", "people", 1e6),
    ("BCA_NGDPD", "current_account_balance", "Current account balance (IMF)", "% of GDP", 1),
    ("GGXWDG_NGDP", "government_debt", "Government gross debt (IMF)", "% of GDP", 1),
    ("GGXCNL_NGDP", "government_balance", "Government net lending or borrowing (IMF)", "% of GDP", 1),
    ("GGR_NGDP", "government_revenue", "Government revenue (IMF)", "% of GDP", 1),
    ("GGX_NGDP", "government_spending", "Government spending (IMF)", "% of GDP", 1),
]


def imf():
    base = "https://www.imf.org/external/datamapper/api/v1/"
    names = {}
    for kind in ("countries", "regions", "groups"):
        try:
            for code, v in (J(base + kind).get(kind) or {}).items():
                if v.get("label"):
                    names[code] = v["label"]
        except Exception as e:
            print("  imf labels", kind, str(e)[:60])
        time.sleep(0.5)
    assert len(names) > 150, "IMF country list not loaded"
    alias = {"WEOWORLD": "WLD", "UVK": "XKX", "WBG": "PSE"}
    past, future, loaded = {}, {}, []
    for code, col, title, unit, k in IMF:
        try:
            vals = J(base + code)["values"][code]
            n = 0
            for c, by in vals.items():
                if c not in names:
                    continue
                for y, v in by.items():
                    if v is None:
                        continue
                    (past if int(y) <= THIS_YEAR else future).setdefault((alias.get(c, c), int(y)), {})[col] = v * k
                    n += 1
            if n < 500:
                raise ValueError(f"{n} values")
            loaded.append(col)
        except Exception as e:
            print(f"  imf {code}: {str(e)[:70]}")
        time.sleep(0.5)
    assert len(loaded) >= 6, f"only {len(loaded)} IMF indicators loaded"
    names = {alias.get(c, c): n for c, n in names.items()}
    names["WLD"] = "World"
    meta = {col: dict(title=title, unit=unit, description=f"IMF World Economic Outlook series {code}. Recent years are IMF estimates.") for code, col, title, unit, _ in IMF}
    url, src = "https://www.imf.org/external/datamapper/datasets/WEO", "International Monetary Fund, World Economic Outlook"
    lic = "Free to use with attribution (IMF copyright and usage terms)"
    out = [country_year("imf-world-economic-outlook", "IMF World Economic Outlook: growth, inflation, debt, jobs",
                        "The IMF's own figures for every economy, from 1980 to this year. The latest years are estimates.",
                        "Economy and development", src, url, lic, past, names, meta, loaded)]
    if future:
        fmeta = {c: dict(title=m["title"].replace(" (IMF)", ", IMF projection"), unit=m["unit"], description=m["description"].replace("Recent years are IMF estimates.", "These are projections, not measurements.")) for c, m in meta.items()}
        out.append(country_year("imf-projections", "IMF projections for the next five years",
                                "What the IMF expects for growth, inflation, debt and jobs in each economy over the coming years. Projections, not measurements.",
                                "Economy and development", src, url, lic, future, names, fmeta, loaded, min_rows=100))
    return out


# ---------- United Nations: population estimates and projections ----------
WPP = [  # column in the UN file, our column, title, unit, multiply by
    ("TPopulation1July", "population", "Population (UN)", "people", 1000), ("PopDensity", "population_density", "Population density (UN)", "people per km²", 1),
    ("MedianAgePop", "median_age", "Median age", "years", 1), ("PopGrowthRate", "population_growth_rate", "Population growth rate (UN)", "% per year", 1),
    ("TFR", "total_fertility_rate", "Total fertility rate (UN)", "births per woman", 1), ("CBR", "birth_rate", "Birth rate (UN)", "births per 1,000 people", 1),
    ("CDR", "death_rate", "Death rate (UN)", "deaths per 1,000 people", 1), ("LEx", "life_expectancy", "Life expectancy at birth (UN)", "years", 1),
    ("LExMale", "life_expectancy_men", "Life expectancy at birth, men (UN)", "years", 1), ("LExFemale", "life_expectancy_women", "Life expectancy at birth, women (UN)", "years", 1),
    ("IMR", "infant_mortality_rate", "Infant mortality rate (UN)", "deaths per 1,000 live births", 1), ("Q5", "under_5_mortality_rate", "Under-five mortality rate (UN)", "deaths per 1,000 live births", 1),
    ("Births", "births", "Births in the year", "births", 1000), ("Deaths", "deaths", "Deaths in the year", "deaths", 1000),
    ("NetMigrations", "net_migration", "Net migration in the year (UN)", "people", 1000), ("CNMR", "net_migration_rate", "Net migration rate", "per 1,000 people", 1),
    ("PopSexRatio", "sex_ratio", "Sex ratio", "men per 100 women", 1), ("NatChangeRT", "natural_change_rate", "Rate of natural change", "per 1,000 people", 1),
]


def un_population():
    urls = ["https://population.un.org/wpp/assets/Excel%20Files/1_Indicator%20(Standard)/CSV_FILES/WPP2024_Demographic_Indicators_Medium.csv.gz",
            "https://population.un.org/wpp/Download/Files/1_Indicator%20(Standard)/CSV_FILES/WPP2024_Demographic_Indicators_Medium.csv.gz"]
    raw, err = None, ""
    for u in urls:
        try:
            raw = fetch(u, timeout=300)
            break
        except Exception as e:
            err = str(e)[:80]
    assert raw, "UN population file not reachable: " + err
    if raw[:2] == b"\x1f\x8b":
        raw = gzip.decompress(raw)
    past, future, names = {}, {}, {}
    for r in csv.DictReader(io.StringIO(raw.decode("utf-8-sig", "replace"))):
        code = r.get("ISO3_code") or ("WLD" if r.get("Location") == "World" else "")
        if not code or not r.get("Time", "").isdigit():
            continue
        y = int(r["Time"])
        names[code] = r["Location"]
        row = {col: float(r[f]) * k for f, col, _, _, k in WPP if r.get(f) not in ("", None)}
        if row:
            (past if y <= THIS_YEAR else future)[(code, y)] = row
    cols = [c for _, c, _, _, _ in WPP]
    meta = {c: dict(title=t, unit=u, description=f"UN World Population Prospects 2024, medium variant, column {f}. Figures up to 2023 are estimates; later years are projections.") for f, c, t, u, _ in WPP}
    src, url, lic = "United Nations, World Population Prospects 2024", "https://population.un.org/wpp/", "CC BY 3.0 IGO"
    out = [country_year("un-population", "Population, births, deaths and migration since 1950 (UN)",
                        "The United Nations' demographic figures for every country: population, age, fertility, life expectancy, deaths and migration.",
                        "People and society", src, url, lic, past, names, meta, cols)]
    if future:
        fmeta = {c: dict(title=m["title"].replace(" (UN)", "") + ", UN projection", unit=m["unit"], description="UN World Population Prospects 2024, medium-variant projection. A projection, not a measurement.") for c, m in meta.items()}
        out.append(country_year("un-population-projections", "Population projections to 2100 (UN)",
                                "Where the United Nations expects each country's population, ageing, births and life expectancy to go by 2100, in its medium scenario.",
                                "People and society", src, url, lic, future, names, fmeta, cols))
    return out


# ---------- UNDP: Human Development Index ----------
HDR = [("hdi", "human_development_index", "Human Development Index", "index, 0 to 1"), ("eys", "expected_years_of_schooling", "Expected years of schooling", "years"),
       ("mys", "mean_years_of_schooling", "Mean years of schooling", "years"), ("gnipc", "gni_per_person_ppp", "Gross national income per person (UNDP)", "2021 PPP $"),
       ("ihdi", "inequality_adjusted_hdi", "Inequality-adjusted Human Development Index", "index, 0 to 1"), ("gii", "gender_inequality_index", "Gender Inequality Index", "index, 0 (equal) to 1"),
       ("gdi", "gender_development_index", "Gender Development Index", "ratio of women's HDI to men's"), ("phdi", "planetary_pressures_adjusted_hdi", "Planetary pressures-adjusted Human Development Index", "index, 0 to 1"),
       ("mf", "material_footprint_per_person", "Material footprint per person", "tonnes")]


def undp():
    urls = [f"https://hdr.undp.org/sites/default/files/{y}_HDR/HDR{str(y)[2:]}_Composite_indices_complete_time_series.csv" for y in (THIS_YEAR, THIS_YEAR - 1)] + \
           ["https://hdr.undp.org/sites/default/files/2025_HDR/HDR25_Composite_indices_complete_time_series.csv",
            "https://hdr.undp.org/sites/default/files/2023-24_HDR/HDR23-24_Composite_indices_complete_time_series.csv"]
    raw, err = None, ""
    for u in dict.fromkeys(urls):
        try:
            raw = fetch(u, tries=1).decode("utf-8-sig", "replace")
            if "iso3" in raw[:300].lower():
                break
            raw = None
        except Exception as e:
            err = str(e)[:80]
    assert raw, "UNDP file not reachable: " + err
    cell, names, want = {}, {}, {p: c for p, c, _, _ in HDR}
    for r in csv.DictReader(io.StringIO(raw)):
        code = (r.get("iso3") or "").strip()
        if not code or code.startswith("ZZ"):
            continue
        names[code] = r.get("country", code).strip()
        for k, v in r.items():
            m = re.fullmatch(r"([a-z_0-9]+?)_(\d{4})", k or "")
            if m and m.group(1) in want and v not in ("", None):
                try:
                    cell.setdefault((code, int(m.group(2))), {})[want[m.group(1)]] = float(v)
                except ValueError:
                    pass
    meta = {c: dict(title=t, unit=u, description=f"UNDP Human Development Report, series {p}.") for p, c, t, u in HDR}
    return country_year("human-development-index", "Human Development Index and its parts (UNDP)",
                        "The UN's measure of how well people live: health, schooling and income in one index, with versions adjusted for inequality, gender and pressure on the planet.",
                        "People and society", "United Nations Development Programme, Human Development Report", "https://hdr.undp.org/data-center", "CC BY 3.0 IGO",
                        cell, names, meta, [c for _, c, _, _ in HDR])


# ---------- WHO Global Health Observatory ----------
GHO = {  # WHO indicator code: (column, title, unit)
    "WHOSIS_000002": ("healthy_life_expectancy", "Healthy life expectancy at birth (WHO)", "years"), "WHOSIS_000015": ("life_expectancy_at_60", "Life expectancy at age 60 (WHO)", "years"),
    "NCD_BMI_30A": ("adults_with_obesity", "Adults with obesity (WHO)", "% of adults"), "NCD_BMI_25A": ("adults_overweight", "Adults who are overweight (WHO)", "% of adults"),
    "BP_04": ("adults_with_raised_blood_pressure", "Adults with raised blood pressure (WHO)", "% of adults"), "NCD_PAA": ("adults_not_active_enough", "Adults who are not physically active enough (WHO)", "% of adults"),
    "HWF_0001": ("medical_doctors", "Medical doctors (WHO)", "per 10,000 people"), "HWF_0006": ("nurses_and_midwives", "Nurses and midwives (WHO)", "per 10,000 people"),
    "HWF_0010": ("dentists", "Dentists (WHO)", "per 10,000 people"), "HWF_0014": ("pharmacists", "Pharmacists (WHO)", "per 10,000 people"),
    "SA_0000001688": ("alcohol_per_adult", "Alcohol consumed per adult in a year (WHO)", "litres of pure alcohol"), "M_Est_tob_curr_std": ("adults_using_tobacco", "Adults who use tobacco (WHO)", "% of adults"),
    "MH_12": ("suicide_rate", "Suicide rate (WHO)", "per 100,000 people"), "RS_198": ("road_traffic_death_rate", "Road traffic death rate (WHO)", "per 100,000 people"),
}


def who():
    base, cell, names, meta, cols = "https://ghoapi.azureedge.net/api/", {}, {}, {}, []
    for code, (col, title, unit) in GHO.items():
        try:
            rows = J(base + code + "?$filter=" + urllib.parse.quote("SpatialDimType eq 'COUNTRY'"))["value"]
            both = [r for r in rows if r.get("NumericValue") is not None and (r.get("Dim1") in (None, "", "SEX_BTSX", "BTSX")) and str(r.get("TimeDim", "")).isdigit() and int(r["TimeDim"]) <= THIS_YEAR]
            got = {}
            for r in both:
                got.setdefault((r["SpatialDim"], int(r["TimeDim"])), []).append(r["NumericValue"])
            clean = {k: v[0] for k, v in got.items() if len(v) == 1}
            if len(clean) < 200 or len(clean) < 0.95 * len(got):   # more than one figure for a country and year: the series has breakdowns we cannot pick from safely
                raise ValueError(f"{len(clean)} single values of {len(got)}")
            label = J(base + "Indicator?$filter=" + urllib.parse.quote(f"IndicatorCode eq '{code}'"))["value"][0]["IndicatorName"]
            meta[col] = dict(title=title, unit=unit, description=f"WHO Global Health Observatory indicator {code}: {label}. Both sexes; rates for adults are age-standardized where WHO publishes them that way.")
            cols.append(col)
            for k, v in clean.items():
                cell.setdefault(k, {})[col] = v
        except Exception as e:
            print(f"  who {code}: {str(e)[:80]}")
        time.sleep(0.4)
    assert len(cols) >= 4, f"only {len(cols)} WHO indicators loaded"
    nm = iso()["name"]
    for c, _ in cell:
        names[c] = nm.get(c, c)
    return country_year("who-health-observatory", "WHO health observatory: healthy life, obesity, blood pressure, health workers",
                        "Health measures published by the World Health Organization itself, by country and year.",
                        "Health", "World Health Organization, Global Health Observatory", "https://www.who.int/data/gho", "CC BY-NC-SA 3.0 IGO", cell, names, meta, cols)


# ---------- Our World in Data charts: many original sources, already harmonised by country and year ----------
# What Our World in Data calls a column -> (our column, a title that stands on its own, unit). An empty unit keeps theirs.
OWID_NAMES = {
    "electoral_democracy_index": ("electoral_democracy_index", "Electoral democracy index (V-Dem)", "index, 0 (least democratic) to 1 (most)"),
    "liberal_democracy_index": ("liberal_democracy_index", "Liberal democracy index (V-Dem)", "index, 0 (least democratic) to 1 (most)"),
    "human_rights_index": ("human_rights_index", "Human rights index (V-Dem)", "index, 0 (least protected) to 1 (most)"),
    "rule_of_law_index": ("rule_of_law_index", "Rule of law index (V-Dem)", "index, 0 (weakest) to 1 (strongest)"),
    "women_s_political_empowerment_index": ("womens_political_empowerment_index", "Women's political empowerment index (V-Dem)", "index, 0 (least) to 1 (most)"),
    "press_freedom_index": ("press_freedom_index", "Press freedom index (Reporters Without Borders)", "score, 0 to 100 (most free)"),
    "corruption_perceptions_index_cpi": ("corruption_perceptions_index", "Corruption Perceptions Index (Transparency International)", "score, 0 (highly corrupt) to 100 (very clean)"),
    "military_expenditure": ("military_spending", "Military spending", ""),
    "number_of_nuclear_warheads": ("nuclear_warheads", "Nuclear warheads", "warheads"),
    "homicide_rate_per_100_000_population": ("homicide_rate", "Homicide rate", "homicides per 100,000 people"),
    "fatalities": ("terrorism_deaths", "Deaths from terrorist attacks", "deaths"),
    "attacks": ("terrorist_attacks", "Terrorist attacks", "attacks"),
    "refugees_by_country_of_origin": ("refugees_by_origin", "Refugees, by the country they fled", "people"),
    "refugees_by_country_of_asylum": ("refugees_hosted", "Refugees, by the country hosting them", "people"),
    "agriculture": ("ghg_agriculture", "Greenhouse gas emissions from agriculture", "tonnes of CO2 equivalent"),
    "land_use_change_and_forestry": ("ghg_land_use_change_and_forestry", "Greenhouse gas emissions from land-use change and forestry", "tonnes of CO2 equivalent"),
    "waste": ("ghg_waste", "Greenhouse gas emissions from waste", "tonnes of CO2 equivalent"),
    "buildings": ("ghg_buildings", "Greenhouse gas emissions from buildings", "tonnes of CO2 equivalent"),
    "industry": ("ghg_industry", "Greenhouse gas emissions from industry", "tonnes of CO2 equivalent"),
    "manufacturing_and_construction": ("ghg_manufacturing_and_construction", "Greenhouse gas emissions from manufacturing and construction", "tonnes of CO2 equivalent"),
    "transport": ("ghg_transport", "Greenhouse gas emissions from transport", "tonnes of CO2 equivalent"),
    "electricity_and_heat": ("ghg_electricity_and_heat", "Greenhouse gas emissions from electricity and heat", "tonnes of CO2 equivalent"),
    "fugitive_emissions": ("ghg_fugitive", "Greenhouse gas emissions from leaks (fugitive emissions)", "tonnes of CO2 equivalent"),
    "other_fuel_combustion": ("ghg_other_fuel_combustion", "Greenhouse gas emissions from other fuel burning", "tonnes of CO2 equivalent"),
    "aviation_and_shipping": ("ghg_aviation_and_shipping", "Greenhouse gas emissions from aviation and shipping", "tonnes of CO2 equivalent"),
    "self_reported_life_satisfaction": ("life_satisfaction", "Life satisfaction (happiness score)", "score, 0 (worst possible life) to 10 (best)"),
    "working_hours_per_worker": ("working_hours_per_worker", "Working hours per worker in a year", "hours a year"),
    "total": ("tree_cover_loss", "Tree cover loss", "hectares"),
    "red_list_index": ("red_list_index", "Red List Index (survival of species)", "index, 1 (no species threatened) to 0 (all extinct)"),
    "total_deaths_from_natural_disasters_among_both_sexes": ("deaths_from_natural_disasters", "Deaths from natural disasters", "deaths"),
    "yearly_per_capita_supply_of_all_meat": ("meat_supply_per_person", "Meat supply per person", "kilograms a year"),
    "share_richest_1_pct_before_tax": ("income_share_top_1_pct", "Share of income going to the richest 1% (before tax)", "% of all income"),
    "share_richest_decile_before_tax": ("income_share_top_10_pct", "Share of income going to the richest 10% (before tax)", "% of all income"),
    "best_estimate": ("deaths_in_armed_conflicts", "Deaths in armed conflicts (best estimate)", "deaths"),
    "total_solar_capacity": ("solar_capacity", "Solar power capacity installed", "gigawatts"), "total_wind_capacity": ("wind_capacity", "Wind power capacity installed", "gigawatts"),
    "annual_number_of_objects_launched_into_outer_space": ("objects_launched_into_space", "Objects launched into space in the year", "objects"),
    "ai_scholarly_publications_field_all": ("ai_research_papers", "Research papers on artificial intelligence", "publications"),
}


OWID_TIDY = [  # (what their title looks like, our column prefix, our title, unit)
    (r"Annual number of people affected by (.+)$", "people_affected_by_", "People affected by {}", "people"),
    (r"Annual rate of deaths from (.+)$", "death_rate_from_", "Death rate from {}", "deaths per 100,000 people"),
    (r"Annual number of people left homeless by (.+)$", "people_left_homeless_by_", "People left homeless by {}", "people"),
    (r"Annual economic damages as a share of GDP from (.+)$", "damage_share_of_gdp_from_", "Economic damage from {}, share of GDP", "% of GDP"),
]
MAIN_HAZARDS = r"all natural disasters|floods|storms|droughts|earthquakes|extreme temperatures|wildfires"
OWID_KEEP = {"conflict-and-security": lambda t: t not in ("High estimate", "Low estimate"),
             "natural-disasters": lambda t: t == "Deaths from natural disasters" or re.search(r"^(People affected by|Death rate from) (" + MAIN_HAZARDS + ")$", t) or "all natural disasters" in t}


def owid_charts(id, title, description, domain, source, slugs, licence="CC BY 4.0 (Our World in Data; original sources named per variable)"):
    cell, names, meta, cols = {}, {}, {}, []
    q = "?v=1&csvType=full&useColumnShortNames=true"
    for s in slugs:
        try:
            rows = [{k.lower() if k.lower() in ("entity", "code", "year") else k: v for k, v in r.items()} for r in csv.DictReader(io.StringIO(text(f"https://ourworldindata.org/grapher/{s}.csv{q}")))]
            info = J(f"https://ourworldindata.org/grapher/{s}.metadata.json{q}").get("columns", {})
            fields = [c for c in rows[0] if c not in ("entity", "code", "year", "owid_region")]
            for f in fields:
                m = info.get(f, {})
                vals = {}
                for r in rows:
                    if r[f] in ("", None) or not str(r["year"]).lstrip("-").isdigit():
                        continue
                    try:
                        v = float(r[f])
                    except ValueError:
                        continue
                    code = {"OWID_WRL": "WLD", "OWID_KOS": "XKX"}.get(r["code"], r["code"]) or "OWID_" + re.sub(r"[^A-Z0-9]+", "_", r["entity"].upper()).strip("_")
                    vals[(code, int(r["year"]))] = v
                    names[code] = r["entity"]
                if len(vals) < 100:
                    continue
                t = m.get("titleShort") or m.get("titleLong") or f.replace("_", " ").capitalize()
                col, unit = slug(t), m.get("unit") or m.get("shortUnit") or ""
                if col in OWID_NAMES:
                    col, t, u = OWID_NAMES[col]
                    unit = u or unit
                for pattern, c2, t2, u2 in OWID_TIDY:
                    hit = re.match(pattern, t)
                    if hit:
                        what = hit.group(1).replace("all disasters", "all natural disasters")
                        col, t, unit = c2 + slug(what), t2.format(what), u2 or unit
                        break
                if id in OWID_KEEP and not OWID_KEEP[id](t):
                    continue
                n = 2
                while col in meta:
                    col, n = f"{slug(t, 44)}_{n}", n + 1
                cite = m.get("citationShort") or ""
                meta[col] = dict(title=t, unit=unit, description=((m.get("descriptionShort") or "") + (f" Source: {cite}." if cite else "") + f" Our World in Data chart: {s}.").strip())
                cols.append(col)
                for k, v in vals.items():
                    if 1750 <= k[1] <= THIS_YEAR:
                        cell.setdefault(k, {})[col] = v
        except Exception as e:
            print(f"  owid {s}: {str(e)[:80]}")
        time.sleep(0.5)
    assert cols, f"{id}: no chart loaded"
    return country_year(id, title, description, domain, source, "https://ourworldindata.org", licence, cell, names, meta, cols, min_rows=100)


def owid_probe(slugs):
    """Print which Our World in Data charts exist and what they hold. Used when choosing charts; not part of a normal run."""
    q = "?v=1&csvType=full&useColumnShortNames=true"
    for s in slugs:
        try:
            rows = list(csv.DictReader(io.StringIO(text(f"https://ourworldindata.org/grapher/{s}.csv{q}", tries=1))))
            info = J(f"https://ourworldindata.org/grapher/{s}.metadata.json{q}", tries=1).get("columns", {})
            print(f"OWID head {s}: {list(rows[0])[:8]}")
            E, Y = ("Entity", "Year") if "Entity" in rows[0] else ("entity", "year")
            fields = [c for c in rows[0] if c.lower() not in ("entity", "code", "year")]
            ents, yrs = {r[E] for r in rows}, [int(r[Y]) for r in rows if str(r[Y]).lstrip("-").isdigit()]
            print(f"OWID ok   {s}: {len(rows)} rows, {len(ents)} entities, {min(yrs)}-{max(yrs)}")
            for f in fields[:14]:
                m = info.get(f, {})
                print(f"       {f} | {m.get('titleShort') or m.get('titleLong')} | unit={m.get('unit')!r} | {str(m.get('citationShort'))[:70]}")
        except Exception as e:
            print(f"OWID FAIL {s}: {str(e)[:60]}")
        time.sleep(0.4)


# ---------- Penn World Table ----------
PWT = [("rgdpe", "real_gdp_expenditure_side", "Real GDP, expenditure side (Penn World Table)", "2017 US$, PPP", 1e6), ("rgdpo", "real_gdp_output_side", "Real GDP, output side (Penn World Table)", "2017 US$, PPP", 1e6),
       ("pop", "population", "Population (Penn World Table)", "people", 1e6), ("emp", "people_employed", "People in work", "people", 1e6), ("avh", "hours_worked_per_worker", "Hours worked per worker in a year", "hours", 1),
       ("hc", "human_capital_index", "Human capital index", "index (years of schooling and returns to education)", 1), ("ctfp", "productivity_level_vs_usa", "Productivity level compared with the United States", "USA = 1", 1),
       ("rtfpna", "productivity_index", "Total factor productivity", "index, 2017 = 1", 1), ("labsh", "labour_share_of_income", "Share of national income going to labour", "share, 0 to 1", 1),
       ("csh_c", "household_consumption_share", "Household consumption as a share of GDP", "share, 0 to 1", 1), ("csh_i", "investment_share", "Investment as a share of GDP", "share, 0 to 1", 1),
       ("csh_g", "government_consumption_share", "Government consumption as a share of GDP", "share, 0 to 1", 1), ("xr", "exchange_rate", "Exchange rate (Penn World Table)", "national currency per US$", 1),
       ("pl_gdpo", "price_level", "Price level of GDP", "USA in 2017 = 1", 1)]


def pwt():
    import openpyxl
    raw, err = None, ""
    for u in ("https://www.rug.nl/ggdc/docs/pwt1001.xlsx", "https://dataverse.nl/api/access/datafile/354095"):
        try:
            raw = fetch(u, tries=2, timeout=300)
            if raw[:2] == b"PK":
                break
            raw = None
        except Exception as e:
            err = str(e)[:80]
    assert raw, "Penn World Table file not reachable: " + err
    ws = openpyxl.load_workbook(io.BytesIO(raw), read_only=True, data_only=True)["Data"]
    it = ws.iter_rows(values_only=True)
    h = [str(c) for c in next(it)]
    i = {c: k for k, c in enumerate(h)}
    cell, names = {}, {}
    for r in it:
        if not r or not r[i["countrycode"]] or r[i["year"]] is None:
            continue
        code, y = r[i["countrycode"]], int(r[i["year"]])
        names[code] = r[i["country"]]
        row = {col: float(r[i[f]]) * k for f, col, _, _, k in PWT if f in i and isinstance(r[i[f]], (int, float))}
        if row:
            cell[(code, y)] = row
    meta = {c: dict(title=t, unit=u, description=f"Penn World Table 10.01, variable {f}.") for f, c, t, u, _ in PWT}
    return country_year("penn-world-table", "Penn World Table: real GDP, productivity, hours worked, human capital",
                        "The economists' standard table for comparing living standards and productivity across countries and decades, 1950 to 2019.",
                        "Economy and development", "Groningen Growth and Development Centre, Penn World Table 10.01", "https://www.rug.nl/ggdc/productivity/pwt/", "CC BY 4.0",
                        cell, names, meta, [c for _, c, _, _, _ in PWT])


# ---------- US economy, from the agencies' own series as carried by FRED ----------
def fred(sid):
    out = {}
    for r in csv.reader(io.StringIO(text(f"https://fred.stlouisfed.org/graph/fredgraph.csv?id={sid}"))):
        if len(r) >= 2 and re.fullmatch(r"\d{4}-\d{2}-\d{2}", r[0]) and r[1] not in ("", "."):
            try:
                out[r[0]] = float(r[1])
            except ValueError:
                pass
    if len(out) < 20:
        raise ValueError(f"{sid}: {len(out)} values")
    time.sleep(0.4)
    return out


def yoy(s, months=12):
    """Percent change from the same month a year earlier."""
    out = {}
    for d, v in s.items():
        y, m = int(d[:4]), int(d[5:7])
        p = s.get(f"{y - 1}{d[4:]}") if months == 12 else None
        if p:
            out[d] = (v / p - 1) * 100
    return out


FRED_MONTHLY = [  # FRED id, column, title, unit, multiply by, agency
    ("UNRATE", "unemployment_rate", "US unemployment rate", "% of labor force", 1, "BLS"), ("CIVPART", "labor_force_participation", "US labor force participation rate", "% of people 16 and over", 1, "BLS"),
    ("PAYEMS", "nonfarm_payrolls", "US jobs (nonfarm payrolls)", "jobs", 1000, "BLS"), ("JTSJOL", "job_openings", "US job openings", "openings", 1000, "BLS"),
    ("AHETPI", "average_hourly_earnings", "US average hourly earnings, production workers", "US$ per hour", 1, "BLS"), ("CPIAUCSL", "consumer_price_index", "US consumer price index", "index, 1982-84 = 100", 1, "BLS"),
    ("CPILFESL", "core_consumer_price_index", "US consumer price index without food and energy", "index, 1982-84 = 100", 1, "BLS"), ("PPIACO", "producer_price_index", "US producer price index, all commodities", "index, 1982 = 100", 1, "BLS"),
    ("PCEPI", "pce_price_index", "US personal consumption price index", "index, 2017 = 100", 1, "BEA"), ("PSAVERT", "personal_saving_rate", "US personal saving rate", "% of disposable income", 1, "BEA"),
    ("DSPIC96", "real_disposable_income", "US real disposable personal income", "2017 US$ a year", 1e9, "BEA"), ("TOTALSA", "vehicle_sales", "US vehicle sales", "vehicles a year, annual rate", 1e6, "BEA"),
    ("FEDFUNDS", "federal_funds_rate", "US federal funds rate", "% a year", 1, "Federal Reserve"), ("GS10", "treasury_10_year_yield", "US 10-year Treasury yield, monthly", "% a year", 1, "Federal Reserve"),
    ("GS2", "treasury_2_year_yield", "US 2-year Treasury yield, monthly", "% a year", 1, "Federal Reserve"), ("INDPRO", "industrial_production", "US industrial production", "index, 2017 = 100", 1, "Federal Reserve"),
    ("M2SL", "money_supply_m2", "US money supply (M2)", "current US$", 1e9, "Federal Reserve"), ("RSAFS", "retail_sales", "US retail and food services sales", "current US$ a month", 1e6, "Census Bureau"),
    ("HOUST", "housing_starts", "US housing starts", "homes a year, annual rate", 1000, "Census Bureau"), ("PERMIT", "building_permits", "US building permits for new homes", "homes a year, annual rate", 1000, "Census Bureau"),
    ("BOPGSTB", "trade_balance", "US trade balance in goods and services", "current US$ a month", 1e6, "Census Bureau and BEA"), ("HPIPONM226S", "house_price_index", "US house price index, purchases only (FHFA)", "index, January 1991 = 100", 1, "FHFA"),
]
FRED_QUARTERLY = [
    ("GDPC1", "real_gdp", "US real GDP", "2017 US$ a year, annual rate", 1e9, "BEA"), ("GDP", "gdp", "US GDP, current dollars", "current US$ a year, annual rate", 1e9, "BEA"),
    ("A191RL1Q225SBEA", "real_gdp_growth", "US real GDP growth, quarterly at an annual rate", "% a year", 1, "BEA"), ("A939RX0Q048SBEA", "real_gdp_per_person", "US real GDP per person", "2017 US$ a year", 1, "BEA"),
    ("GFDEGDQ188S", "federal_debt_share_of_gdp", "US federal debt as a share of GDP", "% of GDP", 1, "Office of Management and Budget"), ("USSTHPI", "house_price_index_all_transactions", "US house price index, all transactions (FHFA)", "index, 1980 Q1 = 100", 1, "FHFA"),
    ("CP", "corporate_profits_after_tax", "US corporate profits after tax", "current US$ a year, annual rate", 1e9, "BEA"), ("MSPUS", "median_home_sale_price", "US median sale price of houses sold", "current US$", 1, "Census Bureau and HUD"),
]
FRED_DAILY = [
    ("DFF", "federal_funds_rate_daily", "US federal funds rate, daily", "% a year", 1, "Federal Reserve"), ("DGS2", "treasury_2_year", "US 2-year Treasury yield", "% a year", 1, "Federal Reserve"),
    ("DGS10", "treasury_10_year", "US 10-year Treasury yield", "% a year", 1, "Federal Reserve"), ("DGS30", "treasury_30_year", "US 30-year Treasury yield", "% a year", 1, "Federal Reserve"),
    ("T10Y2Y", "yield_curve_10_year_minus_2_year", "US yield curve: 10-year minus 2-year Treasury yield", "percentage points", 1, "Federal Reserve"), ("T10YIE", "expected_inflation_10_year", "US expected inflation over 10 years (breakeven rate)", "% a year", 1, "Federal Reserve"),
    ("DEXUSEU", "dollars_per_euro", "US dollars per euro", "US$ per euro", 1, "Federal Reserve"), ("DEXINUS", "rupees_per_dollar", "Indian rupees per US dollar", "rupees per US$", 1, "Federal Reserve"),
    ("DEXCHUS", "yuan_per_dollar", "Chinese yuan per US dollar", "yuan per US$", 1, "Federal Reserve"), ("DEXJPUS", "yen_per_dollar", "Japanese yen per US dollar", "yen per US$", 1, "Federal Reserve"),
]


def fred_set(id, title, description, spec_list, step, derived=()):
    cell, meta, cols, missed = {}, {}, [], []
    for sid, col, t, u, k, agency in spec_list:
        try:
            s = fred(sid)
            for d, v in s.items():
                cell.setdefault(d, {})[col] = v * k
            meta[col] = dict(title=t, unit=u, description=f"Published by {agency}; FRED series {sid}.")
            cols.append(col)
            for src, dcol, dt in derived:
                if src == sid:
                    for d, v in yoy(s).items():
                        cell.setdefault(d, {})[dcol] = v
                    meta[dcol] = dict(title=dt, unit="% a year", description=f"Change in FRED series {sid} from the same month a year earlier, worked out here.")
                    cols.append(dcol)
        except Exception as e:
            missed.append(f"{sid}: {str(e)[:60]}")
    if missed:
        print(f"  {id}: not loaded:", "; ".join(missed[:6]))
    assert len(cols) >= len(spec_list) // 2, f"{id}: only {len(cols)} series loaded"
    return series(id, title, description, "US", "Economy and development",
                  "US Bureau of Labor Statistics, Bureau of Economic Analysis, Census Bureau, Federal Reserve and FHFA, via FRED", "https://fred.stlouisfed.org",
                  PD + ", retrieved from FRED, Federal Reserve Bank of St. Louis", cell, meta, cols, step)


def us_monthly():
    return fred_set("us-economy-monthly", "US economy, monthly: jobs, prices, rates, spending, housing",
                    "The headline monthly numbers for the United States: unemployment, payrolls, inflation, interest rates, retail sales, housing and trade.",
                    FRED_MONTHLY, "month", derived=[("CPIAUCSL", "inflation", "US inflation (consumer prices, change over a year)"), ("CPILFESL", "core_inflation", "US core inflation (without food and energy)"),
                                                    ("PCEPI", "pce_inflation", "US inflation, personal consumption prices"), ("AHETPI", "wage_growth", "US wage growth (average hourly earnings, change over a year)")])


def us_quarterly():
    return fred_set("us-economy-quarterly", "US economy, quarterly: GDP, debt, profits, home prices",
                    "Quarterly figures for the United States: real GDP and its growth, GDP per person, federal debt against GDP, corporate profits and house prices.", FRED_QUARTERLY, "quarter")


def us_daily():
    return fred_set("us-rates-and-currencies-daily", "US interest rates and exchange rates, daily",
                    "Daily Treasury yields, the federal funds rate, the yield curve, expected inflation, and the dollar against the euro, rupee, yuan and yen.", FRED_DAILY, "day")


# ---------- US Treasury: the national debt, every day ----------
def us_debt():
    cell, page, pages = {}, 1, 1
    while page <= pages:
        j = J("https://api.fiscaldata.treasury.gov/services/api/fiscal_service/v2/accounting/od/debt_to_penny"
              f"?fields=record_date,tot_pub_debt_out_amt,debt_held_public_amt,intragov_hold_amt&sort=record_date&page[size]=10000&page[number]={page}")
        pages = int(j["meta"]["total-pages"])
        for r in j["data"]:
            row = {c: float(r[f]) for f, c in (("tot_pub_debt_out_amt", "total_public_debt"), ("debt_held_public_amt", "debt_held_by_the_public"), ("intragov_hold_amt", "intragovernmental_holdings")) if r.get(f) not in (None, "", "null")}
            if row:
                cell[r["record_date"]] = row
        page += 1
    meta = dict(total_public_debt=dict(title="US national debt", unit="current US$", description="Total public debt outstanding: everything the federal government owes."),
                debt_held_by_the_public=dict(title="US debt held by the public", unit="current US$", description="Federal debt held by investors outside the government."),
                intragovernmental_holdings=dict(title="US debt held by government accounts", unit="current US$", description="Federal debt held by government trust funds such as Social Security."))
    return series("us-national-debt", "US national debt, daily", "What the US federal government owes, to the penny, for every business day since 1993.",
                  "US", "Government and finance", "US Treasury, Fiscal Data: Debt to the Penny", "https://fiscaldata.treasury.gov/datasets/debt-to-the-penny/", PD, cell, meta, list(meta), "day")


# ---------- NOAA: United States climate, monthly since 1895 ----------
def us_climate():
    cell, got = {}, []
    for par, col in (("tavg", "average_temperature_f"), ("pcp", "precipitation_inches"), ("tmax", "average_high_f"), ("tmin", "average_low_f")):
        raw, base = None, f"https://www.ncei.noaa.gov/access/monitoring/climate-at-a-glance/national/time-series/110/{par}/"
        for u in (base + f"1/0/1895-{THIS_YEAR}/data.csv", base + f"1/0/1895-{THIS_YEAR}.csv", base + f"all/1/1895-{THIS_YEAR}.csv"):
            try:
                raw = text(u, tries=1)
                if re.search(r"^\d{6},", raw, re.M):
                    break
                raw = None
            except Exception:
                pass
        if not raw:
            print(f"  us-climate: {par} not loaded")
            continue
        for line in raw.splitlines():
            p = line.split(",")
            if re.fullmatch(r"\d{6}", p[0]) and len(p) > 1 and bd.is_num(p[1]) and float(p[1]) > -99:
                cell.setdefault(f"{p[0][:4]}-{p[0][4:]}-01", {})[col] = float(p[1])
        got.append(col)
        time.sleep(0.5)
    meta = dict(average_temperature_f=dict(title="US average temperature, monthly", unit="°F", description="Average temperature across the contiguous United States for the month."),
                precipitation_inches=dict(title="US precipitation, monthly", unit="inches", description="Total precipitation averaged across the contiguous United States for the month."),
                average_high_f=dict(title="US average daily high temperature, monthly", unit="°F"), average_low_f=dict(title="US average daily low temperature, monthly", unit="°F"))
    return series("us-climate-monthly", "United States temperature and rainfall, monthly since 1895", "Monthly average temperature and precipitation for the contiguous United States, from NOAA's climate record.",
                  "US", "Climate and environment", "NOAA National Centers for Environmental Information, Climate at a Glance", "https://www.ncei.noaa.gov/access/monitoring/climate-at-a-glance/", PD, cell, meta, got, "month")


# ---------- research and the internet ----------
WIKIS = [("all-projects", "all_wikipedias_and_sister_projects", "Wikimedia page views, all projects"), ("en.wikipedia", "english_wikipedia", "English Wikipedia page views"),
         ("es.wikipedia", "spanish_wikipedia", "Spanish Wikipedia page views"), ("de.wikipedia", "german_wikipedia", "German Wikipedia page views"),
         ("ja.wikipedia", "japanese_wikipedia", "Japanese Wikipedia page views"), ("fr.wikipedia", "french_wikipedia", "French Wikipedia page views"),
         ("ru.wikipedia", "russian_wikipedia", "Russian Wikipedia page views"), ("zh.wikipedia", "chinese_wikipedia", "Chinese Wikipedia page views"),
         ("hi.wikipedia", "hindi_wikipedia", "Hindi Wikipedia page views"), ("pt.wikipedia", "portuguese_wikipedia", "Portuguese Wikipedia page views")]


def wikipedia():
    cell, cols, meta, end = {}, [], {}, date.today().strftime("%Y%m") + "0100"
    for proj, col, title in WIKIS:
        try:
            for it in J(f"https://wikimedia.org/api/rest_v1/metrics/pageviews/aggregate/{proj}/all-access/user/monthly/2015070100/{end}")["items"]:
                t = it["timestamp"]
                cell.setdefault(f"{t[:4]}-{t[4:6]}-01", {})[col] = it["views"]
            cols.append(col)
            meta[col] = dict(title=title + ", monthly", unit="page views", description=f"Views by people (not bots) of {proj} in the month, all devices.")
        except Exception as e:
            print(f"  wikipedia {proj}: {str(e)[:70]}")
        time.sleep(2)
    cell.pop(date.today().strftime("%Y-%m-01"), None)
    return series("wikipedia-pageviews", "Wikipedia page views, monthly, by language", "How many pages people read on Wikipedia each month since July 2015, in total and for nine languages.",
                  "World", "Science and technology", "Wikimedia Foundation, Pageviews API", "https://wikitech.wikimedia.org/wiki/Analytics/AQS/Pageviews", "CC0", cell, meta, cols, "month")


def research():
    """Papers by year for the world (OpenAlex, Crossref) and by country and year (OpenAlex)."""
    out, cell, meta, cols = [], {}, {}, []
    oa = "https://api.openalex.org/works"
    try:
        tot = {g["key"]: g["count"] for g in J(oa + "?group_by=publication_year")["group_by"]}
        opn = {g["key"]: g["count"] for g in J(oa + "?filter=is_oa:true&group_by=publication_year")["group_by"]}
        for y, n in tot.items():
            if str(y).isdigit() and 1950 <= int(y) < THIS_YEAR:
                cell.setdefault(f"{y}-01-01", {}).update(works=n, **({"open_access_share": opn[y] / n * 100} if n and y in opn else {}))
        cols += ["works", "open_access_share"]
        meta.update(works=dict(title="Research works published in the year (OpenAlex)", unit="works", description="Papers, books, datasets and other scholarly works indexed by OpenAlex, by year of publication."),
                    open_access_share=dict(title="Share of research works that are free to read (OpenAlex)", unit="% of works"))
    except Exception as e:
        print("  openalex world:", str(e)[:80])
    try:
        vals = J("https://api.crossref.org/works?rows=0&facet=published:*")["message"]["facets"]["published"]["values"]
        for y, n in vals.items():
            if str(y).isdigit() and 1950 <= int(y) < THIS_YEAR:
                cell.setdefault(f"{y}-01-01", {})["crossref_records"] = n
        cols.append("crossref_records")
        meta["crossref_records"] = dict(title="Scholarly records registered with Crossref, by year published", unit="records", description="Journal articles, books, preprints and other items with a Crossref DOI, by publication year.")
    except Exception as e:
        print("  crossref:", str(e)[:80])
    try:                                                    # arXiv asks for one request every three seconds; years already on disk are not asked again
        _, old = prior("research-papers-by-year")
        for y in range(1991, THIS_YEAR):
            d = f"{y}-01-01"
            if d in old and old[d].get("arxiv_papers") and y < THIS_YEAR - 2:
                n = float(old[d]["arxiv_papers"])
            else:
                m = re.search(r"<opensearch:totalResults[^>]*>(\d+)<", text(f"https://export.arxiv.org/api/query?search_query=submittedDate:[{y}01010000+TO+{y}12312359]&max_results=1"))
                n = int(m.group(1))
                time.sleep(3)
            if n:
                cell.setdefault(d, {})["arxiv_papers"] = n
        cols.append("arxiv_papers")
        meta["arxiv_papers"] = dict(title="Papers submitted to arXiv in the year", unit="papers", description="Preprints first submitted to arXiv in the year, counted through arXiv's public search.")
    except Exception as e:
        print("  arxiv:", str(e)[:80])
    if cols:
        out.append(series("research-papers-by-year", "Research papers published each year, worldwide", "How much research the world publishes: works indexed by OpenAlex, the share that is free to read, records registered with Crossref, and preprints posted to arXiv.",
                          "World", "Science and technology", "OpenAlex, Crossref and arXiv", "https://openalex.org", "CC0", cell, meta, cols, "year"))
    # by country: only the last three years are asked again; earlier years are read back from the file
    try:
        h, old = prior("research-papers-by-country")
        a2, nm, cc, names = iso()["a2"], iso()["name"], {}, {}
        if h:
            with open(SETS / "research-papers-by-country.csv", newline="", encoding="utf-8") as f:
                for r in csv.DictReader(f):
                    if r.get("works"):
                        cc[(r["code"], int(r["year"]))] = dict(works=float(r["works"]))
                        names[r["code"]] = r["country"]
        have = {y for _, y in cc}
        for y in range(2000, THIS_YEAR):
            if y in have and y < THIS_YEAR - 3:
                continue
            for g in J(f"{oa}?filter=publication_year:{y}&group_by=authorships.countries&per_page=200")["group_by"]:
                code = a2.get(str(g["key"]).rsplit("/", 1)[-1].upper())
                if code and g["count"]:
                    cc[(code, y)] = dict(works=g["count"])
                    names[code] = nm.get(code, g.get("key_display_name") or code)
            time.sleep(0.4)
        out.append(country_year("research-papers-by-country", "Research papers by country and year", "How many research works have at least one author working in each country, by year of publication.",
                                "Science and technology", "OpenAlex", "https://openalex.org", "CC0", cc, names,
                                dict(works=dict(title="Research works with an author in the country", unit="works", description="OpenAlex works with at least one author affiliated with an institution in the country. A work with authors in several countries counts once for each.")), ["works"]))
    except Exception as e:
        print("  openalex by country:", str(e)[:80])
    assert out, "no research data loaded"
    return out


def gbif():
    """Records of living things in the Global Biodiversity Information Facility: by year observed, and by country."""
    base, out = "https://api.gbif.org/v1/occurrence/search?limit=0", []
    kingdoms = [("", "all_records", "Records of living things (GBIF)"), ("&kingdomKey=1", "animal_records", "Animal records (GBIF)"), ("&kingdomKey=6", "plant_records", "Plant records (GBIF)"), ("&kingdomKey=5", "fungus_records", "Fungus records (GBIF)")]
    cell, cc, names, cols = {}, {}, {}, []
    a2, nm = iso()["a2"], iso()["name"]
    for q, col, title in kingdoms:
        try:
            for c in J(base + q + "&facet=year&facetLimit=500")["facets"][0]["counts"]:
                if c["name"].isdigit() and 1900 <= int(c["name"]) < THIS_YEAR:
                    cell.setdefault(f"{c['name']}-01-01", {})[col] = c["count"]
            for c in J(base + q + "&facet=country&facetLimit=300")["facets"][0]["counts"]:
                code = a2.get(c["name"])
                if code:
                    cc.setdefault((code, THIS_YEAR), {})[col] = c["count"]
                    names[code] = nm.get(code, code)
            cols.append(col)
        except Exception as e:
            print(f"  gbif {col}: {str(e)[:70]}")
        time.sleep(0.5)
    meta = {col: dict(title=title, unit="records", description="Occurrence records shared through GBIF: sightings, specimens and samples of living things.") for _, col, title in kingdoms}
    ymeta = {c: dict(title=m["title"].replace(" (GBIF)", ", by year observed (GBIF)"), unit=m["unit"], description=m["description"] + " Counted by the year the organism was observed or collected.") for c, m in meta.items()}
    out.append(series("biodiversity-records-by-year", "Biodiversity records by year observed (GBIF)", "How many sightings and specimens of animals, plants and fungi were recorded in each year, as shared through GBIF.",
                      "World", "Climate and environment", "Global Biodiversity Information Facility (GBIF)", "https://www.gbif.org", "CC BY 4.0 (GBIF; individual datasets CC0, CC BY or CC BY-NC)", cell, ymeta, cols, "year"))
    h, _ = prior("biodiversity-records-by-country")                 # keep earlier years' snapshots
    if h:
        with open(SETS / "biodiversity-records-by-country.csv", newline="", encoding="utf-8") as f:
            for r in csv.DictReader(f):
                if int(r["year"]) != THIS_YEAR:
                    cc[(r["code"], int(r["year"]))] = {c: float(r[c]) for c in cols if r.get(c)}
                    names.setdefault(r["code"], r["country"])
    cmeta = {c: dict(title=m["title"].replace(" (GBIF)", " located in the country (GBIF)"), unit=m["unit"], description=m["description"] + " All records located in the country, counted in the year shown.") for c, m in meta.items()}
    out.append(country_year("biodiversity-records-by-country", "Biodiversity records by country (GBIF)", "How many records of animals, plants and fungi GBIF holds for each country. More records means more observing, not necessarily more species.",
                            "Climate and environment", "Global Biodiversity Information Facility (GBIF)", "https://www.gbif.org", "CC BY 4.0 (GBIF; individual datasets CC0, CC BY or CC BY-NC)", cc, names, cmeta, cols, min_rows=100))
    return out


def github_activity():
    a2, nm, cell, names = iso()["a2"], iso()["name"], {}, {}
    files = [("developers", "developers", "Developers on GitHub", "accounts", "last"), ("repositories", "repositories", "Repositories on GitHub", "repositories", "last"),
             ("organizations", "organizations", "Organizations on GitHub", "organizations", "last"), ("git_pushes", "code_pushes", "Code pushes to GitHub in the year", "pushes", "sum")]
    for f, col, _, _, how in files:
        by = {}
        for r in csv.DictReader(io.StringIO(text(f"{RAW}github/innovationgraph/main/data/{f}.csv"))):
            code = "EUU" if r["iso2_code"] == "EU" else a2.get(r["iso2_code"])
            if code and r[f].isdigit():
                by.setdefault((code, int(r["year"])), {})[int(r["quarter"])] = int(r[f])
                names[code] = "European Union" if code == "EUU" else nm.get(code, code)
        for k, q in by.items():
            if how == "last":
                cell.setdefault(k, {})[col] = q[max(q)]
            elif len(q) == 4:                               # a flow: only whole years
                cell.setdefault(k, {})[col] = sum(q.values())
    meta = {col: dict(title=t, unit=u, description=("Counted at the end of the year (or the latest quarter of the current year)." if how == "last" else "Total over the four quarters of the year; the current year is left out until it is complete.") + " Economies with fewer than 100 are not published.") for _, col, t, u, how in files}
    return country_year("github-activity-by-country", "Software development on GitHub, by country", "How many developers, repositories and organizations each country has on GitHub, and how much code they push.",
                        "Science and technology", "GitHub Innovation Graph", "https://innovationgraph.github.com", "CC0", cell, names, meta, [c for _, c, _, _, _ in files], min_rows=300)


# ---------- US government: rules, drugs, trials, disasters, banks ----------
def yearly(id, first, count, cols, recent=2):
    """{date: {col: n}} for every year from `first`, asking only for the last `recent` years when earlier ones are on disk."""
    h, old = prior(id)
    cell = {}
    for y in range(first, THIS_YEAR + 1):
        d = f"{y}-01-01"
        if d in old and y < THIS_YEAR - recent + 1 and all(old[d].get(c, "") != "" for c in cols):
            cell[d] = {c: float(old[d][c]) for c in cols}
            continue
        row = {}
        for c in cols:
            try:
                row[c] = count(y, c)
            except Exception as e:
                print(f"  {id} {y} {c}: {str(e)[:60]}")
            time.sleep(0.25)
        if row:
            cell[d] = row
    return cell


def federal_register():
    kinds = dict(final_rules="conditions[type][]=RULE", proposed_rules="conditions[type][]=PRORULE",
                 presidential_documents="conditions[type][]=PRESDOCU", executive_orders="conditions[presidential_document_type][]=executive_order")

    def count(y, c):
        n = J(f"https://www.federalregister.gov/api/v1/documents.json?per_page=1&conditions[publication_date][year]={y}&{kinds[c]}")["count"]
        assert n < 10000, "the count is capped at 10,000"
        return n
    cell = yearly("us-federal-register", 1995, count, list(kinds))
    meta = dict(final_rules=dict(title="US federal final rules published in the year", unit="documents"), proposed_rules=dict(title="US federal proposed rules published in the year", unit="documents"),
                presidential_documents=dict(title="US presidential documents published in the year", unit="documents"), executive_orders=dict(title="US executive orders published in the year", unit="orders"))
    out = series("us-federal-register", "US federal rules and executive orders, by year", "How much the US government regulates: final rules, proposed rules, presidential documents and executive orders published in the Federal Register each year since 1995.",
                 "US", "Government and finance", "US National Archives, Federal Register", "https://www.federalregister.gov", PD, cell, meta, list(kinds), "year")
    out["partial"] = True                                   # the newest year is a count so far
    return out


def fda():
    feeds = [("drug/event.json?count=receivedate", "drug_side_effect_reports", "US reports of drug side effects received in the month"), ("device/event.json?count=date_received", "device_problem_reports", "US reports of medical device problems received in the month"),
             ("drug/enforcement.json?count=report_date", "drug_recalls", "US drug recalls reported in the month"), ("food/enforcement.json?count=report_date", "food_recalls", "US food recalls reported in the month"),
             ("device/enforcement.json?count=report_date", "device_recalls", "US medical device recalls reported in the month")]
    cell, cols, this = {}, [], date.today().strftime("%Y-%m")
    for path, col, _ in feeds:
        try:
            for r in J("https://api.fda.gov/" + path)["results"]:
                t = str(r["time"])
                if len(t) == 8 and "2004" <= t[:4] <= str(THIS_YEAR) and f"{t[:4]}-{t[4:6]}" < this:   # the public record starts in 2004
                    k = f"{t[:4]}-{t[4:6]}-01"
                    cell.setdefault(k, {})[col] = cell.get(k, {}).get(col, 0) + r["count"]
            cols.append(col)
        except Exception as e:
            print(f"  fda {col}: {str(e)[:70]}")
        time.sleep(1)
    meta = {col: dict(title=t, unit="reports" if "report" in col else "recalls", description="From openFDA. Reports are unverified and do not show that a product caused harm.") for _, col, t in feeds}
    return series("us-fda-reports", "US drug and device safety reports and recalls, monthly", "Monthly counts of side-effect reports for drugs, problem reports for medical devices, and recalls of drugs, food and devices.",
                  "US", "Health", "US Food and Drug Administration, openFDA", "https://open.fda.gov", "CC0 (openFDA)", cell, meta, cols, "month")


def clinical_trials():
    kinds = dict(studies_started="", interventional_studies_started=" AND AREA[StudyType]INTERVENTIONAL", phase_3_trials_started=" AND AREA[Phase]PHASE3")

    def count(y, c):
        q = urllib.parse.quote(f"AREA[StartDate]RANGE[{y}-01-01,{y}-12-31]{kinds[c]}")
        return J(f"https://clinicaltrials.gov/api/v2/studies?countTotal=true&pageSize=1&fields=NCTId&filter.advanced={q}")["totalCount"]
    cell = yearly("clinical-trials-started", 2000, count, list(kinds), recent=4)
    meta = dict(studies_started=dict(title="Clinical studies started in the year", unit="studies", description="Studies registered on ClinicalTrials.gov by the year they started, worldwide. The current year includes studies registered to start before it ends."),
                interventional_studies_started=dict(title="Clinical trials (interventional studies) started in the year", unit="trials"), phase_3_trials_started=dict(title="Phase 3 clinical trials started in the year", unit="trials"))
    out = series("clinical-trials-started", "Clinical trials started each year", "How many medical studies begin each year, from the world's largest trial registry.",
                 "World", "Health", "US National Library of Medicine, ClinicalTrials.gov", "https://clinicaltrials.gov", PD, cell, meta, list(kinds), "year")
    out["partial"] = True
    return out


def fema():
    seen, skip, url = {}, 0, "https://www.fema.gov/api/open/v2/DisasterDeclarationsSummaries?$select=disasterNumber,state,declarationType,incidentType,declarationDate,declarationTitle&$orderby=disasterNumber&$top=10000"
    while True:
        rows = J(f"{url}&$skip={skip}".replace(" ", "%20"))["DisasterDeclarationsSummaries"]
        for r in rows:
            seen.setdefault(r["disasterNumber"], r)             # one line per county in the source; one per disaster here
        if len(rows) < 10000:
            break
        skip += 10000
        time.sleep(0.5)
    kind = {"Hurricane": "hurricanes", "Tropical Storm": "hurricanes", "Typhoon": "hurricanes", "Flood": "floods", "Fire": "fires", "Severe Storm": "severe_storms", "Severe Storm(s)": "severe_storms",
            "Tornado": "tornadoes", "Snowstorm": "winter_storms", "Severe Ice Storm": "winter_storms", "Winter Storm": "winter_storms", "Freezing": "winter_storms", "Earthquake": "earthquakes", "Drought": "droughts", "Biological": "biological"}
    cols, cell, rows = ["all_declarations", "major_disasters", "emergencies", "fire_management", "hurricanes", "floods", "fires", "severe_storms", "tornadoes", "winter_storms", "earthquakes", "droughts", "biological", "other"], {}, []
    for n, r in sorted(seen.items()):
        y = r["declarationDate"][:4]
        c = cell.setdefault(f"{y}-01-01", {k: 0 for k in cols})
        c["all_declarations"] += 1
        t = {"DR": "major_disasters", "EM": "emergencies", "FM": "fire_management"}.get(r["declarationType"])
        if t:
            c[t] += 1
        c[kind.get(r["incidentType"], "other")] += 1
        rows.append([n, r["declarationDate"][:10], r["state"], r["declarationType"], r["incidentType"], (r.get("declarationTitle") or "").strip()])
    label = dict(all_declarations="US federal disaster declarations in the year", major_disasters="US major disaster declarations in the year", emergencies="US emergency declarations in the year", fire_management="US fire management declarations in the year",
                 hurricanes="US disaster declarations for hurricanes and tropical storms", floods="US disaster declarations for floods", fires="US disaster declarations for fires", severe_storms="US disaster declarations for severe storms",
                 tornadoes="US disaster declarations for tornadoes", winter_storms="US disaster declarations for snow and ice storms", earthquakes="US disaster declarations for earthquakes", droughts="US disaster declarations for droughts",
                 biological="US disaster declarations for biological events (such as COVID-19)", other="US disaster declarations for other causes")
    meta = {c: dict(title=t, unit="declarations", description="Each disaster is counted once for each state or territory it was declared in. The current year is a count so far.") for c, t in label.items()}
    yearly_counts = series("us-disaster-declarations", "US disaster declarations by year and cause", "How many disasters the US government has declared each year since 1953, and what caused them.",
                           "US", "Natural hazards", "Federal Emergency Management Agency, OpenFEMA", "https://www.fema.gov/about/openfema", PD, cell, meta, cols, "year")
    yearly_counts["partial"] = True
    return [yearly_counts,
            table("us-disaster-declarations-list", "Every US disaster declaration since 1953", "One line for each federally declared disaster, with its date, state, type and name.",
                  "US", "Natural hazards", "Federal Emergency Management Agency, OpenFEMA", "https://www.fema.gov/about/openfema", PD, ["disaster_number"], "declared", "date", None,
                  ["disaster_number", "declared", "state", "declaration_type", "incident_type", "name"], rows,
                  dict(state=dict(title="State or territory"), declaration_type=dict(title="Declaration type", description="DR major disaster, EM emergency, FM fire management."), incident_type=dict(title="Cause"), name=dict(title="Name of the disaster")))]


def fdic():
    j = J("https://banks.data.fdic.gov/api/failures?fields=NAME,CERT,CITYST,FAILDATE,RESTYPE1,QBFDEP,QBFASSET,COST&sort_by=FAILDATE&sort_order=ASC&limit=10000&format=json")
    rows, cell = [], {}
    for k, it in enumerate(j["data"]):
        r = it.get("data", it)
        m = re.fullmatch(r"(\d{1,2})/(\d{1,2})/(\d{4})", str(r.get("FAILDATE", "")))
        if not m:
            continue
        d = f"{m.group(3)}-{int(m.group(1)):02d}-{int(m.group(2)):02d}"
        assets, dep, cost = (num(r.get(f) * 1000) if isinstance(r.get(f), (int, float)) else "" for f in ("QBFASSET", "QBFDEP", "COST"))
        rows.append([k + 1, d, r.get("NAME", ""), r.get("CITYST", ""), assets, dep, cost, r.get("RESTYPE1", "")])
        c = cell.setdefault(d[:4] + "-01-01", dict(bank_failures=0, assets_of_failed_banks=0))
        c["bank_failures"] += 1
        c["assets_of_failed_banks"] += assets or 0
    for y in range(int(min(cell)[:4]), THIS_YEAR + 1):
        cell.setdefault(f"{y}-01-01", dict(bank_failures=0, assets_of_failed_banks=0))
    by_year = series("us-bank-failures", "US bank failures by year", "How many banks failed in the United States each year since 1934, and how large they were.",
                     "US", "Government and finance", "Federal Deposit Insurance Corporation, BankFind", "https://banks.data.fdic.gov", PD, cell,
                     dict(bank_failures=dict(title="US bank failures in the year", unit="banks"), assets_of_failed_banks=dict(title="Assets of US banks that failed in the year", unit="current US$")), ["bank_failures", "assets_of_failed_banks"], "year")
    by_year["partial"] = True
    return [by_year,
            table("us-bank-failures-list", "Every US bank failure since 1934", "One line for each failed bank: date, name, place, assets, deposits and the estimated cost to the insurance fund.",
                  "US", "Government and finance", "Federal Deposit Insurance Corporation, BankFind", "https://banks.data.fdic.gov", PD, ["id"], "failed", "date", None,
                  ["id", "failed", "bank", "city_and_state", "assets", "deposits", "estimated_cost", "resolution"], rows,
                  dict(bank=dict(title="Bank"), city_and_state=dict(title="City and state"), assets=dict(title="Assets at failure", unit="current US$"), deposits=dict(title="Deposits at failure", unit="current US$"),
                       estimated_cost=dict(title="Estimated cost to the insurance fund", unit="current US$"), resolution=dict(title="How it was resolved")))]


# ---------- US health and cities ----------
def flu():
    cell, states = {}, {}
    for r in csv.DictReader(io.StringIO(text(f"{RAW}cdcepi/FluSight-forecast-hub/main/target-data/target-hospital-admissions.csv"))):
        if r["value"] in ("", "NA"):
            continue
        col = "united_states" if r["location"] == "US" else slug(r["location_name"])
        states[col] = "the United States" if r["location"] == "US" else r["location_name"]
        cell.setdefault(r["date"], {})[col] = float(r["value"])
    cols = ["united_states"] + sorted(c for c in states if c != "united_states")
    meta = {c: dict(title=f"Flu hospital admissions in the week, {n}", unit="people admitted", description="People newly admitted to hospital with confirmed influenza in the week ending on the date, as reported by hospitals to CDC.") for c, n in states.items()}
    return series("us-flu-hospital-admissions", "US flu hospital admissions, weekly, by state", "How many people were admitted to hospital with confirmed flu each week, for the country and every state. This is the series the CDC FluSight forecasts are scored against.",
                  "US", "Health", "Centers for Disease Control and Prevention (NHSN), via the FluSight Forecast Hub", "https://github.com/cdcepi/FluSight-forecast-hub", PD, cell, meta, cols, "week")


def socrata(url):
    return J(url.replace(" ", "%20"), timeout=240)


def chicago():
    rows = socrata("https://data.cityofchicago.org/resource/ijzp-q8t2.json?$select=date_trunc_ym(date) as month,primary_type,count(*) as n&$group=month,primary_type&$limit=50000")
    pick = {"THEFT": "thefts", "BATTERY": "batteries", "CRIMINAL DAMAGE": "criminal_damage", "ASSAULT": "assaults", "MOTOR VEHICLE THEFT": "vehicle_thefts", "BURGLARY": "burglaries", "ROBBERY": "robberies", "NARCOTICS": "narcotics_offences", "HOMICIDE": "homicides", "WEAPONS VIOLATION": "weapons_violations"}
    cell, this = {}, date.today().strftime("%Y-%m")
    for r in rows:
        m = str(r.get("month", ""))[:7]
        if not re.fullmatch(r"\d{4}-\d{2}", m) or m >= this:
            continue
        c = cell.setdefault(m + "-01", {"all_reported_crimes": 0})
        c["all_reported_crimes"] += int(r["n"])
        if r.get("primary_type") in pick:
            c[pick[r["primary_type"]]] = c.get(pick[r["primary_type"]], 0) + int(r["n"])
    cols = ["all_reported_crimes"] + list(pick.values())
    meta = {c: dict(title=f"Chicago: {c.replace('_', ' ')} in the month", unit="incidents", description="Incidents reported to the Chicago Police Department, counted by the month they happened.") for c in cols}
    return series("chicago-crime-monthly", "Chicago: reported crime by month and type", "Crimes reported in Chicago each month since 2001, in total and for the ten most common types.",
                  "US", "Government and finance", "City of Chicago Data Portal, Chicago Police Department", "https://data.cityofchicago.org/Public-Safety/Crimes-2001-to-Present/ijzp-q8t2", "Chicago Data Portal terms of use (free to use with attribution)", cell, meta, cols, "month")


def nyc():
    rows = socrata("https://data.cityofnewyork.us/resource/h9gi-nx95.json?$select=date_trunc_ym(crash_date) as month,count(*) as crashes,sum(number_of_persons_injured) as injured,sum(number_of_persons_killed) as killed,"
                   "sum(number_of_pedestrians_killed) as pedestrians_killed,sum(number_of_cyclist_killed) as cyclists_killed&$group=month&$order=month&$limit=5000")
    cell, this = {}, date.today().strftime("%Y-%m")
    for r in rows:
        m = str(r.get("month", ""))[:7]
        if re.fullmatch(r"\d{4}-\d{2}", m) and m < this:
            cell[m + "-01"] = {c: float(r[k]) for k, c in (("crashes", "crashes"), ("injured", "people_injured"), ("killed", "people_killed"), ("pedestrians_killed", "pedestrians_killed"), ("cyclists_killed", "cyclists_killed")) if r.get(k) not in (None, "")}
    meta = dict(crashes=dict(title="New York City: motor vehicle crashes in the month", unit="crashes"), people_injured=dict(title="New York City: people injured in crashes in the month", unit="people"),
                people_killed=dict(title="New York City: people killed in crashes in the month", unit="people"), pedestrians_killed=dict(title="New York City: pedestrians killed in crashes in the month", unit="people"),
                cyclists_killed=dict(title="New York City: cyclists killed in crashes in the month", unit="people"))
    return series("nyc-traffic-crashes-monthly", "New York City: traffic crashes, injuries and deaths by month", "Motor vehicle collisions reported by the NYPD each month since mid-2012, with the people injured and killed.",
                  "US", "Government and finance", "NYC Open Data, New York Police Department", "https://data.cityofnewyork.us/Public-Safety/Motor-Vehicle-Collisions-Crashes/h9gi-nx95", "NYC Open Data terms of use (free to use)", cell, meta, list(meta), "month")


def us_spending():
    j = J("https://api.usaspending.gov/api/v2/references/toptier_agencies/")
    rows, fy = [], None
    for a in j["results"]:
        fy = fy or a.get("active_fy")
        if a.get("budget_authority_amount") is None:
            continue
        rows.append([a.get("abbreviation") or slug(a["agency_name"]).upper()[:12], a["agency_name"], int(a.get("active_fy") or fy or THIS_YEAR), num(a.get("budget_authority_amount")), num(a.get("obligated_amount")),
                     num(a.get("outlay_amount")), num((a.get("percentage_of_total_budget_authority") or 0) * 100)])
    seen, uniq = set(), []
    for r in rows:
        if r[0] not in seen:
            seen.add(r[0])
            uniq.append(r)
    return table("us-federal-spending-by-agency", "US federal spending by agency, this fiscal year", "What each federal agency may spend, has committed and has paid out in the current fiscal year.",
                 "US", "Government and finance", "US Treasury, USAspending.gov", "https://www.usaspending.gov/agency", PD, ["agency", "fiscal_year"], "fiscal_year", "year",
                 dict(col="agency", label_col="agency_name", label="Agency"), ["agency", "agency_name", "fiscal_year", "budget_authority", "obligations", "outlays", "share_of_federal_budget"], uniq,
                 dict(budget_authority=dict(title="Budget authority", unit="current US$", description="What Congress has allowed the agency to spend."), obligations=dict(title="Obligations", unit="current US$", description="What the agency has committed to pay."),
                      outlays=dict(title="Outlays", unit="current US$", description="What has actually been paid out."), share_of_federal_budget=dict(title="Share of total federal budget authority", unit="% of the total")))


OWID_SETS = [
    ("democracy-and-rights", "Democracy, human rights, press freedom and corruption", "How free and how clean countries are: democracy and rights scores from V-Dem, press freedom from Reporters Without Borders, and perceived corruption from Transparency International.",
     "Government and finance", "V-Dem, Reporters Without Borders and Transparency International, via Our World in Data",
     ["electoral-democracy-index", "liberal-democracy-index", "human-rights-index-vdem", "rule-of-law-index", "women-political-empowerment-index", "press-freedom-index-rsf", "ti-corruption-perception-index"]),
    ("conflict-and-security", "Military spending, nuclear weapons, homicide, terrorism and refugees", "War and safety by country and year: what armies cost, who holds nuclear warheads, how many people are killed, and how many flee.",
     "Government and finance", "SIPRI, Federation of American Scientists, UNODC, Global Terrorism Database, UCDP and UNHCR, via Our World in Data",
     ["military-expenditure-total", "nuclear-warhead-stockpiles", "homicide-rate-unodc", "fatalities-from-terrorism", "terrorist-attacks", "refugee-population-by-country-or-territory-of-origin", "refugee-population-by-country-or-territory-of-asylum", "deaths-in-armed-conflicts"]),
    ("renewable-capacity", "Solar and wind power capacity installed", "How much solar and wind generating capacity each country has built.",
     "Energy", "International Renewable Energy Agency (IRENA), via Our World in Data", ["installed-solar-pv-capacity", "cumulative-installed-wind-energy-capacity-gigawatts"]),
    ("emissions-by-sector", "Greenhouse gas emissions by sector", "Where each country's emissions come from: electricity and heat, transport, industry, buildings, farming, land use and waste.",
     "Climate and environment", "Climate Watch (World Resources Institute), via Our World in Data", ["ghg-emissions-by-sector"]),
    ("wellbeing-and-schooling", "Happiness, working hours and years of schooling", "How people say their lives are going, how long they work, and how long they stay in school.",
     "People and society", "World Happiness Report, Penn World Table, Barro and Lee, and the World Bank, via Our World in Data",
     ["happiness-cantril-ladder", "annual-working-hours-per-worker", "mean-years-of-schooling-long-run", "learning-adjusted-years-of-school-lays"]),
    ("forests-wildlife-and-plastic", "Forest loss, threatened wildlife and plastic in the ocean", "Pressure on nature by country: forest cleared each year, tree cover lost, how close species are to extinction, and plastic reaching the sea.",
     "Climate and environment", "FAO, Global Forest Watch, IUCN Red List and Meijer et al., via Our World in Data", ["annual-deforestation", "tree-cover-loss", "red-list-index", "plastic-waste-emitted-to-the-ocean"]),
    ("natural-disasters", "Natural disasters: deaths, people affected and damage", "How many people natural disasters kill and affect in each country each year, and what they cost.",
     "Natural hazards", "EM-DAT, CRED, UCLouvain, via Our World in Data", ["deaths-from-natural-disasters", "total-affected-by-natural-disasters", "natural-disaster-death-rates", "number-homeless-from-natural-disasters", "economic-damages-from-natural-disasters-as-a-share-of-gdp"]),
    ("food-supply", "Food supply: calories and meat per person", "How much food is available per person in each country: daily calories and meat.",
     "Economy and development", "Food and Agriculture Organization (FAOSTAT), via Our World in Data", ["daily-per-capita-caloric-supply", "meat-supply-per-person"]),
    ("top-incomes", "Income going to the top 1% and top 10%", "How much of each country's income goes to its highest earners, before tax.",
     "People and society", "World Inequality Database, via Our World in Data", ["income-share-top-1-before-tax-wid", "income-share-top-10-before-tax-wid"]),
    ("space-and-ai", "Objects launched into space, and AI research", "Satellites and other objects launched each year by country, and research papers on artificial intelligence.",
     "Science and technology", "UN Office for Outer Space Affairs and CSET, via Our World in Data", ["yearly-number-of-objects-launched-into-outer-space", "annual-scholarly-publications-on-artificial-intelligence"]),
]

# ---------- US National Institutes of Health: research projects funded each year ----------
def nih():
    def count(y, c):
        body = json.dumps({"criteria": {"fiscal_years": [y]}, "offset": 0, "limit": 1}).encode()
        return J("https://api.reporter.nih.gov/v2/projects/search", data=body, headers={"Content-Type": "application/json", "Accept": "application/json"}, tries=2)["meta"]["total"]
    cell = yearly("us-nih-research-projects", 1990, count, ["projects_funded"], recent=3)
    meta = dict(projects_funded=dict(title="Research projects funded by the US National Institutes of Health", unit="projects",
                                     description="Project records in NIH RePORTER for each US government fiscal year (October to September), including continuing awards. The current year is not complete."))
    out = series("us-nih-research-projects", "US medical research projects funded each year", "How many research projects the US National Institutes of Health pays for in each fiscal year.",
                 "US", "Health", "US National Institutes of Health, RePORTER", "https://reporter.nih.gov", PD, cell, meta, ["projects_funded"], "year")
    out["partial"] = True
    return out


# ---------- keys: a few sources ask for a free key, which the site's owner adds as a GitHub secret ----------
class NeedsKey(Exception):
    """Raised by a builder whose key has not been added yet: the builder is skipped, not counted as a failure."""


def key(name):
    v = os.environ.get(name, "").strip()
    if not v:
        raise NeedsKey(name)
    return v


# ---------- Eurostat: the European Union's statistics office ----------
EUROSTAT = [  # (table, filters that leave one figure for a country and a year, column, title, unit)
    ("une_rt_a", "age=Y15-74&unit=PC_ACT&sex=T", "unemployment_rate", "Unemployment rate (Eurostat)", "% of the labour force"),
    ("lfsi_emp_a", "indic_em=EMP_LFS&sex=T&age=Y20-64&unit=PC_POP", "employment_rate", "Employment rate, ages 20 to 64 (Eurostat)", "% of people aged 20 to 64"),
    ("prc_hicp_aind", "unit=RCH_A_AVG&coicop=CP00", "inflation", "Inflation, harmonised consumer prices (Eurostat)", "% a year"),
    ("nama_10_pc", "unit=CP_EUR_HAB&na_item=B1GQ", "gdp_per_person", "GDP per person (Eurostat)", "euros, current prices"),
    ("nama_10_gdp", "unit=CLV_PCH_PRE&na_item=B1GQ", "real_gdp_growth", "Real GDP growth (Eurostat)", "% a year"),
    ("gov_10dd_edpt1", "unit=PC_GDP&sector=S13&na_item=GD", "government_debt", "Government debt (Eurostat)", "% of GDP"),
    ("nrg_ind_ren", "nrg_bal=REN&unit=PC", "renewable_energy_share", "Renewable energy in final energy use (Eurostat)", "% of energy use"),
    ("demo_mlexpec", "sex=T&age=Y_LT1", "life_expectancy", "Life expectancy at birth (Eurostat)", "years"),
    ("demo_pjan", "sex=T&age=TOTAL", "population", "Population on 1 January (Eurostat)", "people"),
    ("ilc_peps01n", "unit=PC&sex=T&age=TOTAL", "at_risk_of_poverty", "People at risk of poverty or social exclusion (Eurostat)", "% of people"),
    ("ilc_di12", "", "gini_coefficient", "Gini coefficient of disposable income (Eurostat)", "0 (equal) to 100"),
    ("isoc_ci_ifp_iu", "indic_is=I_IU3&unit=PC_IND&ind_type=IND_TOTAL", "internet_users", "People who used the internet in the past three months (Eurostat)", "% of people aged 16 to 74"),
]


def eurostat_table(table, filt):
    j = J(f"https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data/{table}?format=JSON&lang=EN&freq=A{'&' + filt if filt else ''}", tries=2, timeout=240)
    ids, size = j["id"], j["size"]
    index = {}
    for d in ids:
        ix = j["dimension"][d]["category"]["index"]
        index[d] = {c: i for i, c in enumerate(ix)} if isinstance(ix, list) else ix
    gi, ti = ids.index("geo"), ids.index("time")
    assert all(size[k] == 1 for k in range(len(ids)) if k not in (gi, ti)), f"breakdowns left: {dict(zip(ids, size))}"
    mult = [1] * len(ids)
    for k in range(len(ids) - 2, -1, -1):
        mult[k] = mult[k + 1] * size[k + 1]
    geo, when, out = {v: g for g, v in index["geo"].items()}, {v: t for t, v in index["time"].items()}, {}
    values = j["value"].items() if isinstance(j["value"], dict) else enumerate(j["value"])
    for k, v in values:
        k = int(k)
        g, t = geo[(k // mult[gi]) % size[gi]], str(when[(k // mult[ti]) % size[ti]])
        if v is not None and t[:4].isdigit():
            out[(g, int(t[:4]))] = v
    return out


def eurostat():
    a2, name = iso()["a2"], iso()["name"]
    cell, names, meta, cols = {}, {}, {}, []
    for table, filt, col, title, unit in EUROSTAT:
        try:
            got = eurostat_table(table, filt)
            n = 0
            for (g, y), v in got.items():
                code = "EUU" if g == "EU27_2020" else a2.get({"EL": "GR", "UK": "GB"}.get(g, g))
                if code and y <= THIS_YEAR:
                    cell.setdefault((code, y), {})[col] = v
                    names[code] = "European Union" if code == "EUU" else name.get(code, code)
                    n += 1
            if n < 100:
                raise ValueError(f"{n} values")
            meta[col] = dict(title=title, unit=unit, description=f"Eurostat table {table}.")
            cols.append(col)
        except Exception as e:
            print(f"  eurostat {table}: {str(e)[:110]}")
        time.sleep(0.5)
    assert len(cols) >= 4, f"eurostat: only {len(cols)} tables loaded"
    return country_year("europe-eurostat", "Europe: jobs, prices, income, energy and population", "Official statistics for the countries of Europe, harmonised so that they compare like with like, with the European Union as a whole.",
                        "Economy and development", "Eurostat", "https://ec.europa.eu/eurostat/data/database", "Eurostat: free reuse with the source named", cell, names, meta, cols)


# ---------- OECD and BIS series, through FRED ----------
def world_monthly():
    places = [("USA", "the United States"), ("CHN", "China"), ("JPN", "Japan"), ("DEU", "Germany"), ("GBR", "the United Kingdom"), ("FRA", "France"), ("IND", "India"), ("BRA", "Brazil")]
    bis = [("US", "the United States"), ("CN", "China"), ("JP", "Japan"), ("XM", "the euro area"), ("GB", "the United Kingdom"), ("IN", "India"), ("BR", "Brazil"), ("MX", "Mexico")]
    cell, meta, cols = {}, {}, []
    def add(sid, col, title, unit, who):
        try:
            for d, v in fred(sid).items():
                cell.setdefault(d, {})[col] = v
            meta[col] = dict(title=title, unit=unit, description=f"Published by {who}; FRED series {sid}.")
            cols.append(col)
        except Exception as e:
            print(f"  world_monthly {sid}: {str(e)[:60]}")
    for c3, label in places:
        add(f"{c3}LOLITONOSTSAM", f"leading_indicator_{c3.lower()}", f"OECD leading indicator for {label}", "index, long-run trend = 100", "the OECD")
    for c2, label in bis:
        add(f"RB{c2}BIS", f"real_exchange_rate_{slug(label.replace('the ', ''))}", f"Real exchange rate of {label}, against a broad basket of currencies", "index, 2020 = 100", "the Bank for International Settlements")
    assert len(cols) >= 6, f"world_monthly: only {len(cols)} series loaded"
    return series("world-leading-indicators-and-exchange-rates", "Leading indicators and real exchange rates, monthly", "The OECD's early signals of turning points in eight large economies, and how strong each currency is after allowing for prices.",
                  "World", "Economy and development", "OECD and Bank for International Settlements, via FRED", "https://fred.stlouisfed.org", "Free reuse with the source named (OECD and BIS terms), retrieved from FRED", cell, meta, cols, "month")


# ---------- US Consumer Financial Protection Bureau: complaints ----------
def buckets(j):
    """The first list of dated counts anywhere inside a search reply."""
    if isinstance(j, dict):
        b = j.get("buckets")
        if isinstance(b, list) and b and isinstance(b[0], dict) and "key_as_string" in b[0] and "doc_count" in b[0]:
            return b
        for v in j.values():
            r = buckets(v)
            if r:
                return r
    elif isinstance(j, list):
        for v in j:
            r = buckets(v)
            if r:
                return r
    return None


def cfpb():
    j = J("https://www.consumerfinance.gov/data-research/consumer-complaints/search/api/v1/trends?lens=overview&trend_interval=month&trend_depth=5&date_received_min=2011-12-01", tries=2)
    b = buckets(j)
    assert b, "no monthly counts in the reply: " + json.dumps(j)[:200]
    this = date.today().strftime("%Y-%m")
    cell = {x["key_as_string"][:7] + "-01": {"complaints": x["doc_count"]} for x in b if x["key_as_string"][:7] < this}
    meta = dict(complaints=dict(title="US consumer complaints about financial companies received in the month", unit="complaints",
                                description="Complaints sent to the Consumer Financial Protection Bureau about banks, lenders, credit reporting and debt collection. Counts for recent months still rise as complaints are published."))
    return series("us-consumer-finance-complaints", "US consumer complaints about financial companies, monthly", "How many complaints about banks, lenders, credit bureaus and debt collectors reach the US consumer watchdog each month.",
                  "US", "Government and finance", "US Consumer Financial Protection Bureau, Consumer Complaint Database", "https://www.consumerfinance.gov/data-research/consumer-complaints/", PD, cell, meta, ["complaints"], "month")


# ---------- US Geological Survey: river flow ----------
RIVERS = [("07010000", "mississippi_at_st_louis", "Mississippi River at St. Louis"), ("06934500", "missouri_at_hermann", "Missouri River at Hermann"), ("03294500", "ohio_at_louisville", "Ohio River at Louisville"),
          ("14105700", "columbia_at_the_dalles", "Columbia River at The Dalles"), ("09380000", "colorado_at_lees_ferry", "Colorado River at Lees Ferry"), ("01646500", "potomac_near_washington", "Potomac River near Washington, DC"),
          ("01358000", "hudson_at_green_island", "Hudson River at Green Island"), ("11447650", "sacramento_at_freeport", "Sacramento River at Freeport")]


def usgs_water():
    cell, meta, cols = {}, {}, []
    this = date.today().strftime("%Y-%m")
    for site, col, label in RIVERS:
        try:
            j = J(f"https://waterservices.usgs.gov/nwis/dv/?format=json&sites={site}&parameterCd=00060&statCd=00003&startDT=1950-01-01", tries=2, timeout=300)
            months = {}
            for x in j["value"]["timeSeries"][0]["values"][0]["value"]:
                v = float(x["value"])
                if v >= 0:
                    months.setdefault(x["dateTime"][:7], []).append(v)
            good = {m: sum(v) / len(v) for m, v in months.items() if len(v) >= 25 and m < this}
            if len(good) < 60:
                raise ValueError(f"{len(good)} months")
            for m, v in good.items():
                cell.setdefault(m + "-01", {})[col] = round(v)
            meta[col] = dict(title=f"Flow of the {label}, monthly average", unit="cubic feet per second", description=f"US Geological Survey stream gauge {site}: the average of the daily mean flow in each month with at least 25 days recorded.")
            cols.append(col)
        except Exception as e:
            print(f"  usgs_water {site}: {str(e)[:90]}")
        time.sleep(0.5)
    assert len(cols) >= 3, f"usgs_water: only {len(cols)} rivers loaded"
    return series("us-river-flow-monthly", "Flow of major US rivers, monthly", "How much water eight major US rivers carry, month by month, from stream gauges that have run for decades.",
                  "US", "Climate and environment", "US Geological Survey, National Water Information System", "https://waterdata.usgs.gov", PD, cell, meta, cols, "month")


# ---------- US Centers for Disease Control and Prevention: deaths from drug overdoses ----------
OVERDOSE = {"Number of Drug Overdose Deaths": ("all_drug_overdose_deaths", "US deaths from drug overdoses"), "Opioids (T40.0-T40.4,T40.6)": ("opioid_deaths", "US overdose deaths involving opioids"),
            "Synthetic opioids, excl. methadone (T40.4)": ("synthetic_opioid_deaths", "US overdose deaths involving synthetic opioids such as fentanyl"), "Heroin (T40.1)": ("heroin_deaths", "US overdose deaths involving heroin"),
            "Cocaine (T40.5)": ("cocaine_deaths", "US overdose deaths involving cocaine"), "Psychostimulants with abuse potential (T43.6)": ("stimulant_deaths", "US overdose deaths involving methamphetamine and similar stimulants")}
MONTHS = {m: i + 1 for i, m in enumerate("January February March April May June July August September October November December".split())}


def cdc_overdose():
    q = urllib.parse.quote("state='US' AND period='12 month-ending'")
    rows = J(f"https://data.cdc.gov/resource/xkb8-kh2a.json?$select=year,month,indicator,data_value,predicted_value&$where={q}&$limit=50000", tries=2)
    assert isinstance(rows, list) and rows, "no rows: " + json.dumps(rows)[:200]
    cell, meta = {}, {}
    for r in rows:
        hit = OVERDOSE.get(r.get("indicator"))
        raw = r.get("predicted_value") if r.get("indicator") == "Number of Drug Overdose Deaths" and r.get("predicted_value") else r.get("data_value")
        if hit and raw and r.get("month") in MONTHS:
            try:
                cell.setdefault(f"{int(r['year'])}-{MONTHS[r['month']]:02d}-01", {})[hit[0]] = float(str(raw).replace(",", ""))
            except ValueError:
                pass
    for col, title in OVERDOSE.values():
        meta[col] = dict(title=title + ", past 12 months", unit="deaths in the 12 months ending that month", description="Provisional counts from death certificates, CDC National Center for Health Statistics. A death can involve more than one drug, so the drug columns overlap. "
                         + ("This column uses CDC's figure adjusted for reports still to arrive." if col == "all_drug_overdose_deaths" else "Recent months are incomplete."))
    return series("us-drug-overdose-deaths", "US deaths from drug overdoses, 12-month running count", "How many people in the United States died of a drug overdose in the 12 months ending each month, in total and for the main drugs involved.",
                  "US", "Health", "US Centers for Disease Control and Prevention, National Center for Health Statistics", "https://www.cdc.gov/nchs/nvss/vsrr/drug-overdose-data.htm", PD, cell, meta, [c for c, _ in OVERDOSE.values()], "month")


# ---------- Maryland Open Data: crime in the state, year by year ----------
def maryland():
    rows = J("https://opendata.maryland.gov/resource/hyg2-hy98.json?$limit=500", tries=2)
    assert isinstance(rows, list) and len(rows) >= 20 and "year" in rows[0], "unexpected reply: " + json.dumps(rows)[:300]
    print("  maryland fields:", sorted(rows[0])[:40])
    want = [("population", "Maryland population", "people"), ("murder", "Maryland: murders", "offences"), ("rape", "Maryland: rapes", "offences"), ("robbery", "Maryland: robberies", "offences"),
            ("agg_assault", "Maryland: aggravated assaults", "offences"), ("b_e", "Maryland: breaking and entering", "offences"), ("larceny_theft", "Maryland: larceny and theft", "offences"),
            ("m_v_theft", "Maryland: motor vehicle thefts", "offences"), ("grand_total", "Maryland: all serious crimes reported", "offences"), ("violent_crime_total", "Maryland: violent crimes", "offences"),
            ("property_crime_totals", "Maryland: property crimes", "offences"), ("violent_crime_rate_per_100_000_people", "Maryland: violent crime rate", "per 100,000 people"),
            ("property_crime_rate_per_100_000_people", "Maryland: property crime rate", "per 100,000 people"), ("murder_per_100_000_people", "Maryland: murder rate", "per 100,000 people")]
    names = {"b_e": "breaking_and_entering", "agg_assault": "aggravated_assaults", "m_v_theft": "motor_vehicle_thefts", "grand_total": "all_serious_crimes", "violent_crime_total": "violent_crimes", "property_crime_totals": "property_crimes",
             "violent_crime_rate_per_100_000_people": "violent_crime_rate", "property_crime_rate_per_100_000_people": "property_crime_rate", "murder_per_100_000_people": "murder_rate", "murder": "murders", "rape": "rapes", "robbery": "robberies"}
    cell, meta, cols = {}, {}, []
    for f, title, unit in want:
        col = names.get(f, f)
        for r in rows:
            try:
                cell.setdefault(f"{int(float(r['year']))}-01-01", {})[col] = float(r[f])
            except (KeyError, TypeError, ValueError):
                pass
        if any(col in v for v in cell.values()):
            meta[col] = dict(title=title, unit=unit, description="Maryland Statistical Analysis Center, Uniform Crime Reports, statewide totals.")
            cols.append(col)
    return series("maryland-crime", "Maryland: reported crime, year by year", "Serious crimes reported to police across the state of Maryland each year since 1975, as counts and as rates.",
                  "US", "Government and finance", "State of Maryland, Open Data Portal", "https://opendata.maryland.gov", "Open data, State of Maryland", cell, meta, cols, "year")


# ---------- United Kingdom: Office for National Statistics ----------
def uk():
    want = [("economy/inflationandpriceindices/timeseries/d7g7/mm23", "inflation", "UK inflation (consumer prices, change over a year)", "% a year"),
            ("economy/inflationandpriceindices/timeseries/l55o/mm23", "inflation_with_housing", "UK inflation including owner-occupiers' housing costs", "% a year"),
            ("employmentandlabourmarket/peoplenotinwork/unemployment/timeseries/mgsx/lms", "unemployment_rate", "UK unemployment rate", "% of people 16 and over in the labour force"),
            ("employmentandlabourmarket/peopleinwork/employmentandemployeetypes/timeseries/lf24/lms", "employment_rate", "UK employment rate, ages 16 to 64", "% of people aged 16 to 64"),
            ("economy/grossdomesticproductgdp/timeseries/ecy2/mgdp", "monthly_gdp_index", "UK monthly GDP", "index")]
    mon = {m: i + 1 for i, m in enumerate("JAN FEB MAR APR MAY JUN JUL AUG SEP OCT NOV DEC".split())}
    cell, meta, cols = {}, {}, []
    for uri, col, title, unit in want:
        try:
            n = 0
            for r in csv.reader(io.StringIO(text(f"https://www.ons.gov.uk/generator?format=csv&uri=/{uri}", tries=2))):
                m = re.fullmatch(r"(\d{4}) ([A-Z]{3})", r[0].strip()) if r else None
                if m and len(r) > 1 and r[1].strip() not in ("", ".."):
                    cell.setdefault(f"{m.group(1)}-{mon[m.group(2)]:02d}-01", {})[col] = float(r[1])
                    n += 1
            if n < 24:
                raise ValueError(f"{n} months")
            meta[col] = dict(title=title, unit=unit, description=f"UK Office for National Statistics series {uri.split('/')[-2].upper()}.")
            cols.append(col)
        except Exception as e:
            print(f"  uk {uri.split('/')[-2]}: {str(e)[:80]}")
        time.sleep(1)
    assert len(cols) >= 2, f"uk: only {len(cols)} series loaded"
    return series("uk-economy-monthly", "United Kingdom economy, monthly", "Prices, jobs and output in the United Kingdom, month by month, from its national statistics office.",
                  "World", "Economy and development", "UK Office for National Statistics", "https://www.ons.gov.uk", "Open Government Licence v3.0", cell, meta, cols, "month")


# ---------- Climate TRACE: emissions counted from satellites and sensors ----------
def climate_trace():
    cell, names = {}, {}
    known = iso()["name"]
    for y in range(2015, THIS_YEAR):
        try:
            j = J(f"https://api.climatetrace.org/v6/country/emissions?since={y}&to={y}", tries=2)
            rows = j if isinstance(j, list) else j.get("countries") or j.get("data") or []
            if y == 2015 or not rows:
                print(f"  climate_trace {y}: {json.dumps(j)[:260]}")
            for r in rows:
                c, e = r.get("country"), r.get("emissions") or {}
                v = e.get("co2e_100yr")
                if c and len(c) == 3 and v:
                    cell.setdefault((c, y), {})["greenhouse_gas_emissions"] = v
                    names[c] = known.get(c, c)
                    for g in ("co2", "ch4", "n2o"):
                        if e.get(g):
                            cell[(c, y)][g] = e[g]
        except Exception as e:
            print(f"  climate_trace {y}: {str(e)[:80]}")
        time.sleep(0.4)
    meta = dict(greenhouse_gas_emissions=dict(title="Greenhouse gas emissions (Climate TRACE)", unit="tonnes of CO2 equivalent", description="All greenhouse gases over 100 years, estimated independently from satellites and other sensors rather than from what countries report."),
                co2=dict(title="Carbon dioxide emissions (Climate TRACE)", unit="tonnes"), ch4=dict(title="Methane emissions (Climate TRACE)", unit="tonnes of methane"), n2o=dict(title="Nitrous oxide emissions (Climate TRACE)", unit="tonnes of nitrous oxide"))
    return country_year("climate-trace-emissions", "Emissions measured independently (Climate TRACE)", "Greenhouse gas emissions for every country, estimated from satellites and sensors rather than from national reports.",
                        "Climate and environment", "Climate TRACE", "https://climatetrace.org", "CC BY 4.0", cell, names, meta, ["greenhouse_gas_emissions", "co2", "ch4", "n2o"])


# ---------- US mortgages: yearly totals from the Home Mortgage Disclosure Act records ----------
def hmda():
    kinds = dict(mortgages_made="1", applications_denied="3")
    cell = {}
    for y in range(2018, THIS_YEAR):
        for col, action in kinds.items():
            try:
                j = J(f"https://ffiec.cfpb.gov/v2/data-browser-api/view/nationwide/aggregations?years={y}&actions_taken={action}", tries=2)
                a = (j.get("aggregations") or [{}])[0]
                if y == 2018 and col == "mortgages_made":
                    print(f"  hmda {y}: {json.dumps(j)[:220]}")
                if a.get("count"):
                    cell.setdefault(f"{y}-01-01", {})[col] = a["count"]
                    if col == "mortgages_made" and a.get("sum"):
                        cell[f"{y}-01-01"]["amount_lent"] = a["sum"]
            except Exception as e:
                print(f"  hmda {y} {col}: {str(e)[:60]}")
            time.sleep(0.4)
    meta = dict(mortgages_made=dict(title="US mortgages made in the year", unit="loans", description="Home loans originated, from the records lenders file under the Home Mortgage Disclosure Act."),
                amount_lent=dict(title="Amount lent in US mortgages made in the year", unit="current US$"), applications_denied=dict(title="US mortgage applications denied in the year", unit="applications"))
    return series("us-mortgage-lending", "US mortgage lending, year by year", "How many home loans US lenders made each year, how much they lent, and how many applications they turned down.",
                  "US", "Economy and development", "US Federal Financial Institutions Examination Council, HMDA Data Browser", "https://ffiec.cfpb.gov/data-browser/", PD, cell, meta, ["mortgages_made", "amount_lent", "applications_denied"], "year", min_rows=4)


# ---------- Stack Overflow: questions and answers each year ----------
def stackoverflow():
    def count(y, c):
        a, b = int(datetime(y, 1, 1, tzinfo=timezone.utc).timestamp()), int(datetime(y + 1, 1, 1, tzinfo=timezone.utc).timestamp())
        return J(f"https://api.stackexchange.com/2.3/{'questions' if c == 'questions_asked' else 'answers'}?fromdate={a}&todate={b}&site=stackoverflow&filter=total", tries=2)["total"]
    cell = yearly("stack-overflow-activity", 2008, count, ["questions_asked", "answers_posted"], recent=2)
    meta = dict(questions_asked=dict(title="Questions asked on Stack Overflow in the year", unit="questions", description="Questions still on the site, by the year they were asked. The current year is not complete."),
                answers_posted=dict(title="Answers posted on Stack Overflow in the year", unit="answers"))
    out = series("stack-overflow-activity", "Stack Overflow: questions and answers each year", "How much programmers ask and answer on the largest question-and-answer site for code.",
                 "World", "Science and technology", "Stack Exchange API", "https://api.stackexchange.com", "CC BY-SA 4.0", cell, meta, ["questions_asked", "answers_posted"], "year", min_rows=8)
    out["partial"] = True
    return out


# ---------- loaders that wait for a free key ----------
GRID = [("US48", "the lower 48 states"), ("PJM", "PJM (mid-Atlantic and Midwest)"), ("MISO", "MISO (Midwest and South)"), ("ERCO", "ERCOT (Texas)"), ("CISO", "California ISO"), ("SWPP", "Southwest Power Pool"), ("NYIS", "New York ISO"), ("ISNE", "ISO New England")]


def eia_grid():
    k = key("EIA_API_KEY")
    cell, meta, cols = {}, {}, []
    today = date.today().isoformat()
    for code, label in GRID:
        col, got, offset = f"demand_{code.lower()}", 0, 0
        try:
            while True:
                j = J("https://api.eia.gov/v2/electricity/rto/daily-region-data/data/?frequency=daily&data[0]=value&facets[type][]=D&facets[timezone][]=Eastern"
                      f"&facets[respondent][]={code}&start=2019-01-01&sort[0][column]=period&sort[0][direction]=asc&length=5000&offset={offset}&api_key={k}", tries=2)
                rows = j["response"]["data"]
                for r in rows:
                    if r.get("value") is not None and r["period"] < today:
                        cell.setdefault(r["period"][:10], {})[col] = float(r["value"])
                        got += 1
                offset += len(rows)
                if len(rows) < 5000:
                    break
            if got < 100:
                raise ValueError(f"{got} days")
            meta[col] = dict(title=f"Electricity demand in {label}, daily", unit="megawatt-hours in the day", description=f"US Energy Information Administration, Hourly Electric Grid Monitor, balancing authority {code}.")
            cols.append(col)
        except Exception as e:
            print(f"  eia_grid {code}: {str(e)[:60]}")
    assert len(cols) >= 4, f"eia_grid: only {len(cols)} regions loaded"
    return series("us-grid-demand-daily", "US electricity demand by grid operator, daily", "How much electricity the main US power grids deliver each day, from the grid operators' own reports.",
                  "US", "Energy", "US Energy Information Administration, Hourly Electric Grid Monitor (data from PJM, MISO, ERCOT, CAISO, SPP, NYISO and ISO New England)", "https://www.eia.gov/electricity/gridmonitor/", PD, cell, meta, cols, "day")


def us_lawmaking():
    k = key("DATA_GOV_API_KEY")
    h = {"X-Api-Key": k}
    cell = {}
    for n in range(93, 1 + (THIS_YEAR - 1789) // 2 + 1):          # the 93rd Congress sat from 1973
        d = f"{1789 + 2 * (n - 1)}-01-01"
        for col, path in (("bills_introduced", "bill"), ("laws_enacted", "law")):
            try:
                cell.setdefault(d, {})[col] = J(f"https://api.congress.gov/v3/{path}/{n}?format=json&limit=1", headers=h, tries=2)["pagination"]["count"]
            except Exception as e:
                print(f"  congress {n} {col}: {str(e)[:50]}")
            time.sleep(0.3)
    for y in range(2006, THIS_YEAR + 1):
        d = f"{y}-01-01"
        for col, path in (("regulatory_documents_posted", "documents"), ("public_comments_posted", "comments")):
            try:
                cell.setdefault(d, {})[col] = J(f"https://api.regulations.gov/v4/{path}?filter[postedDate][ge]={y}-01-01&filter[postedDate][le]={y}-12-31&page[size]=5", headers=h, tries=2)["meta"]["totalElements"]
            except Exception as e:
                print(f"  regulations {y} {col}: {str(e)[:50]}")
            time.sleep(0.3)
    cell = {d: v for d, v in cell.items() if v}
    meta = dict(bills_introduced=dict(title="Bills introduced in the US Congress that began that year", unit="bills", description="Congress.gov. Each Congress lasts two years, so there is one figure every second year; the current Congress is not finished."),
                laws_enacted=dict(title="Laws enacted by the US Congress that began that year", unit="laws", description="Congress.gov."),
                regulatory_documents_posted=dict(title="Documents posted on Regulations.gov in the year", unit="documents", description="Rules, proposed rules, notices and supporting papers posted by US federal agencies."),
                public_comments_posted=dict(title="Public comments posted on Regulations.gov in the year", unit="comments"))
    out = series("us-congress-and-rulemaking", "US Congress and federal rulemaking, by year", "How many bills Congress takes up and passes, and how much federal agencies post and the public comments on.",
                 "US", "Government and finance", "Library of Congress (Congress.gov) and US General Services Administration (Regulations.gov)", "https://api.data.gov", PD, cell, meta,
                 ["bills_introduced", "laws_enacted", "regulatory_documents_posted", "public_comments_posted"], "year", min_rows=8)
    out["partial"] = True
    return out


# ---------- US Census Bureau: every state, year by year ----------
USPS = dict(zip("01 02 04 05 06 08 09 10 11 12 13 15 16 17 18 19 20 21 22 23 24 25 26 27 28 29 30 31 32 33 34 35 36 37 38 39 40 41 42 44 45 46 47 48 49 50 51 53 54 55 56 72".split(),
                "AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY PR".split()))
ACS = [("B01003_001E", "population"), ("B19013_001E", "median_household_income"), ("B01002_001E", "median_age"), ("B25077_001E", "median_home_value"), ("B25064_001E", "median_rent")]
ACS_SHARES = [  # (codes, column, how to turn the counts into a percentage)
    ("B17001_002E,B17001_001E", "poverty_rate", lambda v: 100 * v[0] / v[1]),
    ("B15003_022E,B15003_023E,B15003_024E,B15003_025E,B15003_001E", "adults_with_a_degree", lambda v: 100 * sum(v[:4]) / v[4]),
    ("B23025_005E,B23025_003E", "unemployment_rate", lambda v: 100 * v[0] / v[1]),
]


def census_states():
    k = key("CENSUS_API_KEY")
    id, cell, names = "us-states-census", {}, {}
    path = SETS / f"{id}.csv"
    if path.exists():                                       # earlier years do not change: keep them and ask only for the recent ones
        with open(path, encoding="utf-8") as f:
            for r in csv.DictReader(f):
                names[r["state"]] = r["state_name"]
                cell[(r["state"], int(r["year"]))] = {c: float(v) for c, v in r.items() if c not in ("state", "state_name", "year") and v != ""}
    have = {y for _, y in cell}

    def grab(url):
        rows = J(url, tries=2)
        return [dict(zip(rows[0], r)) for r in rows[1:]]

    def val(x):
        try:
            v = float(x)
            return v if v >= 0 else None                    # the Census Bureau writes large negative numbers for "not available"
        except (TypeError, ValueError):
            return None
    for y in range(2010, THIS_YEAR):
        if y in have and y < THIS_YEAR - 3:
            continue
        base = f"https://api.census.gov/data/{y}/acs/acs1?key={k}&for=state:*&get=NAME,"
        try:
            for r in grab(base + ",".join(c for c, _ in ACS)):
                st = USPS.get(r["state"])
                if not st:
                    continue
                names[st] = r["NAME"]
                for code, col in ACS:
                    if val(r[code]) is not None:
                        cell.setdefault((st, y), {})[col] = val(r[code])
        except Exception as e:
            print(f"  census acs {y}: {str(e)[:70]}")
            continue
        for codes, col, share in ACS_SHARES:
            try:
                for r in grab(base + codes):
                    v = [val(r[c]) for c in codes.split(",")]
                    if USPS.get(r["state"]) and None not in v and v[-1]:
                        cell.setdefault((USPS[r["state"]], y), {})[col] = round(share(v), 2)
            except Exception as e:
                print(f"  census acs {y} {col}: {str(e)[:60]}")
            time.sleep(0.3)
        for vintage in ("NAICS2022", "NAICS2017", "NAICS2012"):   # businesses, from County Business Patterns; the industry list is renamed every five years
            try:
                for r in grab(f"https://api.census.gov/data/{y}/cbp?key={k}&get=ESTAB,EMP,PAYANN&for=state:*&{vintage}=00"):
                    st = USPS.get(r["state"])
                    if st and val(r["ESTAB"]):
                        cell.setdefault((st, y), {}).update({k: v for k, v in (("business_establishments", val(r["ESTAB"])), ("employees_at_businesses", val(r["EMP"])),
                                                                             ("annual_payroll", val(r["PAYANN"]) * 1000 if val(r["PAYANN"]) is not None else None)) if v is not None})
                break
            except Exception:
                time.sleep(0.2)
        time.sleep(0.3)
    cols = [c for _, c in ACS] + [c for _, c, _ in ACS_SHARES] + ["business_establishments", "employees_at_businesses", "annual_payroll"]
    cols = [c for c in cols if any(c in v for v in cell.values())]
    S = "US Census Bureau, American Community Survey, 1-year estimates"
    meta = dict(population=dict(title="Population of the state", unit="people", description=S + ", table B01003."),
                median_household_income=dict(title="Median household income", unit="US$ a year, in that year's dollars", description=S + ", table B19013. Not adjusted for inflation."),
                median_age=dict(title="Median age", unit="years", description=S + ", table B01002."),
                median_home_value=dict(title="Median value of owner-occupied homes", unit="US$", description=S + ", table B25077."),
                median_rent=dict(title="Median monthly rent, with utilities", unit="US$ a month", description=S + ", table B25064 (gross rent)."),
                poverty_rate=dict(title="People living below the poverty line", unit="% of people", description=S + ", table B17001."),
                adults_with_a_degree=dict(title="Adults aged 25 and over with a bachelor's degree or higher", unit="% of adults 25 and over", description=S + ", table B15003."),
                unemployment_rate=dict(title="Unemployment rate (survey-based)", unit="% of the civilian labour force", description=S + ", table B23025. This differs slightly from the official monthly rate."),
                business_establishments=dict(title="Business establishments", unit="establishments", description="US Census Bureau, County Business Patterns: places of business with paid employees."),
                employees_at_businesses=dict(title="Employees at those businesses", unit="people", description="US Census Bureau, County Business Patterns: employees in the pay period including March 12."),
                annual_payroll=dict(title="Annual payroll of those businesses", unit="US$", description="US Census Bureau, County Business Patterns."))
    rows = [[st, names.get(st, st), y] + [num(v.get(c)) for c in cols] for (st, y), v in sorted(cell.items())]
    assert len(rows) >= 200 and len({r[2] for r in rows}) >= 5, f"{id}: only {len(rows)} rows"
    return table(id, "US states: people, income, housing and business", "Every US state, the District of Columbia and Puerto Rico, year by year: population, income, age, home values, rent, poverty, education, unemployment and businesses.",
                 "US", "People and society", "US Census Bureau, American Community Survey and County Business Patterns", "https://www.census.gov/data/developers/data-sets.html", PD,
                 ["state", "year"], "year", "year", dict(col="state", label_col="state_name", label="State"), ["state", "state_name", "year"] + cols, rows, meta)



BUILDERS = [(lambda s=s: wb_set(s[0], s[1], s[2], s[3], s[4], s[5], **s[6])) for s in WB_SETS] + [(lambda s=s: owid_charts(*s)) for s in OWID_SETS] + [
    imf, un_population, undp, who, pwt, us_monthly, us_quarterly, us_daily, us_debt, us_climate, wikipedia, research, gbif, github_activity,
    federal_register, fda, clinical_trials, fema, fdic, flu, chicago, nyc, us_spending, nih, eurostat, world_monthly, cfpb, usgs_water, cdc_overdose, maryland, uk, climate_trace, hmda, stackoverflow,
    eia_grid, us_lawmaking, census_states,
]
NAMES = [s[0] for s in WB_SETS] + [s[0] for s in OWID_SETS] + ["imf", "un_population", "undp", "who", "pwt", "us_monthly", "us_quarterly", "us_daily", "us_debt", "us_climate", "wikipedia", "research", "gbif",
                                    "github_activity", "federal_register", "fda", "clinical_trials", "fema", "fdic", "flu", "chicago", "nyc", "us_spending", "nih", "eurostat", "world_monthly", "cfpb", "usgs_water", "cdc_overdose", "maryland", "uk", "climate_trace", "hmda", "stackoverflow",
                                    "eia_grid", "us_lawmaking", "census_states"]
