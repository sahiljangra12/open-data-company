/* Data AI: questions in plain words or by voice, answered from the datasets.
   Two engines share this page. A plain lookup ("India life expectancy") is matched by fixed rules and read straight from the
   data: instant, exact, no AI involved. Anything else goes to a Claude model behind a small service (see ai/ in the repo);
   when it needs a figure it asks for a tool and this page reads the value from the same data. If the AI is unavailable the
   built-in engine answers alone, so a question is never left without a way forward.
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
const FILLER = new Set("use used uses usage live lives living people rate rates level levels number numbers amount total data figure figures stats statistics value values average annual yearly recent recently big large high low size long ago".split(" "));
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
    if (m && !found.some(f => f.id === id)) { found.push({ id, at: m.index, text: m[0].trim() }); s = s.replace(new RegExp(`[a-z0-9]*(?:${re.source})[a-z0-9]*`, "g"), x => " ".repeat(x.length)); }      // every mention of the same idea is used up, so "CO2 emitters" is one variable, not two
  }));
  const words = s.replace(TOP, " ").replace(BOTTOM, " ").split(/\s+/).filter(w => w && !STOP.has(w) && !/^\d+$/.test(w));
  let fuzzy = [];
  if (!found.length && words.length && !quake) {
    fuzzy = [...V.values()].filter(v => v.d.id !== "earthquakes-past-30-days" && v.c.type === "num" && words.every(w => v.q.includes(w))).sort((a, b) => a.c.title.length - b.c.title.length);
    if (fuzzy.length) found.push({ id: fuzzy[0].id, at: 0, text: "" });
  }
  /* "methane emissions" is one idea: drop a variable that was only matched by a word already in another match's title */
  const stem = w => w.replace(/(ies|es|s)$/, ""), inTitle = (id, w) => V.get(id).q.includes(stem(w));
  const keep = found.filter(f => !found.some(g => g !== f && f.text && !f.text.includes(" ") && inTitle(g.id, f.text) && !(g.text && inTitle(f.id, g.text))));
  found.length = 0; found.push(...keep);
  found.sort((a, b) => a.at - b.at);
  /* words the match does not explain: a question with any of these is more than a plain lookup */
  const left = fuzzy.length ? [] : words.filter(w => w.length > 1 && !FILLER.has(w) && !/quake|seismic|tremor/.test(w) && !found.some(f => inTitle(f.id, w)));
  return { vars: found.map(f => f.id).slice(0, 2), places: codes.slice(0, 8), year, rank, n, quake, words, left, weak: fuzzy.length > 0 && words.length < 2 && !codes.length && !rank, others: fuzzy.slice(1, 7).map(v => v.id) };
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

