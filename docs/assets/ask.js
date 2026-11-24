/* Data AI: questions in plain words or by voice, answered from the datasets.
   Two engines share this page. A plain lookup ("India life expectancy") is matched by fixed rules and read straight from the
   data: instant, exact, no AI involved. Anything else goes to a Claude model behind a small service (see ai/ in the repo);
   when it needs a figure it asks for a tool and this page reads the value from the same data. If the AI is unavailable the
   built-in engine answers alone, so a question is never left without a way forward.
   Needs core.js, concepts.js (word lists) and charts.js. */
let M = [], V = new Map(), C = {}, PULSE = {}, NAMES = [], LABEL = new Map(), ticket = 0;
const latestCache = {};
const COUNTRY_SETS = ["co2-and-greenhouse-gases", "energy", "world-bank-development"];      // their place names come first, so the usual spelling of a country wins
/* Three shapes of dataset. A country table (one row for a place and a year) answers lookups, rankings, maps and scatters.
   A series (one row for a date) answers "what is it now" and "how has it changed". Anything else is a list or a table by
   state, agency or zone: it is opened in the explorer rather than read aloud. */
const isCountrySet = d => !!d.entity && d.keys.join("+") === "code+year", isSeriesSet = d => !d.entity && d.keys.length === 1 && d.keys[0] === d.time.col;
const stepOf = d => d.step || (d.keys[0] === "month" ? "month" : "day");
const STEP_ADV = { day: "daily", week: "weekly", month: "monthly", quarter: "quarterly", year: "yearly" };
function whenText(t, step) {                                            // a date as people say it, no finer than the data is
  const x = String(t), y = x.slice(0, 4), d = new Date(x.length > 10 ? x : x.slice(0, 10) + "T00:00:00Z"), f = o => d.toLocaleDateString("en-US", { ...o, timeZone: "UTC" });
  if (step === "year" || x.length <= 4 || isNaN(d)) return y;
  if (step === "quarter") return `the ${["first", "second", "third", "fourth"][Math.floor(d.getUTCMonth() / 3)]} quarter of ${y}`;
  if (step === "month") return f({ year: "numeric", month: "long" });
  return (step === "week" ? "the week ending " : "") + f({ year: "numeric", month: "long", day: "numeric" });
}
const inOn = step => (step === "day" ? "on" : "in");
const thisYear = () => +String(M.checked || new Date().toISOString()).slice(0, 4);
const partialNow = (d, t) => !!d.partial && +String(t).slice(0, 4) >= thisYear();          // a yearly count whose last point is the year still in progress
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
  const take = d => (d.places || []).forEach(([code, label]) => { add(label, code); if (!LABEL.has(code)) LABEL.set(code, label); });
  COUNTRY_SETS.forEach(id => { const d = M.find(x => x.id === id); if (d) take(d); });
  Object.entries(C).forEach(([code, c]) => { add(c.name, code); if (!LABEL.has(code)) LABEL.set(code, c.name); });
  M.filter(d => isCountrySet(d) && !COUNTRY_SETS.includes(d.id)).forEach(take);                                         // other sources' spellings and groupings are understood too
  Object.entries(PLACE_ALIAS).forEach(([n, code]) => seen.set(n, code));
  NAMES = [...seen].sort((a, b) => b[0].length - a[0].length);
}
const placeName = code => LABEL.get(code) || code;
/* the same measure in a table of projections, for questions about years that have not happened yet */
const FUTURE = { "world-bank-development::population": "un-population-projections::population", "world-bank-development::life_expectancy": "un-population-projections::life_expectancy", "world-bank-development::fertility_rate": "un-population-projections::total_fertility_rate",
  "world-bank-development::gdp_growth": "imf-projections::real_gdp_growth", "world-bank-development::inflation": "imf-projections::inflation", "world-bank-development::unemployment": "imf-projections::unemployment_rate", "world-bank-development::gdp_current_usd": "imf-projections::gdp", "world-bank-development::gdp_per_capita": "imf-projections::gdp_per_person" };
