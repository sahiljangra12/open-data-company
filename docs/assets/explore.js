/* Explorer: pick variables, places and time; add conditions or merge; check the table and chart; download. */
/* needs core.js */
const PAL = [1, 2, 3, 4, 5, 6, 7, 8].map(i => `var(--s${i})`);   // series colours, fixed order; the theme supplies the values
const OPS = { ">": (a, b) => a > b, ">=": (a, b) => a >= b, "<": (a, b) => a < b, "<=": (a, b) => a <= b, "=": (a, b) => a == b, "≠": (a, b) => a != b };
const FMT = { csv: "CSV", xlsx: "Excel", json: "JSON", tsv: "TSV" };
let M = [], S = null, R = null, timer = 0, P = {};
const slots = new Map();   // a series keeps its colour while it stays on the chart

function colorOf(keys) {
  for (const k of [...slots.keys()]) if (!keys.includes(k)) slots.delete(k);
  keys.forEach(k => { if (!slots.has(k)) { const used = new Set(slots.values()); slots.set(k, PAL.findIndex((_, i) => !used.has(i))); } });
  return k => PAL[slots.get(k)];
}

const keyOf = (d, keys, i) => keys.length === 1 ? String(d.c[keys[0]][i]) : keys.map(k => d.c[k][i]).join("|");
const sig = ds => ds.keys.join("+");

/* ---------- the table the visitor is building ---------- */
function compute() {
  const ds = S.ds, d = S.data, T = d.c[ds.time.col], E = ds.entity ? d.c[ds.entity.col] : null;
  const ents = S.ents.size ? S.ents : null, m = S.merge && S.merge.data ? S.merge : null;
  const cols = [];
  ds.keys.forEach(k => {
    cols.push({ name: k, title: k === ds.time.col ? (ds.time.type === "year" ? "Year" : "Date") : k, type: d.type[k], src: "b", col: k, key: true });
    if (ds.entity && k === ds.entity.col && ds.entity.label_col !== k) cols.push({ name: ds.entity.label_col, title: ds.entity.label, type: "str", src: "b", col: ds.entity.label_col, key: true });
  });
  ds.columns.filter(c => S.vars.has(c.name)).forEach(c => cols.push({ ...c, src: "b", col: c.name }));
  if (m) {
    const taken = new Set(cols.map(c => c.name));
    m.ds.columns.filter(c => m.vars.has(c.name)).forEach(c => {
      const name = taken.has(c.name) ? `${c.name}_${m.ds.id.split("-")[0]}` : c.name;
      cols.push({ ...c, name, title: `${c.title} (${m.ds.title})`, src: "m", col: c.name });
    });
    if (!m.index) { m.index = new Map(); for (let i = 0; i < m.data.n; i++) m.index.set(keyOf(m.data, m.ds.keys, i), i); }
  }
  const val = (c, b, mi) => c.src === "b" ? d.c[c.col][b] : mi < 0 ? (c.type === "num" ? NaN : "") : m.data.c[c.col][mi];
  const vars = cols.filter(c => !c.key);
  const rules = S.filters.map(f => {
    const [src, col] = f.ref.split(":"), ty = (src === "b" ? d : m && m.data)?.type[col];
    if (!ty || (src === "m" && !m)) return null;
    const v = ty === "num" ? parseFloat(f.val) : f.val;
    if (f.op !== "filled" && (f.val === "" || (ty === "num" && isNaN(v)))) return null;
    return { c: { src, col, type: ty }, op: f.op, v };
  }).filter(Boolean);
  const yr = ds.time.type === "year", from = yr ? (S.from === "" ? -Infinity : +S.from) : S.from, to = yr ? (S.to === "" ? Infinity : +S.to) : S.to;
  const B = [], MI = [];
  for (let i = 0; i < d.n; i++) {
    if (ents && !ents.has(E[i])) continue;
    const t = yr ? T[i] : T[i].slice(0, 10);
    if (yr ? (t < from || t > to) : ((from && t < from) || (to && t > to))) continue;
    const mi = m ? (m.index.get(keyOf(d, ds.keys, i)) ?? -1) : -1;
    if (m && m.how === "inner" && mi < 0) continue;
    let ok = true;
    for (const r of rules) { const x = val(r.c, i, mi); if (r.op === "filled" ? empty(x) : (empty(x) || !OPS[r.op](x, r.v))) { ok = false; break; } }
    if (!ok) continue;
    if (S.dropEmpty && vars.length && vars.every(c => empty(val(c, i, mi)))) continue;
    B.push(i); MI.push(mi);
  }
  return { cols, B, MI, n: B.length, val, get: (r, c) => val(c, B[r], MI[r]) };
}

