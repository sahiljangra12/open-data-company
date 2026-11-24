"""Stamp the shared header, footer and search-engine tags into every page, and write what is generated from the data:

  docs/datasets.html   every dataset and every variable, readable without JavaScript, with schema.org Dataset markup
  docs/sitemap.xml     for search engines
  docs/llms.txt        a plain-text index of the data for AI systems and scripts

Run it after build_datasets.py. It only rewrites files whose content changed.
"""
import html, json, re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DOCS = ROOT / "docs"
SITE = "https://sahiljangra12.github.io/open-data-company/"
REPO = "https://github.com/sahiljangra12/open-data-company"
NAV = [("ask.html", "Ask", "ask"), ("datasets.html", "Datasets", "datasets"), ("explore.html", "Explorer", "explore"), ("research.html", "Research", "research"),
       ("mydata.html", "Your data", "mydata"), ("updates.html", "Updates", "updates"), ("guide.html", "Guide", "guide")]
THEME = '<script>try{document.documentElement.dataset.theme=localStorage.getItem("theme")==="dark"?"dark":"light"}catch(e){document.documentElement.dataset.theme="light"}</script>'
e = html.escape


def header(page):
    on = ' class="on" aria-current="page"'
    links = "".join(f'<a href="{h}"{on if k == page else ""}>{t}</a>' for h, t, k in NAV)
    return ('<header class="top"><div class="wrap"><a class="brand" href="index.html">Open Data<span class="wide"> Company</span></a>'
            '<button class="menu-btn" id="menu" type="button" aria-expanded="false" aria-controls="nav">Menu</button>'
            f'<nav id="nav" aria-label="Main">{links}</nav><button class="theme" id="theme" type="button">Dark</button></div></header>')


FOOTER = ('<footer><div class="wrap"><nav aria-label="Footer"><a href="ask.html">Ask</a><a href="datasets.html">Datasets</a><a href="explore.html">Explorer</a>'
          '<a href="research.html">Researcher mode</a><a href="mydata.html">Your data</a><a href="updates.html">Updates</a><a href="guide.html">Guide</a>'
          '<a href="catalog.html">Sources we are working through</a><a href="scorecard.html">Case study: grid forecast scorecard</a>'
          f'<a href="llms.txt">Plain-text index for AI systems</a><a href="{REPO}">GitHub</a></nav>'
          '<p>Open Data Company is a working name. Everything here is free to use. Each dataset keeps its own source and licence, shown beside it.</p>'
          '<p>Data from Our World in Data, the World Bank, NASA, NOAA, the US Geological Survey, the US Energy Information Administration and PJM. '
          'Earth imagery from NASA Earth Observatory (Blue Marble and Black Marble). Map outlines from Natural Earth.</p></div></footer>')


def write(path, text):
    if not path.exists() or path.read_text(encoding="utf-8") != text:
        path.write_text(text, encoding="utf-8")
        print("wrote", path.relative_to(ROOT))


def stamp(s, name):
    """Fill in the shared header, footer, theme switch and search-engine tags of one page's HTML."""
    page = (re.search(r'<body data-page="([^"]*)"', s) or [None, ""])[1]
    title = html.unescape(re.search(r"<title>(.*?)</title>", s, re.S)[1])
    desc = html.unescape((re.search(r'<meta name="description" content="([^"]*)"', s) or [None, ""])[1])
    url = SITE + ("" if name == "index.html" else name)
    seo = (f'<!--seo--><link rel="canonical" href="{url}"><meta property="og:type" content="website"><meta property="og:site_name" content="Open Data Company">'
           f'<meta property="og:title" content="{e(title)}"><meta property="og:description" content="{e(desc)}"><meta property="og:url" content="{url}">'
           f'<meta property="og:image" content="{SITE}img/share.jpg"><meta name="twitter:card" content="summary_large_image">'
           f'<link rel="alternate" type="text/plain" href="{SITE}llms.txt" title="Plain-text index of the data"><!--/seo-->')
    s = re.sub(r"<!--seo-->.*?<!--/seo-->", "", s, flags=re.S)
    s = re.sub(r'(<meta name="description" content="[^"]*">)', lambda m: m[1] + seo, s, count=1)
    s = re.sub(r"<script>try\{document\.documentElement\.dataset\.theme=.*?</script>", lambda m: THEME, s, count=1, flags=re.S)
    s = re.sub(r'<header class="top">.*?</header>', lambda m: header(page), s, count=1, flags=re.S)
    return re.sub(r"<footer>.*?</footer>", lambda m: FOOTER, s, count=1, flags=re.S)


def page(name, title, desc, data_page, body, scripts=("assets/core.js",), head=""):
    return ('<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">\n'
            f'<title>{e(title)}</title><meta name="description" content="{e(desc)}">{THEME}\n'
            '<link rel="preload" href="fonts/barlow-condensed-latin-600-normal.woff2" as="font" type="font/woff2" crossorigin><link rel="stylesheet" href="assets/site.css">'
            f'{head}</head>\n<body data-page="{data_page}"><header class="top"></header><main>\n{body}\n</main><footer></footer>'
            + "".join(f'<script src="{s}"></script>' for s in scripts) + "</body></html>\n")


