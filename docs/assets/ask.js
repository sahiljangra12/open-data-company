/* Ask: a question in plain words -> the number, its year and its source, read from the datasets.
   Nothing is generated: the page matches words to a variable and a place by fixed rules, then looks the value up.
   Needs core.js, concepts.js (word lists) and charts.js. */
let M = [], V = new Map(), C = {}, PULSE = {}, NAMES = [], LABEL = new Map(), ticket = 0;
const latestCache = {};
const COUNTRY_SETS = ["co2-and-greenhouse-gases", "energy", "world-bank-development"];
const norm = t => String(t).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/₂/g, "2").replace(/[^a-z0-9%$]+/g, " ").trim();
const isReal = code => code in C && !code.startsWith("OWID_");
const ordinal = n => { const s = ["th", "st", "nd", "rd"], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); };

/* Words that should win over the general list when someone is asking for a number rather than framing a hypothesis. */
const ASK_FIRST = [
  [/(co2|carbon|emissions?) per (capita|person|head)|per (capita|person|head) (co2|carbon|emissions?)/, "co2-and-greenhouse-gases::co2_per_capita"],
  [/co2 in the (air|atmosphere)|atmospheric co2|carbon dioxide (level|concentration)|\bppm\b/, "atmospheric-co2::mauna_loa_ppm"],
  [/greenhouse gas/, "co2-and-greenhouse-gases::total_ghg"], [/methane/, "co2-and-greenhouse-gases::methane"],
  [/co2|carbon|emissions?|emitters?|emit|polluters?/, "co2-and-greenhouse-gases::co2"],
  [/richest|poorest|gdp per (capita|person|head)|income per (capita|person|head)|average income/, "world-bank-development::gdp_per_capita"],
  [/(biggest|largest|size of( the)?) econom\w*|total gdp/, "world-bank-development::gdp_current_usd"],
  [/most populous|how many people|number of people|inhabitants/, "world-bank-development::population"],
  [/solar (power|energy|electricity|generation|output)/, "energy::solar_electricity"], [/wind (power|energy|electricity|generation|output)/, "energy::wind_electricity"],
  [/nuclear/, "energy::nuclear_share_elec"], [/hydro/, "energy::hydro_share_elec"], [/fossil/, "energy::fossil_share_elec"],
  [/electricity (generation|production|generated|produced)|power generation/, "energy::electricity_generation"],
  [/electricity (use|consumption|demand) per (capita|person|head)|electricity per (capita|person|head)/, "energy::per_capita_electricity"],
  [/energy (use|consumption) per (capita|person|head)|energy per (capita|person|head)/, "energy::energy_per_capita"], [/primary energy|total energy|energy (use|consumption)/, "energy::primary_energy_consumption"],
  [/wti|west texas/, "crude-oil-prices::wti_usd_per_barrel"], [/maternal mortality|mothers d(ie|ying)/, "world-bank-development::maternal_mortality"],
  [/sanitation|toilets?/, "world-bank-development::basic_sanitation_access"], [/drinking water|clean water|water access/, "world-bank-development::basic_water_access"],
  [/exchange rate/, "world-bank-development::exchange_rate"], [/\bgni\b/, "world-bank-development::gni_per_capita"], [/tax/, "world-bank-development::tax_revenue_share_gdp"],
  [/research and development|\br ?& ?d\b|r d spending/, "world-bank-development::research_spending_share_gdp"], [/migration|migrants?/, "world-bank-development::net_migration"],
  [/elderly|ageing|aging|over 65|65 and (above|over)/, "world-bank-development::population_65_plus_share"], [/vaccin|immuni[sz]|measles/, "world-bank-development::measles_immunization"],
  [/farmland|agricultural land/, "world-bank-development::agricultural_land_share"], [/women (working|in work|in the labou?r force)|female labou?r/, "world-bank-development::female_labor_participation"],
];
const STOP = new Set("what whats is are was were the of in for how many much does do did has have had a an which country countries nation nations by to and vs versus compare compared comparison between with than show me give tell latest current currently now today right this year s on at about there it its their any all please can you i want need know number numbers figure figures data value values level levels stats statistics rate total".split(" "));
const TOP = /\b(top|highest|most|largest|biggest|greatest|leading|richest|maximum|ranking|rank|ranked|leaders?)\b/, BOTTOM = /\b(lowest|least|smallest|fewest|bottom|poorest|minimum)\b/;
const WHICH = /\b(which|what) (country|countries|nation|nations)\b|\bcountries (with|by|ranked)\b|\bby country\b|\bemitters\b/;