/* ---------- the tools the AI can ask for: each reads the site's own data, here in the browser ---------- */
let PLACE = new Map();
const r6 = x => (x === null || x === undefined || !isFinite(x) ? null : +(+x).toPrecision(6));
const codeOf = name => { const raw = String(name || "").trim(); if (/^[A-Za-z]{3}$/.test(raw) && LABEL.has(raw.toUpperCase())) return raw.toUpperCase(); const n = norm(raw); return PLACE.get(n) || PLACE.get(n.replace(/^the /, "")) || null; };
const TOOLS = {
  async find_variables({ query }) {
    const q = norm(query || ""), words = q.split(" ").filter(w => w && !STOP.has(w)), hits = new Map();
    [ASK_FIRST, CONCEPTS].forEach(list => list.forEach(([re, id]) => { if (V.has(id) && re.test(` ${q} `) && !hits.has(id)) hits.set(id, 3); }));
    if (words.length) V.forEach(v => { if (v.c.type !== "num") return; const n = words.filter(w => v.q.includes(w)).length; if (n >= Math.ceil(words.length * 0.6)) hits.set(v.id, Math.max(hits.get(v.id) || 0, n / words.length + 1 / (20 + v.c.title.length))); });
    return { matches: [...hits].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([id]) => { const v = V.get(id); return { id, title: v.c.title, unit: v.c.unit || "", source: v.d.source, covers: v.d.coverage, by: v.d.entity ? v.d.entity.label.toLowerCase() + " and year" : "one world series over time" }; }) };
  },
  async get_values({ variable, places, year }, used) {
    const v = V.get(variable); if (!v) return { error: "Unknown variable id. Call find_variables to get the right one." };
    if (!v.d.entity || v.d.keys.join("+") !== "code+year") return { error: "This variable is one world series, not by country. Call get_series without a place." };
    const L = await latest(v.d.id), rec = L.vars[v.c.name]; if (!rec) return { error: "That variable has no numbers." };
    const want = (Array.isArray(places) ? places : [places]).filter(Boolean).slice(0, 8).map(n => [n, codeOf(n)]), codes = [...new Set(want.map(w => w[1]).filter(c => c && L.pos.has(c)))];
    const yr = Number.isInteger(year) ? year : null, S = yr ? await seriesOf(v, [...new Set([...codes, "WLD"])]) : null;
    const one = c => { if (yr) { const s = S.get(c) || [], hit = s.find(x => x[0] === yr); if (hit) return { place: placeName(c), year: yr, value: r6(hit[1]) }; const near = s.reduce((a, b) => (!a || Math.abs(b[0] - yr) < Math.abs(a[0] - yr) ? b : a), null); return near ? { place: placeName(c), year: near[0], value: r6(near[1]), note: `No value for ${yr}; this is the nearest year` } : { place: placeName(c), error: "No data" }; }
      const i = L.pos.get(c); return rec.v[i] === null ? { place: placeName(c), error: "No data" } : { place: placeName(c), year: rec.y[i], value: r6(rec.v[i]), ...(rec.p[i] !== null ? { value_ten_years_earlier: r6(rec.p[i]) } : {}) }; };
    const out = { variable: v.c.title, unit: v.c.unit || "", source: v.d.source, values: want.map(([name, c]) => (c && L.pos.has(c) ? one(c) : { place: name, error: "This place is not in the dataset" })) };
    if (L.pos.has("WLD") && !codes.includes("WLD")) { const w = one("WLD"); if (!w.error) out.world = w; }
    if (codes.length) used.push({ kind: "places", v, places: codes, year: yr });
    return out;
  },
  async rank({ variable, order, n, year }, used) {
    const v = V.get(variable); if (!v) return { error: "Unknown variable id. Call find_variables to get the right one." };
    if (!v.d.entity || v.d.keys.join("+") !== "code+year") return { error: "This variable is one world series, so it cannot be ranked by country." };
    const L = await latest(v.d.id), rec = L.vars[v.c.name]; if (!rec) return { error: "That variable has no numbers." };
    const k = Math.max(1, Math.min(20, n || 10)), yr = Number.isInteger(year) ? year : null; let table = [];
    if (yr) { const T = await load(v.d), col = T.c[v.c.name]; for (let i = 0; i < T.n; i++) if (T.c.year[i] === yr && !isNaN(col[i]) && isReal(T.c.code[i])) table.push({ c: T.c.code[i], v: col[i], y: yr }); }
    else { table = L.codes.map((c, i) => ({ c, v: rec.v[i], y: rec.y[i] })).filter(r => isReal(r.c) && r.v !== null); const newest = Math.max(...table.map(r => r.y)); table = table.filter(r => r.y >= newest - 6); }
    if (!table.length) return { error: yr ? `No country has a value for ${yr}.` : "No country values." };
    table.sort((a, b) => (order === "bottom" ? a.v - b.v : b.v - a.v));
    used.push({ kind: "rank", v, order: order === "bottom" ? "bottom" : "top", n: k, year: yr });
    return { variable: v.c.title, unit: v.c.unit || "", source: v.d.source, order: order === "bottom" ? "lowest first" : "highest first", countries_compared: table.length, rows: table.slice(0, k).map((r, i) => ({ rank: i + 1, place: placeName(r.c), year: r.y, value: r6(r.v) })) };
  },
  async get_series({ variable, place, from, to }, used) {
    const v = V.get(variable); if (!v) return { error: "Unknown variable id. Call find_variables to get the right one." };
    let pts, label = "";
    if (v.d.entity && v.d.keys.join("+") === "code+year") { const c = codeOf(place || "World"); if (!c) return { error: "This place is not in the dataset" }; pts = (await seriesOf(v, [c])).get(c) || []; label = placeName(c); used.push({ kind: "places", v, places: [c], year: null }); }
    else if (!v.d.entity) { const T = await load(v.d), t = T.c[v.d.time.col], col = T.c[v.c.name]; pts = []; for (let i = 0; i < T.n; i++) if (!isNaN(col[i])) pts.push([t[i], col[i]]); used.push({ kind: "series", v }); }
    else return { error: "This variable cannot be read as a series here." };
    const yearOf = x => +String(x).slice(0, 4); if (from) pts = pts.filter(p => yearOf(p[0]) >= from); if (to) pts = pts.filter(p => yearOf(p[0]) <= to);
    if (!pts.length) return { error: "No values in that period." };
    const step = Math.max(1, (pts.length - 1) / 23), thin = []; for (let i = 0; i < pts.length - 1; i += step) thin.push(pts[Math.floor(i)]); thin.push(pts[pts.length - 1]);
    const lo = pts.reduce((a, b) => (b[1] < a[1] ? b : a)), hi = pts.reduce((a, b) => (b[1] > a[1] ? b : a)), f = p => ({ when: p[0], value: r6(p[1]) });
    return { variable: v.c.title, unit: v.c.unit || "", source: v.d.source, place: label || "World series", points_in_period: pts.length, first: f(pts[0]), last: f(pts[pts.length - 1]), lowest: f(lo), highest: f(hi), points: [...new Set(thin)].map(p => [p[0], r6(p[1])]) };
  },
  async recent_earthquakes(_, used) {
    const d = M.find(x => x.id === "earthquakes-past-30-days"); if (!d) return { error: "No earthquake data." };
    const T = await load(d), rows = []; for (let i = 0; i < T.n; i++) rows.push({ t: T.c.time[i], m: T.c.magnitude[i], place: T.c.place[i] });
    const end = rows.reduce((a, r) => (r.t > a ? r.t : a), ""), cut = new Date(Date.parse(end) - 864e5).toISOString().slice(0, 19) + "Z", day = rows.filter(r => r.t >= cut), top = a => [...a].sort((x, y) => y.m - x.m).slice(0, 5).map(r => ({ magnitude: r.m, place: r.place, time: r.t }));
    used.push({ kind: "quakes" });
    return { source: d.source, note: "Magnitude 2.5 and above, worldwide", data_as_of: end, past_24_hours: { count: day.length, strongest: top(day) }, past_30_days: { count: rows.length, strongest: top(rows) } };
  },
};