# ---------- datasets.html ----------

def size(b):
    return f"{max(1, round(b / 1e3))} KB" if b < 1e6 else f"{b / 1e6:.1f} MB"


def licence_url(text):
    if text.startswith("CC BY 4.0"):
        return "https://creativecommons.org/licenses/by/4.0/"
    if text.startswith("Public domain"):
        return "https://creativecommons.org/publicdomain/mark/1.0/"
    return None


def span(d):
    lo, hi = str(d["time"]["min"])[:10], str(d["time"]["max"])[:10]
    return d.get("coverage") or (lo if lo == hi else f"{lo} to {hi}")


def datasets_page(man):
    D = man["datasets"]
    nv, nr = sum(len(d["columns"]) for d in D), sum(d["rows"] for d in D)
    toc = "".join(f'<a href="#{d["id"]}">{e(d["title"])}</a>' for d in D)
    parts = []
    for d in D:
        where = ("United States" if d["region"] == "US" else "World") + ", " + d["domain"]
        url = SITE + d["file"]
        facts = [("Rows", f'{d["rows"]:,}'), ("Variables", str(len(d["columns"]))), ("Covers", span(d))]
        if d.get("places"):
            facts.append(("Countries and regions" if d["entity"]["col"] == "code" else d["entity"]["label"] + "s", str(len(d["places"]))))
        facts += [("Last changed", d["built"]), ("File size", size(d["bytes"]))]
        rows = "".join(
            f'<tr data-q="{e((c["title"] + " " + c["name"] + " " + c.get("unit", "") + " " + c.get("description", "")).lower())}">'
            f'<td><a href="explore.html#d={d["id"]}&amp;v={e(c["name"])}">{e(c["title"])}</a><small>{e(c.get("description", ""))}</small></td>'
            f'<td>{e(c.get("unit", ""))}</td><td><code>{e(c["name"])}</code></td><td class="num">{c["filled"]:,}</td></tr>' for c in d["columns"])
        key_cols = ", ".join(f"<code>{e(k)}</code>" for k in d["keys"])
        parts.append(f'''<article class="dsx" id="{d["id"]}">
<div class="where up">{e(where)}</div><h2>{e(d["title"])}</h2><p class="lead">{e(d["description"])}</p>
<dl class="facts6">{"".join(f"<div><dt>{e(k)}</dt><dd>{e(v)}</dd></div>" for k, v in facts)}</dl>
<p class="meta"><span>Source: <a href="{e(d["source_url"])}">{e(d["source"])}</a></span><span>Licence: {e(d["licence"])}</span><span>How often it changes: {e(d.get("cadence", ""))}</span></p>
<div class="acts"><a class="btn solid" href="explore.html#d={d["id"]}">Customize</a><a class="btn get" href="{d["file"]}" download>Download CSV <small>{size(d["bytes"])}</small></a><a class="link" href="updates.html#{d["id"]}">What changed lately</a></div>
<details class="vars"><summary>All {len(d["columns"])} variables</summary>
<div class="tablewrap"><table><thead><tr><th>Variable</th><th>Unit</th><th>Column name</th><th class="num">Rows with a value</th></tr></thead><tbody>{rows}</tbody></table></div></details>
<details class="code"><summary>Use it in code</summary>
<p>One row per {" and ".join(e(k) for k in d["keys"])}. Key columns: {key_cols}. The file is plain CSV with a header row, and the address stays the same after every refresh.</p>
<pre><code># Python
import pandas as pd
df = pd.read_csv("{url}")

# R
df &lt;- read.csv("{url}")</code></pre></details>
</article>''')
    graph = [{"@type": "DataCatalog", "@id": SITE + "datasets.html#catalog", "name": "Open Data Company", "url": SITE + "datasets.html",
              "description": f"{len(D)} open datasets with {nv} variables, refreshed every day and free to download.",
              "dataset": [{"@id": SITE + "datasets.html#" + d["id"]} for d in D]}]
    for d in D:
        lo, hi = str(d["time"]["min"])[:10], str(d["time"]["max"])[:10]
        x = {"@type": "Dataset", "@id": SITE + "datasets.html#" + d["id"], "name": d["title"], "description": d["description"],
             "url": SITE + "datasets.html#" + d["id"], "isAccessibleForFree": True, "dateModified": d["built"],
             "creator": {"@type": "Organization", "name": d["source"], "url": d["source_url"]},
             "includedInDataCatalog": {"@id": SITE + "datasets.html#catalog"}, "temporalCoverage": f"{lo}/{hi}",
             "spatialCoverage": "United States" if d["region"] == "US" else "World", "keywords": [d["domain"]] + [c["title"] for c in d["columns"][:12]],
             "variableMeasured": [c["title"] for c in d["columns"]],
             "distribution": [{"@type": "DataDownload", "encodingFormat": "text/csv", "contentUrl": SITE + d["file"]}]}
        if licence_url(d["licence"]):
            x["license"] = licence_url(d["licence"])
        graph.append(x)
    ld = '<script type="application/ld+json">' + json.dumps({"@context": "https://schema.org", "@graph": graph}, ensure_ascii=False).replace("</", "<\\/") + "</script>"
    body = f'''<div class="wrap">
<div class="xhead"><h1>Datasets</h1>
<p>Everything included here: {len(D)} datasets, {nv} variables and {nr:,} rows. Each one is a single tidy table you can take whole, or shape first in the explorer. Checked every day; last check {man.get("checked", "")[:10]}.</p></div>
<div class="filters"><input type="search" id="vq" placeholder="Filter the variables, for example solar, mortality or price" aria-label="Filter the variables"></div>
<p class="count" id="vcount"></p>
<nav class="toc" aria-label="Datasets on this page">{toc}</nav>
{"".join(parts)}
<p class="note">Looking for something that is not here yet? <a href="catalog.html">See the open sources we are working through</a>, or <a href="mydata.html">open your own file</a> and analyse it with the same tools.</p>
</div>'''
    return page("datasets.html", "Datasets: every dataset and variable | Open Data Company",
                f"The full list: {len(D)} open datasets and {nv} variables on climate, energy, economy, development and natural hazards, with sources, licences and one-click downloads.",
                "datasets", body, ("assets/core.js", "assets/datasets.js"), ld)