/* ---------- words ---------- */
function buildPlaces() {
  const seen = new Map(), add = (name, code) => { const n = norm(name); if (n.length >= 3 && !seen.has(n)) seen.set(n, code); };
  COUNTRY_SETS.forEach(id => { const d = M.find(x => x.id === id); if (!d) return; d.places.forEach(([code, label]) => { add(label, code); if (!LABEL.has(code)) LABEL.set(code, label); }); });
  Object.entries(C).forEach(([code, c]) => { add(c.name, code); if (!LABEL.has(code)) LABEL.set(code, c.name); });
  Object.entries(PLACE_ALIAS).forEach(([n, code]) => seen.set(n, code));
  NAMES = [...seen].sort((a, b) => b[0].length - a[0].length);
}
const placeName = code => LABEL.get(code) || code;

function parse(text) {
  let s = ` ${norm(text)} `; const places = [];
  for (const [n, code] of NAMES) { const k = s.indexOf(` ${n} `); if (k >= 0) { places.push({ code, at: k }); s = s.slice(0, k + 1) + "~".repeat(n.length) + s.slice(k + 1 + n.length); } }
  places.sort((a, b) => a.at - b.at);
  const codes = [...new Set(places.map(p => p.code))];
  s = s.replace(/~+/g, " ");
  const ym = s.match(/\b(1[789]\d\d|20\d\d)\b/), year = ym ? +ym[1] : null; if (ym) s = s.replace(ym[0], " ");
  const nm = s.match(/\b(?:top|bottom|first|last) (\d{1,2})\b/), n = nm ? Math.max(3, Math.min(25, +nm[1])) : 10;
  const rank = BOTTOM.test(s) ? "bottom" : TOP.test(s) || WHICH.test(s) ? "top" : null;
  const quake = /earthquake|quake|seismic|tremor/.test(s);
  const found = [];
  [ASK_FIRST, CONCEPTS].forEach(listOf => listOf.forEach(([re, id]) => {
    if (!V.has(id)) return; const m = re.exec(s);
    if (m && !found.some(f => f.id === id)) { found.push({ id, at: m.index }); s = s.replace(new RegExp(re.source, "g"), x => " ".repeat(x.length)); }      // every mention of the same idea is used up, so "CO2 emitters" is one variable, not two
  }));
  const words = s.replace(TOP, " ").replace(BOTTOM, " ").split(/\s+/).filter(w => w && !STOP.has(w) && !/^\d+$/.test(w));
  let fuzzy = [];
  if (!found.length && words.length && !quake) {
    fuzzy = [...V.values()].filter(v => v.d.id !== "earthquakes-past-30-days" && v.c.type === "num" && words.every(w => v.q.includes(w))).sort((a, b) => a.c.title.length - b.c.title.length);
    if (fuzzy.length) found.push({ id: fuzzy[0].id, at: 0 });
  }
  found.sort((a, b) => a.at - b.at);
  return { vars: found.map(f => f.id).slice(0, 2), places: codes.slice(0, 8), year, rank, n, quake, words, others: fuzzy.slice(1, 7).map(v => v.id) };
}