/* ---------- the AI: a Claude model behind a small service; it asks for tools, the browser runs them ---------- */
const AI = { url: typeof DATA_AI_URL === "string" ? DATA_AI_URL : "", state: null, memory: [] };
function aiReady() {
  if (!AI.url) return Promise.resolve(false);
  return AI.state || (AI.state = (async () => { try { const c = new AbortController(), t = setTimeout(() => c.abort(), 5000), r = await fetch(AI.url, { signal: c.signal }); clearTimeout(t); const j = await r.json(); return !!(j && j.ok && j.ai); } catch (e) { return false; } })());
}
const TOOL_SAYS = { find_variables: i => `Searching the variables for "${i.query || ""}"`, get_values: i => `Reading ${(V.get(i.variable) || { c: { title: "the data" } }).c.title.toLowerCase()} for ${[].concat(i.places || []).join(", ")}`, rank: i => `Ranking countries by ${(V.get(i.variable) || { c: { title: "that measure" } }).c.title.toLowerCase()}`,
  get_series: i => `Reading the history of ${(V.get(i.variable) || { c: { title: "that measure" } }).c.title.toLowerCase()}${i.place ? " for " + i.place : ""}`, recent_earthquakes: () => "Reading the latest earthquakes" };
async function aiTurn(question, say) {
  const messages = [...AI.memory, { role: "user", content: question }], used = [], cost = { usd: 0, rounds: 0, cached: 0 };
  for (let round = 0; round < 4; round++) {                             // 4 rounds is 13 messages at most, inside the service's limit
    const c = new AbortController(), t = setTimeout(() => c.abort(), 60000);
    let body = JSON.stringify({ messages });
    for (let i = 0; body.length > 52000 && i < messages.length - 1; i++) { const m = messages[i]; if (m.role === "user" && Array.isArray(m.content)) { m.content = m.content.map(b => ({ ...b, content: '{"note":"left out to save space; ask again if needed"}' })); body = JSON.stringify({ messages }); } }
    let r, j; try { r = await fetch(AI.url, { method: "POST", headers: { "content-type": "application/json" }, body, signal: c.signal }); j = await r.json(); } finally { clearTimeout(t); }
    if (!r.ok || !j || !j.ok) throw Object.assign(new Error("The AI service did not answer"), { reason: (j && j.reason) || "error" });
    messages.push({ role: "assistant", content: j.content });
    cost.rounds++; if (j.usage) { cost.usd += j.usage.usd || 0; cost.cached += j.usage.cache_read || 0; }
    const calls = j.content.filter(b => b.type === "tool_use");
    if (j.stop_reason !== "tool_use" || !calls.length) {
      let text = j.content.filter(b => b.type === "text").map(b => b.text).join("\n\n").trim(); if (!text) throw Object.assign(new Error("Empty answer"), { reason: "error" });
      if (j.stop_reason === "max_tokens") text += " …";                                                                // the reply reached its length limit
      AI.memory = [...AI.memory, { role: "user", content: question }, { role: "assistant", content: text }].slice(-6);
      return { text, used, cost };
    }
    say(calls.map(k => (TOOL_SAYS[k.name] || (() => "Reading the data"))(k.input || {})).join(". ") + ".");
    const results = await Promise.all(calls.map(async k => { let out; try { out = TOOLS[k.name] ? await TOOLS[k.name](k.input || {}, used) : { error: "No such tool" }; } catch (e) { console.warn(e); out = { error: "The data could not be read just now." }; } return { type: "tool_result", tool_use_id: k.id, content: JSON.stringify(out).slice(0, 5000) }; }));
    messages.push({ role: "user", content: results });
  }
  throw Object.assign(new Error("Too many steps"), { reason: "error" });
}
/* the model writes plain text with **bold** and "-" lists: turn that into elements, never into raw HTML */
function mdLite(text) {
  const out = document.createDocumentFragment(), inline = (node, s) => { String(s).split(/(\*\*[^*]+\*\*)/g).forEach(part => { if (/^\*\*[^*]+\*\*$/.test(part)) node.append(el("strong", "", part.slice(2, -2))); else if (part) node.append(document.createTextNode(part.replace(/(^|\s)[*_]([^*_\s][^*_]*)[*_](?=\s|[.,;:!?]|$)/g, "$1$2"))); }); return node; };
  String(text).replace(/\r/g, "").split(/\n{2,}/).forEach(block => {
    const lines = block.split("\n").filter(l => l.trim() !== ""); if (!lines.length) return;
    let list = null;
    lines.forEach(line => { const b = /^\s*(?:[-*•]|\d+[.)])\s+(.*)$/.exec(line), h = /^\s*#{1,6}\s+(.*)$/.exec(line);
      if (b) { if (!list) { list = el(/^\s*\d/.test(line) ? "ol" : "ul"); out.append(list); } list.append(inline(el("li"), b[1])); }
      else { list = null; out.append(inline(el("p", h ? "lead-line" : ""), h ? h[1] : line)); } });
  });
  return out;
}
function speak(btn, text) {
  if (!("speechSynthesis" in window)) return; const s = speechSynthesis;
  if (s.speaking) { s.cancel(); btn.textContent = "Read it aloud"; return; }
  const u = new SpeechSynthesisUtterance(text.replace(/\*\*/g, "")); u.lang = document.documentElement.lang || "en"; u.onend = u.onerror = () => { btn.textContent = "Read it aloud"; }; btn.textContent = "Stop reading"; s.speak(u);
}

