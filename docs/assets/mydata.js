/* Your data: open a file in the browser, see what is in it, run analyses on it. Nothing is uploaded.
   Needs core.js (helpers, picker), readers.js (file formats), stats.js (validated statistics) and charts.js. */
let T = null, tool = null, seq = 0;
const sig = v => (v === null || v === undefined || !isFinite(v) ? "–" : Math.abs(v) >= 10000 ? Math.round(v).toLocaleString("en-US") : String(+(+v).toPrecision(4)));
const pv = p => (p < 0.001 ? "p < 0.001" : `p = ${p.toFixed(3)}`);
const chance = p => (p < 0.001 ? "This is very unlikely to be chance alone" : p < 0.05 ? "This is unlikely to be chance alone" : p < 0.1 ? "The evidence is weak: chance could plausibly produce this" : "The data do not show a clear pattern: chance alone could easily produce this");
const strength = r => { const a = Math.abs(r); return a < 0.1 ? "negligible" : a < 0.3 ? "weak" : a < 0.5 ? "moderate" : a < 0.7 ? "strong" : "very strong"; };
const dateText = ms => { const d = new Date(ms), s = d.toISOString(); return s.slice(11, 19) === "00:00:00" ? s.slice(0, 10) : s.slice(0, 16).replace("T", " "); };
const pause = () => new Promise(r => setTimeout(r, 16));