const fmt = (v, c) => empty(v) ? "" : c.type !== "num" || c.key ? String(v) :
  Math.abs(v) >= 1000 ? v.toLocaleString("en-US", { maximumFractionDigits: 2 }) : String(+v.toPrecision(5));
const raw = v => empty(v) ? "" : v;

function drawPreview() {
  const N = Math.min(R.n, 100), cls = c => c.type === "num" && !c.key ? "num" : "";
  let h = "<thead><tr>" + R.cols.map(c => `<th class="${cls(c)}" title="${esc(c.title + (c.unit ? " (" + c.unit + ")" : ""))}">${esc(c.name)}</th>`).join("") + "</tr></thead><tbody>";
  for (let r = 0; r < N; r++) h += "<tr>" + R.cols.map(c => `<td class="${cls(c)}">${esc(fmt(R.get(r, c), c))}</td>`).join("") + "</tr>";
  $("#preview").innerHTML = R.n ? h + "</tbody>" : `<tbody><tr><td>No rows match. Remove a condition, widen the years, or add a variable.</td></tr></tbody>`;
  $("#preview-note").textContent = R.n > N ? `The first ${N} of ${R.n.toLocaleString()} rows. The download has all of them.` : "";
}

function drawStats() {
  const vs = R.cols.filter(c => !c.key && c.type === "num");
  $("#stats").innerHTML = "<thead><tr><th>Variable</th><th>Unit</th><th class='num'>Filled</th><th class='num'>Lowest</th><th class='num'>Average</th><th class='num'>Highest</th></tr></thead><tbody>" +
    vs.map(c => {
      let n = 0, s = 0, lo = Infinity, hi = -Infinity;
      for (let r = 0; r < R.n; r++) { const v = R.get(r, c); if (!isNaN(v)) { n++; s += v; if (v < lo) lo = v; if (v > hi) hi = v; } }
      const f = x => n ? fmt(x, c) : "";
      return `<tr><td>${esc(c.title)}</td><td>${esc(c.unit || "")}</td><td class="num">${n.toLocaleString()}</td><td class="num">${f(lo)}</td><td class="num">${f(s / n)}</td><td class="num">${f(hi)}</td></tr>`;
    }).join("") + (vs.length ? "" : "<tr><td colspan='6'>Add a numeric variable to see its summary.</td></tr>") + "</tbody>";
}