/* ---------- the conversation ---------- */
const EXPLAIN = /\b(why|how come|explain|reasons?|causes?|caused|because|should|could|would|will|predict\w*|forecast\w*|future|means?|meaning|define|definition|impact|effects?|affects?|relationship|correlat\w*|better|worse|good|bad|summar\w*|describe|tell me about|think|opinion|recommend\w*|advice|trend|changed?|changing|grow\w*|increas\w*|decreas\w*|fall\w*|ris\w+)\b/i;
/* questions the datasets cannot hold an answer to: these need the AI, never a lucky word match */
const GENERAL = /^(who|whom|whose|when|where)\b|\b(capital( city)? of|president|prime minister|king|queen|currency|languages?|invented|inventor|founded|founder|born|died|weather|recipe|joke|poem|story|translate|wrote|written by|author|meaning of|stands? for)\b/i;
const last = { v: null, places: [], ai: false };
let busy = false;
function newTurn(q) {
  const root = el("article", "turn"), you = el("p", "you"), reply = el("div", "reply"), status = el("p", "thinking", "Thinking");
  you.append(el("span", "up", "You"), document.createTextNode(q)); reply.append(el("span", "up", "Data AI"), status); root.append(you, reply); $("#thread").append(root);
  $("#askbar").classList.add("docked"); $("#examples").hidden = true; $("#help").hidden = true; $("#fresh-chat").hidden = false;
  root.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
  return { root, box: reply, say: t => { status.textContent = t; }, done: () => status.remove() };
}
const SMALL = [[/^(hi|hello|hey|hola|namaste|good (morning|afternoon|evening))\b/i, "Hello. I'm Data AI. Ask me for a number, a comparison or a ranking, for example \"India life expectancy\" or \"top 10 CO2 emitters\", and I'll answer with the year and the source."],
  [/\b(who are you|what are you|what can you do|what do you do|help me|how do (you|i) (work|use))\b/i, "I'm Data AI, the assistant for this site's open data. I can give you a single figure, compare countries, rank them, show how something changed over time, and report today's earthquakes, oil prices, global temperature and CO2 in the air. Every figure comes with its year and source."],
  [/^(thanks|thank you|thx|great|nice|ok|okay|cool)\b/i, "You're welcome. Ask me anything else about the data."]];