/* ---------- turning raw cells into typed columns ---------- */
const MISSING = new Set(["", "na", "n/a", "nan", "null", "none", ".", "-", "--", "?", "#n/a", "#na", "missing", "nil"]);
function toNum(s) {
  let t = s; if (/^[$€£₹¥]/.test(t)) t = t.slice(1); if (t.endsWith("%")) t = t.slice(0, -1).trim();
  if (/^[-+]?\d{1,3}(,\d{3})+(\.\d+)?$/.test(t)) t = t.replace(/,/g, "");
  return /^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/.test(t) ? Number(t) : NaN;
}
const ISO = /^\d{4}-\d{1,2}(-\d{1,2})?([T ]\d{1,2}:\d{2}(:\d{2}(\.\d+)?)?\s*(Z|[+-]\d{2}:?\d{2})?)?$/, SLASH = /^(\d{1,4})[/.](\d{1,2})[/.](\d{1,4})$/, WORDY = /^(\d{1,2} )?(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?,? (\d{1,2},? )?\d{4}$/i;
const EURO = /^[-+]?\d{1,3}(\.\d{3})*,\d+$|^[-+]?\d+,\d+$/;
function toDate(s, dayFirst) {
  if (ISO.test(s)) { const m = /^(\d{4})-(\d{1,2})(?:-(\d{1,2}))?$/.exec(s); if (m) return Date.UTC(+m[1], +m[2] - 1, +(m[3] || 1)); const t = Date.parse(s.replace(" ", "T") + (/(Z|[+-]\d{2}:?\d{2})$/.test(s) ? "" : "Z")); return t; }
  const m = SLASH.exec(s);
  if (m) { let y, mo, d; if (m[1].length === 4) { y = +m[1]; mo = +m[2]; d = +m[3]; } else { y = +m[3]; if (y < 100) y += y < 50 ? 2000 : 1900; if (dayFirst) { d = +m[1]; mo = +m[2]; } else { mo = +m[1]; d = +m[2]; } } return mo >= 1 && mo <= 12 && d >= 1 && d <= 31 ? Date.UTC(y, mo - 1, d) : NaN; }
  return WORDY.test(s) ? Date.parse(s + " UTC") : NaN;
}
function typeColumn(name, raw, label) {
  const n = raw.length; let nNum = 0, nDate = 0, nStr = 0, nMiss = 0, nEuro = 0, lead0 = 0, bigFirst = false, bigSecond = false;
  for (let i = 0; i < n; i++) {
    const v = raw[i];
    if (v === null || v === undefined) { nMiss++; continue; }
    if (typeof v === "number") { if (isNaN(v)) nMiss++; else nNum++; continue; }
    if (v instanceof Date) { if (isNaN(v)) nMiss++; else nDate++; continue; }
    if (typeof v === "boolean") { nStr++; continue; }
    const s = String(v).trim();
    if (MISSING.has(s.toLowerCase())) { nMiss++; continue; }
    if (!isNaN(toNum(s))) { nNum++; if (/^[-+]?0\d/.test(s)) lead0++; }
    else if (EURO.test(s)) nEuro++;
    else if (ISO.test(s) || WORDY.test(s)) nDate++;
    else { const m = SLASH.exec(s); if (m) { nDate++; if (m[1].length < 4) { if (+m[1] > 12) bigFirst = true; if (+m[2] > 12) bigSecond = true; } } else nStr++; }
  }
  const present = n - nMiss, col = { name, label: label || "", n, missing: nMiss, notes: [] };
  const euro = nEuro > 0 && nStr === 0 && nDate === 0 && nEuro + nNum >= present;
  if (present && !lead0 && (euro || (nNum >= present * 0.98 && nNum > 0))) {
    col.kind = "num"; col.v = new Float64Array(n); let bad = 0;
    for (let i = 0; i < n; i++) { const v = raw[i]; let x = NaN; if (typeof v === "number") x = v; else if (v !== null && v !== undefined && !(v instanceof Date) && typeof v !== "boolean") { const s = String(v).trim(); if (!MISSING.has(s.toLowerCase())) { x = euro && EURO.test(s) ? Number(s.replace(/\./g, "").replace(",", ".")) : toNum(s); if (isNaN(x)) bad++; } } col.v[i] = x; }
    if (bad) { col.missing += bad; col.notes.push(`${plural(bad, "value")} could not be read as a number and ${bad > 1 ? "are" : "is"} treated as missing.`); }
    if (euro) col.notes.push("Read with a comma as the decimal mark.");
  } else if (present && nDate >= present * 0.95) {
    const dayFirst = bigFirst && !bigSecond; col.kind = "date"; col.v = new Float64Array(n); let bad = 0;
    for (let i = 0; i < n; i++) { const v = raw[i]; let x = NaN; if (v instanceof Date) x = v.getTime(); else if (v !== null && v !== undefined && typeof v !== "number") { const s = String(v).trim(); if (!MISSING.has(s.toLowerCase())) { x = toDate(s, dayFirst); if (isNaN(x)) bad++; } } col.v[i] = x; }
    if (bad) col.missing += bad;
    if (!bigFirst && !bigSecond && raw.some(v => typeof v === "string" && SLASH.test(v.trim()) && SLASH.exec(v.trim())[1].length < 4)) col.notes.push("Dates like 03/04/2021 were read as month/day/year. If yours are day/month/year, the months and days are swapped.");
  } else {
    col.v = new Array(n);
    for (let i = 0; i < n; i++) { const v = raw[i]; if (v === null || v === undefined) col.v[i] = null; else if (v instanceof Date) col.v[i] = isNaN(v) ? null : dateText(v.getTime()); else { const s = String(v).trim(); col.v[i] = MISSING.has(s.toLowerCase()) ? null : s; } }
    const u = new Set(); for (const s of col.v) { if (s !== null) u.add(s); if (u.size > 5000) break; }
    col.kind = u.size <= 30 || (u.size <= present * 0.2 && u.size <= 500) ? "cat" : "text";
    if (lead0 && nNum >= present * 0.98) col.notes.push("Kept as text because some values start with a zero, as codes do.");
  }
  return col;
}

function profile(c) {
  const p = c.p = {};
  if (c.kind === "num" || c.kind === "date") {
    const ok = c.v.filter(x => !isNaN(x)), s = Float64Array.from(ok).sort(); p.n = s.length; c.missing = c.n - p.n;
    if (!p.n) return;
    const q = f => { const h = (s.length - 1) * f, lo = Math.floor(h), hi = Math.ceil(h); return s[lo] + (s[hi] - s[lo]) * (h - lo); };
    p.min = s[0]; p.max = s[p.n - 1]; p.median = q(0.5); p.q1 = q(0.25); p.q3 = q(0.75);
    let u = 1; for (let i = 1; i < p.n; i++) if (s[i] !== s[i - 1]) u++; p.unique = u;
    const bins = 18, counts = new Array(bins).fill(0), span = p.max - p.min || 1; for (const x of s) counts[Math.min(bins - 1, Math.floor((x - p.min) / span * bins))]++; p.hist = counts;
    if (c.kind === "num") {
      p.mean = Stats.mean(s); p.sd = p.n > 1 ? Stats.sd(s) : 0; p.skew = p.n > 2 ? Stats.skewness(s) : 0; p.ints = ok.every(Number.isInteger);
      const iqr = p.q3 - p.q1; p.far = iqr > 0 ? ok.filter(x => x < p.q1 - 3 * iqr || x > p.q3 + 3 * iqr).length : 0;
      p.yearLike = p.ints && p.min >= 1500 && p.max <= 2200 && (/year|yr|anio|año|jahr/i.test(c.name) || (u <= 400 && p.max - p.min <= 400 && p.min >= 1800));
      p.idLike = p.ints && p.unique === p.n && p.n > 20 && (p.max - p.min + 1 === p.n || /(^|[_ ])(id|no|nr|num|key|code|index|serial)($|[_ ])/i.test(c.name));       // a running number or a code, not a measure
    }
  } else {
    const m = new Map(); let present = 0, spaces = 0; for (const x of c.v) if (x !== null) { present++; m.set(x, (m.get(x) || 0) + 1); }
    p.n = present; p.unique = m.size; p.top = [...m].sort((a, b) => b[1] - a[1]).slice(0, 40);
    const lower = new Map(); for (const k of m.keys()) { const l = k.toLowerCase(); lower.set(l, (lower.get(l) || 0) + 1); } p.caseClash = [...lower.values()].filter(x => x > 1).length; void spaces;
  }
}

/* columns a tool can use */
const cols = kind => T.cols.filter(c => c.kind === kind && c.p.n);
const nums = () => cols("num"), groupers = () => T.cols.filter(c => (c.kind === "cat" && c.p.unique >= 2) || (c.kind === "num" && c.p.unique >= 2 && c.p.unique <= 12));
const timers = () => T.cols.filter(c => (c.kind === "date" || (c.kind === "num" && c.p.yearLike)) && c.p.unique >= 3);
const byName = n => T.cols.find(c => c.name === n);
const groupKey = (c, i) => (c.kind === "num" ? (isNaN(c.v[i]) ? null : String(c.v[i])) : c.v[i]);
const shown = (c, i) => (c.kind === "num" ? (isNaN(c.v[i]) ? "" : c.v[i]) : c.kind === "date" ? (isNaN(c.v[i]) ? "" : dateText(c.v[i])) : c.v[i] === null ? "" : c.v[i]);

/* ---------- opening a file ---------- */
function status(text, bad) { const s = $("#status"); s.hidden = !text; s.textContent = text || ""; s.classList.toggle("blocked", !!bad); }
async function open(file, opt = {}) {
  status(`Reading ${file.name || "the table"}.`); await pause();
  try {
    const t0 = performance.now(), raw = opt.table || await Readers.read(file, opt);
    status(`Working out what each of the ${raw.columns.length} columns holds.`); await pause();
    const colsOut = raw.columns.map((name, j) => { const col = new Array(raw.rows.length); for (let i = 0; i < raw.rows.length; i++) col[i] = raw.rows[i][j]; const c = typeColumn(name, col, raw.labels && raw.labels[name]); profile(c); return c; });
    T = { name: raw.name || file.name || "pasted table", format: raw.format || "", bytes: file.size || 0, n: raw.rows.length, cols: colsOut, notes: raw.notes || [], sheets: raw.sheets, sheet: raw.sheet, file, ms: performance.now() - t0 };
    const seen = new Set(); let dup = 0; if (T.n <= 300000) { for (let i = 0; i < T.n; i++) { let k = ""; for (const c of T.cols) k += shown(c, i) + "\u0001"; if (seen.has(k)) dup++; else seen.add(k); } T.dup = dup; }
    status(""); render();
  } catch (e) {
    const ours = e && e.message && /\.$/.test(e.message) && !/^(Unexpected|Cannot read|undefined|null)/.test(e.message);     // the readers end their own messages with a full stop
    if (!ours) console.error(e);
    T = null; $("#work").hidden = true; status(ours ? e.message : "That file could not be read. If it is a spreadsheet or statistics file, try saving it again from its program, or export it as CSV.", true);
  }
}

/* ---------- the picture ---------- */
function mini(c) {
  const p = c.p, W = 132, H = 34, root = svgEl("svg", { viewBox: `0 0 ${W} ${H}`, width: W, height: H, role: "img" });
  if (!p.n) return el("span", "hint", "empty");
  if (c.kind === "num" || c.kind === "date") {
    const hi = Math.max(...p.hist), bw = W / p.hist.length; root.setAttribute("aria-label", `Spread of ${c.name}`);
    p.hist.forEach((k, i) => { if (k) { const h = Math.max(1.5, k / hi * (H - 2)); root.append(svgEl("rect", { x: (i * bw + 0.5).toFixed(1), y: (H - h).toFixed(1), width: (bw - 1).toFixed(1), height: h.toFixed(1), style: `fill:var(--${c.kind === "date" ? "s3" : "s1"})` })); } });
  } else {
    if (p.unique === p.n && p.n > 5) return el("span", "hint", "all different");
    const top = p.top.slice(0, 5), hi = top[0][1]; root.setAttribute("aria-label", `Most common values of ${c.name}`);
    top.forEach(([, k], i) => root.append(svgEl("rect", { x: 0, y: i * 7, width: Math.max(2, k / hi * W).toFixed(1), height: 5, rx: 1.5, style: "fill:var(--s4)" })));
  }
  return root;
}
function render() {
  $("#work").hidden = false; $("#drop").classList.add("small");
  const K = { num: "Number", date: "Date", cat: "Category", text: "Text" }, cells = T.n * T.cols.length, miss = T.cols.reduce((s, c) => s + c.missing, 0), count = k => T.cols.filter(c => c.kind === k).length;
  const bar = $("#filebar"); bar.replaceChildren(el("strong", "", T.name), el("span", "", [T.format, T.bytes ? size(T.bytes) : "", `read in ${T.ms < 1000 ? Math.round(T.ms) + " ms" : (T.ms / 1000).toFixed(1) + " s"}`].filter(Boolean).join(", ")));
  if (T.sheets && T.sheets.length > 1) { const s = el("select"); s.setAttribute("aria-label", "Sheet"); T.sheets.forEach(n => s.append(new Option(`Sheet: ${n}`, n, false, n === T.sheet))); s.onchange = () => open(T.file, { sheet: s.value }); bar.append(s); }
  const exp = el("span", "exports"); [["csv", "CSV"], ["xlsx", "Excel"], ["json", "JSON"]].forEach(([k, t]) => { const b = el("button", "link", `Save as ${t}`); b.type = "button"; b.onclick = () => exportAs(k); exp.append(b); }); bar.append(exp);
  $("#tiles").replaceChildren(...[[T.n.toLocaleString("en-US"), "rows"], [T.cols.length, "columns"], [[count("num") && `${count("num")} number`, count("cat") && `${count("cat")} category`, count("date") && `${count("date")} date`, count("text") && `${count("text")} text`].filter(Boolean).join(", "), "what the columns hold"],
    [cells ? (miss / cells * 100).toFixed(miss / cells < 0.01 && miss ? 2 : 1) + "%" : "0%", "of cells are empty"], ...(T.dup === undefined ? [] : [[T.dup.toLocaleString("en-US"), "repeated rows"]])].map(([a, b]) => { const d = el("div"); d.append(el("strong", String(a).length > 9 ? "long" : "", String(a)), el("span", "", b)); return d; }));
  /* worth a look */
  const w = [...T.notes];
  T.cols.forEach(c => c.notes.forEach(x => w.push(`${c.name}: ${x}`)));
  const empties = T.cols.filter(c => !c.p.n).map(c => c.name); if (empties.length) w.push(`${empties.length > 1 ? "These columns are" : "This column is"} completely empty: ${empties.join(", ")}.`);
  const holes = T.cols.filter(c => c.p.n && c.missing / c.n >= 0.2).sort((a, b) => b.missing - a.missing); if (holes.length) w.push(`Many empty cells in ${holes.slice(0, 6).map(c => `${c.name} (${Math.round(c.missing / c.n * 100)}%)`).join(", ")}${holes.length > 6 ? ` and ${holes.length - 6} more` : ""}. Analyses skip rows where a value they need is missing.`);
  const flat = T.cols.filter(c => c.p.n && c.p.unique === 1).map(c => c.name); if (flat.length) w.push(`Only one value throughout: ${flat.join(", ")}. Nothing to analyse there.`);
  const ids = T.cols.filter(c => c.p.n > 20 && c.p.unique === c.p.n && (c.kind === "text" || (c.kind === "num" && c.p.idLike))).map(c => c.name); if (ids.length) w.push(`Every row has its own value in ${ids.slice(0, 5).join(", ")}: likely an identifier or a name, useful as a label but not as a measure.`);
  const far = T.cols.filter(c => c.kind === "num" && c.p.far).sort((a, b) => b.p.far - a.p.far); if (far.length) w.push(`Values far from the rest in ${far.slice(0, 5).map(c => `${c.name} (${c.p.far})`).join(", ")}. Check whether they are real or typing errors; they can dominate averages and straight-line fits.`);
  const skew = T.cols.filter(c => c.kind === "num" && c.p.n > 20 && Math.abs(c.p.skew) > 2 && c.p.unique > 12).map(c => c.name); if (skew.length) w.push(`Strongly lopsided: ${skew.slice(0, 6).join(", ")}. A few large values pull the average away from the typical row, so medians and rank-based tests describe them better.`);
  const clash = T.cols.filter(c => c.kind === "cat" && c.p.caseClash).map(c => c.name); if (clash.length) w.push(`The same label appears with different capital letters in ${clash.join(", ")}, so it is counted as separate groups.`);
  if (T.dup) w.push(`${plural(T.dup, "row")} repeat${T.dup === 1 ? "s" : ""} an earlier row exactly.`);
  const box = $("#worth"); box.replaceChildren(); if (w.length) { box.append(el("h3", "", "Worth a look")); const ul = el("ul", "caveats"); w.forEach(x => ul.append(el("li", "", x))); box.append(ul); }
  /* one row per column */
  const tb = $("#coltable"); tb.replaceChildren(); const th = el("tr"); ["Column", "Holds", "Filled", "Distinct", "Shape", "In short"].forEach(h => th.append(el("th", "", h))); const thead = el("thead"); thead.append(th); tb.append(thead);
  const body = el("tbody");
  T.cols.forEach(c => {
    const tr = el("tr"), nm = el("td"), p = c.p, fill = el("td", "num", c.n ? Math.round((c.n - c.missing) / c.n * 100) + "%" : "–"), shape = el("td");
    nm.append(el("b", "", c.name)); if (c.label) nm.append(el("small", "", c.label));
    shape.append(mini(c));
    let brief = "";
    if (!p.n) brief = "No values";
    else if (c.kind === "num") brief = `${sig(p.min)} to ${sig(p.max)}, middle value ${sig(p.median)}, average ${sig(p.mean)}`;
    else if (c.kind === "date") brief = `${dateText(p.min)} to ${dateText(p.max)}`;
    else brief = p.top.slice(0, 3).map(([k, n]) => `${k.length > 28 ? k.slice(0, 27) + "…" : k} (${n.toLocaleString("en-US")})`).join(", ") + (p.unique > 3 ? `, and ${(p.unique - 3).toLocaleString("en-US")} more` : "");
    const kind = el("td"); kind.append(el("span", `tag k-${c.kind}`, K[c.kind]));
    tr.append(nm, kind, fill, el("td", "num", p.n ? p.unique.toLocaleString("en-US") : "–"), shape, el("td", "", brief)); body.append(tr);
  });
  tb.append(body);
  /* first rows */
  const rt = $("#rowtable"), LIM = 100, h2 = el("tr"); rt.replaceChildren(); T.cols.forEach(c => h2.append(el("th", c.kind === "num" ? "num" : "", c.name))); const rh = el("thead"); rh.append(h2); const rb = el("tbody");
  for (let i = 0; i < Math.min(LIM, T.n); i++) { const tr = el("tr"); T.cols.forEach(c => { const v = shown(c, i); tr.append(el("td", c.kind === "num" ? "num" : "", typeof v === "number" ? sig(v) : String(v).length > 60 ? String(v).slice(0, 59) + "…" : v)); }); rb.append(tr); }
  rt.append(rh, rb); $("#rownote").textContent = T.n > LIM ? `The first ${LIM} of ${T.n.toLocaleString("en-US")} rows.` : `All ${plural(T.n, "row")}.`;
  $("#results").replaceChildren(); buildTools();
  $("#work").scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
}

function exportAs(kind) {
  const head = T.cols.map(c => c.name), base = T.name.replace(/\.[a-z0-9.]+$/i, "") || "table", cell = (c, i) => { const v = shown(c, i); return v === "" ? null : v; };
  const save = (blob, ext) => { const a = el("a"); a.href = URL.createObjectURL(blob); a.download = `${base}.${ext}`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 4000); };
  if (kind === "csv") { const q = v => (v === null ? "" : /[",\n\r]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : v); const out = [head.map(q).join(",")]; for (let i = 0; i < T.n; i++) out.push(T.cols.map(c => q(cell(c, i))).join(",")); save(new Blob([out.join("\n") + "\n"], { type: "text/csv" }), "csv"); }
  else if (kind === "json") { const out = []; for (let i = 0; i < T.n; i++) { const o = {}; T.cols.forEach(c => { o[c.name] = cell(c, i); }); out.push(o); } save(new Blob([JSON.stringify(out)], { type: "application/json" }), "json"); }
  else { const go = () => { const aoa = [head]; for (let i = 0; i < T.n; i++) aoa.push(T.cols.map(c => cell(c, i))); const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), "data"); save(new Blob([XLSX.write(wb, { bookType: "xlsx", type: "array" })], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), "xlsx"); };
    if (typeof XLSX !== "undefined") go(); else { const s = document.createElement("script"); s.src = "vendor/xlsx.full.min.js"; s.onload = go; document.head.append(s); } }
}

/* ---------- results ---------- */
function result(kicker) {
  const sec = el("section", "answer result"), head = el("div", "up kick", kicker), body = el("div"), text = [];
  const api = {
    sec, text,
    say(t) { body.append(el("p", "headline", t)); text.push(t); return api; },
    h(t) { body.append(el("h3", "", t)); return api; },
    p(t, cls = "cap") { body.append(el("p", cls, t)); return api; },
    fig(cap) { const f = el("figure", "fig"), host = el("div", "fig"); f.append(host); if (cap) f.append(el("figcaption", "", cap)); body.append(f); return host; },
    table(headRow, rows, numFrom = 1) { const w = el("div", "tablewrap"), t = el("table"), hr = el("tr"); headRow.forEach((h, j) => hr.append(el("th", j >= numFrom ? "num" : "", h))); const th = el("thead"); th.append(hr); const tb = el("tbody"); rows.forEach(r => { const tr = el("tr"); r.forEach((v, j) => tr.append(el("td", j >= numFrom ? "num" : "", typeof v === "number" ? sig(v) : v))); tb.append(tr); }); t.append(th, tb); w.append(t); body.append(w); api.csv = [headRow, ...rows]; return api; },
    list(title, items, cls = "caveats") { if (!items.length) return api; body.append(el("h3", "", title)); const ul = el("ul", cls); items.forEach(x => ul.append(el("li", "", x))); body.append(ul); return api; },
    done() {
      const a = el("div", "acts"), cp = el("button", "link", "Copy the result"), rm = el("button", "link", "Remove"); cp.type = rm.type = "button";
      cp.onclick = async () => { try { await navigator.clipboard.writeText(`${kicker}. ${text.join(" ")} (${T.name}, ${plural(T.n, "row")}.)`); cp.textContent = "Copied"; setTimeout(() => { cp.textContent = "Copy the result"; }, 1500); } catch (e) { /* clipboard blocked: nothing to do */ } };
      rm.onclick = () => sec.remove();
      if (api.csv) { const dl = el("button", "link", "Download this table"); dl.type = "button"; dl.onclick = () => { const q = v => (/[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : v), b = el("a"); b.href = URL.createObjectURL(new Blob([api.csv.map(r => r.map(q).join(",")).join("\n") + "\n"], { type: "text/csv" })); b.download = "result.csv"; b.click(); }; a.append(dl); }
      a.append(cp, rm); sec.append(head, body, a); $("#results").prepend(sec); sec.id = "r" + (++seq);
      sec.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
    },
  };
  return api;
}
const fail = msg => { const r = result("Could not run"); r.p(msg, "note blocked"); r.done(); };
/* rows where every named column has a value */
function complete(list) { const idx = []; for (let i = 0; i < T.n; i++) { let ok = true; for (const c of list) { if (c.kind === "num" || c.kind === "date" ? isNaN(c.v[i]) : c.v[i] === null) { ok = false; break; } } if (ok) idx.push(i); } return idx; }
function groupsOf(y, g, minSize = 2) { const m = new Map(); for (let i = 0; i < T.n; i++) { const k = groupKey(g, i); if (k === null || isNaN(y.v[i])) continue; let a = m.get(k); if (!a) m.set(k, a = []); a.push(y.v[i]); } const all = [...m].map(([name, values]) => ({ name, values })); return { used: all.filter(x => x.values.length >= minSize).sort((a, b) => Stats.median(b.values) - Stats.median(a.values)), dropped: all.filter(x => x.values.length < minSize) }; }

/* ---------- the tools ---------- */
const TOOLS = [
  { id: "summary", name: "Summary table", when: "The key figures for each number column, overall or for each group.",
    fields: () => [{ id: "v", label: "Number columns", type: "multi", from: nums, pre: nums().filter(c => !c.p.idLike).slice(0, 12) }, { id: "g", label: "Split by (optional)", type: "one", from: groupers, optional: true }],
    run(o) {
      if (!o.v.length) return fail("Pick at least one number column.");
      const rows = [], g = o.g, add = (c, name, vals) => { if (!vals.length) return; const s = Float64Array.from(vals).sort(), q = f => Stats.quantile(s, f); rows.push([c.name, ...(g ? [name] : []), s.length, Stats.mean(s), s.length > 1 ? Stats.sd(s) : NaN, s[0], q(0.25), q(0.5), q(0.75), s[s.length - 1]]); };
      o.v.forEach(c => { if (!g) add(c, "", Array.from(c.v).filter(x => !isNaN(x))); else groupsOf(c, g, 1).used.forEach(x => add(c, x.name, x.values)); });
      const r = result(g ? `Summary by ${g.name}` : "Summary");
      r.say(`${plural(o.v.length, "column")} summarised${g ? ` for each value of ${g.name}` : ""}. Empty cells are left out, column by column.`).table(["Column", ...(g ? [g.name] : []), "Rows", "Average", "Spread (sd)", "Lowest", "Lower quarter", "Middle", "Upper quarter", "Highest"], rows, g ? 2 : 1);
      r.list("How to read it", ["The middle value (median) has half the rows below it and half above. When it sits far from the average, a few extreme rows are pulling the average.", "Half of all rows lie between the lower and upper quarter."]); r.done();
    } },
  { id: "one", name: "One column", when: "How one column is spread out: the typical value, the range, the odd ones out.",
    fields: () => [{ id: "c", label: "Column", type: "one", from: () => T.cols.filter(c => c.p.n) }, { id: "lab", label: "Name rows by (optional)", type: "one", from: () => T.cols.filter(c => c.kind === "text" || c.kind === "cat"), optional: true }],
    run(o) {
      const c = o.c, p = c.p, r = result(`One column: ${c.name}`);
      if (c.kind === "num") {
        const x = Array.from(c.v).filter(v => !isNaN(v)), jb = x.length >= 8 ? Stats.jarqueBera(x) : null, bell = jb && jb.p >= 0.05;
        r.say(`${c.name} runs from ${sig(p.min)} to ${sig(p.max)} across ${plural(x.length, "row")}. The middle value is ${sig(p.median)} and the average is ${sig(p.mean)}; half of the rows fall between ${sig(p.q1)} and ${sig(p.q3)}.`);
        Charts.hist(r.fig("Each bar counts the rows in that range. The line marks the middle value."), { values: x, marks: [{ at: p.median, name: "middle" }], label: `Spread of ${c.name}` });
        r.table(["", "Rows", "Empty", "Average", "Spread (sd)", "Lowest", "Lower quarter", "Middle", "Upper quarter", "Highest", "Skew"], [[c.name, x.length, c.missing, p.mean, p.sd, p.min, p.q1, p.median, p.q3, p.max, p.skew]]);
        const notes = [];
        if (jb) notes.push(bell ? `The shape is close to a bell curve (Jarque-Bera ${pv(jb.p)}), so averages and the usual tests suit it.` : `The shape is not a bell curve (Jarque-Bera ${pv(jb.p)}; skew ${sig(jb.skew)}). ${Math.abs(jb.skew) > 1 ? "It has a long tail on the " + (jb.skew > 0 ? "high" : "low") + " side, so the middle value describes a typical row better than the average." : "With many rows this matters little for averages."}`);
        if (p.far) { const iqr = p.q3 - p.q1, idx = []; for (let i = 0; i < T.n; i++) if (c.v[i] < p.q1 - 3 * iqr || c.v[i] > p.q3 + 3 * iqr) idx.push(i); idx.sort((a, b) => Math.abs(c.v[b] - p.median) - Math.abs(c.v[a] - p.median)); notes.push(`${plural(p.far, "value")} far from the rest: ${idx.slice(0, 6).map(i => `${sig(c.v[i])}${o.lab && o.lab.v[i] ? ` (${o.lab.v[i]})` : ` (row ${i + 1})`}`).join(", ")}${idx.length > 6 ? ", and more" : ""}.`); }
        if (p.min > 0 && p.skew > 1.5) notes.push("Values are all positive and bunched low: comparing them on a log scale (ratios instead of differences) often makes patterns clearer.");
        r.list("What stands out", notes);
      } else if (c.kind === "date") {
        r.say(`${c.name} runs from ${dateText(p.min)} to ${dateText(p.max)}, with ${plural(p.unique, "different date")} in ${plural(p.n, "row")}.`);
        const per = new Map(), days = (p.max - p.min) / 864e5, cut = days > 1500 ? 4 : days > 120 ? 7 : 10; for (const x of c.v) if (!isNaN(x)) { const k = new Date(x).toISOString().slice(0, cut) + (cut === 4 ? "-01-01" : cut === 7 ? "-01" : ""); per.set(k, (per.get(k) || 0) + 1); }
        Charts.line(r.fig(`Rows per ${cut === 4 ? "year" : cut === 7 ? "month" : "day"}.`), { series: [{ name: "Rows", pts: [...per] }], x: "date", label: `Rows over time in ${c.name}` });
      } else {
        const top = p.top, share = top[0][1] / p.n;
        r.say(`${c.name} has ${plural(p.unique, "different value")} in ${plural(p.n, "row")}. The most common is ${top[0][0]}, in ${(share * 100).toFixed(share < 0.1 ? 1 : 0)}% of them.`);
        Charts.bars(r.fig(p.unique > 25 ? `The 25 most common of ${p.unique.toLocaleString("en-US")} values.` : ""), { rows: top.slice(0, 25).map(([k, n]) => ({ label: k, value: n, sub: (n / p.n * 100).toFixed(1) + "%" })), fmt: v => v.toLocaleString("en-US") });
      }
      r.done();
    } },
  { id: "groups", name: "Compare groups", when: "Does a number differ between groups? Picks the right test for the shape of your data.",
    fields: () => [{ id: "y", label: "Number to compare", type: "one", from: nums }, { id: "g", label: "Groups", type: "one", from: groupers }],
    run(o) {
      const y = o.y, g = o.g; if (y === g) return fail("Pick two different columns.");
      const { used, dropped } = groupsOf(y, g, 3); if (used.length < 2) return fail(`At least two groups need three or more rows each. ${g.name} has ${used.length} such group${used.length === 1 ? "" : "s"}.`);
      if (used.length > 20) return fail(`${g.name} has ${used.length} groups, which is too many to compare at once. Choose a column with fewer groups.`);
      const two = used.length === 2, small = used.some(x => x.values.length < 30), skewed = used.some(x => x.values.length > 3 && Math.abs(Stats.skewness(x.values)) > 1), rank = small || skewed, r = result(`${y.name} by ${g.name}`), why = [];
      let line, p;
      if (two) {
        const [a, b] = used, w = Stats.welch(a.values, b.values), mw = Stats.mannWhitney(a.values, b.values); p = rank ? mw.p : w.p;
        const up = w.diff >= 0, lo = up ? w.lo : -w.hi, hi = up ? w.hi : -w.lo;                                 // the gap and its range, written as positive when a is ahead
        line = `${y.name} is ${up ? "higher" : "lower"} in ${a.name} than in ${b.name}: the averages are ${sig(w.meanA)} and ${sig(w.meanB)}, a gap of ${sig(Math.abs(w.diff))} (95% range ${sig(lo)} to ${sig(hi)}). ${chance(p)} (${rank ? "Mann-Whitney test" : "Welch t-test"}, ${pv(p)}).`;
        why.push(rank ? `Mann-Whitney test recommended: ${small ? "a group has fewer than 30 rows" : "the values are lopsided"}, so comparing ranks is safer than comparing averages.` : "Welch t-test recommended: both groups are large and roughly symmetric. It does not assume the groups are equally spread.", `The other test agrees or not: Welch ${pv(w.p)}, Mann-Whitney ${pv(mw.p)}.`, `Size of the gap in spread units (Hedges g): ${sig(w.hedgesG)}. Around 0.2 is small, 0.5 medium, 0.8 large.`);
      } else {
        const an = Stats.anova(used.map(x => x.values)), kw = Stats.kruskal(used.map(x => x.values)); p = rank ? kw.p : an.p;
        const hi = used[0], lo = used[used.length - 1];
        line = `${y.name} ${p < 0.05 ? "differs" : "does not clearly differ"} across the ${used.length} groups of ${g.name}. Middle values run from ${sig(Stats.median(lo.values))} in ${lo.name} to ${sig(Stats.median(hi.values))} in ${hi.name}. ${chance(p)} (${rank ? "Kruskal-Wallis test" : "analysis of variance"}, ${pv(p)}).`;
        why.push(rank ? `Kruskal-Wallis test recommended: ${small ? "a group has fewer than 30 rows" : "the values are lopsided"}, so comparing ranks is safer than comparing averages.` : "Analysis of variance recommended: every group is large and roughly symmetric.", `Both tests: analysis of variance ${pv(an.p)}, Kruskal-Wallis ${pv(kw.p)}.`, `The grouping accounts for ${(an.eta2 * 100).toFixed(1)}% of the variation in ${y.name}.`);
      }
      r.say(line);
      Charts.strip(r.fig("Each dot is a row. The box holds the middle half of each group and the bar marks its middle value."), { groups: used, label: `${y.name} for each group of ${g.name}` });
      r.table([g.name, "Rows", "Average", "Middle", "Spread (sd)", "Lowest", "Highest"], used.map(x => [x.name, x.values.length, Stats.mean(x.values), Stats.median(x.values), Stats.sd(x.values), Math.min(...x.values), Math.max(...x.values)]));
      r.list("Why this test", why);
      r.list("Keep in mind", [...(dropped.length ? [`Left out for having fewer than three rows: ${dropped.slice(0, 8).map(x => x.name).join(", ")}${dropped.length > 8 ? " and more" : ""}.`] : []), ...(two ? [] : ["The test says at least one group differs. It does not say which pairs differ."]), "Groups can differ in many ways at once. A gap between them does not show that the grouping itself is the cause."]);
      r.done();
    } },
  { id: "relation", name: "Relationship", when: "Do two numbers move together? A scatter, a fitted line and how sure it is.",
    fields: () => [{ id: "y", label: "Outcome (vertical)", type: "one", from: nums }, { id: "x", label: "Explained by (horizontal)", type: "one", from: nums, skip: 1 }, { id: "c", label: "Holding constant (optional, up to 4)", type: "multi", from: nums, max: 4, pre: [] }, { id: "lab", label: "Name points by (optional)", type: "one", from: () => T.cols.filter(c => c.kind === "text" || c.kind === "cat"), optional: true },
      { id: "logx", label: "Log scale for the horizontal column", type: "check" }, { id: "logy", label: "Log scale for the outcome", type: "check" }],
    run(o) {
      const y = o.y, x = o.x, ctl = o.c.filter(c => c !== y && c !== x); if (y === x) return fail("Pick two different columns.");
      let idx = complete([y, x, ...ctl]); const lx = o.logx, ly = o.logy;
      if (lx) idx = idx.filter(i => x.v[i] > 0); if (ly) idx = idx.filter(i => y.v[i] > 0);
      const n = idx.length; if (n < ctl.length + 5) return fail(`Only ${plural(n, "row")} ${n === 1 ? "has" : "have"} every value needed${lx || ly ? " (log scales need values above zero)" : ""}. That is too few.`);
      const Y = Float64Array.from(idx, i => (ly ? Math.log(y.v[i]) : y.v[i])), X = Float64Array.from(idx, i => (lx ? Math.log(x.v[i]) : x.v[i])), Cs = ctl.map(c => Float64Array.from(idx, i => c.v[i]));
      let fit; try { fit = Stats.ols(Y, [X, ...Cs], { cov: "HC1", names: [x.name, ...ctl.map(c => c.name)] }); } catch (e) { return fail(e.message); }
      const b = fit.coef[1], pr = Stats.pearson(X, Y), sp = Stats.spearman(X, Y), r = result(`${y.name} and ${x.name}`), dir = b.b >= 0 ? "higher" : "lower";
      const amount = lx && ly ? `a 1% higher ${x.name} goes with ${y.name} that is ${sig(Math.abs(b.b))}% ${dir}` : lx ? `a doubling of ${x.name} goes with ${y.name} that is ${sig(Math.abs(b.b * Math.LN2))} ${dir}` : ly ? `each extra unit of ${x.name} goes with ${y.name} that is ${sig(Math.abs((Math.exp(b.b) - 1) * 100))}% ${dir}` : `each extra unit of ${x.name} goes with ${y.name} that is ${sig(Math.abs(b.b))} ${dir}`;
      r.say(`Across ${plural(n, "row")}, ${amount}${ctl.length ? `, holding ${ctl.map(c => c.name).join(", ")} constant` : ""}. ${chance(b.p)} (${pv(b.p)}). The link is ${strength(pr.r)} (correlation ${sig(pr.r)}), and ${ctl.length ? "together the columns account" : x.name + " accounts"} for ${(fit.r2 * 100).toFixed(0)}% of the differences in ${y.name}.`);
      const simple = Stats.ols(Y, [X]);
      Charts.scatter(r.fig(`Each dot is a row. The line is the straight-line fit${ctl.length ? " without the columns held constant" : ""}.`), { pts: idx.map(i => ({ x: x.v[i], y: y.v[i], label: o.lab ? o.lab.v[i] : `Row ${i + 1}` })), xLabel: x.name, yLabel: y.name, logX: lx, logY: ly, fit: { a: (simple.coef[0].b) / (ly ? Math.LN10 : 1), b: simple.coef[1].b * (lx ? Math.LN10 : 1) / (ly ? Math.LN10 : 1) }, label: `${y.name} against ${x.name}` });
      r.table(["", "Estimate", "Standard error", "95% range, low", "95% range, high", "p"], fit.coef.map(c => [c.name === "(Intercept)" ? "Baseline (intercept)" : (c.name === x.name && lx ? "log of " : "") + c.name, c.b, c.se, c.lo, c.hi, c.p < 0.001 ? "< 0.001" : c.p.toFixed(3)]));
      const why = ["A straight-line fit (linear regression) with robust standard errors, so the uncertainty stays honest when the scatter is wider in some places than others.", `Rank correlation (Spearman) ${sig(sp.rho)}, ${pv(sp.p)}. It only asks whether the two rise together, so it is not thrown by outliers or curves.`];
      const sx = Stats.skewness(Array.from(idx, i => x.v[i])), sy = Stats.skewness(Array.from(idx, i => y.v[i]));
      if (!lx && sx > 1.5 && x.p.min > 0) why.push(`${x.name} is bunched low with a long tail. Ticking its log scale usually gives a straighter, fairer picture.`);
      if (!ly && sy > 1.5 && y.p.min > 0) why.push(`${y.name} is bunched low with a long tail. Ticking its log scale usually gives a straighter, fairer picture.`);
      if (Math.abs(sp.rho) - Math.abs(pr.r) > 0.15) why.push("The rank correlation is clearly stronger than the straight-line one: the relationship is probably curved.");
      r.list("Why this method", why);
      r.list("Keep in mind", ["Moving together is not the same as one causing the other. Something not in the table may drive both.", ...(ctl.length ? [] : ["Add columns under 'holding constant' to see whether the link survives once they are taken into account."]), ...(n < 30 ? ["With fewer than 30 rows, one or two unusual rows can change the answer."] : [])]);
      r.done();
    } },
  { id: "corr", name: "Correlations", when: "Which number columns move together? All pairs at a glance.",
    fields: () => [{ id: "v", label: "Number columns (up to 14)", type: "multi", from: nums, max: 14, pre: nums().filter(c => c.p.unique > 2 && !c.p.idLike && !c.p.yearLike).slice(0, 10) }],
    run(o) {
      const v = o.v; if (v.length < 2) return fail("Pick at least two number columns.");
      const m = v.map(() => new Array(v.length).fill(1)), cnt = v.map(() => new Array(v.length).fill(0)), pairs = [];
      for (let a = 0; a < v.length; a++) for (let b = a + 1; b < v.length; b++) { const idx = complete([v[a], v[b]]), k = idx.length; let rr = NaN; if (k >= 3) rr = Stats.pearson(Float64Array.from(idx, i => v[a].v[i]), Float64Array.from(idx, i => v[b].v[i])).r; m[a][b] = m[b][a] = rr; cnt[a][b] = cnt[b][a] = k; if (isFinite(rr)) pairs.push([rr, v[a].name, v[b].name, k]); }
      pairs.sort((a, b) => Math.abs(b[0]) - Math.abs(a[0])); const r = result("Correlations");
      if (!pairs.length) return fail("No pair of columns has three or more rows in common.");
      r.say(`Of ${plural(pairs.length, "pair")}, the tightest link is between ${pairs[0][1]} and ${pairs[0][2]} (${sig(pairs[0][0])}, ${strength(pairs[0][0])}${pairs[0][0] < 0 ? ", moving in opposite directions" : ""}).`);
      Charts.heat(r.fig(), { labels: v.map(c => c.name), m, n: cnt });
      r.table(["Pair", "Correlation", "Rows used"], pairs.slice(0, 12).map(p => [`${p[1]} and ${p[2]}`, p[0], p[3]]));
      r.list("Keep in mind", ["A correlation measures straight-line togetherness from -1 to 1. Zero can hide a curved relationship.", "Each pair uses the rows where both columns have a value, so pairs can rest on different rows.", "With many pairs, a few will look linked by luck alone. Follow up the interesting ones with the Relationship tool."]); r.done();
    } },
  { id: "time", name: "Over time", when: "How a number changes over time, with a test for a rising or falling trend.",
    fields: () => [{ id: "t", label: "Time column", type: "one", from: timers }, { id: "y", label: "Number to follow", type: "one", from: () => nums().filter(c => !c.p.yearLike) }, { id: "how", label: "When several rows share a time, show their", type: "pick", options: [["mean", "average"], ["sum", "total"], ["median", "middle value"], ["count", "count"]] }, { id: "g", label: "One line for each (optional)", type: "one", from: groupers, optional: true }],
    run(o) {
      const t = o.t, y = o.y, g = o.g, year = t.kind === "num", how = o.how || "mean";
      const span = t.p.max - t.p.min, bucket = year ? null : span > 20 * 365 * 864e5 && t.p.unique > 400 ? 7 : null;       // long daily series are shown month by month
      const key = i => (year ? t.v[i] : bucket ? Date.parse(new Date(t.v[i]).toISOString().slice(0, bucket) + "-01") : t.v[i]);
      const agg = a => (how === "sum" ? Stats.sum(a) : how === "median" ? Stats.median(a) : how === "count" ? a.length : Stats.mean(a));
      const series = new Map(); for (let i = 0; i < T.n; i++) { if (isNaN(t.v[i]) || isNaN(y.v[i])) continue; const gk = g ? groupKey(g, i) : ""; if (gk === null) continue; let m = series.get(gk); if (!m) series.set(gk, m = new Map()); const k = key(i); let a = m.get(k); if (!a) m.set(k, a = []); a.push(y.v[i]); }
      let list = [...series].map(([name, m]) => ({ name: name || y.name, rows: [...m.values()].reduce((s, a) => s + a.length, 0), pts: [...m].map(([k, a]) => [k, agg(a)]).sort((a, b) => a[0] - b[0]) })).filter(s => s.pts.length >= 2).sort((a, b) => b.rows - a.rows);
      if (!list.length) return fail("There are not enough rows with both a time and a value.");
      const more = list.length - 6; list = list.slice(0, 6);
      const r = result(`${y.name} over time`), one = list[0], shared = [...series.values()].some(m => [...m.values()].some(a => a.length > 1));
      const tx = p => (year ? p[0] : p[0] / (365.25 * 864e5)), fmtT = k => (year ? String(k) : dateText(k).slice(0, bucket || 10));
      if (list.length === 1 && one.pts.length >= 5) {
        const X = Float64Array.from(one.pts, tx), Y = Float64Array.from(one.pts, p => p[1]), fit = Stats.ols(Y, [X], { cov: "HAC" }), b = fit.coef[1], n = one.pts.length;
        const mk = n <= 3000 ? Stats.mannKendall(Y) : null, sen = n <= 1500 ? Stats.senSlope(X, Y) : null;
        r.say(`${y.name} has ${b.b >= 0 ? "risen" : "fallen"} by about ${sig(Math.abs(b.b))} a year from ${fmtT(one.pts[0][0])} to ${fmtT(one.pts[n - 1][0])} (95% range ${sig(Math.min(b.lo, b.hi))} to ${sig(Math.max(b.lo, b.hi))}). ${chance(b.p)} (${pv(b.p)}, ${plural(n, "point")}).${sen ? ` Cross-check that ignores unusual points: ${sig(sen.slope)} a year${mk ? ` (Mann-Kendall ${pv(mk.p)})` : ""}.` : ""}`);
        const x0 = one.pts[0], x1 = one.pts[n - 1];
        Charts.line(r.fig(`${shared ? `The ${how === "mean" ? "average" : how === "sum" ? "total" : how === "median" ? "middle value" : "count"} for each ${bucket ? "month" : "time"}. ` : ""}The straight line is the fitted trend.`), { series: [{ name: y.name, pts: one.pts }], x: year ? "year" : "date", zero: false, fit: [[x0[0], fit.coef[0].b + b.b * tx(x0)], [x1[0], fit.coef[0].b + b.b * tx(x1)]], label: `${y.name} over time` });
        const dw = Stats.durbinWatson(fit.resid);
        r.list("Why this method", ["A straight-line trend summarises the average change per year.", "Its uncertainty allows for neighbouring points resembling each other (Newey-West errors), which ordinary formulas ignore and so look too sure.", ...(sen ? ["The cross-check (Sen's slope with the Mann-Kendall test) uses medians, so one odd year cannot drive it."] : []), ...(dw < 1 ? [`Points cluster above and below the line for long stretches (Durbin-Watson ${sig(dw)}), so the path may bend. Look at the chart before trusting a single straight line.`] : [])]);
      } else {
        r.say(`${y.name} for ${list.length === 1 ? "one series" : `${list.length} groups of ${g.name}`}, from ${fmtT(Math.min(...list.map(s => s.pts[0][0])))} to ${fmtT(Math.max(...list.map(s => s.pts[s.pts.length - 1][0])))}.`);
        Charts.line(r.fig(shared ? `The ${how === "mean" ? "average" : how === "sum" ? "total" : how === "median" ? "middle value" : "count"} for each ${bucket ? "month" : "time"}.` : ""), { series: list.map(s => ({ name: s.name, pts: s.pts })), x: year ? "year" : "date", zero: false, label: `${y.name} over time by ${g ? g.name : "series"}` });
        if (list.length > 1) { const rows = list.map(s => { const X = Float64Array.from(s.pts, tx), Y = Float64Array.from(s.pts, p => p[1]); if (s.pts.length < 5) return [s.name, s.pts.length, "–", "–", "–"]; const f = Stats.ols(Y, [X], { cov: "HAC" }).coef[1]; return [s.name, s.pts.length, f.b, `${sig(Math.min(f.lo, f.hi))} to ${sig(Math.max(f.lo, f.hi))}`, f.p < 0.001 ? "< 0.001" : f.p.toFixed(3)]; }); r.table([g.name, "Points", "Change a year", "95% range", "p"], rows); }
        if (more > 0) r.p(`Showing the six groups with the most rows; ${more} more are left out.`);
      }
      r.list("Keep in mind", ["A trend describes the past. It is not a forecast, and it says nothing about what caused the change.", "The first and last dates matter: a different window can give a different slope."]); r.done();
    } },
  { id: "cross", name: "Two categories", when: "Do two groupings go together? A count table and a test of whether they are linked.",
    fields: () => [{ id: "a", label: "Rows", type: "one", from: groupers }, { id: "b", label: "Columns", type: "one", from: groupers, skip: 1 }],
    run(o) {
      const a = o.a, b = o.b; if (a === b) return fail("Pick two different columns.");
      const ra = new Map(), cb = new Map(), cell = new Map(); let n = 0;
      for (let i = 0; i < T.n; i++) { const x = groupKey(a, i), y = groupKey(b, i); if (x === null || y === null) continue; n++; ra.set(x, (ra.get(x) || 0) + 1); cb.set(y, (cb.get(y) || 0) + 1); cell.set(x + "\u0001" + y, (cell.get(x + "\u0001" + y) || 0) + 1); }
      const R = [...ra].sort((p, q) => q[1] - p[1]).slice(0, 15).map(p => p[0]), Cc = [...cb].sort((p, q) => q[1] - p[1]).slice(0, 10).map(p => p[0]);
      if (R.length < 2 || Cc.length < 2) return fail("Both columns need at least two groups among the rows that have both values.");
      const tab = R.map(x => Cc.map(y => cell.get(x + "\u0001" + y) || 0)), ch = Stats.chiSquare(tab), r = result(`${a.name} by ${b.name}`);
      r.say(`${a.name} and ${b.name} ${ch.p < 0.05 ? "are linked" : "show no clear link"} across ${plural(ch.n, "row")}: the mix of ${b.name} ${ch.p < 0.05 ? "differs" : "is much the same"} from one ${a.name} to the next. ${chance(ch.p)} (chi-square test, ${pv(ch.p)}). The link is ${strength(ch.cramersV)} (Cramér's V ${sig(ch.cramersV)}).`);
      const w = el("div", "tablewrap"), t = el("table", "xtab"), hr = el("tr"); hr.append(el("th", "", a.name)); Cc.forEach(c => hr.append(el("th", "num", c))); hr.append(el("th", "num", "All")); const th = el("thead"); th.append(hr); const tb = el("tbody");
      tab.forEach((row, i) => { const tr = el("tr"), tot = Stats.sum(row); tr.append(el("td", "", R[i])); row.forEach(k => { const td = el("td", "num"), share = tot ? k / tot : 0; td.append(el("b", "", k.toLocaleString("en-US")), el("small", "", ` ${(share * 100).toFixed(0)}%`)); td.style.background = `color-mix(in srgb, var(--s1) ${Math.round(share * 55)}%, var(--bg))`; tr.append(td); }); tr.append(el("td", "num", tot.toLocaleString("en-US"))); tb.append(tr); });
      t.append(th, tb); w.append(t); const f = r.fig("Counts, with each row's share beside them. Deeper blue means a larger share of that row."); f.replaceChildren(w);
      r.csv = [[a.name, ...Cc], ...tab.map((row, i) => [R[i], ...row])];
      r.list("Keep in mind", [...(ch.smallShare > 0.2 ? [`${Math.round(ch.smallShare * 100)}% of the cells expect fewer than five rows, so the test is unreliable here. Merge small groups or collect more rows.`] : []), ...(ra.size > R.length || cb.size > Cc.length ? ["Only the most common groups are shown and tested; rarer ones are left out."] : []), "A link between two groupings does not say which one, if either, drives the other."]); r.done();
    } },
  { id: "pivot", name: "Totals by group", when: "Add up, average or count a number for each group, largest first.",
    fields: () => [{ id: "g", label: "Group by", type: "one", from: () => T.cols.filter(c => (c.kind === "cat" || c.kind === "text" || (c.kind === "num" && c.p.unique <= 60)) && c.p.unique >= 2) }, { id: "how", label: "Show the", type: "pick", options: [["sum", "total"], ["mean", "average"], ["median", "middle value"], ["count", "number of rows"], ["max", "highest"], ["min", "lowest"]] }, { id: "y", label: "Of", type: "one", from: nums, optional: true, hint: "Not needed for a count of rows" }],
    run(o) {
      const g = o.g, y = o.y, how = o.how || "sum"; if (how !== "count" && !y) return fail("Pick the number column to add up or average.");
      const m = new Map(); for (let i = 0; i < T.n; i++) { const k = g.kind === "text" ? g.v[i] : groupKey(g, i); if (k === null) continue; if (how !== "count" && isNaN(y.v[i])) continue; let a = m.get(k); if (!a) m.set(k, a = []); a.push(how === "count" ? 1 : y.v[i]); }
      const f = a => (how === "sum" ? Stats.sum(a) : how === "mean" ? Stats.mean(a) : how === "median" ? Stats.median(a) : how === "count" ? a.length : how === "max" ? Math.max(...a) : Math.min(...a));
      const rows = [...m].map(([k, a]) => [k, f(a), a.length]).sort((p, q) => q[1] - p[1]); if (!rows.length) return fail("No rows have both values.");
      const word = { sum: "Total", mean: "Average", median: "Middle value", count: "Rows", max: "Highest", min: "Lowest" }[how], what = how === "count" ? "Rows" : `${word} of ${y.name}`, r = result(`${what} by ${g.name}`), all = Stats.sum(rows.map(x => x[1]));
      r.say(`${rows[0][0]} leads with ${sig(rows[0][1])}${how === "sum" || how === "count" ? `, ${(rows[0][1] / all * 100).toFixed(0)}% of the whole` : ""}. ${rows.length > 1 ? `${rows[rows.length - 1][0]} is lowest with ${sig(rows[rows.length - 1][1])}. ` : ""}${plural(rows.length, "group")} in all.`);
      Charts.bars(r.fig(rows.length > 30 ? `The 30 largest of ${rows.length} groups.` : ""), { rows: rows.slice(0, 30).map(x => ({ label: x[0], value: x[1], sub: how === "count" ? "" : plural(x[2], "row") })), fmt: sig });
      r.table([g.name, what, "Rows used"], rows.slice(0, 200)); if (rows.length > 200) r.p("The table shows the first 200 groups; the download has them all."); r.csv = [[g.name, what, "Rows used"], ...rows]; r.done();
    } },
  { id: "paired", name: "Before and after", when: "Two measurements of the same rows: did the second differ from the first?",
    fields: () => [{ id: "a", label: "First measurement", type: "one", from: nums }, { id: "b", label: "Second measurement", type: "one", from: nums, skip: 1 }],
    run(o) {
      const a = o.a, b = o.b; if (a === b) return fail("Pick two different columns.");
      const idx = complete([a, b]), d = Float64Array.from(idx, i => b.v[i] - a.v[i]); if (d.length < 5) return fail("At least five rows need both values.");
      const t = Stats.pairedT(d), w = Stats.wilcoxon(d), rank = d.length < 30 || Math.abs(Stats.skewness(d)) > 1, p = rank ? w.p : t.p, r = result(`${b.name} compared with ${a.name}`);
      r.say(`Across ${plural(d.length, "row")}, ${b.name} is on average ${sig(Math.abs(t.diff))} ${t.diff >= 0 ? "higher" : "lower"} than ${a.name} (95% range ${sig(t.lo)} to ${sig(t.hi)}). ${chance(p)} (${rank ? "Wilcoxon signed-rank test" : "paired t-test"}, ${pv(p)}). ${idx.filter(i => b.v[i] > a.v[i]).length} rows went up and ${idx.filter(i => b.v[i] < a.v[i]).length} went down.`);
      Charts.hist(r.fig(`The change in each row (${b.name} minus ${a.name}). The line marks no change.`), { values: Array.from(d), marks: [{ at: 0, name: "no change" }], label: "Spread of the changes" });
      r.list("Why this test", [rank ? `Wilcoxon signed-rank test recommended: ${d.length < 30 ? "there are fewer than 30 rows" : "the changes are lopsided"}, so ranks are safer than averages.` : "Paired t-test recommended: there are plenty of rows and the changes are roughly symmetric.", `Both tests: paired t ${pv(t.p)}, Wilcoxon ${pv(w.p)}.`, "Each row is compared with itself, which removes the differences between rows and leaves only the change."]);
      r.list("Keep in mind", ["This only makes sense when both columns measure the same thing in the same units for the same rows.", "A change between two measurements can come from anything that happened in between, not only the thing you have in mind."]); r.done();
    } },
];

function buildTools() {
  const tabs = $("#tooltabs"); tabs.replaceChildren();
  TOOLS.forEach(t => { const ok = t.fields().every(f => f.optional || f.type === "check" || f.type === "pick" || f.from().length > (f.skip || 0) || (f.type === "multi" && f.from().length)); const b = el("button"); b.type = "button"; b.dataset.id = t.id; b.disabled = !ok; b.append(el("b", "", t.name), el("span", "", ok ? t.when : "This file has no columns of the kind it needs.")); b.onclick = () => pickTool(t.id); tabs.append(b); });
  /* starting points worked out from the columns */
  const sug = $("#suggest"); sug.replaceChildren(el("span", "up", "Good first looks")); const N = nums().filter(c => !c.p.idLike && !c.p.yearLike && c.p.unique > 2), G = groupers().filter(c => c.kind === "cat" && c.p.unique <= 8), D = timers();
  const offer = (text, id, pre) => { const b = el("button", "", text); b.type = "button"; b.onclick = () => { pickTool(id, pre); runTool(); }; sug.append(b); };
  if (N.length >= 2) {
    let best = null; const pool = N.slice(0, 9); for (let a = 0; a < pool.length; a++) for (let b = a + 1; b < pool.length; b++) { const idx = complete([pool[a], pool[b]]); if (idx.length < 8) continue; const r = Math.abs(Stats.pearson(Float64Array.from(idx, i => pool[a].v[i]), Float64Array.from(idx, i => pool[b].v[i])).r); if (isFinite(r) && r < 0.999 && (!best || r > best.r)) best = { r, a: pool[a], b: pool[b] }; }
    if (best) offer(`${best.a.name} and ${best.b.name}: do they move together?`, "relation", { y: best.a, x: best.b });
    offer(`How all ${Math.min(N.length, 10)} number columns relate`, "corr");
  }
  if (N.length && G.length) offer(`${N[0].name} across ${G[0].name}`, "groups", { y: N[0], g: G[0] });
  if (D.length && N.length) offer(`${N[0].name} over time`, "time", { t: D[0], y: N[0] });
  if (G.length >= 2) offer(`${G[0].name} against ${G[1].name}`, "cross", { a: G[0], b: G[1] });
  if (N.length) offer("A summary of every number column", "summary");
  if (sug.children.length === 1) sug.append(el("span", "hint", "Open the Summary or One column tool below to start."));
  pickTool((TOOLS.find(t => !$(`#tooltabs button[data-id=${t.id}]`).disabled) || TOOLS[0]).id);
}

let form = {};
function pickTool(id, pre = {}) {
  tool = TOOLS.find(t => t.id === id); form = {};
  $$("#tooltabs button").forEach(b => b.setAttribute("aria-pressed", b.dataset.id === id));
  const box = $("#toolform"); box.replaceChildren(el("h3", "", tool.name), el("p", "hint", tool.when)); const grid = el("div", "rgrid");
  tool.fields().forEach(f => {
    const wrap = el("div"), list = f.from ? f.from() : [];
    if (f.type === "check") { const l = el("label", "tick"), c = el("input"); c.type = "checkbox"; c.checked = !!pre[f.id]; form[f.id] = () => c.checked; l.append(c, document.createTextNode(" " + f.label)); wrap.append(l); }
    else if (f.type === "pick") { const s = el("select"); f.options.forEach(([v, t]) => s.append(new Option(t, v))); if (pre[f.id]) s.value = pre[f.id]; form[f.id] = () => s.value; wrap.append(el("span", "fl", f.label), s); }
    else if (f.type === "one") {
      const s = el("select"); if (f.optional) s.append(new Option("None", "")); list.forEach(c => s.append(new Option(c.name + (c.label ? ` (${c.label.slice(0, 40)})` : ""), c.name)));
      const want = pre[f.id] ? pre[f.id].name : f.optional ? "" : (list[f.skip || 0] || list[0] || {}).name; if (want !== undefined) s.value = want;
      form[f.id] = () => (s.value ? byName(s.value) : null); wrap.append(el("span", "fl", f.label), s); if (f.hint) wrap.append(el("p", "hint", f.hint));
    } else {
      const set = new Set((pre[f.id] || f.pre || []).map(c => c.name)), host = el("div", "pick"); host.id = `tf-${tool.id}-${f.id}`; wrap.append(el("span", "fl", f.label), host); wrap.style.gridColumn = "1 / -1";
      picker(host, { items: list.map(c => ({ value: c.name, label: c.name, sub: c.label })), set, add: "Add a column", none: "None chosen", max: f.max, allText: f.max ? "" : "Add all", clearText: "Clear", onChange() {} });
      form[f.id] = () => [...set].map(byName).filter(Boolean);
    }
    grid.append(wrap);
  });
  const run = el("button", "btn solid", "Run it"); run.type = "button"; run.id = "run"; run.onclick = runTool;
  const row = el("div", "run"); row.append(run, el("span", "hint", "The result appears below. Earlier results stay, so you can compare."));
  box.append(grid, row);
}
function runTool() {
  const o = {}; for (const k in form) o[k] = form[k]();
  for (const f of tool.fields()) if (f.type === "one" && !f.optional && !o[f.id]) return fail(`Choose a column for "${f.label}".`);
  try { tool.run(o); } catch (e) { console.error(e); fail(e && e.message && e.message.length < 200 && /[.]$/.test(e.message) ? e.message : "That analysis could not be completed on these columns. Try other columns, or check them in the Columns table for empty or constant values."); }
}

/* ---------- start ---------- */
(function () {
  const drop = $("#drop"), input = $("#file");
  $("#pick").onclick = e => { e.stopPropagation(); input.click(); };
  drop.addEventListener("click", e => { if (!e.target.closest("button, a, input, textarea")) input.click(); });
  drop.addEventListener("keydown", e => { if ((e.key === "Enter" || e.key === " ") && e.target === drop) { e.preventDefault(); input.click(); } });
  input.onchange = () => { if (input.files[0]) open(input.files[0]); input.value = ""; };
  ["dragenter", "dragover"].forEach(k => addEventListener(k, e => { e.preventDefault(); drop.classList.add("over"); }));
  ["dragleave", "drop"].forEach(k => addEventListener(k, e => { e.preventDefault(); if (k === "drop" || e.relatedTarget === null) drop.classList.remove("over"); }));
  addEventListener("drop", e => { const f = e.dataTransfer && e.dataTransfer.files[0]; if (f) open(f); });
  const sample = async (url, name) => { status(`Fetching ${name}.`); try { const b = await (await fetch(url)).blob(); open(new File([b], name)); } catch (e) { status("The sample could not be loaded. Check the connection and try again.", true); } };
  $("#s-countries").onclick = () => sample("data/sample-countries.csv", "countries-one-year.csv");
  $("#s-oil").onclick = () => sample("data/sets/crude-oil-prices.csv", "crude-oil-prices.csv");
  $("#paste-btn").onclick = () => { $("#pastebox").hidden = !$("#pastebox").hidden; if (!$("#pastebox").hidden) $("#paste").focus(); };
  $("#paste-go").onclick = () => { const t = $("#paste").value; if (!t.trim()) return status("Paste some rows first.", true); try { const table = Readers.text(t); open({ name: "pasted table", size: t.length }, { table }); } catch (e) { status(e.message || "That text could not be read as a table.", true); } };
  $("#ptabs").onclick = e => { const b = e.target.closest("button"); if (!b) return; $$("#ptabs button").forEach(x => x.classList.toggle("on", x === b)); $("#pane-cols").hidden = b.dataset.t !== "cols"; $("#pane-rows").hidden = b.dataset.t !== "rows"; };
})();