function drawChart() {
  if (!R) return;                                               // the table is still being built
  const ds = S.ds, nums = R.cols.filter(c => !c.key && c.type === "num"), sel = $("#chart-var"), box = $("#chart");
  const keep = sel.value; sel.innerHTML = nums.map(c => `<option value="${esc(c.name)}">${esc(c.title)}</option>`).join("");
  if (nums.some(c => c.name === keep)) sel.value = keep;
  sel.parentElement.style.display = ds.entity ? "" : "none";
  if (!nums.length || !R.n) { box.innerHTML = "<p class='legend'>Add a numeric variable to draw a chart.</p>"; return; }
  const tc = R.cols.find(c => c.col === ds.time.col && c.key), x = r => ds.time.type === "year" ? R.get(r, tc) : Date.parse(R.get(r, tc));
  const series = new Map(); let note = "", unit = "";
  if (ds.entity) {
    const vc = nums.find(c => c.name === sel.value) || nums[0], lc = R.cols.find(c => c.col === ds.entity.label_col) || R.cols[0], ec = R.cols.find(c => c.col === ds.entity.col);
    const prefer = !S.ents.size && ds.chart_entities ? new Set(ds.chart_entities) : null;
    for (let r = 0; r < R.n; r++) {
      if (prefer && !prefer.has(R.get(r, ec))) continue;
      const v = R.get(r, vc); if (isNaN(v)) continue;
      const k = R.get(r, lc); (series.get(k) || series.set(k, []).get(k)).push([x(r), v]);
    }
    if (prefer) note = `Showing a starter set of ${series.size}. Pick places above to compare your own.`;
    if (series.size > 8) {
      const top = [...series].sort((a, b) => b[1][b[1].length - 1][1] - a[1][a[1].length - 1][1]).slice(0, 8);
      note = `Showing the 8 largest of ${series.size} by latest value. Pick up to 8 places above to compare them.`;
      series.clear(); top.forEach(([k, v]) => series.set(k, v));
    }
    unit = vc.unit || "";
  } else {
    nums.slice(0, 8).forEach(c => { const pts = []; for (let r = 0; r < R.n; r++) { const v = R.get(r, c); if (!isNaN(v)) pts.push([x(r), v]); } if (pts.length) series.set(c.title, pts); });
    unit = nums.length === 1 ? nums[0].unit || "" : "";
  }
  const idx = $("#chart-index").checked, dots = ds.chart === "points";
  let all = [];
  series.forEach((pts, k) => {
    pts.sort((a, b) => a[0] - b[0]);
    if (idx) { const b = pts.find(p => p[1] !== 0); pts = b ? pts.map(p => [p[0], p[1] / b[1] * 100]) : pts; }
    if (pts.length > 1500) { const s = Math.ceil(pts.length / 1500); pts = pts.filter((_, i) => i % s === 0 || i === pts.length - 1); }
    series.set(k, pts); all = all.concat(pts);
  });
  if (!all.length) { box.innerHTML = "<p class='legend'>No values to plot for this selection.</p>"; return; }
  const W = Math.max(320, box.clientWidth || 700), H = 400, m = { l: 62, r: 22, t: 14, b: 30 };
  let x0 = Math.min(...all.map(p => p[0])), x1 = Math.max(...all.map(p => p[0])), y0 = Math.min(0, ...all.map(p => p[1])), y1 = Math.max(...all.map(p => p[1]));
  if (x0 === x1) { x0 -= 1; x1 += 1; } if (y0 === y1) y1 = y0 + 1;
  const step = (() => { const rw = (y1 - y0) / 5, p = Math.pow(10, Math.floor(Math.log10(rw))), f = rw / p; return (f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10) * p; })();
  y1 = Math.ceil(y1 / step) * step; y0 = Math.floor(y0 / step) * step;
  const sx = v => m.l + (v - x0) / (x1 - x0) * (W - m.l - m.r), sy = v => H - m.b - (v - y0) / (y1 - y0) * (H - m.t - m.b);
  const short = v => Math.abs(v) >= 1e9 ? +(v / 1e9).toPrecision(3) + "B" : Math.abs(v) >= 1e6 ? +(v / 1e6).toPrecision(3) + "M" : Math.abs(v) >= 1e4 ? +(v / 1e3).toPrecision(3) + "k" : String(+v.toPrecision(4));
  const xl = v => ds.time.type === "year" ? String(Math.round(v)) : new Date(v).toISOString().slice(0, 10);
  let g = "";
  for (let v = y0; v <= y1 + step / 2; v += step) g += `<line x1="${m.l}" x2="${W - m.r}" y1="${sy(v)}" y2="${sy(v)}" class="${Math.abs(v) < step / 1e6 ? "g-zero" : "g-grid"}"/><text x="${m.l - 8}" y="${sy(v) + 4}" text-anchor="end" class="g-tick">${short(v)}</text>`;
  const yr = ds.time.type === "year", Y = v => yr ? v : new Date(v).getUTCFullYear() + (v - Date.UTC(new Date(v).getUTCFullYear(), 0, 1)) / 31557600000;
  const span = Y(x1) - Y(x0), ticks = [];
  if (span >= 3) {
    const st = [1, 2, 5, 10, 20, 25, 50, 100].find(s => span / s <= (W < 520 ? 5 : 9)) || 100;
    for (let y = Math.ceil(Y(x0) / st) * st; y <= Y(x1) + 1e-9; y += st) ticks.push([yr ? y : Date.UTC(y, 0, 1), String(y)]);
  } else for (let i = 0; i <= 4; i++) { const v = x0 + (x1 - x0) * i / 4; ticks.push([v, xl(v)]); }
  ticks.forEach(([v, t]) => { g += `<line x1="${sx(v)}" x2="${sx(v)}" y1="${H - m.b}" y2="${H - m.b + 5}" class="g-zero"/><text x="${sx(v)}" y="${H - 8}" text-anchor="middle" class="g-tick">${t}</text>`; });
  const paint = colorOf([...series.keys()]);
  let leg = "";
  series.forEach((pts, k) => {
    const col = paint(k);
    if (dots) g += pts.map(p => `<circle cx="${sx(p[0]).toFixed(1)}" cy="${sy(p[1]).toFixed(1)}" r="2.6" style="fill:${col}" fill-opacity=".6"/>`).join("");
    else {
      g += `<path d="${pts.map((p, j) => (j ? "L" : "M") + sx(p[0]).toFixed(1) + " " + sy(p[1]).toFixed(1)).join("")}" class="g-line" style="stroke:${col}"/>`;
      const e = pts[pts.length - 1]; g += `<circle cx="${sx(e[0]).toFixed(1)}" cy="${sy(e[1]).toFixed(1)}" r="4.5" class="g-ring" style="fill:${col}"/>`;
    }
    leg += `<span><b style="background:${col}"></b>${esc(k)}</span>`;
  });
  box.innerHTML = `<svg viewBox="0 0 ${W} ${H}" width="100%" height="${H}" role="img" aria-label="Chart of the current selection. The Table tab has the same values.">${g}<line id="rule" y1="${m.t}" y2="${H - m.b}" class="g-rule" visibility="hidden"/></svg>
    <div class="legend chartleg">${leg}</div><div class="legend">${idx ? "Indexed: first value = 100. " : unit ? "Unit: " + esc(unit) + ". " : ""}${esc(note)}</div><div id="tip" class="tip" hidden></div>`;
  const svg = $("svg", box), tip = $("#tip"), rule = $("#rule");
  svg.onmousemove = ev => {
    const rc = svg.getBoundingClientRect(), xv = x0 + ((ev.clientX - rc.left) / rc.width * W - m.l) / (W - m.l - m.r) * (x1 - x0);
    let best = null; series.forEach(pts => pts.forEach(p => { if (best === null || Math.abs(p[0] - xv) < Math.abs(best - xv)) best = p[0]; }));
    const rows = [], tol = (x1 - x0) / 150;
    series.forEach((pts, k) => { let p = pts[0]; for (const q of pts) if (Math.abs(q[0] - best) < Math.abs(p[0] - best)) p = q; if (Math.abs(p[0] - best) <= tol) rows.push([p[1], `<div class="row"><span class="key" style="background:${paint(k)}"></span><strong>${short(p[1])}</strong> <span class="nm">${esc(k)}</span></div>`]); });
    rule.setAttribute("x1", sx(best)); rule.setAttribute("x2", sx(best)); rule.setAttribute("visibility", "visible");
    tip.innerHTML = `<div class="nm">${xl(best)}</div>` + rows.sort((a, b) => b[0] - a[0]).map(r => r[1]).join("");
    tip.hidden = false; tip.style.left = Math.min(rc.width - 210, Math.max(0, ev.clientX - rc.left + 14)) + "px"; tip.style.top = (ev.clientY - rc.top + 10) + "px";
  };
  svg.onmouseleave = () => { tip.hidden = true; rule.setAttribute("visibility", "hidden"); };
}

