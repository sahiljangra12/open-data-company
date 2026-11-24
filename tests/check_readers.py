"""Checks docs/assets/readers.js: writes the same table in every supported format with pandas, pyarrow and pyreadstat,
reads each file back with the site's own code, and compares cell by cell.
   python tests/check_readers.py   (needs node, numpy, pandas, openpyxl, pyarrow, pyreadstat)"""
import gzip, json, subprocess, sys, tempfile
from pathlib import Path
import numpy as np, pandas as pd, pyreadstat

rng = np.random.default_rng(11)
n = 80
LAB = {1: "Control", 2: "Treatment A", 3: "Treatment B"}
note = [f'row {i}, said "hello"' + ("\nsecond line" if i % 9 == 0 else "") + (" " + "long text " * 40 if i % 13 == 0 else "") for i in range(n)]
df = pd.DataFrame(dict(
    id=np.arange(1, n + 1),
    score=np.where(rng.random(n) < 0.1, np.nan, rng.normal(50, 10, n).round(3)),
    city=rng.choice(["Mumbai", "São Paulo", "Zürich", "New York", None], n),
    note=note,
    group=rng.integers(1, 4, n),
    when=pd.to_datetime("2020-01-01") + pd.to_timedelta(rng.integers(0, 2000, n), unit="D"),
    big=rng.integers(-2_000_000_000, 2_000_000_000, n),
    small=rng.integers(-5, 90, n).astype("int8"),
    ratio=rng.random(n).astype("float32"),
))
tmp = Path(tempfile.mkdtemp())
files = {}                                                     # name -> (expected frame, options)

def add(name, frame, **opt):
    files[name] = (frame, opt)

plain = df.assign(when=df["when"].dt.strftime("%Y-%m-%d"))
plain.to_csv(tmp / "comma.csv", index=False); add("comma.csv", plain)
plain.to_csv(tmp / "tabs.tsv", index=False, sep="\t"); add("tabs.tsv", plain)
plain.to_csv(tmp / "semi.csv", index=False, sep=";"); add("semi.csv", plain)
plain.to_csv(tmp / "pipe.txt", index=False, sep="|"); add("pipe.txt", plain)
(tmp / "bom.csv").write_bytes(b"\xef\xbb\xbf" + plain.to_csv(index=False).encode()); add("bom.csv", plain)
(tmp / "latin.csv").write_bytes(plain.to_csv(index=False).encode("cp1252")); add("latin.csv", plain)
(tmp / "utf16.csv").write_bytes(plain.to_csv(index=False).encode("utf-16")); add("utf16.csv", plain)
with gzip.open(tmp / "packed.csv.gz", "wb") as f: f.write(plain.to_csv(index=False).encode()); add("packed.csv.gz", plain)
plain.to_csv(tmp / "nohead.csv", index=False, header=False); add("nohead.csv", plain, numbered=True)
plain.to_json(tmp / "records.json", orient="records"); add("records.json", plain)
(tmp / "columns.json").write_text(json.dumps({c: json.loads(plain[c].to_json(orient="values")) for c in plain.columns})); add("columns.json", plain)
(tmp / "wrapped.json").write_text(json.dumps({"meta": {"n": n}, "result": {"data": json.loads(plain.to_json(orient="records"))}})); add("wrapped.json", plain)
plain.to_json(tmp / "lines.jsonl", orient="records", lines=True); add("lines.jsonl", plain)
wide = pd.DataFrame({"country": ["A", "B", "C"], "2019": [1.5, 2.5, 3.5], "2020": [2, 3, 4], "2021": [9, 8, 7]})
wide.to_csv(tmp / "wide.csv", index=False); add("wide.csv", wide)
df.to_excel(tmp / "book.xlsx", index=False, sheet_name="data"); add("book.xlsx", df)
with pd.ExcelWriter(tmp / "titled.xlsx") as w: df.to_excel(w, index=False, startrow=3, sheet_name="data")
add("titled.xlsx", df)
df.to_parquet(tmp / "snappy.parquet", index=False); add("snappy.parquet", df)
df.to_parquet(tmp / "zstd.parquet", index=False, compression="zstd"); add("zstd.parquet", df)
df.to_parquet(tmp / "gzip.parquet", index=False, compression="gzip"); add("gzip.parquet", df)
labelled = df.assign(group=df["group"].map(LAB))
for name, kw in (("plain.sav", dict(row_compress=False)), ("bytecode.sav", dict(row_compress=True)), ("zlib.zsav", dict(compress=True))):
    pyreadstat.write_sav(df, str(tmp / name), variable_value_labels={"group": LAB}, column_labels={"score": "Test score, points", "city": "City of residence"}, **kw)
    add(name, labelled, labels={"score": "Test score, points", "city": "City of residence"})
short = df.assign(note=df["note"].str.slice(0, 200), group=pd.Categorical(df["group"].map(LAB), categories=list(LAB.values())))
for v in (114, 117, 118, 119):
    kw = dict(version=v, write_index=False, convert_dates={"when": "td"}, variable_labels={"score": "Test score, points"})
    frame = short if v == 114 else df.assign(group=short["group"])
    if v >= 117: kw["convert_strl"] = ["note"]
    frame.to_stata(tmp / f"v{v}.dta", **kw); add(f"v{v}.dta", frame.assign(group=frame["group"].astype(str)), labels={"score": "Test score, points"})

import os
bad, cells = [], 0
for zone in ("UTC", "Asia/Kolkata", "America/Los_Angeles"):        # dates must not shift with the reader's time zone
  got = json.loads(subprocess.run(["node", str(Path(__file__).with_name("run_readers.js"))] + [str(tmp / f) for f in files], capture_output=True, text=True, check=True, env=dict(os.environ, TZ=zone)).stdout)
  for name, (frame, opt) in files.items():
      g = got[name]
      if "error" in g: bad.append((zone, name, g["error"])); continue
      want_cols = [f"column {i + 1}" for i in range(frame.shape[1])] if opt.get("numbered") else list(frame.columns)
      if g["columns"] != want_cols: bad.append((name, "columns", g["columns"], want_cols)); continue
      if len(g["rows"]) != len(frame): bad.append((name, "row count", len(g["rows"]), len(frame))); continue
      for want, have in opt.get("labels", {}).items():
          if g["labels"].get(want) != have: bad.append((name, "label", want, g["labels"].get(want)))
      for i, (_, row) in enumerate(frame.iterrows()):
          for j, w in enumerate(row):
              h = g["rows"][i][j]; cells += 1
              if isinstance(h, dict): h = h["$date"][:10]
              missing = w is None or (isinstance(w, float) and np.isnan(w)) or w is pd.NaT
              if missing: ok = h is None or h == ""
              elif isinstance(w, pd.Timestamp): ok = str(h)[:10] == w.strftime("%Y-%m-%d")
              elif isinstance(w, (int, float, np.integer, np.floating)):
                  try: ok = h is not None and abs(float(h) - float(w)) <= 1e-6 * max(1, abs(float(w)))
                  except (TypeError, ValueError): ok = False
              else: ok = str(h).rstrip(" ") == str(w).rstrip(" ") or (h is None and str(w) == "")      # fixed-width formats pad text with spaces
              if not ok and len(bad) < 30: bad.append((name, i, frame.columns[j], repr(h)[:60], repr(w)[:60]))
print(f"{len(files)} files in {len({f.rsplit('.', 1)[-1] for f in files})} formats read back in 3 time zones; {cells} cells compared")
for b in bad: print("  MISMATCH", b)
sys.exit(1 if bad else 0)
