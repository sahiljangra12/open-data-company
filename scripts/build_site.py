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
# The pages of the app, in the order they appear in the side bar. The first four are also the tabs along the foot of a phone screen.
NAV = [("index.html", "Home", "home"), ("ask.html", "Data AI", "ask"), ("datasets.html", "Datasets", "datasets"), ("explore.html", "Explorer", "explore"),
       ("research.html", "Research", "research"), ("mydata.html", "Your data", "mydata"), ("updates.html", "Updates", "updates"),
       ("brief.html", "Daily brief", "brief"), ("guide.html", "Guide", "guide")]
TABS = 4
ICON = {  # line drawings on a 24 by 24 grid, one path each
    "mark": "M12 3.5a8.5 8.5 0 1 0 0 17 8.5 8.5 0 0 0 0-17zM3.5 12h17M12 3.5c2.6 2.4 3.9 5.2 3.9 8.5s-1.3 6.1-3.9 8.5c-2.6-2.4-3.9-5.2-3.9-8.5S9.4 5.9 12 3.5z",
    "home": "M4 11.5 12 4l8 7.5M6.5 10v9.5h11V10M10 19.5v-5h4v5",
    "ask": "M5 5.5h14A1.5 1.5 0 0 1 20.5 7v8a1.5 1.5 0 0 1-1.5 1.5h-6L8.5 20v-3.5H5A1.5 1.5 0 0 1 3.5 15V7A1.5 1.5 0 0 1 5 5.5zM8 9h8M8 12.5h5",
    "datasets": "M5 6.5C5 5.1 8.1 4 12 4s7 1.1 7 2.5S15.9 9 12 9 5 7.9 5 6.5zM5 6.5V12c0 1.4 3.1 2.5 7 2.5s7-1.1 7-2.5V6.5M5 12v5.5C5 18.9 8.1 20 12 20s7-1.1 7-2.5V12",
    "explore": "M4 7h9M17 7h3M4 12h3M11 12h9M4 17h11M19 17h1M15 5v4M9 10v4M17 15v4",
    "research": "M9.5 4h5M10.5 4v5.5L5.5 18a1.5 1.5 0 0 0 1.3 2.2h10.4a1.5 1.5 0 0 0 1.3-2.2l-5-8.5V4M8 15h8",
    "mydata": "M7.5 3.5H14l4 4V19a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 6 19V5a1.5 1.5 0 0 1 1.5-1.5zM14 3.5V8h4M12 17v-5.5M9.5 13.5 12 11l2.5 2.5",
    "updates": "M12 4a8 8 0 1 0 0 16 8 8 0 0 0 0-16zM12 8v4.5l3 2",
    "brief": "M5 5h11v14H6.5A1.5 1.5 0 0 1 5 17.5zM16 9h3v8.5a1.5 1.5 0 0 1-3 0M8 9h5M8 12.5h5M8 16h3",
    "guide": "M5 5.5A1.5 1.5 0 0 1 6.5 4H19v13.5H6.5A1.5 1.5 0 0 0 5 19zM5 19a1.5 1.5 0 0 0 1.5 1.5H19M9 8h6M9 11.5h4",
    "more": "M5.5 12h.01M12 12h.01M18.5 12h.01",
    "install": "M12 4v10M8 10.5l4 4 4-4M5 19h14",
}
THEME = '<script>try{document.documentElement.dataset.theme=localStorage.getItem("theme")==="dark"?"dark":"light"}catch(e){document.documentElement.dataset.theme="light"}</script>'
e = html.escape


def icon(name):
    return f'<svg class="ic" viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="{ICON[name]}"/></svg>'


def header(page):
    """The app's frame: a side bar on a wide screen; on a phone, a slim bar on top and tabs along the foot."""
    def link(h, t, k, more=False):
        cls = " ".join(c for c in ("more" if more else "", "on" if k == page else "") if c)
        return f'<a href="{h}"' + (f' class="{cls}"' if cls else "") + (' aria-current="page"' if k == page else "") + f'>{icon(k)}<span>{t}</span></a>'
    links = "".join(link(h, t, k, i >= TABS) for i, (h, t, k) in enumerate(NAV))
    sheet = "".join(link(h, t, k) for h, t, k in NAV[TABS:])
    return ('<header class="top"><div class="wrap"><a class="brand" href="index.html">' + icon("mark") + '<span>Open Data<span class="wide"> Company</span></span></a>'
            f'<nav id="nav" aria-label="Main">{links}<button class="menu-btn" id="menu" type="button" aria-expanded="false" aria-controls="more">{icon("more")}<span>More</span></button></nav>'
            f'<div class="sheet" id="more" hidden><div class="sheet-in" role="group" aria-label="More pages">{sheet}</div></div>'
            '<div class="apptools"><button class="install" id="install" type="button" hidden>' + icon("install") + '<span>Install app</span></button>'
            '<button class="theme" id="theme" type="button">Dark</button></div></div></header>')