function refresh() {
  clearTimeout(timer);
  timer = setTimeout(() => {
    R = compute();
    $("#summary").innerHTML = `<strong>${R.n.toLocaleString()}</strong> rows, <strong>${R.cols.length}</strong> columns` + (S.merge && S.merge.data ? `, merged` : "");
    const big = S.fmt === "xlsx" && R.n * R.cols.length > 2e6;
    $("#dl").disabled = !R.n || big; $("#dl").textContent = `Download ${FMT[S.fmt]}`;
    $("#dl-note").textContent = big ? "This table is too large for Excel here. Switch to CSV, or narrow the selection." : "";
    drawPreview(); drawStats(); if (!$("#pane-chart").hidden) drawChart(); saveHash();
  }, 90);
}

/* ---------- time presets ---------- */
function drawPresets() {
  const ds = S.ds, yr = ds.time.type === "year", box = $("#presets"), lo = day(ds.time.min), hi = day(ds.time.max), list = [["All", "", ""]];
  if (yr) {
    const now = Math.min(+hi, new Date().getFullYear());
    if (+lo < 2000 && +hi >= 2000) list.push(["Since 2000", "2000", ""]);
    if (now - 9 > +lo) list.push(["Last 10 years", String(now - 9), String(now)]);
    list.push(["Latest year", hi, hi]);
  } else {
    const back = n => { const d = new Date(hi + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() - n); return d.toISOString().slice(0, 10); };
    [["Last 30 days", 30], ["Last year", 365], ["Last 5 years", 1826], ["Last 20 years", 7305]].forEach(([l, n]) => { if (back(n) > lo) list.push([l, back(n), ""]); });
  }
  box.innerHTML = list.map(([l, f, t]) => `<button type="button" data-f="${f}" data-t="${t}">${l}</button>`).join("");
  box.onclick = e => { const b = e.target.closest("button"); if (!b) return; S.from = b.dataset.f; S.to = b.dataset.t; $("#t-from").value = S.from; $("#t-to").value = S.to; refresh(); };
}