function futureOf(id) { const [d, c] = id.split("::"), twin = FUTURE[id] || (d === "un-population" ? `un-population-projections::${c}` : d === "imf-world-economic-outlook" ? `imf-projections::${c}` : null); return twin && V.has(twin) ? twin : null; }

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
  [ASK_FIRST, CONCEPTS_MORE, CONCEPTS].forEach(listOf => listOf.forEach(([re, id]) => {
    if (!V.has(id)) return; const m = re.exec(s);
    if (m && !found.some(f => f.id === id)) { found.push({ id, at: m.index, text: m[0].trim() }); s = s.replace(new RegExp(`[a-z0-9]*(?:${re.source})[a-z0-9]*`, "g"), x => " ".repeat(x.length)); }      // every mention of the same idea is used up, so "CO2 emitters" is one variable, not two
  }));
  const words = s.replace(TOP, " ").replace(BOTTOM, " ").split(/\s+/).filter(w => w && !STOP.has(w) && !/^\d+$/.test(w));
  let fuzzy = [];
  if (!found.length && words.length && !quake) {
    fuzzy = [...V.values()].filter(v => v.ok && words.every(w => v.q.includes(w) || v.q.includes(w.replace(/(ies|es|s)$/, "")))).sort((a, b) => a.c.title.length - b.c.title.length);
    if (fuzzy.length) found.push({ id: fuzzy[0].id, at: 0, text: "" });
  }
  /* "methane emissions" is one idea: drop a variable that was only matched by a word already in another match's title */
  const stem = w => w.replace(/(ies|es|s)$/, ""), inTitle = (id, w) => V.get(id).q.includes(stem(w));
  const keep = found.filter(f => !found.some(g => g !== f && f.text && !f.text.includes(" ") && inTitle(g.id, f.text) && !(g.text && inTitle(f.id, g.text))));
  found.length = 0; found.push(...keep);
  found.sort((a, b) => a.at - b.at);
  if (year && year > thisYear()) found.forEach(f => { const twin = futureOf(f.id); if (twin) f.id = twin; });                // "population in 2050" is a projection
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
  const unit = v.c.unit, step = stepOf(d), when = t => whenText(t, step), on = inOn(step), yearly = step === "year";
  const sec = card("Answer", d), head = el("div", "ans-head"), facts = el("ul", "ans-facts"), seg = el("div", "seg"), fig = el("figure", "fig");
  const open = pts.length > 1 && partialNow(d, pts[pts.length - 1][0]) ? pts[pts.length - 1] : null;                     // the year in progress is reported, but never as the headline
  let last = open ? pts[pts.length - 2] : pts[pts.length - 1], sentence;
  const big = x => { const s = say(x, unit), b = el("p", "ans-n"); b.append(el("strong", "", s.n), document.createTextNode(s.tail ? " " + s.tail : "")); return b; };
  if (P.year) {
    const yr = pts.filter(p => String(p[0]).startsWith(String(P.year)));
    if (yr.length && yearly) { const p = yr[0], so = open && p === open; head.append(el("p", "ans-q", `${v.c.title}, ${P.year}${so ? " so far" : ""}`), big(p[1])); sentence = `${v.c.title}: ${full(p[1], unit)} in ${P.year}${so ? " so far (the year is not over)" : ""}.`; if (so) facts.append(el("li", "", "The year is not over, so this count will still rise.")); }
    else if (yr.length) { const mean = yr.reduce((a, p) => a + p[1], 0) / yr.length; head.append(el("p", "ans-q", `${v.c.title}, average for ${P.year}`), big(mean)); facts.append(el("li", "", `Lowest ${full(Math.min(...yr.map(p => p[1])), unit)}, highest ${full(Math.max(...yr.map(p => p[1])), unit)}, from ${plural(yr.length, step)} of data.`)); sentence = `${v.c.title} averaged ${full(mean, unit)} in ${P.year}.`; }
    else P.year = null;
  }
  if (!P.year) {
    head.append(el("p", "ans-q", `${v.c.title}, ${when(last[0])}`), big(last[1])); sentence = `${v.c.title} was ${full(last[1], unit)} ${on} ${when(last[0])}.`;
    if (open) facts.append(el("li", "", `${when(open[0])} so far: ${full(open[1], unit)}. The year is not over, so the last full year is shown above.`));
    const t0 = Date.parse(last[0]) - 365.25 * 864e5, prev = pts.reduce((a, p) => (Math.abs(Date.parse(p[0]) - t0) < Math.abs(Date.parse(a[0]) - t0) ? p : a));
    if (prev !== last) { const diff = last[1] - prev[1], rel = /\$/.test(unit) && prev[1] ? ` (${diff >= 0 ? "+" : "−"}${fmtN(Math.abs(diff / prev[1] * 100))}%)` : "";
      facts.append(el("li", "", `A year earlier, ${when(prev[0])}: ${full(prev[1], unit)}. Change: ${diff >= 0 ? "+" : "−"}${fmtN(Math.abs(diff))}${rel}.`)); }
    const full_ = open ? pts.slice(0, -1) : pts, hi = full_.reduce((a, p) => (p[1] > a[1] ? p : a)); facts.append(el("li", "", `Highest on record here: ${full(hi[1], unit)}, ${when(hi[0])}. The series starts ${on} ${when(pts[0][0])}.`));
  }
  if (v.c.description) facts.append(el("li", "what", v.c.description));
  const spans = yearly ? [["10", "10 years"], ["30", "30 years"], ["all", "All"]] : step === "day" || step === "week" ? [["1", "1 year"], ["5", "5 years"], ["20", "20 years"], ["all", "All"]] : [["5", "5 years"], ["20", "20 years"], ["all", "All"]];
  let span = "all"; const end = pts[pts.length - 1];
  const draw = () => { const cut = span === "all" ? -Infinity : Date.parse(end[0]) - span * 365.25 * 864e5; [...seg.children].forEach(b => b.setAttribute("aria-pressed", String(b.dataset.s) === String(span)));
    Charts.line(fig, { series: [{ name: v.c.title, pts: pts.filter(p => Date.parse(p[0]) >= cut) }], x: "date", fmt: x => (/\$/.test(unit) ? "$" : "") + Charts.short(x), unit: say(1, unit).tail, zero: /\$/.test(unit), label: `${v.c.title} over time` }); };
  spans.forEach(([k, t]) => { const b = el("button", "", t); b.type = "button"; b.dataset.s = k; b.onclick = () => { span = k === "all" ? "all" : +k; draw(); }; seg.append(b); });
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
const isCountry = v => !!(v && isCountrySet(v.d));
let PLACE = new Map();
const byText = d => (isCountrySet(d) ? "country and year" : `one ${d.region === "US" ? "United States" : "world"} series over time, ${STEP_ADV[stepOf(d)]}`);
function matchVars(query, n) {                                          // the variables whose names fit some plain words, best first
  const q = norm(query || ""), words = q.split(" ").filter(w => w && !STOP.has(w) && !VISFILL.has(w)).map(w => (w.length > 3 ? w.replace(/(ies|es|s)$/, "") : w)), hits = new Map();
  [ASK_FIRST, CONCEPTS_MORE, CONCEPTS].forEach(list => list.forEach(([re, id]) => { if (V.has(id) && re.test(` ${q} `) && !hits.has(id)) hits.set(id, 3 - hits.size / 100); }));
  if (words.length) V.forEach(v => { if (!v.ok || !(isCountrySet(v.d) || isSeriesSet(v.d))) return; const k = words.filter(w => v.q.includes(w)).length; if (k >= Math.ceil(words.length * 0.6)) hits.set(v.id, Math.max(hits.get(v.id) || 0, k / words.length + 1 / (20 + v.c.title.length))); });
  return [...hits].sort((a, b) => b[1] - a[1]).slice(0, n).map(([id]) => V.get(id));
}
const r6 = x => (x === null || x === undefined || !isFinite(x) ? null : +(+x).toPrecision(6));
const codeOf = name => { const raw = String(name || "").trim(); if (/^[A-Za-z]{3}$/.test(raw) && LABEL.has(raw.toUpperCase())) return raw.toUpperCase(); const n = norm(raw); return PLACE.get(n) || PLACE.get(n.replace(/^the /, "")) || null; };
const TOOLS = {
  async find_variables({ query }) {
    return { matches: matchVars(query, 8).map(v => ({ id: v.id, title: v.c.title, unit: v.c.unit || "", source: v.d.source, covers: v.d.coverage, by: byText(v.d) })) };
  },
  async get_values({ variable, places, year }, used) {
    const v = V.get(variable); if (!v) return { error: "Unknown variable id. Call find_variables to get the right one." };
    if (!isCountry(v)) return { error: isSeriesSet(v.d) ? "This variable is one series over time, not by country. Call get_series without a place." : "This variable is a table that only the explorer page can show." };
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
    if (!isCountry(v)) return { error: "This variable is not measured by country, so it cannot be ranked by country." };
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
    if (isCountry(v)) { const c = codeOf(place || "World"); if (!c) return { error: "This place is not in the dataset" }; pts = (await seriesOf(v, [c])).get(c) || []; label = placeName(c); used.push({ kind: "places", v, places: [c], year: null }); }
    else if (isSeriesSet(v.d)) { const T = await load(v.d), t = T.c[v.d.time.col], col = T.c[v.c.name]; pts = []; for (let i = 0; i < T.n; i++) if (!isNaN(col[i])) pts.push([t[i], col[i]]); used.push({ kind: "series", v }); }
    else return { error: "This variable cannot be read as a series here." };
    const yearOf = x => +String(x).slice(0, 4); if (from) pts = pts.filter(p => yearOf(p[0]) >= from); if (to) pts = pts.filter(p => yearOf(p[0]) <= to);
    if (!pts.length) return { error: "No values in that period." };
    const step = Math.max(1, (pts.length - 1) / 23), thin = []; for (let i = 0; i < pts.length - 1; i += step) thin.push(pts[Math.floor(i)]); thin.push(pts[pts.length - 1]);
    const lo = pts.reduce((a, b) => (b[1] < a[1] ? b : a)), hi = pts.reduce((a, b) => (b[1] > a[1] ? b : a)), f = p => ({ when: p[0], value: r6(p[1]) });
    const open = !label && partialNow(v.d, pts[pts.length - 1][0]);
    return { variable: v.c.title, unit: v.c.unit || "", source: v.d.source, place: label || (v.d.region === "US" ? "United States series" : "World series"), ...(label ? {} : { one_point_per: stepOf(v.d) }), ...(open ? { note: `The last point, ${String(pts[pts.length - 1][0]).slice(0, 4)}, covers the year so far and will still rise. Compare full years only.` } : {}),
      points_in_period: pts.length, first: f(pts[0]), last: f(pts[pts.length - 1]), lowest: f(lo), highest: f(hi), points: [...new Set(thin)].map(p => [p[0], r6(p[1])]) };
  },
  async recent_earthquakes(_, used) {
    const d = M.find(x => x.id === "earthquakes-past-30-days"); if (!d) return { error: "No earthquake data." };
    const T = await load(d), rows = []; for (let i = 0; i < T.n; i++) rows.push({ t: T.c.time[i], m: T.c.magnitude[i], place: T.c.place[i] });
    const end = rows.reduce((a, r) => (r.t > a ? r.t : a), ""), cut = new Date(Date.parse(end) - 864e5).toISOString().slice(0, 19) + "Z", day = rows.filter(r => r.t >= cut), utc = t => new Date(t).toLocaleString("en-GB", { timeZone: "UTC", day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" }) + " UTC",      // spelled out, so a date cannot be misread
      top = a => [...a].sort((x, y) => y.m - x.m).slice(0, 5).map(r => ({ magnitude: r.m, place: r.place, when: utc(r.t), hours_before_data_end: Math.round((Date.parse(end) - Date.parse(r.t)) / 36e5) }));
    used.push({ kind: "quakes" });
    return { source: d.source, note: "Magnitude 2.5 and above, worldwide", data_as_of: utc(end), past_24_hours: { count: day.length, strongest: top(day) }, past_30_days: { count: rows.length, strongest: top(rows) } };
  },
};

TOOLS.show_chart = async (input, used) => {                            // draws straight into the reply that is being written
  if (!used.box) return { error: "A chart cannot be drawn here." };
  const out = await visual(input || {}, used.box);
  if (!out.error) used.push({ kind: "viz", v: V.get(input.variable), places: [].concat(input.places || []).map(codeOf).filter(Boolean) });
  return out;
};

/* ---------- the AI: a Claude model behind a small service; it asks for tools, the browser runs them ---------- */
const AI = { url: typeof DATA_AI_URL === "string" ? DATA_AI_URL : "", state: null, memory: [] };
function aiReady() {
  if (!AI.url) return Promise.resolve(false);
  return AI.state || (AI.state = (async () => { try { const c = new AbortController(), t = setTimeout(() => c.abort(), 5000), r = await fetch(AI.url, { signal: c.signal }); clearTimeout(t); const j = await r.json(); return !!(j && j.ok && j.ai); } catch (e) { return false; } })());
}
const TOOL_SAYS = { find_variables: i => `Searching the variables for "${i.query || ""}"`, get_values: i => `Reading ${(V.get(i.variable) || { c: { title: "the data" } }).c.title.toLowerCase()} for ${[].concat(i.places || []).join(", ")}`, rank: i => `Ranking countries by ${(V.get(i.variable) || { c: { title: "that measure" } }).c.title.toLowerCase()}`,
  get_series: i => `Reading the history of ${(V.get(i.variable) || { c: { title: "that measure" } }).c.title.toLowerCase()}${i.place ? " for " + i.place : ""}`, recent_earthquakes: () => "Reading the latest earthquakes",
  show_chart: i => `Drawing a ${i.kind === "map" ? "world map" : i.kind === "scatter" ? "scatter chart" : i.kind === "bar" ? "bar chart" : "line chart"} of ${(V.get(i.variable) || { c: { title: "the data" } }).c.title.toLowerCase()}` };
/* The service's standing instructions name only the first datasets. Each question therefore carries a short note with the
   variables on this page that fit its words, so the model reaches every dataset. The note is not kept in the conversation. */
function hintFor(q) {
  const room = 1180 - q.length, head = `\n\n(Note added by the site, not typed by the visitor: the site now holds ${M.length} datasets and ${V.size} variables, more than your instructions list, including health, population, government, society, science and the United States economy. find_variables searches all of them.`;
  if (room < head.length + 1) return "";
  let out = head, n = 0;
  for (const v of matchVars(q, 7)) { const item = `${n ? ";" : " Variables that may fit this question:"} ${v.id} (${v.c.title}${v.c.unit ? ", " + v.c.unit.replace(/\s*\(.*$/, "") : ""}; ${byText(v.d)})`; if (out.length + item.length + 2 > room) break; out += item; n++; }
  return out + (n ? "." : "") + ")";
}
async function aiTurn(question, say, box) {
  const messages = [...AI.memory, { role: "user", content: question + hintFor(question) }], used = [], cost = { usd: 0, rounds: 0, cached: 0 }; used.box = box;
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

/* ---------- visuals: one function draws for the AI's show_chart tool and for plain "chart ..." requests ---------- */
let SHAPE = null;
const yearOf = x => +String(x).slice(0, 4);
async function valuesAt(v, yr) {                                       // code -> { v, y } for every place: one year, or each place's newest
  const out = new Map();
  if (yr) { const T = await load(v.d), col = T.c[v.c.name]; for (let i = 0; i < T.n; i++) if (T.c.year[i] === yr && !isNaN(col[i])) out.set(T.c.code[i], { v: col[i], y: yr }); }
  else { const L = await latest(v.d.id), rec = L.vars[v.c.name]; if (rec) L.codes.forEach((c, i) => { if (rec.v[i] !== null) out.set(c, { v: rec.v[i], y: rec.y[i] }); }); }
  return out;
}
/* save a chart as a picture. The SVG takes its colours from the style sheet, so they are written into a copy first; the title and source are added around it */
function savePNG(svg, name, title, foot) {
  const copy = svg.cloneNode(true), src = [svg, ...svg.querySelectorAll("*")], dst = [copy, ...copy.querySelectorAll("*")], rc = svg.getBoundingClientRect(), k = 2, top = 46, bottom = 34, pad = 16;
  const props = ["fill", "fill-opacity", "stroke", "stroke-width", "stroke-opacity", "stroke-dasharray", "stroke-linecap", "stroke-linejoin", "opacity", "font-family", "font-size", "font-weight", "text-anchor", "visibility"];
  src.forEach((n, i) => { const cs = getComputedStyle(n); dst[i].setAttribute("style", props.map(q => `${q}:${cs.getPropertyValue(q)}`).join(";")); });
  copy.setAttribute("xmlns", "http://www.w3.org/2000/svg"); copy.setAttribute("width", rc.width); copy.setAttribute("height", rc.height);
  const root = getComputedStyle(document.documentElement), bg = root.getPropertyValue("--bg").trim() || "#fff", ink = root.getPropertyValue("--ink").trim() || "#000", soft = root.getPropertyValue("--ink3").trim() || "#666";
  return new Promise((done, fail) => {
    const img = new Image();
    img.onerror = () => fail(new Error("The picture could not be made."));
    img.onload = () => {
      const c = document.createElement("canvas"); c.width = (rc.width + pad * 2) * k; c.height = (rc.height + top + bottom) * k;
      const g = c.getContext("2d"); g.scale(k, k); g.fillStyle = bg; g.fillRect(0, 0, c.width, c.height);
      g.fillStyle = ink; g.font = "600 17px Arial, sans-serif"; g.textBaseline = "middle"; g.fillText(title.length > 90 ? title.slice(0, 88) + "…" : title, pad, top / 2 + 2, rc.width);
      g.drawImage(img, pad, top, rc.width, rc.height);
      g.fillStyle = soft; g.font = "12px Arial, sans-serif"; g.fillText(foot, pad, top + rc.height + bottom / 2, rc.width);
      c.toBlob(b => { if (!b) return fail(new Error("The picture could not be made.")); const a = el("a"); a.href = URL.createObjectURL(b); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 4000); done(b.size); }, "image/png");
    };
    img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(new XMLSerializer().serializeToString(copy));
  });
}
/* spec: { kind: line | bar | scatter | map, variable, variable_x, places, from, to, year, order, n }.  Draws into box and returns a short account of what was drawn. */
async function visual(spec, box) {
  const v = V.get(spec.variable); if (!v) return { error: "Unknown variable id. Call find_variables to get the right one." };
  const kind = ["line", "bar", "scatter", "map"].includes(spec.kind) ? spec.kind : "line";
  const unit = v.c.unit || "", u = say(1, unit), mt = /^million tonnes/.test(unit) ? 1e6 : 1, pct = unit.startsWith("%");
  const fmt = x => (u.money ? "$" : "") + Charts.short(x) + (pct ? "%" : ""), int = x => (Number.isInteger(x) && x > 1500 && x < 2200 ? x : null), yr = int(spec.year), from = int(spec.from), to = int(spec.to);
  const asked = [].concat(spec.places || []).filter(Boolean), codes = [...new Set(asked.map(codeOf).filter(Boolean))], unknown = asked.filter(n => !codeOf(n));
  if (asked.length && !codes.length) return { error: `None of these places is in the data: ${asked.join(", ")}.` };
  const fig = el("figure", "viz"), title = el("h4"), host = el("div", "fig"), cap = el("p", "cap"), tools = el("div", "vizacts");
  const mount = t => { title.textContent = t; fig.append(title, host, cap, tools); box.append(fig); const b = box.closest(".bubble"); if (b) b.classList.add("roomy"); };
  const finish = (text, explore, csv) => {
    cap.textContent = `${text} Source: ${v.d.source}.`;
    tools.append(linkBtn("Open in the explorer", explore, "link"));
    if (csv) { const b = el("button", "link", "Download the numbers"); b.type = "button"; b.onclick = () => saveCSV(csv.name, csv.header, csv.rows); tools.append(b); }
    const svg = $("svg", host); if (svg) { const b = el("button", "link", "Save as picture"); b.type = "button"; b.onclick = () => savePNG($("svg", host), `${v.c.name}_${kind}.png`, title.textContent, `Source: ${v.d.source}. Open Data Company, Data AI.`).then(() => { b.textContent = "Saved"; setTimeout(() => { b.textContent = "Save as picture"; }, 1600); }, () => { b.textContent = "Could not save"; }); tools.append(b); }
    const t = $("#thread"); if (t) t.scrollTop = t.scrollHeight;
  };
  const unitText = u.tail ? `Measured in ${u.money ? "dollars, " : ""}${u.tail}.` : u.money ? "Measured in US dollars." : pct ? "Measured in percent." : "";

  if (kind === "line") {
    let series, explore = `explore.html#d=${v.d.id}&v=${v.c.name}`;
    if (isCountry(v)) {
      const L = await latest(v.d.id), use = (codes.length ? codes : L.pos.has("WLD") ? ["WLD"] : []).filter(c => L.pos.has(c)).slice(0, 6);
      if (!use.length) return { error: codes.length ? "None of those places is in this dataset." : "Name at least one place for this variable." };
      const S = await seriesOf(v, use);
      series = use.map(c => ({ name: placeName(c), code: c, pts: (S.get(c) || []).filter(p => (!from || p[0] >= from) && (!to || p[0] <= to)) })).filter(x => x.pts.length);
      explore = exploreUrl(v.d, v.c.name, use, from, to);
    } else if (isSeriesSet(v.d)) {
      const T = await load(v.d), t = T.c[v.d.time.col], col = T.c[v.c.name], pts = [];
      for (let i = 0; i < T.n; i++) if (!isNaN(col[i]) && (!from || yearOf(t[i]) >= from) && (!to || yearOf(t[i]) <= to)) pts.push([t[i], col[i]]);
      series = pts.length ? [{ name: v.c.title, pts }] : [];
    } else return { error: "This variable cannot be drawn as a line here. It can be opened in the explorer." };
    if (!series.length) return { error: "There are no values in that period." };
    const dated = v.d.time.type === "date", span = `${yearOf(series[0].pts[0][0])} to ${yearOf(series[0].pts[series[0].pts.length - 1][0])}`;
    mount(isCountry(v) ? `${v.c.title}: ${series.map(x => x.name).join(", ")}` : `${v.c.title}, ${span}`);
    Charts.line(host, { series: series.map(x => ({ name: x.name, pts: x.pts.map(p => [p[0], p[1] * mt]) })), x: dated ? "date" : "year", fmt, unit: u.tail, zero: pct || series.length > 1, label: `${v.c.title} over time${isCountry(v) ? " for " + series.map(x => x.name).join(", ") : ""}` });
    finish(`${unitText} Hover the chart to read any point.`.trim(), explore, { name: `${v.c.name}.csv`, header: ["place", dated ? "date" : "year", v.c.name], rows: series.flatMap(x => x.pts.map(p => [x.name, p[0], p[1]])) });
    const end = p => ({ when: p[0], value: r6(p[1]) });
    return { drawn: "line chart", title: title.textContent, unit, source: v.d.source, ...(unknown.length ? { places_not_found: unknown } : {}), series: series.map(x => ({ place: x.name, points: x.pts.length, first: end(x.pts[0]), last: end(x.pts[x.pts.length - 1]), lowest: end(x.pts.reduce((a, b) => (b[1] < a[1] ? b : a))), highest: end(x.pts.reduce((a, b) => (b[1] > a[1] ? b : a))) })) };
  }
  if (!isCountry(v)) return { error: `A ${kind} chart needs a variable measured by country. For a world series such as a price, use kind "line".` };

  if (kind === "bar") {
    const all = await valuesAt(v, yr); let rows, head;
    if (codes.length) { rows = codes.filter(c => all.has(c)).map(c => ({ c, ...all.get(c) })).sort((a, b) => b.v - a.v); head = `${v.c.title}${yr ? ", " + yr : ""}`; if (!rows.length) return { error: `There are no values for those places${yr ? " in " + yr : ""}.` }; }
    else {
      const n = Math.max(3, Math.min(20, spec.n || 10)), bottom = spec.order === "bottom"; let t = [...all].filter(([c]) => isReal(c)).map(([c, r]) => ({ c, ...r }));
      if (!t.length) return { error: `No country has a value${yr ? " for " + yr : ""}.` };
      const newest = Math.max(...t.map(r => r.y)); t = t.filter(r => r.y >= newest - 6).sort((a, b) => (bottom ? a.v - b.v : b.v - a.v)); rows = t.slice(0, n); head = `${v.c.title}: the ${rows.length} ${bottom ? "lowest" : "highest"} countries${yr ? ", " + yr : ""}`;
    }
    mount(head);
    Charts.bars(host, { rows: rows.map(r => ({ label: placeName(r.c), value: r.v * mt, sub: yr ? "" : String(r.y) })), fmt: x => say(x / mt, unit).n, unit: u.tail });
    finish(yr ? `Values for ${yr}.` : "Each place at its most recent year, shown beside its name.", exploreUrl(v.d, v.c.name, rows.map(r => r.c).slice(0, 12)), { name: `${v.c.name}_bars.csv`, header: ["code", "place", "year", v.c.name], rows: rows.map(r => [r.c, placeName(r.c), r.y, r.v]) });
    return { drawn: "bar chart", title: head, unit, source: v.d.source, ...(unknown.length ? { places_not_found: unknown } : {}), rows: rows.map(r => ({ place: placeName(r.c), year: r.y, value: r6(r.v) })) };
  }

  if (kind === "scatter") {
    const vx = V.get(spec.variable_x); if (!vx) return { error: "A scatter needs variable_x too: the id of the variable for the horizontal axis." };
    if (!isCountry(vx)) return { error: "A scatter needs two variables measured by country." };
    const [Y, X] = await Promise.all([valuesAt(v, yr), valuesAt(vx, yr)]); let pts = [];
    Y.forEach((r, c) => { const x = X.get(c); if (x && isReal(c)) pts.push({ c, x: x.v, y: r.v, when: Math.min(x.y, r.y), label: placeName(c) }); });
    if (!yr && pts.length) { const newest = Math.max(...pts.map(p => p.when)); pts = pts.filter(p => p.when >= newest - 8); }
    if (pts.length < 5) return { error: "Too few countries have both values to draw a scatter." };
    const wide = a => a.every(x => x > 0) && Math.max(...a) / Math.min(...a) > 60, logX = wide(pts.map(p => p.x)), logY = wide(pts.map(p => p.y));
    const tx = x => (logX ? Math.log10(x) : x), ty = y => (logY ? Math.log10(y) : y), n = pts.length, mx = pts.reduce((a, p) => a + tx(p.x), 0) / n, my = pts.reduce((a, p) => a + ty(p.y), 0) / n;
    let sxy = 0, sxx = 0, syy = 0; pts.forEach(p => { const a = tx(p.x) - mx, b = ty(p.y) - my; sxy += a * b; sxx += a * a; syy += b * b; });
    const r = sxx && syy ? sxy / Math.sqrt(sxx * syy) : 0, head = `${v.c.title} against ${vx.c.title}`, axis = w => `${w.c.title}${w.c.unit ? ", " + w.c.unit : ""}`;
    mount(head);
    Charts.scatter(host, { pts, logX, logY, xLabel: axis(vx), yLabel: axis(v), label: `${head}: one dot for each of ${n} countries` });
    finish(`Each dot is a country${yr ? " in " + yr : " at its most recent year"}; hover a dot to see which. Correlation ${r.toFixed(2)}${logX || logY ? ", measured on the logarithmic scale the chart uses" : ""}. Two measures moving together does not show that one causes the other.`,
      exploreUrl(v.d, v.c.name), { name: `${v.c.name}_vs_${vx.c.name}.csv`, header: ["code", "place", vx.c.name, v.c.name], rows: pts.map(p => [p.c, p.label, p.x, p.y]) });
    const byY = [...pts].sort((a, b) => b.y - a.y), named = codes.map(c => pts.find(p => p.c === c)).filter(Boolean).map(p => ({ place: p.label, x: r6(p.x), y: r6(p.y) }));
    return { drawn: "scatter chart", title: head, vertical: axis(v), horizontal: axis(vx), countries: n, correlation: +r.toFixed(2), correlation_note: logX || logY ? "Pearson r on the log scales used by the chart" : "Pearson r", highest_vertical: byY.slice(0, 3).map(p => p.label), lowest_vertical: byY.slice(-3).map(p => p.label), ...(named.length ? { places_asked_about: named } : {}), source: v.d.source === vx.d.source ? v.d.source : `${v.d.source}; ${vx.d.source}` };
  }

  /* map: countries shaded in six equal-sized groups (the ramp runs light to dark on a light page and the other way on a dark one) */
  const all = await valuesAt(v, yr), shape = await (SHAPE || (SHAPE = getJSON("data/worldmap.json")));
  let t = [...all].filter(([c]) => isReal(c)).map(([c, r]) => ({ c, ...r })); if (!t.length) return { error: `No country has a value${yr ? " for " + yr : ""}.` };
  const newest = Math.max(...t.map(r => r.y)); t = t.filter(r => r.y >= newest - 6).sort((a, b) => a.v - b.v);
  const val = new Map(t.map(r => [r.c, r])), cut = [1, 2, 3, 4, 5].map(i => t[Math.floor(t.length * i / 6)].v), cls = x => cut.findIndex(c => x < c) + 1 || 6, head = `${v.c.title}, ${yr || "latest year for each country"}`;
  mount(head); host.classList.add("mapbox");
  const root = svgEl("svg", { viewBox: `0 0 ${shape.w} ${shape.h}`, role: "img", "aria-label": `World map of ${v.c.title}. Lowest ${placeName(t[0].c)}, highest ${placeName(t[t.length - 1].c)}.` }), tip = el("div", "tip"); tip.hidden = true;
  root.append(svgEl("path", { d: shape.sphere, class: "sphere" }));
  shape.countries.forEach(c => { const p = svgEl("path", { d: c.d }), r = val.get(c.code); p.dataset.name = LABEL.get(c.code) || c.name; if (r) { p.style.fill = `var(--q${cls(r.v)})`; p.dataset.v = `${full(r.v, unit)} (${r.y})`; } else p.setAttribute("class", "none"); root.append(p); });
  host.append(root, tip);
  const point = e => { const p = e.target.closest("path[data-name]"); if (!p) { tip.hidden = true; return; } const rc = host.getBoundingClientRect(); tip.replaceChildren(el("strong", "", p.dataset.name), el("div", "nm", p.dataset.v || "No data")); tip.hidden = false; tip.style.left = Math.min(rc.width - 190, Math.max(0, e.clientX - rc.left + 14)) + "px"; tip.style.top = (e.clientY - rc.top + 14) + "px"; };
  root.addEventListener("pointermove", point); root.addEventListener("pointerdown", point);                              // a tap works as well as a hover
  root.addEventListener("pointerleave", e => { if (e.pointerType === "mouse") tip.hidden = true; });
  const lg = el("div", "maplegend"), edges = [t[0].v, ...cut, t[t.length - 1].v];
  for (let i = 0; i < 6; i++) { const sp = el("span"), sw = el("i"); sw.style.background = `var(--q${i + 1})`; sp.append(sw, document.createTextNode(`${say(edges[i], unit).n} to ${say(edges[i + 1], unit).n}`)); lg.append(sp); }
  const nd = el("span"), sw = el("i"); sw.style.background = "var(--nodata)"; nd.append(sw, document.createTextNode("No data")); lg.append(nd); host.after(lg);
  finish(`${unitText} ${t.length} countries have data, split into six equal-sized groups; the key under the map gives the range of each shade. Hover or tap a country to read its value.`.trim(), exploreUrl(v.d, v.c.name), { name: `${v.c.name}_map.csv`, header: ["code", "place", "year", v.c.name], rows: t.map(r => [r.c, placeName(r.c), r.y, r.v]) });
  const one = r => ({ place: placeName(r.c), year: r.y, value: r6(r.v) });
  return { drawn: "world map", title: head, unit, source: v.d.source, countries_with_data: t.length, lowest: t.slice(0, 3).map(one), median: one(t[t.length >> 1]), highest: t.slice(-3).reverse().map(one) };
}
/* a plain-words reading of a drawn chart, for requests answered without the AI */
function describe(out, v) {
  const unit = v.c.unit || "", step = stepOf(v.d), when = w => (typeof w === "number" ? `in ${w}` : `${inOn(step)} ${whenText(w, step)}`);
  if (out.series) return out.series.slice(0, 4).map(x => `${out.series.length > 1 || isCountry(v) ? x.place : v.c.title} went from ${full(x.first.value, unit)} ${when(x.first.when)} to ${full(x.last.value, unit)} ${when(x.last.when)}${x.highest.when !== x.last.when && x.highest.when !== x.first.when ? `, with a peak of ${full(x.highest.value, unit)} ${when(x.highest.when)}` : ""}.`).join(" ");
  if (out.rows) { const a = out.rows[0], z = out.rows[out.rows.length - 1]; return out.rows.length > 1 ? `${a.place} is first at ${full(a.value, unit)} (${a.year}); ${z.place} is last of those shown at ${full(z.value, unit)} (${z.year}).` : `${a.place}: ${full(a.value, unit)} (${a.year}).`; }
  if ("correlation" in out) { const r = out.correlation, size = Math.abs(r) >= 0.7 ? "strongly" : Math.abs(r) >= 0.4 ? "moderately" : Math.abs(r) >= 0.2 ? "weakly" : "hardly"; return `Across ${out.countries} countries the two measures ${size === "hardly" ? "hardly move together" : r > 0 ? `rise together ${size}` : `move in opposite directions ${size}`} (correlation ${r.toFixed(2)}). That alone does not show that one causes the other.`; }
  if (out.highest) return `Highest: ${out.highest.map(x => `${x.place} (${full(x.value, unit)})`).join(", ")}. Lowest: ${out.lowest.map(x => `${x.place} (${full(x.value, unit)})`).join(", ")}.`;
  return "";
}
const VIS = /\b(charts?|graphs?|plots?|plotted|plotting|visuali[sz]\w*|visuals?|draw|drawn|diagram|pictures?|maps?|mapped|scatter\w*|bar ?charts?|line ?charts?|histogram|pie)\b/i;
const VISFILL = new Set("chart charts graph graphs plot plots plotted plotting visual visuals visualize visualise visualization visualisation draw drawn diagram picture pictures map maps mapped scatter scatterplot bar bars barchart line lines linechart pie histogram show showing display see view trend trends change changed changing changes history historical evolution over time since from between until till through after before last past year years decade decades across against relationship correlation correlate it that this them these those same please can you could".split(" "));
const WHY = /\b(why|how come|explain|reasons?|causes?|caused|because|should|would|will|predict\w*|forecast\w*|future|means?|meaning|define|definition|impact|effects?|affects?|opinion|recommend\w*|advice|summar\w*|describe|tell me about|think|better|worse|good|bad|surpris\w*)\b/i;
function rangeOf(q) {                                                  // "since 1990", "from 2000 to 2020", "last 20 years"
  const s = q.toLowerCase(), Y = "(1[789]\\d\\d|20\\d\\d)", now = new Date().getFullYear(); let m;
  if ((m = s.match(new RegExp(`\\b(?:from|between)\\s+${Y}\\s*(?:to|and|until|till|through|-|–)\\s*${Y}\\b`))) || (m = s.match(new RegExp(`\\b${Y}\\s*(?:-|–|to)\\s*${Y}\\b`)))) return { from: Math.min(+m[1], +m[2]), to: Math.max(+m[1], +m[2]) };
  if ((m = s.match(new RegExp(`\\b(?:since|after|from)\\s+${Y}\\b`)))) return { from: +m[1] };
  if ((m = s.match(new RegExp(`\\b(?:until|till|before|up to|through)\\s+${Y}\\b`)))) return { to: +m[1] };
  if ((m = s.match(/\b(?:last|past)\s+(\d{1,3})\s+years\b/))) return { from: now - +m[1] };
  if (/\b(?:last|past) decade\b/.test(s)) return { from: now - 10 };
  return {};
}
function visualPlan(q, P) {                                            // which charts a "chart ..." request means, when its words match the data
  if (!P.vars.length) return null;
  const s = q.toLowerCase(), r = rangeOf(q), ranged = "from" in r || "to" in r, year = ranged ? null : P.year, vs = P.vars.map(id => V.get(id)), real = P.places.filter(c => c !== "WLD");
  if (vs.length === 2 && vs.every(isCountry) && !real.length && /scatter|versus|\bvs\b|against|relationship|correlat|plot/.test(s)) return [{ kind: "scatter", variable: vs[0].id, variable_x: vs[1].id, year }];
  const plan = vs.map(v => {
    if (!isCountry(v)) return isSeriesSet(v.d) ? { kind: "line", variable: v.id, ...r } : null;
    if (/\bmaps?\b|mapped/.test(s) && !real.length) return { kind: "map", variable: v.id, year };
    if (P.rank && !real.length) return { kind: "bar", variable: v.id, order: P.rank, n: P.n, year };
    if (real.length >= 2 && (year || /\bbars?\b|bar ?chart|histogram|\bpie\b/.test(s))) return { kind: "bar", variable: v.id, places: P.places, year };
    return { kind: "line", variable: v.id, places: P.places, ...r };
  }).filter(Boolean);
  return plan.length ? plan : null;
}

/* ---------- the conversation ---------- */
const EXPLAIN = /\b(why|how come|explain|reasons?|causes?|caused|because|should|could|would|will|predict\w*|forecast\w*|future|means?|meaning|define|definition|impact|effects?|affects?|relationship|correlat\w*|better|worse|good|bad|summar\w*|describe|tell me about|think|opinion|recommend\w*|advice|trend|changed?|changing|grow\w*|increas\w*|decreas\w*|fall\w*|ris\w+)\b/i;
/* questions the datasets cannot hold an answer to: these need the AI, never a lucky word match */
const GENERAL = /^(who|whom|whose|when|where)\b|\b(capital( city)? of|president|prime minister|king|queen|currency|languages?|invented|inventor|founded|founder|born|died|weather|recipe|joke|poem|story|translate|wrote|written by|author|meaning of|stands? for)\b/i;
const last = { v: null, places: [], ai: false };
let busy = false;
const toEnd = () => { const t = $("#thread"); t.scrollTop = t.scrollHeight; };
function newTurn(q) {
  const root = el("article", "turn"), mine = el("div", "msg user"), theirs = el("div", "msg ai"), ucol = el("div", "col"), acol = el("div", "col"), ub = el("div", "bubble"), reply = el("div", "bubble reply"), viz = el("div", "vizzes");
  const status = el("p", "thinking"), dots = el("span", "dots"), words = el("span", "", "Thinking"), at = new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }), meta = el("p", "stamp", `Data AI, ${at}`), face = el("span", "avatar", "AI");
  dots.append(el("i"), el("i"), el("i")); dots.setAttribute("aria-hidden", "true"); status.append(dots, words); face.setAttribute("aria-hidden", "true");
  ub.append(el("p", "you", q)); ucol.append(ub, el("p", "stamp", `You, ${at}`)); mine.append(ucol);
  reply.append(viz, status); acol.append(reply, meta); theirs.append(face, acol); root.append(mine, theirs); $("#thread").append(root);
  $("#fresh-chat").hidden = false; toEnd();
  return { root, box: reply, viz, say: t => { words.textContent = t; toEnd(); }, done: () => status.remove(), label: t => { meta.textContent = `Data AI, ${at}. ${t}`; },
    settle: () => { const t = $("#thread"); t.scrollTop = Math.max(0, root.offsetTop - 14); } };          // show the question at the top with its answer under it
}
const SMALL = [[/^(hi|hello|hey|hola|namaste|good (morning|afternoon|evening))\b/i, "Hello. Ask me for a number, a comparison, a ranking or a chart, for example \"India life expectancy\", \"top 10 CO2 emitters\" or \"chart oil price since 2020\". I'll answer with the year and the source."],
  [/\b(who are you|what are you|what can you do|what do you do|help me|how do (you|i) (work|use))\b/i, "I'm Data AI, the assistant for this site's open data. I can give you a single figure, compare countries, rank them, draw a line chart, a bar chart, a scatter or a world map, and report today's earthquakes, oil prices, US interest rates and the national debt. The data covers climate, energy, the economy, health, people, government and science. Every figure comes with its date and source."],
  [/^(thanks|thank you|thx|great|nice|ok|okay|cool)\b/i, "You're welcome. Ask me anything else about the data."]];

