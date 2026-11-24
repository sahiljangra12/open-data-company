"""PJM summer peak forecast scorecard (preview).

Compares the summer peak that PJM forecast for a year (January load report, Table B-1,
a normal-weather forecast) with the weather-normalized summer peak PJM later reported
for that year (next January's report, Table F-3). Metered peaks are kept for reference.
error_pct > 0 means the forecast was too high.
"""
import json, re, sys
from pathlib import Path
import openpyxl

ROOT = Path(__file__).resolve().parents[1]
RAW = ROOT / "data" / "raw" / "pjm"
SKIP = ("DIVERSITY", "FE-EAST", "PLGRP")

def table(year, sheet):
    wb = openpyxl.load_workbook(RAW / f"{year}-load-report-tables.xlsx", read_only=True, data_only=True)
    rows = [list(r) for r in wb[sheet].iter_rows(values_only=True)]
    hdr = next(i for i, r in enumerate(rows) if any(isinstance(c, str) and re.match(r"(Metered|Summer) 20\d\d", c.strip()) for c in r))
    return rows[hdr], rows[hdr + 1:]

def named(rows):
    return {str(r[0]).strip(): r for r in rows if isinstance(r[0], str) and r[0].strip() and isinstance(r[1], (int, float))}

def main(target=2025):
    h_f, r_f = table(target, "Table B1")          # forecast vintage: January of target year
    h_a, r_a = table(target + 1, "Table B1")      # next vintage: metered actual + revised outlook
    h_w, r_w = table(target + 1, "Table F3")      # weather-normalized actual
    assert f"Metered {target}" in str(h_a[1]) and f"Summer {target}" in str(h_w[1])
    col = lambda h, y: h.index(y)
    f, a, w = named(r_f), named(r_a), named(r_w)
    horizon = target + 2
    zones = []
    for z, row in f.items():
        if z.startswith(SKIP) or z not in w or z not in a:
            continue
        fc, wn, met = row[col(h_f, target)], w[z][1], a[z][1]
        old, new = row[col(h_f, horizon)], a[z][col(h_a, horizon)]
        zones.append(dict(zone=z, region=z.startswith("PJM"), forecast_mw=round(fc), normalized_mw=round(wn),
                          metered_mw=round(met), error_mw=round(fc - wn), error_pct=round(100 * (fc - wn) / wn, 2),
                          outlook_year=horizon, outlook_old_mw=round(old), outlook_new_mw=round(new),
                          outlook_revision_pct=round(100 * (new - old) / old, 2)))
    zs = [z for z in zones if not z["region"]]
    out = dict(target_year=target, forecast_vintage=f"January {target} PJM Load Forecast Report, Table B-1",
               actual_source=f"January {target + 1} PJM Load Forecast Report, Tables F-3 and B-1",
               n_zones=len(zs), mean_abs_error_pct=round(sum(abs(z["error_pct"]) for z in zs) / len(zs), 2),
               n_over=sum(z["error_pct"] > 0 for z in zs), n_under=sum(z["error_pct"] < 0 for z in zs), zones=zones)
    (ROOT / "docs" / "data" / "scorecard.json").write_text(json.dumps(out, indent=1))
    print(json.dumps({k: v for k, v in out.items() if k != "zones"}, indent=1))
    for z in sorted(zones, key=lambda z: -abs(z["error_pct"])):
        print(f"{z['zone']:18}{z['forecast_mw']:>8}{z['normalized_mw']:>8}{z['metered_mw']:>8}{z['error_pct']:>7}{z['outlook_revision_pct']:>8}")

if __name__ == "__main__":
    main(int(sys.argv[1]) if len(sys.argv) > 1 else 2025)