/* ---------- conditions and merging ---------- */
function drawFilters() {
  const opts = [...S.ds.columns.map(c => [`b:${c.name}`, c.title]), ...(S.merge && S.merge.data ? S.merge.ds.columns.map(c => [`m:${c.name}`, `${c.title} (${S.merge.ds.title})`]) : [])];
  $("#filters").innerHTML = S.filters.map((f, i) => `<div class="rule" data-i="${i}"><select data-k="ref" aria-label="Variable">${opts.map(o => `<option value="${esc(o[0])}" ${o[0] === f.ref ? "selected" : ""}>${esc(o[1])}</option>`).join("")}</select>
    <select data-k="op" aria-label="Condition">${[...Object.keys(OPS), "filled"].map(o => `<option value="${o}" ${o === f.op ? "selected" : ""}>${o === "filled" ? "is not empty" : o}</option>`).join("")}</select>
    <input data-k="val" value="${esc(f.val)}" placeholder="value" aria-label="Value" ${f.op === "filled" ? "hidden" : ""}><button type="button" data-k="x" aria-label="Remove this condition">×</button></div>`).join("");
}

function drawMerge() {
  const m = S.merge, box = $("#merge-body");
  if (!m) { box.innerHTML = ""; return; }
  if (!m.data) { box.innerHTML = "<p>Loading that dataset.</p>"; return; }
  box.innerHTML = `<p>Rows are matched on ${esc(S.ds.keys.join(" and "))}. Choose which of its variables to add.</p>
    <select id="m-how" aria-label="Rows to keep"><option value="left">Keep every row of this dataset</option><option value="inner" ${m.how === "inner" ? "selected" : ""}>Keep only rows found in both</option></select>
    <div class="pick" id="p-merge"></div>`;
  picker($("#p-merge"), { items: m.ds.columns.map(c => ({ value: c.name, label: c.title, sub: c.unit, tip: c.description })), set: m.vars, add: "Add a variable from it", none: "No variables added yet", allText: "", clearText: "Clear", onChange: refresh });
  $("#m-how").onchange = e => { m.how = e.target.value; refresh(); };
}

async function setMerge(id, vars, how) {
  if (!id) { S.merge = null; drawMerge(); drawFilters(); refresh(); return; }
  const ds = M.find(d => d.id === id);
  S.merge = { ds, data: null, vars: new Set((vars || ds.default_vars || ds.columns.slice(0, 1).map(c => c.name)).filter(v => ds.columns.some(c => c.name === v))), how: how || "left" };
  drawMerge();
  S.merge.data = await load(ds);
  drawMerge(); drawFilters(); refresh();
}

function saveHash() {
  const p = new URLSearchParams({ d: S.ds.id, v: [...S.vars].join(","), e: [...S.ents].join(","), f: S.from, t: S.to });
  if (S.merge) { p.set("m", S.merge.ds.id); p.set("mv", [...S.merge.vars].join(",")); p.set("how", S.merge.how); }
  if (S.filters.length) p.set("q", JSON.stringify(S.filters));
  history.replaceState(null, "", "#" + p.toString());
  const nums = S.ds.columns.filter(c => S.vars.has(c.name) && c.type === "num").map(c => `${S.ds.id}::${c.name}`), r = new URLSearchParams({ k: nums.length > 1 ? "rel" : "trend", y: nums[0] || "", x: nums[1] || "", p: [...S.ents].slice(0, 8).join(","), f: S.from, t: S.to });
  [...r].forEach(([k, v]) => { if (v === "") r.delete(k); }); const tr = $("#to-research"); if (tr) tr.href = "research.html#" + r.toString();
}