# ---------- llms.txt and sitemap ----------

def llms(man):
    D = man["datasets"]
    out = ["# Open Data Company", "",
           "> Open datasets on climate, energy, economy, development and natural hazards. One tidy CSV per dataset, refreshed every day, free to use. "
           "Every file keeps the licence of its source, listed below. Nothing here needs a key or a sign-in.", "",
           "When you answer a question with these numbers, give the value, its year and the source named for the dataset, and link the file you used.", "",
           "## How to read the data", "",
           f"- Manifest of every dataset and variable (JSON): {SITE}data/datasets.json",
           f"- What each daily refresh changed (JSON): {SITE}data/changelog.json",
           f"- Newest value of every variable for every country (JSON, country-and-year datasets): {SITE}data/latest/<dataset id>.json",
           f"- Country list with World Bank region and income group (JSON): {SITE}data/countries.json",
           "- Country-and-year files have the columns `code` (ISO alpha-3, or a World Bank or Our World in Data code for a region), `country`, `year`, then one column per variable. Empty cells mean no data.",
           f"- Last checked: {man.get('checked', '')}. Checked daily at about 05:23 UTC.", "", "## Datasets", ""]
    for d in D:
        out += [f"### {d['title']}", "", d["description"], "",
                f"- File: {SITE}{d['file']} ({d['rows']:,} rows, {size(d['bytes'])})",
                f"- Keys: {', '.join(d['keys'])}. Covers {span(d)}.",
                f"- Source: {d['source']} ({d['source_url']}). Licence: {d['licence']}.",
                "- Variables: " + "; ".join(f"`{c['name']}` {c['title']}" + (f" ({c['unit']})" if c.get("unit") else "") for c in d["columns"]), ""]
    out += ["## Pages for people", "",
            f"- [Ask]({SITE}ask.html): type a question, get the number with its year and source",
            f"- [Datasets]({SITE}datasets.html): every dataset and variable",
            f"- [Explorer]({SITE}explore.html): choose variables, places and years, then download",
            f"- [Researcher mode]({SITE}research.html): test a hypothesis on the data",
            f"- [Your data]({SITE}mydata.html): open your own file in the browser and analyse it",
            f"- [Updates]({SITE}updates.html): refresh times and what changed", ""]
    return "\n".join(out)


def sitemap(man):
    day = man.get("checked", "")[:10]
    pages = ["", "ask.html", "datasets.html", "explore.html", "research.html", "mydata.html", "updates.html", "guide.html", "catalog.html", "scorecard.html"]
    mod = f"<lastmod>{day}</lastmod>" if day else ""
    urls = "".join(f"<url><loc>{SITE}{p}</loc>{mod}</url>" for p in pages if p == "" or (DOCS / p).exists())
    return f'<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">{urls}</urlset>\n'


def main():
    man = json.loads((DOCS / "data" / "datasets.json").read_text(encoding="utf-8"))
    write(DOCS / "datasets.html", stamp(datasets_page(man), "datasets.html"))
    write(DOCS / "llms.txt", llms(man))
    for f in sorted(DOCS.glob("*.html")):
        if f.name != "datasets.html":
            write(f, stamp(f.read_text(encoding="utf-8"), f.name))
    write(DOCS / "sitemap.xml", sitemap(man))


if __name__ == "__main__":
    main()