async function lookup(q, P, turn) {                                    // the built-in engine: exact, instant, no AI needed
  const box = turn.box, vs = P.vars.map(id => V.get(id));
  if (P.quake) { box.append(el("p", "readas", "Read as: recent earthquakes worldwide.")); await answerQuakes(q, box); return true; }
  if (!vs.length) return false;
  const byPlace = vs.some(v => v.d.entity), read = el("p", "readas");
  read.append(document.createTextNode(`Read as: ${vs.map(v => `"${v.c.title}" from ${v.d.source}`).join(" and ")}${!byPlace ? "" : P.places.length ? `, for ${P.places.map(placeName).join(", ")}` : P.rank ? ", ranked by country" : ""}${P.year ? `, in ${P.year}` : ""}. `));
  if (P.others.length) { read.append("Not what you meant? Try "); P.others.slice(0, 4).forEach((id, i) => { const o = V.get(id), b = el("button", "link plain", o.c.title); b.type = "button"; b.onclick = () => respond(o.c.title + (P.places.length ? " " + P.places.map(placeName).join(" ") : "")); read.append(i ? ", " : "", b); }); read.append("."); }
  box.append(read);
  for (const v of vs) {
    try {
      if (!v.d.entity) await answerSeries(q, v, { ...P }, box);
      else if (v.d.keys.join("+") !== "code+year") box.append(note(`"${v.c.title}" is broken down by ${v.d.entity.label.toLowerCase()}, which is best seen in the explorer.`, linkBtn("Open it in the explorer", `explore.html#d=${v.d.id}&v=${v.c.name}`, "link")));
      else if (P.places.length) await answerPlaces(q, v, { ...P }, box);
      else if (P.rank) await answerRank(q, v, { ...P }, box);
      else await answerWorld(q, v, { ...P }, box);
    } catch (e) { console.error(e); box.append(note("That answer could not be loaded. Check the connection and ask again.")); }
  }
  last.v = vs[0].id; if (P.places.length) last.places = P.places;
  return true;
}
function closest(words) {                                              // when nothing matches exactly: the nearest variables, so there is always a way forward
  const hits = []; V.forEach(v => { if (v.c.type !== "num" || v.d.id === "earthquakes-past-30-days") return; const n = words.filter(w => w.length > 2 && v.q.includes(w.replace(/(ies|es|s)$/, ""))).length; if (n) hits.push([n - v.c.title.length / 500, v]); });
  return hits.sort((a, b) => b[0] - a[0]).slice(0, 5).map(h => h[1]);
}
async function respond(text, opt = {}) {
  const q = String(text).trim(); if (!q || busy) return;
  busy = true; $("#q").value = ""; $("#ask-go").disabled = true;
  const turn = newTurn(q), box = turn.box;
  history.replaceState(null, "", `ask.html?q=${encodeURIComponent(q).replace(/%20/g, "+")}`); document.title = `${q} | Data AI`;
  try {
    const P = parse(q), short = q.split(/\s+/).length <= 4, follow = /^(and|what about|how about|same for|for|in|versus|vs|compared (to|with))\b/i.test(q);
    if (!P.vars.length && !P.quake && P.places.length && last.v && (short || follow)) P.vars = [last.v];              // "and China?" keeps the measure
    if (P.vars.length && !P.places.length && !P.rank && last.places.length && follow && V.get(P.vars[0]).d.entity) P.places = last.places;   // "and its population?" keeps the places
    const wordy = q.split(/\s+/).length, small = wordy <= 6 && !P.vars.length && !P.places.length && !P.quake && SMALL.find(([re]) => re.test(q));
    if (small && !opt.force) { turn.done(); box.append(el("p", "aitext", small[1])); return; }                       // a greeting needs no model
    const general = GENERAL.test(q), ai = await aiReady(), simple = (P.quake || P.vars.length > 0) && !EXPLAIN.test(q) && !general && !P.weak && P.left.length === 0 && !(follow && last.ai);   // a follow-up to an AI answer stays with the AI
    if (ai && (opt.force || !simple)) {
      try {
        const a = await aiTurn(opt.prompt || q, turn.say); turn.done(); last.ai = true;
        turn.root.dataset.rounds = a.cost.rounds; turn.root.dataset.usd = a.cost.usd.toFixed(6); turn.root.dataset.cached = a.cost.cached;
        const ans = el("div", "aitext"); ans.append(mdLite(a.text)); box.append(ans);
        const tools = el("div", "acts small"), cp = el("button", "link", "Copy the answer"), rd = el("button", "link", "Read it aloud"); cp.type = rd.type = "button";
        cp.onclick = () => copy(cp, `${a.text.replace(/\*\*/g, "")}\n\nFrom Data AI, Open Data Company: ${SITE}ask.html?q=${encodeURIComponent(q).replace(/%20/g, "+")}`); rd.onclick = () => speak(rd, a.text);
        tools.append(cp); if ("speechSynthesis" in window) tools.append(rd); box.append(tools);
        box.append(el("p", "ainote", a.used.length ? "Written by an AI model. The figures were read from the datasets shown below; any explanation around them is general knowledge and can be wrong." : "Written by an AI model from general knowledge, not from this site's data. It can be wrong or out of date, so check anything that matters."));
        const seen = new Set(); let cards = 0;
        for (const u of a.used) {
          const key = u.kind + (u.v ? u.v.id : "") + (u.places || []).join() + (u.order || ""); if (seen.has(key) || cards >= 2) continue; seen.add(key); cards++;
          try { if (u.kind === "places") await answerPlaces(q, u.v, { places: u.places, year: u.year, rank: null, n: 10 }, box); else if (u.kind === "rank") await answerRank(q, u.v, { places: [], year: u.year, rank: u.order, n: Math.min(u.n, 15) }, box); else if (u.kind === "series") await answerSeries(q, u.v, { year: null }, box); else if (u.kind === "quakes") await answerQuakes(q, box); } catch (e) { console.warn(e); }
          if (u.v) { last.v = u.v.id; if (u.places && u.places.length) last.places = u.places; }
        }
        return;
      } catch (e) {
        console.warn("AI unavailable, using the built-in lookup", e); if (e.reason === "budget" || e.reason === "off") AI.state = Promise.resolve(false); aiBadge();
        box.append(el("p", "ainote", e.reason === "budget" ? "The AI's allowance for now is used up, so this answer comes straight from the data." : e.reason === "busy" ? "The AI is busy right now, so this answer comes straight from the data." : "The AI could not be reached just now, so this answer comes straight from the data."));
      }
    }
    turn.done(); last.ai = false;
    if (general || P.weak) { P.vars = []; P.quake = false; }                                                            // without the AI, say so instead of answering a different question
    if (await lookup(q, P, turn)) { if (ai && !opt.force) { const b = el("button", "link", "Ask Data AI to explain this"); b.type = "button"; b.onclick = () => respond(q, { force: true, prompt: `${q}\n\nGive the figures, then explain briefly what is behind them.` }); const w = el("p", "more-ai"); w.append(b); box.append(w); } return; }
    const hello = SMALL.find(([re]) => re.test(q)); if (hello) { box.append(el("p", "aitext", hello[1])); return; }
    /* nothing matched and no AI to hand it to: say what was understood and offer the nearest things that can be answered */
    const near = general ? [] : closest(P.words), p = el("div", "aitext");
    p.append(el("p", "", general ? "That is a general question rather than one the datasets hold, so it needs the AI part, which is resting right now. I can still answer from the data straight away, for example:" : P.places.length ? `I found ${P.places.map(placeName).join(", ")} in your question, but not which measure you want. Pick one below, or add it to the question, for example "${placeName(P.places[0])} life expectancy".`
      : near.length ? "I could not match that to one measure in the data, but these are close. Pick one, or say it another way." : "That is outside the datasets I can read right now. I answer from open data on climate, energy, economy, development and natural hazards. Here are things I can answer straight away."));
    const picks = el("div", "quick"); (near.length ? near.map(v => [v.c.title, v.c.title + (P.places.length ? " " + P.places.map(placeName).join(" ") : "")]) : ["World population", "Top 10 CO2 emitters", "Oil price", "Global temperature", "Earthquakes today"].map(t => [t, t]))
      .forEach(([label, ask]) => { const b = el("button", "", label); b.type = "button"; b.onclick = () => respond(ask); picks.append(b); });
    p.append(picks); const more = el("p", "hint"); more.append("Or ", Object.assign(el("a", "", "search the list of every variable"), { href: `datasets.html?q=${encodeURIComponent(P.words.join(" "))}` }), "."); p.append(more); box.append(p);
  } catch (e) { console.error(e); turn.done(); box.append(note("Something went wrong while answering. Please ask again.")); }
  finally { busy = false; $("#ask-go").disabled = false; if (matchMedia("(pointer:fine)").matches) $("#q").focus({ preventScroll: true }); }
}
async function aiBadge() { const on = await aiReady(), b = $("#ai-state"); b.textContent = on ? "AI answers are on. Figures come from the datasets, with their sources." : "Answers come straight from the datasets right now. The AI part is resting."; b.classList.toggle("on", on); }