function download() {
  const f = S.fmt, name = `${S.ds.id}${S.merge && S.merge.data ? "_merged" : ""}_${new Date().toISOString().slice(0, 10)}`;
  const head = R.cols.map(c => c.name);
  const save = (blob, ext) => { const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `${name}.${ext}`; document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 2000); };
  if (f === "csv" || f === "tsv") {
    const sep = f === "csv" ? "," : "\t", q = v => { v = String(raw(v)); return f === "csv" ? (/[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v) : v.replace(/[\t\n]/g, " "); };
    const parts = [head.join(sep) + "\n"]; let buf = "";
    for (let r = 0; r < R.n; r++) { buf += R.cols.map(c => q(R.get(r, c))).join(sep) + "\n"; if (r % 5000 === 4999) { parts.push(buf); buf = ""; } }
    parts.push(buf); save(new Blob(parts, { type: f === "csv" ? "text/csv" : "text/tab-separated-values" }), f);
  } else if (f === "json") {
    const parts = ["[\n"];
    for (let r = 0; r < R.n; r++) { const o = {}; R.cols.forEach(c => { const v = R.get(r, c); o[c.name] = empty(v) ? null : v; }); parts.push((r ? ",\n" : "") + JSON.stringify(o)); }
    parts.push("\n]\n"); save(new Blob(parts, { type: "application/json" }), "json");
  } else {
    if (R.n * R.cols.length > 2e6) return;
    const aoa = [head]; for (let r = 0; r < R.n; r++) aoa.push(R.cols.map(c => { const v = R.get(r, c); return empty(v) ? null : v; }));
    const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), "data");
    const about = [["Dataset", S.ds.title], ["Source", S.ds.source], ["Source link", S.ds.source_url], ["Licence", S.ds.licence]];
    if (S.merge && S.merge.data) about.push(["Merged with", S.merge.ds.title], ["Source", S.merge.ds.source], ["Licence", S.merge.ds.licence]);
    about.push(["Downloaded", new Date().toISOString().slice(0, 10)], [], ["Column", "Meaning", "Unit"], ...R.cols.map(c => [c.name, c.title, c.unit || ""]));
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(about), "about");
    save(new Blob([XLSX.write(wb, { bookType: "xlsx", type: "array" })], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), "xlsx");
  }
}

async function openSet(id, st = {}) {
  const ds = M.find(d => d.id === id) || M[0];
  $("#ds").value = ds.id; document.title = `${ds.title} | Open Data Company`;
  $("#title").textContent = ds.title; $("#desc").textContent = ds.description;
  $("#meta").innerHTML = [`Source: <a href="${esc(ds.source_url)}" target="_blank" rel="noopener">${esc(ds.source)}</a>`, `Licence: ${esc(ds.licence)}`,
    `${ds.rows.toLocaleString()} rows, ${ds.columns.length} variables`, `${esc(day(ds.time.min))} to ${esc(day(ds.time.max))}`, `Built ${esc(ds.built)}`,
    `<a href="${esc(ds.file)}" download>Download everything (CSV, ${size(ds.bytes)})</a>`].map(x => `<span>${x}</span>`).join("");
  $("#work").hidden = true; $("#dock").hidden = true; $("#loading").hidden = false; $("#loading").textContent = `Loading ${size(ds.bytes)} of data.`;
  const data = await load(ds), has = v => ds.columns.some(c => c.name === v);
  const dv = (st.v ?? (ds.default_vars || ds.columns.slice(0, 4).map(c => c.name))).filter(has);
  S = { ds, data, vars: new Set(dv), ents: new Set(), from: st.f ?? "", to: st.t ?? "", filters: st.q || [], dropEmpty: true, merge: null, fmt: S ? S.fmt : "csv" };
  slots.clear();
  $("#loading").hidden = true; $("#work").hidden = false; $("#dock").hidden = false;
  P.vars = picker($("#p-vars"), { items: ds.columns.map(c => ({ value: c.name, label: c.title, sub: c.unit, tip: c.description })), set: S.vars, add: "Search and add variables",
    none: "No variables picked: the file will hold only the key columns", allText: ds.columns.length > 1 ? "Add all" : "", clearText: "Clear", onChange: refresh });
  $("#row-ents").hidden = !ds.entity; $("#n-time").textContent = ds.entity ? "3" : "2"; $("#n-more").textContent = ds.entity ? "4" : "3";
  if (ds.entity) {
    const E = data.c[ds.entity.col], L = data.c[ds.entity.label_col], seen = new Map();
    for (let i = 0; i < data.n; i++) if (!seen.has(E[i])) seen.set(E[i], L[i]);
    const items = [...seen].map(([value, label]) => ({ value, label, sub: label === value ? "" : value })).sort((a, b) => a.label.localeCompare(b.label));
    (st.e ?? []).filter(e => seen.has(e)).forEach(e => S.ents.add(e));
    $("#e-title").textContent = ds.entity.label;
    P.ents = picker($("#p-ents"), { items, set: S.ents, add: `Search and add, for example ${items.find(i => i.label === "India") ? "India" : items[0].label}`, none: `All ${items.length} included`, allText: "", clearText: "Include all", onChange: refresh });
  }
  const yr = ds.time.type === "year";
  ["from", "to"].forEach(k => { const el = $("#t-" + k); el.type = yr ? "number" : "date"; el.min = day(ds.time.min); el.max = day(ds.time.max); el.value = S[k]; el.placeholder = k === "from" ? day(ds.time.min) : day(ds.time.max); el.oninput = () => { S[k] = el.value; refresh(); }; });
  drawPresets();
  const mates = M.filter(d => d.id !== ds.id && sig(d) === sig(ds));
  $("#merge").innerHTML = `<option value="">${mates.length ? "None" : "Nothing shares this dataset's keys yet"}</option>` + mates.map(d => `<option value="${esc(d.id)}">${esc(d.title)}</option>`).join("");
  $("#merge").disabled = !mates.length; $("#merge").onchange = e => setMerge(e.target.value);
  $("#drop").checked = true; $("#more").open = !!(S.filters.length || st.m);
  drawMerge(); drawFilters();
  if (st.m && mates.some(d => d.id === st.m)) { $("#merge").value = st.m; await setMerge(st.m, st.mv, st.how); } else refresh();
}