/* ---------- numbers and sentences ---------- */
function say(v, unit) {
  const u = String(unit || "").replace(/\s*\([^)]*\)\s*$/, "");
  if (/^million tonnes/.test(u)) return { n: fmtN(v * 1e6), tail: u.replace(/^million /, "") };
  if (/^(current US\$|current international \$|international-\$|US\$)/.test(u)) return { n: "$" + fmtN(v), tail: u === "current US$" ? "" : u.replace(/^US\$\s*/, "").replace(/international-\$/, "international dollars").replace(/\s*\$/g, " dollars").trim(), money: true };
  if (u.startsWith("%")) return { n: fmtN(v) + "%", tail: u.slice(1).trim() };
  return { n: fmtN(v), tail: u };
}
const full = (v, unit) => { const s = say(v, unit); return s.n + (s.tail ? " " + s.tail : ""); };
const latest = id => latestCache[id] || (latestCache[id] = getJSON(`data/latest/${id}.json`).then(j => { j.pos = new Map(j.codes.map((c, i) => [c, i])); return j; }));
const source = d => `${d.source} (${d.licence.replace(/\s*\(.*$/, "")})`;
function cite(sentence, d, q) { return `${sentence} Source: ${d.source}, via Open Data Company, ${SITE}ask.html?q=${encodeURIComponent(q).replace(/%20/g, "+")} (data checked ${String(M.checked || "").slice(0, 10)}).`; }
async function copy(btn, text) {
  try { await navigator.clipboard.writeText(text); } catch (e) { const t = el("textarea"); t.value = text; document.body.append(t); t.select(); document.execCommand("copy"); t.remove(); }
  const was = btn.textContent; btn.textContent = "Copied"; setTimeout(() => { btn.textContent = was; }, 1600);
}
function saveCSV(name, header, rows) {
  const q = v => (/[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : v), a = el("a");
  a.href = URL.createObjectURL(new Blob([[header, ...rows].map(r => r.map(q).join(",")).join("\n") + "\n"], { type: "text/csv" })); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

/* ---------- answer cards ---------- */
function card(kicker, d) {
  const sec = el("section", "answer"), src = el("p", "src");
  sec.append(el("div", "up kick", kicker));
  src.append(document.createTextNode("Source: "), Object.assign(el("a", "", d.source), { href: d.source_url }), document.createTextNode(`. Licence: ${d.licence}. This dataset last changed ${d.built}.`));
  sec.src = src; return sec;
}
function acts(sec, items) { const a = el("div", "acts"); items.forEach(i => a.append(i)); sec.append(a, sec.src); }
const linkBtn = (text, href, cls = "btn") => Object.assign(el("a", cls, text), { href });
const exploreUrl = (d, v, codes, from, to) => `explore.html#d=${encodeURIComponent(d.id)}&v=${encodeURIComponent(v)}${codes ? "&e=" + codes.map(encodeURIComponent).join(",") : ""}${from ? "&f=" + from : ""}${to ? "&t=" + to : ""}`;

/* every year of one variable for some places, from the full table */
async function seriesOf(v, codes) {
  const T = await load(v.d), out = new Map(codes.map(c => [c, []])), col = T.c[v.c.name], code = T.c.code, yr = T.c.year;
  for (let i = 0; i < T.n; i++) if (out.has(code[i]) && !isNaN(col[i])) out.get(code[i]).push([yr[i], col[i]]);
  return out;
}

async function answerPlaces(q, v, P, box) {
  const d = v.d, L = await latest(d.id), rec = L.vars[v.c.name], codes = P.places.filter(c => L.pos.has(c) && rec && rec.v[L.pos.get(c)] !== null), unit = v.c.unit;
  const missing = P.places.filter(c => !codes.includes(c));
  if (!codes.length) { box.append(note(`${d.source} has no ${v.c.title.toLowerCase()} figure for ${P.places.map(placeName).join(" or ")}.`, linkBtn("Open the variable in the explorer", exploreUrl(d, v.c.name), "link"))); return; }
  const at = c => L.pos.get(c), one = codes.length === 1;
  const sec = card(one ? "Answer" : "Comparison", d), head = el("div", "ans-head"), body = el("div"), fig = el("figure", "fig"), dl = el("button", "btn get", "Download these numbers"); dl.type = "button"; dl.disabled = true;
  sec.append(head, body, el("h3", "", one ? "Over time" : "Over time, side by side"), fig); fig.append(el("p", "hint", "Loading the full history."));
  let sentence = "";
  function draw(S) {                                                   // S: full series once loaded; before that, the newest values only
    const row = c => { if (P.year && S) { const p = (S.get(c) || []).find(x => x[0] === P.year); return p ? { y: p[0], v: p[1] } : null; } return { y: rec.y[at(c)], v: rec.v[at(c)], p: rec.p[at(c)] }; };
    head.replaceChildren(); body.replaceChildren();
    if (P.year && !S) { head.append(el("p", "hint", `Looking up ${P.year}.`)); return; }
    if (one) {
      const c = codes[0], r = row(c);
      if (!r) { const near = (S.get(c) || []).reduce((a, b) => (!a || Math.abs(b[0] - P.year) < Math.abs(a[0] - P.year) ? b : a), null); head.append(el("p", "ans-q", `${v.c.title}, ${placeName(c)}`), el("p", "hint", `There is no figure for ${P.year}. The nearest year with one is ${near[0]}: ${full(near[1], unit)}.`)); sentence = `${v.c.title} in ${placeName(c)} was ${full(near[1], unit)} in ${near[0]}.`; return; }
      const s = say(r.v, unit), big = el("p", "ans-n"); big.append(el("strong", "", s.n), document.createTextNode(s.tail ? " " + s.tail : ""));
      head.append(el("p", "ans-q", `${v.c.title}, ${placeName(c)}, ${r.y}`), big);
      sentence = `${v.c.title} in ${placeName(c)} was ${full(r.v, unit)} in ${r.y}.`;
      const facts = el("ul", "ans-facts");
      if (!P.year && r.p !== null && r.p !== undefined) { const pct = unit.startsWith("%"), ch = pct ? r.v - r.p : (r.p ? (r.v / r.p - 1) * 100 : NaN); if (isFinite(ch)) facts.append(el("li", "", `Ten years earlier, in ${r.y - 10}, it was ${full(r.p, unit)}. It has ${ch >= 0 ? "risen" : "fallen"} by ${pct ? fmtN(Math.abs(ch)) + " percentage points" : `${say(Math.abs(r.v - r.p), unit).n} (${fmtN(Math.abs(ch))}%)`} since.`)); }
      if (!P.year && isReal(c)) { const all = L.codes.map((k, i) => [k, rec.v[i]]).filter(([k, x]) => isReal(k) && x !== null).sort((a, b) => b[1] - a[1]), pos = all.findIndex(x => x[0] === c); if (pos >= 0 && all.length > 20) facts.append(el("li", "", `That is the ${ordinal(pos + 1)} highest of ${all.length} countries, each at its most recent year.`)); }
      if (!P.year && c !== "WLD" && L.pos.has("WLD") && rec.v[at("WLD")] !== null) facts.append(el("li", "", `World: ${full(rec.v[at("WLD")], unit)} in ${rec.y[at("WLD")]}.`));
      if (v.c.description) facts.append(el("li", "what", v.c.description));
      body.append(facts);
    } else {
      const rows = codes.map(c => [c, row(c)]).filter(x => x[1]).sort((a, b) => b[1].v - a[1].v);
      head.append(el("p", "ans-q", `${v.c.title}${P.year ? ", " + P.year : ""}`));
      const f = el("div", "fig"); body.append(f);
      Charts.bars(f, { rows: rows.map(([c, r]) => ({ label: placeName(c), value: /^million tonnes/.test(unit) ? r.v * 1e6 : r.v, sub: P.year ? "" : String(r.y) })), fmt: x => say(/^million tonnes/.test(unit) ? x / 1e6 : x, unit).n, unit: say(1, unit).tail });
      if (rows.length >= 2) { const [a, b] = rows, ratio = b[1].v > 0 ? a[1].v / b[1].v : NaN; sentence = `${v.c.title}: ${rows.map(([c, r]) => `${placeName(c)} ${full(r.v, unit)} (${r.y})`).join(", ")}.`; if (isFinite(ratio) && ratio >= 1.05) body.append(el("p", "ans-line", `${placeName(a[0])} is ${ratio >= 2 ? fmtN(ratio) + " times" : fmtN((ratio - 1) * 100) + "% above"} ${placeName(b[0])}${ratio >= 2 ? "" : ""}.`)); }
      if (P.year && rows.length < codes.length) body.append(el("p", "hint", `No ${P.year} figure for ${codes.filter(c => !rows.some(r => r[0] === c)).map(placeName).join(", ")}.`));
    }
    if (missing.length) body.append(el("p", "hint", `No figure in this dataset for ${missing.map(placeName).join(", ")}.`));
  }
  draw(null);
  const cp = el("button", "link", "Copy the answer with its source"); cp.type = "button"; cp.onclick = () => copy(cp, cite(sentence, d, q));
  acts(sec, [dl, linkBtn("Open in the explorer", exploreUrl(d, v.c.name, codes)), linkBtn("Test a hypothesis with it", `research.html#k=trend&y=${encodeURIComponent(v.id)}&p=${codes.join(",")}`, "link"), cp]);
  box.append(sec);
  const S = await seriesOf(v, codes); if (!sec.isConnected) return;
  draw(S);
  const scale = /^million tonnes/.test(unit) ? 1e6 : 1, u = say(1, unit);
  Charts.line(fig, { series: codes.map(c => ({ name: placeName(c), pts: S.get(c).map(p => [p[0], p[1] * scale]) })), x: "year", fmt: x => (u.money ? "$" : "") + Charts.short(x) + (unit.startsWith("%") ? "%" : ""), unit: u.tail, zero: unit.startsWith("%") || codes.length > 1, label: `${v.c.title} over time for ${codes.map(placeName).join(", ")}` });
  fig.append(el("figcaption", "", `${v.c.title}${u.tail ? ", " + u.tail : ""}. Hover the chart to read any year.`));
  dl.disabled = false; dl.onclick = () => saveCSV(`${v.c.name}_${codes.join("-").toLowerCase()}.csv`, ["code", "place", "year", v.c.name], codes.flatMap(c => S.get(c).map(p => [c, placeName(c), p[0], p[1]])));
}

async function answerRank(q, v, P, box) {
  const d = v.d, L = await latest(d.id), rec = L.vars[v.c.name], unit = v.c.unit, sec = card("Ranking", d), head = el("div", "ans-head"), seg = el("div", "seg"), fig = el("div", "fig"), foot = el("p", "hint");
  let dir = P.rank === "bottom" ? "bottom" : "top", rows = [], sentence = "";
  const mt = /^million tonnes/.test(unit) ? 1e6 : 1;
  let table = L.codes.map((c, i) => ({ c, v: rec.v[i], y: rec.y[i] })).filter(r => isReal(r.c) && r.v !== null);
  if (!table.length) { box.append(note(`There are no country figures for ${v.c.title.toLowerCase()}.`)); return; }
  const newest = Math.max(...table.map(r => r.y)); table = table.filter(r => r.y >= newest - 6);       // leave out countries whose last figure is long out of date
  function draw() {
    const s = [...table].sort((a, b) => (dir === "top" ? b.v - a.v : a.v - b.v)); rows = s.slice(0, P.n);
    [...seg.children].forEach(b => b.setAttribute("aria-pressed", b.dataset.d === dir));
    head.replaceChildren(el("p", "ans-q", `${v.c.title}: the ${P.n} ${dir === "top" ? "highest" : "lowest"} countries${P.year ? " in " + P.year : ""}`));
    Charts.bars(fig, { rows: rows.map((r, i) => ({ label: `${i + 1}. ${placeName(r.c)}`, value: r.v * mt, sub: P.year ? "" : String(r.y), href: `ask.html?q=${encodeURIComponent(v.c.title + " " + placeName(r.c)).replace(/%20/g, "+")}` })), fmt: x => say(x / mt, unit).n, unit: say(1, unit).tail });
    const ys = table.map(r => r.y);
    foot.textContent = P.year ? `${table.length} countries have a ${P.year} figure.` : `${table.length} countries compared, ${Math.min(...ys) === Math.max(...ys) ? `all for ${ys[0]}` : `each at its most recent year (${Math.min(...ys)} to ${Math.max(...ys)})`}. Regional totals and the world are left out.`;
    sentence = `${v.c.title}, ${dir === "top" ? "highest" : "lowest"} ${rows.length} countries: ${rows.map((r, i) => `${i + 1}. ${placeName(r.c)} ${full(r.v, unit)} (${r.y})`).join("; ")}.`;
  }
  ["top", "bottom"].forEach(k => { const b = el("button", "", k === "top" ? "Highest" : "Lowest"); b.type = "button"; b.dataset.d = k; b.onclick = () => { dir = k; draw(); }; seg.append(b); });
  sec.append(head, seg, fig, foot);
  if (/^(people|million tonnes|terawatt-hours|current US\$)/.test(unit) && !/per_|_per|share|rate|growth|density|index/.test(v.c.name)) sec.append(el("p", "hint", "This is a total, so large countries lead. For a like-for-like comparison ask for the per-person version."));
  const cp = el("button", "link", "Copy the ranking with its source"); cp.type = "button"; cp.onclick = () => copy(cp, cite(sentence, d, q));
  const dl = el("button", "btn get", "Download the full ranking"); dl.type = "button"; dl.onclick = () => saveCSV(`${v.c.name}_ranking.csv`, ["rank", "code", "country", "year", v.c.name], [...table].sort((a, b) => b.v - a.v).map((r, i) => [i + 1, r.c, placeName(r.c), r.y, r.v]));
  acts(sec, [dl, linkBtn("Open in the explorer", exploreUrl(d, v.c.name)), cp]);
  box.append(sec);
  if (P.year) {
    foot.textContent = `Looking up ${P.year}.`; const T = await load(d); if (!sec.isConnected) return;
    const col = T.c[v.c.name], t2 = []; for (let i = 0; i < T.n; i++) if (T.c.year[i] === P.year && !isNaN(col[i]) && isReal(T.c.code[i])) t2.push({ c: T.c.code[i], v: col[i], y: P.year });
    if (t2.length) table = t2; else { P.year = null; sec.append(el("p", "hint", "No country has a figure for that year, so this shows each country's most recent one.")); }
  }
  draw();
}

async function answerWorld(q, v, P, box) {                              // a variable with no place: the world figure if there is one, then who leads
  const L = await latest(v.d.id);
  if (L.pos.has("WLD") && L.vars[v.c.name] && L.vars[v.c.name].v[L.pos.get("WLD")] !== null) await answerPlaces(q, v, { ...P, places: ["WLD"] }, box);
  await answerRank(q, v, { ...P, rank: P.rank || "top" }, box);
}

async function answerSeries(q, v, P, box) {
  const d = v.d, T = await load(d), tcol = T.c[d.time.col], col = T.c[v.c.name], pts = []; for (let i = 0; i < T.n; i++) if (!isNaN(col[i])) pts.push([tcol[i], col[i]]);
  if (!pts.length) { box.append(note("That series has no values.")); return; }
  const unit = v.c.unit, monthly = d.keys[0] === "month", when = t => new Date(t).toLocaleDateString("en-US", monthly ? { year: "numeric", month: "long", timeZone: "UTC" } : { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" });
  const sec = card("Answer", d), head = el("div", "ans-head"), facts = el("ul", "ans-facts"), seg = el("div", "seg"), fig = el("figure", "fig");
  let last = pts[pts.length - 1], sentence;
  if (P.year) {
    const yr = pts.filter(p => String(p[0]).startsWith(String(P.year)));
    if (yr.length) { const mean = yr.reduce((a, p) => a + p[1], 0) / yr.length, s = say(mean, unit), big = el("p", "ans-n"); big.append(el("strong", "", s.n), document.createTextNode(s.tail ? " " + s.tail : "")); head.append(el("p", "ans-q", `${v.c.title}, average for ${P.year}`), big); facts.append(el("li", "", `Lowest ${full(Math.min(...yr.map(p => p[1])), unit)}, highest ${full(Math.max(...yr.map(p => p[1])), unit)}, from ${plural(yr.length, monthly ? "month" : "day")} of data.`)); sentence = `${v.c.title} averaged ${full(mean, unit)} in ${P.year}.`; }
    else P.year = null;
  }
  if (!P.year) {
    const s = say(last[1], unit), big = el("p", "ans-n"); big.append(el("strong", "", s.n), document.createTextNode(s.tail ? " " + s.tail : ""));
    head.append(el("p", "ans-q", `${v.c.title}, ${when(last[0])}`), big); sentence = `${v.c.title} was ${full(last[1], unit)} ${monthly ? "in" : "on"} ${when(last[0])}.`;
    const t0 = Date.parse(last[0]) - 365.25 * 864e5, prev = pts.reduce((a, p) => (Math.abs(Date.parse(p[0]) - t0) < Math.abs(Date.parse(a[0]) - t0) ? p : a));
    const diff = last[1] - prev[1], rel = /\$/.test(unit) && prev[1] ? ` (${diff >= 0 ? "+" : "−"}${fmtN(Math.abs(diff / prev[1] * 100))}%)` : "";
    facts.append(el("li", "", `A year earlier, ${when(prev[0])}: ${full(prev[1], unit)}. Change: ${diff >= 0 ? "+" : "−"}${fmtN(Math.abs(diff))}${rel}.`));
    const hi = pts.reduce((a, p) => (p[1] > a[1] ? p : a)); facts.append(el("li", "", `Highest on record here: ${full(hi[1], unit)}, ${when(hi[0])}. The series starts ${when(pts[0][0])}.`));
  }
  if (v.c.description) facts.append(el("li", "what", v.c.description));
  let span = "all";
  const draw = () => { const cut = span === "all" ? -Infinity : Date.parse(last[0]) - span * 365.25 * 864e5; [...seg.children].forEach(b => b.setAttribute("aria-pressed", String(b.dataset.s) === String(span)));
    Charts.line(fig, { series: [{ name: v.c.title, pts: pts.filter(p => Date.parse(p[0]) >= cut) }], x: "date", fmt: x => (/\$/.test(unit) ? "$" : "") + Charts.short(x), unit: say(1, unit).tail, zero: /\$/.test(unit), label: `${v.c.title} over time` }); };
  [["1", "1 year"], ["5", "5 years"], ["20", "20 years"], ["all", "All"]].forEach(([k, t]) => { const b = el("button", "", t); b.type = "button"; b.dataset.s = k; b.onclick = () => { span = k === "all" ? "all" : +k; draw(); }; seg.append(b); });
  sec.append(head, facts, seg, fig);
  const cp = el("button", "link", "Copy the answer with its source"); cp.type = "button"; cp.onclick = () => copy(cp, cite(sentence, d, q));
  acts(sec, [Object.assign(linkBtn("Download the series", d.file, "btn get"), { download: "" }), linkBtn("Open in the explorer", `explore.html#d=${d.id}&v=${v.c.name}`), linkBtn("Test for a trend", `research.html#k=trend&y=${encodeURIComponent(v.id)}`, "link"), cp]);
  box.append(sec); draw();
}

async function answerQuakes(q, box) {
  const d = M.find(x => x.id === "earthquakes-past-30-days"); if (!d) return;
  const sec = card("Answer", d), head = el("div", "ans-head"), facts = el("ul", "ans-facts"), fig = el("div", "fig"), fig2 = el("figure", "fig");
  sec.append(head, facts, el("h3", "", "The ten strongest of the past 30 days"), fig, el("h3", "", "Earthquakes a day"), fig2);
  acts(sec, [Object.assign(linkBtn("Download all 30 days", d.file, "btn get"), { download: "" }), linkBtn("See them on the live globe", "index.html"), linkBtn("Open in the explorer", `explore.html#d=${d.id}`, "link")]);
  box.append(sec);
  const T = await load(d), rows = []; for (let i = 0; i < T.n; i++) rows.push({ t: T.c.time[i], m: T.c.magnitude[i], place: T.c.place[i] });
  let day = null, how = "";
  try { const j = await (await fetch("https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/2.5_day.geojson", { cache: "no-store" })).json(); day = j.features.map(f => ({ t: new Date(f.properties.time).toISOString(), m: f.properties.mag, place: f.properties.place || "" })); how = `live from the US Geological Survey at ${new Date().toLocaleTimeString()}`; }
  catch (e) { const end = rows.reduce((a, r) => (r.t > a ? r.t : a), ""), cut = new Date(Date.parse(end) - 864e5).toISOString(); day = rows.filter(r => r.t >= cut.slice(0, 19) + "Z"); how = `in the 24 hours to ${new Date(end).toLocaleString()}, the last saved check (the live feed did not answer)`; }
  if (!sec.isConnected) return;
  const big = el("p", "ans-n"); big.append(el("strong", "", day.length.toLocaleString("en-US")), document.createTextNode(" earthquakes of magnitude 2.5 or more"));
  head.append(el("p", "ans-q", `Past 24 hours, ${how}`), big);
  if (day.length) { const s = day.reduce((a, r) => (r.m > a.m ? r : a)); facts.append(el("li", "", `Strongest in that time: magnitude ${s.m.toFixed(1)}, ${s.place}.`)); }
  facts.append(el("li", "", `${rows.length.toLocaleString("en-US")} in the past 30 days, about ${Math.round(rows.length / 30)} a day.`));
  Charts.bars(fig, { rows: [...rows].sort((a, b) => b.m - a.m).slice(0, 10).map(r => ({ label: r.place, value: r.m, sub: new Date(r.t).toLocaleDateString("en-US", { month: "short", day: "numeric" }) })), fmt: x => "M " + x.toFixed(1) });
  const per = new Map(); rows.forEach(r => per.set(r.t.slice(0, 10), (per.get(r.t.slice(0, 10)) || 0) + 1));
  const days = [...per].sort((a, b) => (a[0] < b[0] ? -1 : 1)).slice(1, -1);
  Charts.line(fig2, { series: [{ name: "Earthquakes a day", pts: days }], x: "date", label: "Earthquakes a day over the past 30 days" });
}

const note = (text, extra) => { const p = el("p", "note", text); if (extra) p.append(" ", extra); return p; };

/* ---------- run ---------- */
async function ask(text) {
  const q = text.trim(), box = $("#answers"), read = $("#read"), me = ++ticket;
  box.replaceChildren(); read.hidden = true; $("#help").hidden = !!q;
  if (!q) return;
  const P = parse(q), vs = P.vars.map(id => V.get(id));
  if (P.quake) { read.textContent = "Read as: recent earthquakes worldwide."; read.hidden = false; await answerQuakes(q, box); return; }
  if (!vs.length) {
    const p = note(P.places.length ? `Found ${P.places.map(placeName).join(", ")}, but no variable in the rest of the question. Add what you want to know, for example "${placeName(P.places[0])} life expectancy".`
      : "Nothing in the datasets matches that. This page looks numbers up in the data it holds; it does not search the web or write an answer of its own. Try naming a measure and a place.");
    box.append(p, Object.assign(el("p", "hint"), { innerHTML: `<a href="datasets.html?q=${encodeURIComponent(P.words.join(" "))}">Search the list of every variable</a> for those words, or pick an example above.` }));
    return;
  }
  const bits = vs.map(v => `"${v.c.title}" from ${v.d.source}`);
  const byPlace = vs.some(v => v.d.entity);
  read.replaceChildren(document.createTextNode(`Read as: ${bits.join(" and ")}${!byPlace ? "" : P.places.length ? `, for ${P.places.map(placeName).join(", ")}` : P.rank ? ", ranked by country" : ""}${P.year ? `, in ${P.year}` : ""}. `));
  if (P.others.length) { read.append("Not what you meant? Try "); P.others.slice(0, 4).forEach((id, i) => { const o = V.get(id), a = el("a", "", o.c.title); a.href = `ask.html?q=${encodeURIComponent(o.c.title + (P.places.length ? " " + P.places.map(placeName).join(" ") : "")).replace(/%20/g, "+")}`; read.append(i ? ", " : "", a); }); read.append("."); }
  read.hidden = false;
  for (const v of vs) {
    if (me !== ticket) return;
    try {
      if (!v.d.entity) await answerSeries(q, v, { ...P }, box);
      else if (v.d.keys.join("+") !== "code+year") box.append(note(`"${v.c.title}" is broken down by ${v.d.entity.label.toLowerCase()}, which this page does not read yet.`, linkBtn("Open it in the explorer", `explore.html#d=${v.d.id}&v=${v.c.name}`, "link")));
      else if (P.places.length) await answerPlaces(q, v, { ...P }, box);
      else if (P.rank) await answerRank(q, v, { ...P }, box);
      else await answerWorld(q, v, { ...P }, box);
    } catch (e) { console.error(e); box.append(note("That answer could not be loaded. Check the connection and ask again.")); }
  }
}

(async () => {
  const [man, countries, pulse] = await Promise.all([getJSON("data/datasets.json"), getJSON("data/countries.json").catch(() => ({ countries: {} })), getJSON("data/pulse.json").catch(() => ({}))]);
  M = man.datasets; M.checked = man.checked; C = countries.countries || {}; PULSE = pulse;
  M.forEach(d => d.columns.forEach(c => V.set(`${d.id}::${c.name}`, { id: `${d.id}::${c.name}`, d, c, q: norm(`${c.title} ${c.name.replace(/_/g, " ")} ${c.unit || ""}`) })));
  buildPlaces();
  const input = $("#q"), form = $("#askform");
  const go = (text, push) => { input.value = text; const u = text.trim() ? `ask.html?q=${encodeURIComponent(text.trim()).replace(/%20/g, "+")}` : "ask.html"; if (push) history.pushState(null, "", u); document.title = text.trim() ? `${text.trim()} | Ask the data` : "Ask the data | Open Data Company"; ask(text); };
  form.addEventListener("submit", e => { e.preventDefault(); go(input.value, true); });
  ["India life expectancy", "Top 10 CO2 emitters", "China vs India vs United States solar power", "Which country is richest?", "World population", "Lowest child mortality", "Brazil forest area 1995", "Oil price", "Global temperature", "Earthquakes today"]
    .forEach(t => { const b = el("button", "", t); b.type = "button"; b.onclick = () => go(t, true); $("#examples").append(b); });
  addEventListener("popstate", () => go(new URLSearchParams(location.search).get("q") || "", false));
  go(new URLSearchParams(location.search).get("q") || "", false);
})().catch(e => { console.error(e); $("#answers").append(el("p", "note", "This page could not load its data. Reload to try again.")); });