async function lookup(q, P, turn) {                                    // the built-in engine: exact, instant, no AI needed
  const box = turn.box, vs = P.vars.map(id => V.get(id));
  if (P.quake) { box.classList.add("roomy"); box.append(el("p", "readas", "Read as: recent earthquakes worldwide.")); await answerQuakes(q, box); return true; }
  if (!vs.length) return false;
  const byPlace = vs.some(isCountry), read = el("p", "readas"); box.classList.add("roomy");
  read.append(document.createTextNode(`Read as: ${vs.map(v => `"${v.c.title}" from ${v.d.source}`).join(" and ")}${!byPlace ? "" : P.places.length ? `, for ${P.places.map(placeName).join(", ")}` : P.rank ? ", ranked by country" : ""}${P.year ? `, in ${P.year}` : ""}. `));
  if (P.others.length) { read.append("Not what you meant? Try "); P.others.slice(0, 4).forEach((id, i) => { const o = V.get(id), b = el("button", "link plain", o.c.title); b.type = "button"; b.onclick = () => respond(o.c.title + (P.places.length ? " " + P.places.map(placeName).join(" ") : "")); read.append(i ? ", " : "", b); }); read.append("."); }
  box.append(read);
  for (const v of vs) {
    try {
      if (isSeriesSet(v.d)) await answerSeries(q, v, { ...P }, box);
      else if (!isCountry(v)) box.append(note(v.d.entity ? `"${v.c.title}" is broken down by ${v.d.entity.label.toLowerCase()}, which is best seen in the explorer.` : `"${v.c.title}" is a column in a list (${v.d.title}), which is best seen in the explorer.`, linkBtn("Open it in the explorer", `explore.html#d=${v.d.id}&v=${v.c.name}`, "link")));
      else if (P.places.length) await answerPlaces(q, v, { ...P }, box);
      else if (P.rank) await answerRank(q, v, { ...P }, box);
      else await answerWorld(q, v, { ...P }, box);
    } catch (e) { console.error(e); box.append(note("That answer could not be loaded. Check the connection and ask again.")); }
  }
  last.v = vs[0].id; if (P.places.length) last.places = P.places;
  return true;
}
/* the data an AI answer was built on, folded away until asked for */
function evidence(u, q, box) {
  const d = el("details", "evidence"), s = el("summary"), body = el("div");
  s.textContent = "Data behind this answer: " + (u.kind === "quakes" ? "recent earthquakes, US Geological Survey" : `${u.v.c.title}${u.kind === "places" ? " for " + u.places.map(placeName).join(", ") : u.kind === "rank" ? ", countries ranked" : ""} (${u.v.d.source})`);
  d.append(s, body); box.append(d);
  d.addEventListener("toggle", async () => {
    if (!d.open || d.dataset.done) return; d.dataset.done = "1"; box.classList.add("roomy");
    try { if (u.kind === "places") await answerPlaces(q, u.v, { places: u.places, year: u.year, rank: null, n: 10 }, body); else if (u.kind === "rank") await answerRank(q, u.v, { places: [], year: u.year, rank: u.order, n: Math.min(u.n, 15) }, body); else if (u.kind === "series") await answerSeries(q, u.v, { year: null }, body); else await answerQuakes(q, body); }
    catch (e) { console.warn(e); body.append(note("That data could not be loaded just now.")); }
  });
}
function closest(words) {                                              // when nothing matches exactly: the nearest variables, so there is always a way forward
  const hits = []; V.forEach(v => { if (!v.ok) return; const n = words.filter(w => w.length > 2 && !VISFILL.has(w) && v.q.includes(w.replace(/(ies|es|s)$/, ""))).length; if (n) hits.push([n - v.c.title.length / 500, v]); });
  return hits.sort((a, b) => b[0] - a[0]).slice(0, 5).map(h => h[1]);
}
async function respond(text, opt = {}) {
  const q = String(text).trim(); if (!q || busy) return;
  const input = $("#q"); busy = true; input.value = ""; input.style.height = ""; $("#ask-go").disabled = true;
  const turn = newTurn(q), box = turn.box;
  history.replaceState(null, "", `ask.html?q=${encodeURIComponent(q).replace(/%20/g, "+")}`); document.title = `${q} | Data AI`;
  try {
    const P = parse(q), count = q.split(/\s+/).length, follow = /^(and|what about|how about|same for|for|in|versus|vs|compared (to|with))\b/i.test(q), wantsVis = VIS.test(q);
    const bare = P.left.every(w => VISFILL.has(w));                                                                    // nothing in the words but "chart", "it", "since 2000" and the like
    if (!P.vars.length && !P.quake && last.v && ((wantsVis && bare) || (P.places.length && (count <= 4 || follow)))) { P.vars = [last.v]; if (!P.places.length && wantsVis) P.places = last.places; }   // "and China?" or "chart it" keeps the measure
    if (P.vars.length && !P.places.length && !P.rank && last.places.length && follow && isCountry(V.get(P.vars[0]))) P.places = last.places;   // "and its population?" keeps the places
    const small = count <= 6 && !P.vars.length && !P.places.length && !P.quake && SMALL.find(([re]) => re.test(q));
    if (small && !opt.force) { turn.done(); box.append(el("p", "aitext", small[1])); return; }                       // a greeting needs no model
    const general = GENERAL.test(q), plan = wantsVis && !general ? visualPlan(q, P) : null, ai = await aiReady();
    const drawable = plan && !WHY.test(q) && !P.weak && P.left.every(w => VISFILL.has(w));                                  // the words name data we hold and nothing more: draw it without the AI
    const simple = drawable || (!wantsVis && (P.quake || P.vars.length > 0) && !EXPLAIN.test(q) && !general && !P.weak && P.left.length === 0 && !(follow && last.ai));   // a follow-up to an AI answer stays with the AI
    if (ai && (opt.force || !simple)) {
      try {
        const a = await aiTurn(opt.prompt || q, turn.say, turn.viz); turn.done(); last.ai = true; turn.label("Written by AI");
        turn.root.dataset.rounds = a.cost.rounds; turn.root.dataset.usd = a.cost.usd.toFixed(6); turn.root.dataset.cached = a.cost.cached;
        const ans = el("div", "aitext"); ans.append(mdLite(a.text)); box.append(ans);
        const seen = new Set(), drawn = new Set(a.used.filter(u => u.kind === "viz" && u.v).map(u => u.v.id)); let shown = 0;
        for (const u of a.used) {
          if (u.v) { last.v = u.v.id; if (u.places && u.places.length) last.places = u.places; }
          const key = u.kind + (u.v ? u.v.id : "") + (u.places || []).join() + (u.order || ""); if (u.kind === "viz" || seen.has(key) || shown >= 3 || (u.v && drawn.has(u.v.id))) continue; seen.add(key); shown++;
          evidence(u, q, box);
        }
        box.append(el("p", "ainote", a.used.length ? "Written by an AI model. The figures were read from the datasets named here; any explanation around them is general knowledge and can be wrong." : "Written by an AI model from general knowledge, not from this site's data. It can be wrong or out of date, so check anything that matters."));
        const tools = el("div", "acts small"), cp = el("button", "link", "Copy the answer"), rd = el("button", "link", "Read it aloud"); cp.type = rd.type = "button";
        cp.onclick = () => copy(cp, `${a.text.replace(/\*\*/g, "")}\n\nFrom Data AI, Open Data Company: ${SITE}ask.html?q=${encodeURIComponent(q).replace(/%20/g, "+")}`); rd.onclick = () => speak(rd, a.text);
        tools.append(cp); if ("speechSynthesis" in window) tools.append(rd); box.append(tools);
        return;
      } catch (e) {
        console.warn("AI unavailable, using the built-in lookup", e); if (e.reason === "budget" || e.reason === "off") AI.state = Promise.resolve(false); aiBadge();
        turn.viz.replaceChildren();
        box.append(el("p", "ainote", e.reason === "budget" ? "The AI's allowance for now is used up, so this answer comes straight from the data." : e.reason === "busy" ? "The AI is busy right now, so this answer comes straight from the data." : "The AI could not be reached just now, so this answer comes straight from the data."));
      }
    }
    turn.done(); last.ai = false; turn.label("Read straight from the data");
    if (general || P.weak) { P.vars = []; P.quake = false; }                                                            // without the AI, say so instead of answering a different question
    const explain = () => { if (!ai || opt.force) return; const b = el("button", "link", "Ask Data AI to explain this"); b.type = "button"; b.onclick = () => respond(q, { force: true, prompt: `${q}\n\nGive the figures, then explain briefly what is behind them.` }); const w = el("p", "more-ai"); w.append(b); box.append(w); };
    if (plan && P.vars.length) {                                                                                         // a chart was asked for and the data is here
      const said = [];
      for (const spec of plan) { try { const out = await visual(spec, turn.viz); if (out.error) box.append(note(out.error)); else said.push(describe(out, V.get(spec.variable))); } catch (e) { console.error(e); box.append(note("That chart could not be drawn just now. Check the connection and ask again.")); } }
      if (said.length) {
        if (/\bpie\b/i.test(q)) said.push("Shown as bars, which compare sizes more clearly than a pie.");
        box.append(el("p", "aitext", said.filter(Boolean).join(" ")));
        last.v = P.vars[0]; if (P.places.length) last.places = P.places; explain(); return;
      }
    }
    if (await lookup(q, P, turn)) { explain(); return; }
    const hello = SMALL.find(([re]) => re.test(q)); if (hello) { box.append(el("p", "aitext", hello[1])); return; }
    /* nothing matched and no AI to hand it to: say what was understood and offer the nearest things that can be answered */
    const near = general ? [] : closest(P.words), p = el("div", "aitext"); turn.label("");
    p.append(el("p", "", general ? "That is a general question rather than one the datasets hold, so it needs the AI part, which is resting right now. I can still answer from the data straight away, for example:" : P.places.length ? `I found ${P.places.map(placeName).join(", ")} in your question, but not which measure you want. Pick one below, or add it to the question, for example "${placeName(P.places[0])} life expectancy".`
      : near.length ? "I could not match that to one measure in the data, but these are close. Pick one, or say it another way." : "That is outside the datasets I can read right now. I answer from open data on climate, energy, the economy, health, people, government, science and natural hazards. Here are things I can answer straight away."));
    const picks = el("div", "quick"); (near.length ? near.map(v => [v.c.title, (wantsVis ? "Chart " : "") + v.c.title + (P.places.length ? " " + P.places.map(placeName).join(" ") : "")]) : ["World population", "Top 10 CO2 emitters", "US unemployment rate", "Map of life expectancy", "Happiest countries", "Earthquakes today"].map(t => [t, t]))
      .forEach(([label, ask]) => { const b = el("button", "", label); b.type = "button"; b.onclick = () => respond(ask); picks.append(b); });
    p.append(picks); const more = el("p", "hint"); more.append("Or ", Object.assign(el("a", "", "search the list of every variable"), { href: `datasets.html?q=${encodeURIComponent(P.words.filter(w => !VISFILL.has(w)).join(" "))}` }), "."); p.append(more); box.append(p);
  } catch (e) { console.error(e); turn.done(); box.append(note("Something went wrong while answering. Please ask again.")); }
  finally { busy = false; $("#ask-go").disabled = false; turn.settle(); if (matchMedia("(pointer:fine)").matches) input.focus({ preventScroll: true }); }
}
async function aiBadge() { const on = await aiReady(), b = $("#ai-state"); b.textContent = on ? "AI answers are on. Figures come from the datasets." : "Answering straight from the datasets. The AI part is resting."; b.classList.toggle("on", on); }