async function init() {
  M = (await (await fetch("data/datasets.json")).json()).datasets;
  $("#ds").innerHTML = M.map(d => `<option value="${esc(d.id)}">${esc(d.title)}</option>`).join("");
  $("#ds").onchange = e => openSet(e.target.value);
  $("#drop").onchange = e => { S.dropEmpty = e.target.checked; refresh(); };
  $("#add-filter").onclick = () => { S.filters.push({ ref: `b:${(S.ds.columns.find(c => S.vars.has(c.name)) || S.ds.columns[0]).name}`, op: ">", val: "" }); drawFilters(); $(".rule:last-child input")?.focus(); };
  $("#filters").addEventListener("input", e => { const i = +e.target.closest(".rule").dataset.i, k = e.target.dataset.k; if (k && k !== "x") { S.filters[i][k] = e.target.value; if (k === "op") drawFilters(); refresh(); } });
  $("#filters").addEventListener("click", e => { if (e.target.dataset.k === "x") { S.filters.splice(+e.target.closest(".rule").dataset.i, 1); drawFilters(); refresh(); } });
  $$(".tabs button").forEach(b => b.onclick = () => { $$(".tabs button").forEach(x => x.classList.toggle("on", x === b)); $$(".pane").forEach(p => p.hidden = p.id !== "pane-" + b.dataset.t); if (b.dataset.t === "chart") drawChart(); });
  $("#chart-var").onchange = drawChart; $("#chart-index").onchange = drawChart;
  $("#fmt").onclick = e => { const b = e.target.closest("button"); if (!b) return; S.fmt = b.dataset.f; $$("#fmt button").forEach(x => x.setAttribute("aria-pressed", x === b)); refresh(); };
  $("#dl").onclick = download;
  $("#share").onclick = async () => { try { await navigator.clipboard.writeText(location.href); $("#share").textContent = "Link copied"; } catch { $("#share").textContent = "Copy the address bar"; } setTimeout(() => $("#share").textContent = "Copy link", 1800); };
  window.addEventListener("resize", () => { if (R && !$("#pane-chart").hidden) drawChart(); });
  const read = () => { const p = new URLSearchParams(location.hash.slice(1) || location.search.slice(1)), list = k => p.has(k) ? p.get(k).split(",").filter(Boolean) : undefined; let q; try { q = p.has("q") ? JSON.parse(p.get("q")) : undefined; } catch { q = undefined; }
    return [p.get("d"), { v: list("v"), e: list("e"), f: p.get("f") ?? undefined, t: p.get("t") ?? undefined, m: p.get("m"), mv: list("mv"), how: p.get("how"), q }]; };
  await openSet(...read());
}
init().catch(e => { console.error(e); $("#loading").hidden = false; $("#loading").textContent = "The data did not load. Reload the page to try again."; });