(async () => {
  const [man, countries, pulse] = await Promise.all([getJSON("data/datasets.json"), getJSON("data/countries.json").catch(() => ({ countries: {} })), getJSON("data/pulse.json").catch(() => ({}))]);
  M = man.datasets; M.checked = man.checked; C = countries.countries || {}; PULSE = pulse;
  M.forEach(d => d.columns.forEach(c => V.set(`${d.id}::${c.name}`, { id: `${d.id}::${c.name}`, d, c, q: norm(`${c.title} ${c.name.replace(/_/g, " ")} ${c.unit || ""}`) })));
  buildPlaces(); PLACE = new Map(NAMES);
  const input = $("#q"), form = $("#askform");
  form.addEventListener("submit", e => { e.preventDefault(); respond(input.value); });
  ["India life expectancy", "Top 10 CO2 emitters", "China vs India vs United States solar power", "Why is the world getting warmer?", "Which country is richest?", "Brazil forest area 1995", "Oil price", "Earthquakes today"]
    .forEach(t => { const b = el("button", "", t); b.type = "button"; b.onclick = () => respond(t); $("#examples").append(b); });
  $("#fresh-chat").onclick = () => { $("#thread").replaceChildren(); AI.memory = []; last.v = null; last.places = []; last.ai = false; $("#askbar").classList.remove("docked"); $("#examples").hidden = false; $("#help").hidden = false; $("#fresh-chat").hidden = true; history.replaceState(null, "", "ask.html"); document.title = "Data AI | Open Data Company"; if ("speechSynthesis" in window) speechSynthesis.cancel(); input.focus(); };
  voiceInput($("#mic"), input, $("#voice-note"), t => respond(t));
  $("#thread").addEventListener("click", e => { const a = e.target.closest('a[href^="ask.html?q="]'); if (!a || e.metaKey || e.ctrlKey || e.shiftKey) return; e.preventDefault(); respond(new URL(a.href).searchParams.get("q") || ""); });
  aiBadge();
  const first = new URLSearchParams(location.search).get("q"); if (first) respond(first);
})().catch(e => { console.error(e); $("#thread").append(el("p", "note", "This page could not load its data. Reload to try again.")); });