(async () => {
  const [man, countries, pulse] = await Promise.all([getJSON("data/datasets.json"), getJSON("data/countries.json").catch(() => ({ countries: {} })), getJSON("data/pulse.json").catch(() => ({}))]);
  M = man.datasets; M.checked = man.checked; C = countries.countries || {}; PULSE = pulse;
  M.forEach(d => { const ok = isCountrySet(d) || isSeriesSet(d) || (!!d.entity && d.time.type === "year");                       // lists (earthquakes, bank failures) are never matched by a stray word
    d.columns.forEach(c => V.set(`${d.id}::${c.name}`, { id: `${d.id}::${c.name}`, d, c, ok: ok && c.type === "num", q: norm(`${c.title} ${c.name.replace(/_/g, " ")} ${c.unit || ""}`) })); });
  ASK_FIRST.unshift(...CONCEPTS_FIRST);
  buildPlaces(); PLACE = new Map(NAMES);
  const input = $("#q"), form = $("#askform"), grow = () => { input.style.height = "auto"; input.style.height = Math.min(168, input.scrollHeight + 4) + "px"; };
  form.addEventListener("submit", e => { e.preventDefault(); respond(input.value); });
  input.addEventListener("input", grow);
  input.addEventListener("keydown", e => { if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); respond(input.value); } });   // Enter sends, Shift+Enter starts a new line
  ["India life expectancy", "Top 10 CO2 emitters", "Chart India's CO2 emissions since 1990", "Map of life expectancy", "Which countries are the happiest?", "US unemployment rate", "Chart the US national debt", "Why is the world getting warmer?", "Plot life expectancy against GDP per capita", "Earthquakes today"]
    .forEach(t => { const b = el("button", "", t); b.type = "button"; b.onclick = () => respond(t); $("#examples").append(b); });
  $("#fresh-chat").onclick = () => { $$(".turn", $("#thread")).forEach(t => t.remove()); AI.memory = []; last.v = null; last.places = []; last.ai = false; $("#fresh-chat").hidden = true; history.replaceState(null, "", "ask.html"); document.title = "Data AI | Open Data Company"; if ("speechSynthesis" in window) speechSynthesis.cancel(); $("#thread").scrollTop = 0; input.focus(); };
  voiceInput($("#mic"), input, $("#voice-note"), t => respond(t));
  $("#thread").addEventListener("click", e => { const a = e.target.closest('a[href^="ask.html?q="]'); if (!a || e.metaKey || e.ctrlKey || e.shiftKey) return; e.preventDefault(); respond(new URL(a.href).searchParams.get("q") || ""); });
  aiBadge();
  const first = new URLSearchParams(location.search).get("q"); if (first) respond(first);
})().catch(e => { console.error(e); $("#thread").append(el("p", "note", "This page could not load its data. Reload to try again.")); });