FOOTER = ('<footer><div class="wrap"><nav aria-label="Footer"><a href="ask.html">Data AI</a><a href="datasets.html">Datasets</a><a href="explore.html">Explorer</a>'
          '<a href="research.html">Researcher mode</a><a href="mydata.html">Your data</a><a href="updates.html">Updates</a><a href="brief.html">Daily brief</a><a href="guide.html">Guide</a>'
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
           f'<link rel="alternate" type="text/plain" href="{SITE}llms.txt" title="Plain-text index of the data">'
           '<link rel="manifest" href="manifest.webmanifest"><link rel="icon" href="img/icon.svg" type="image/svg+xml"><link rel="apple-touch-icon" href="img/icon-180.png">'
           '<meta name="theme-color" content="#ffffff" media="(prefers-color-scheme: light)"><meta name="theme-color" content="#000000" media="(prefers-color-scheme: dark)">'
           '<meta name="apple-mobile-web-app-capable" content="yes"><meta name="mobile-web-app-capable" content="yes"><meta name="apple-mobile-web-app-title" content="Open Data"><!--/seo-->')
    s = re.sub(r"<!--seo-->.*?<!--/seo-->", "", s, flags=re.S)
    s = re.sub(r'(<meta name="description" content="[^"]*">)', lambda m: m[1] + seo, s, count=1)
    s = re.sub(r"<script>try\{document\.documentElement\.dataset\.theme=.*?</script>", lambda m: THEME, s, count=1, flags=re.S)
    s = re.sub(r'<header class="top">.*?</header>', lambda m: header(page), s, count=1, flags=re.S)
    return re.sub(r"<footer>.*?</footer>", lambda m: FOOTER, s, count=1, flags=re.S)


def page(name, title, desc, data_page, body, scripts=("assets/core.js",), head=""):
    return ('<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">\n'
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
                f"The full list: {len(D)} open datasets and {nv} variables on climate, energy, the economy, health, people, government, science and natural hazards, with sources, licences and one-click downloads.",
                "datasets", body, ("assets/core.js", "assets/datasets.js"), ld)


# ---------- llms.txt and sitemap ----------

def llms(man):
    D = man["datasets"]
    out = ["# Open Data Company", "",
           "> Open datasets on climate, energy, the economy, health, people, government, science and natural hazards. One tidy CSV per dataset, refreshed every day, free to use. "
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
            f"- [Data AI]({SITE}ask.html): a chat window; ask by typing or by voice, the answer gives the number with its year and source, charts on request; chats are saved in the visitor's browser and an open model can run on the visitor's device",
            f"- [Datasets]({SITE}datasets.html): every dataset and variable",
            f"- [Explorer]({SITE}explore.html): choose variables, places and years, then download",
            f"- [Researcher mode]({SITE}research.html): test a hypothesis on the data",
            f"- [Your data]({SITE}mydata.html): open your own file in the browser and analyse it",
            f"- [Updates]({SITE}updates.html): refresh times and what changed",
            f"- [Daily brief]({SITE}brief.html): a short note on what changed, written each day by the site's Data Agent (JSON: {SITE}data/brief.json)", ""]
    return "\n".join(out)


def sitemap(man):
    day = man.get("checked", "")[:10]
    pages = ["", "ask.html", "datasets.html", "explore.html", "research.html", "mydata.html", "updates.html", "brief.html", "guide.html", "catalog.html", "scorecard.html"]
    mod = f"<lastmod>{day}</lastmod>" if day else ""
    urls = "".join(f"<url><loc>{SITE}{p}</loc>{mod}</url>" for p in pages if p == "" or (DOCS / p).exists())
    return f'<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">{urls}</urlset>\n'


def main():
    man = json.loads((DOCS / "data" / "datasets.json").read_text(encoding="utf-8"))
    write(DOCS / "datasets.html", stamp(datasets_page(man), "datasets.html"))
    write(DOCS / "llms.txt", llms(man))
    for f in sorted(DOCS.glob("*.html")):
        if f.name not in ("datasets.html", "chat.html"):                         # chat.html only forwards to ask.html
            write(f, stamp(f.read_text(encoding="utf-8"), f.name))
    write(DOCS / "sitemap.xml", sitemap(man))


if __name__ == "__main__":
    main()
