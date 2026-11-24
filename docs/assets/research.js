/* Researcher mode. Needs core.js (helpers, loader, picker) and stats.js (validated statistics).
   Flow: state -> plan() looks at the data and recommends a method with reasons -> run() -> render(). */
const FAMILIES = new Set(["code+year", "month", "date", "zone+year"]);            // datasets this page can analyse, by key columns
const WB_TOTALS = new Set("AFE AFW ARB CEB CSS EAP EAR EAS ECA ECS EMU EUU FCS HIC HPC IBD IBT IDA IDB IDX INX LAC LCN LDC LIC LMC LMY LTE MEA MIC MNA NAC OED OSS PRE PSS PST SAS SSA SSF SST TEA TEC TLA TMN TSA TSS UMC WLD".split(" "));
let M = [], V = new Map(), C = null, P = {}, plan = null, result = null, ticket = 0, timer = 0;
const st = { kind: "rel", y: new Set(), x: new Set(), c: new Set(), places: new Set(), only: true, from: "", to: "", yearly: true,
  groupby: "", a: new Set(), b: new Set(), pa: ["", ""], pb: ["", ""], method: "", logY: null, logX: null };
const fam = d => d.keys.join("+"), one = s => [...s][0], vm = id => V.get(id);
const isReal = code => C ? code in C : /^[A-Z]{3}$/.test(code) && !WB_TOTALS.has(code);
const num = (v, d = 3) => { if (!isFinite(v)) return "–"; const a = Math.abs(v); return a >= 1e9 ? `${+(v / 1e9).toPrecision(3)} billion` : a >= 1e6 ? `${+(v / 1e6).toPrecision(3)} million` : a >= 1000 ? Math.round(v).toLocaleString("en-US") : String(+v.toPrecision(d)); };
const pv = p => p < 0.001 ? "p < 0.001" : `p = ${p.toFixed(3)}`;
const low = s => (/^[A-Z][a-z]/.test(s) && !/^(Henry|Brent|Mauna|Gini|Global temperature)/.test(s) ? s.charAt(0).toLowerCase() + s.slice(1) : s);   // keeps GDP, CO2 and proper names
const chance = p => p < 0.001 ? "This is very unlikely to be chance alone" : p < 0.05 ? "This is unlikely to be chance alone" : p < 0.1 ? "The evidence is weak: chance could plausibly produce this" : "The data do not show a clear pattern: chance alone could easily produce this";
const strength = r => { const a = Math.abs(r); return a < 0.1 ? "negligible" : a < 0.3 ? "weak" : a < 0.5 ? "moderate" : a < 0.7 ? "strong" : "very strong"; };
const title = id => vm(id).c.title, unit = id => vm(id).c.unit || "";
const placeWord = F => F === "zone+year" ? "zone" : "country";

/* ---------- data: one row per place and time, one column per chosen variable ---------- */
async function assemble(ids, o) {
  const metas = ids.map(vm), d0 = metas[0].d, F = fam(d0), ent = !!d0.entity, yr = d0.time.type === "year";
  const datas = await Promise.all(metas.map(m => load(m.d))), rows = new Map();
  metas.forEach((m, j) => {
    const D = datas[j], d = m.d, T = D.c[d.time.col], E = ent ? D.c[d.entity.col] : null, L = ent ? D.c[d.entity.label_col] : null, X = D.c[m.c.name];
    for (let i = 0; i < D.n; i++) {
      const v = X[i]; if (isNaN(v)) continue;
      let t = T[i];
      if (yr) { if ((o.from !== "" && t < +o.from) || (o.to !== "" && t > +o.to)) continue; }
      else { t = t.slice(0, 10); if ((o.from && t < o.from) || (o.to && t > o.to)) continue; }
      const code = ent ? E[i] : "";
      if (ent && (o.places && o.places.size ? !o.places.has(code) : o.only && F === "code+year" && !isReal(code))) continue;
      const key = code + "|" + t; let r = rows.get(key);
      if (!r) rows.set(key, r = { e: code, label: ent ? L[i] : "", t, v: new Float64Array(ids.length).fill(NaN) });
      r.v[j] = v;
    }
  });
  let list = [...rows.values()];
  if (!yr && o.yearly) {                                        // monthly or daily series -> yearly means, complete-enough years only
    const need = F === "month" ? 9 : 150, by = new Map();
    list.forEach(r => { const y = r.t.slice(0, 4); let g = by.get(y); if (!g) by.set(y, g = { s: new Float64Array(ids.length), n: new Int32Array(ids.length) }); r.v.forEach((v, j) => { if (!isNaN(v)) { g.s[j] += v; g.n[j]++; } }); });
    list = [...by].map(([y, g]) => ({ e: "", label: "", t: +y, v: Float64Array.from(g.s, (s, j) => (g.n[j] >= need ? s / g.n[j] : NaN)) }));
  } else if (!yr) list.forEach(r => { r.date = r.t; r.t = 1970 + Date.parse(r.t) / 31557600000; });
  const some = list.length; list = list.filter(r => r.v.every(x => !isNaN(x)));
  list.sort((a, b) => (a.e < b.e ? -1 : a.e > b.e ? 1 : a.t - b.t));
  return { rows: list, dropped: some - list.length, ent, F, yearly: yr || o.yearly, entities: new Set(list.map(r => r.e)).size, times: new Set(list.map(r => r.t)).size };
}
const when = r => r.date || String(r.t);
const span = rows => { const t = rows.map(r => r.t), a = Math.min(...t), b = Math.max(...t); return a === b ? when(rows[0]) : `${Math.floor(a)} to ${Math.floor(b)}`; };
const logCheck = v => { const mn = Math.min(...v), mx = Math.max(...v), can = mn > 0; return { can, suggest: can && Stats.skewness(v) > 1 && mx / mn > 20, ratio: can ? mx / mn : 0 }; };

/* ---------- step 1: look at the data and recommend ---------- */
async function makePlan() {
  const y = one(st.y); if (!y) return { ok: false, head: "Pick an outcome to begin", text: "Choose what you want to explain. The recommendation appears here and updates as you change things." };
  const F = fam(vm(y).d), ent = !!vm(y).d.entity, scope = { places: st.places, only: st.only, from: st.from, to: st.to, yearly: st.yearly }, pw = placeWord(F);
  if (st.kind === "rel") {
    const x = one(st.x); if (!x) return { ok: false, head: "Now pick what might explain it", text: `Choose the variable you think moves with ${low(title(y))}.` };
    if (x === y) return { ok: false, head: "Pick two different variables", text: "The outcome and the explanation are the same variable." };
    const ids = [y, x, ...st.c].filter((v, i, a) => a.indexOf(v) === i), data = await assemble(ids, scope), n = data.rows.length;
    const base = { ok: true, kind: "rel", data, ids, F }, k = ids.length - 2;
    const ly = logCheck(data.rows.map(r => r.v[0])), lx = logCheck(data.rows.map(r => r.v[1]));
    const logs = { y: ly, x: lx }, logWhy = [];
    if (lx.suggest) logWhy.push(`${title(x)} is very uneven (its largest value is ${num(lx.ratio, 2)} times its smallest), so it goes on a log scale. The result then reads as the effect of a percentage change.`);
    if (ly.suggest) logWhy.push(`${title(y)} is just as uneven, so it goes on a log scale too.`);
    if (!ent || data.entities === 1) {
      if (n < 12) return tooFew(n, "points over time", 12);
      return { ...base, structure: "series", logs, rec: "diff", facts: [`${n} points over time`, span(data.rows)],
        why: [`This is one series followed over time (${n} points). Two things that both drift upward correlate strongly even when they have nothing to do with each other.`,
          `Comparing changes from one period to the next removes the shared drift. It asks: when ${low(title(x))} rises more than usual, does ${low(title(y))} rise more than usual too?`,
          "Errors allow for neighbouring periods resembling each other (Newey-West).", ...logWhy],
        methods: [["diff", "Regression on period-to-period changes", "Best for two trending series."], ["levels", "Regression on the raw levels", "Simple to read, but a shared trend can fake a relationship."], ["rank", "Spearman rank correlation of the levels", "A quick look at whether the two move in the same order."]] };
    }
    if (data.times === 1) {
      if (n < 10) return tooFew(n, pw === "zone" ? "zones" : "countries", 10);
      const sy = Math.abs(Stats.skewness(data.rows.map(r => (ly.suggest ? Math.log(r.v[0]) : r.v[0])))), sx = Math.abs(Stats.skewness(data.rows.map(r => (lx.suggest ? Math.log(r.v[1]) : r.v[1]))));
      const rank = n < 30 || sy > 2 || sx > 2;
      return { ...base, structure: "cross", logs, rec: rank ? "rank" : "ols", facts: [`${n} ${pw === "zone" ? "zones" : "countries"}`, `one point in time: ${span(data.rows)}`],
        why: [`You are comparing ${n} ${pw === "zone" ? "zones" : "countries"} at one point in time, so each counts once.`,
          rank ? (n < 30 ? `With only ${n} of them, a rank-based measure is safer: it asks whether the ordering agrees, so a few extreme values cannot dominate.` : "The values stay heavily skewed even on a log scale, so a rank-based measure is safer: extreme values cannot dominate it.")
            : `A straight-line fit measures how much ${low(title(y))} changes with ${low(title(x))}${k ? `, holding ${k === 1 ? "the control" : "the controls"} fixed` : ""}.`,
          rank ? "The regression is still shown for the size of the effect." : "Errors are made robust, because the spread usually differs between small and large values.", ...logWhy],
        methods: [["ols", "Linear regression, robust errors", "Gives the size of the effect and lets you hold other things constant."], ["rank", "Spearman rank correlation", "Safest with few observations or extreme values. Ignores the controls."]] };
    }
    if (data.entities < 3 || data.times < 3) return tooFew(n, "rows", 30);
    const few = data.entities < 10;
    return { ...base, structure: "panel", logs, rec: "fe2", facts: [`${n.toLocaleString()} ${pw}-years`, `${data.entities} ${pw === "zone" ? "zones" : "countries"}`, `${data.times} years: ${span(data.rows)}`],
      why: [`The data follow ${data.entities} ${pw === "zone" ? "zones" : "countries"} over ${data.times} years. A ${pw}'s years are not independent of each other, and ${pw === "zone" ? "zones" : "countries"} differ in lasting ways (geography, history, institutions) that would distort a simple comparison.`,
        `Fixed effects compare each ${pw} with itself over time. Year effects remove whatever hit everyone at once, such as a global recession.`,
        `Errors are clustered by ${pw}, so repeated years do not create false confidence.`, ...(few ? [`Only ${data.entities} ${pw === "zone" ? "zones" : "countries"}: clustered errors work best with 30 or more, so read the p-value with caution.`] : []), ...logWhy],
      methods: [["fe2", `Fixed effects: ${pw} and year`, "The standard choice for panels. Uses only change within each " + pw + "."], ["fe1", `Fixed effects: ${pw} only`, "Keeps worldwide swings in. Use when a common trend is part of your question."],
        ["between", `Between ${pw === "zone" ? "zones" : "countries"}: long-run averages`, `Asks whether ${pw === "zone" ? "zones" : "countries"} with more of one have more of the other.`], ["pooled", "Pooled regression", "Mixes both kinds of variation. Shown for comparison; lasting differences can bias it."]] };
  }
  if (st.kind === "trend") {
    let places = st.places;
    if (ent && !places.size) { const w = (vm(y).d.places || []).find(p => p[0] === "WLD" || p[0] === "PJM RTO"); if (!w) return { ok: false, head: "Pick a place", text: "Choose up to 8 places to follow over time." }; places = new Set([w[0]]); }
    if (places.size > 8) return { ok: false, head: "Too many places", text: "Pick 8 or fewer so each trend can be read." };
    const data = await assemble([y], { ...scope, places, only: false }), groups = new Map();
    data.rows.forEach(r => (groups.get(r.e) || groups.set(r.e, []).get(r.e)).push(r));
    const series = [...groups.values()].filter(g => g.length >= 8).map(g => ({ label: g[0].label || title(y), rows: g }));
    if (!series.length) return tooFew(data.rows.length, "points over time", 8);
    const s0 = series[0], t = s0.rows.map(r => r.t), v = s0.rows.map(r => r.v[0]), n = v.length, fit = Stats.ols(v, [t.map(q => q - t[0])]), sk = Math.abs(Stats.skewness(fit.resid)), out = Math.max(...Array.from(fit.resid, e => Math.abs(e))) / fit.sigma;
    const pos = Math.min(...v) > 0, r2log = pos ? Stats.ols(v.map(Math.log), [t.map(q => q - t[0])]).r2 : 0, growth = pos && r2log > fit.r2 + 0.05 && Math.max(...v) / Math.min(...v) > 3;
    const sen = n < 30 || sk > 1 || out > 3.5;
    return { ok: true, kind: "trend", data, ids: [y], F, series, structure: "trend", logs: {}, rec: growth ? "growth" : sen ? "sen" : "ols", facts: [`${series.length === 1 ? n + " points" : series.length + " places"}`, span(data.rows), data.yearly ? "yearly values" : "every observation"],
      why: growth ? [`${title(y)} grows faster the larger it gets: a constant percentage rate fits it better than a straight line (it explains ${Math.round(r2log * 100)}% of the movement against ${Math.round(fit.r2 * 100)}%).`, "So the trend is measured as a growth rate, in percent a year.", "Errors allow for neighbouring years resembling each other (Newey-West)."]
        : sen ? [n < 30 ? `There are only ${n} points, so one unusual year could tilt a fitted line.` : "A few years sit far from the general path, and they could tilt a fitted line.", "Sen's slope takes the median of the slopes between every pair of years, so no single year can dominate. The Mann-Kendall test then asks whether rises outnumber falls by more than chance would allow.", "The straight-line fit is shown alongside as a cross-check."]
          : [`${n} points give enough to fit a straight line, which summarises the average change per year.`, "Errors allow for neighbouring years resembling each other (Newey-West), so the confidence range is not too narrow.", "Sen's slope is shown alongside as a cross-check that no single year drives the result."],
      methods: [["ols", "Straight-line trend, Newey-West errors", "The average change per year."], ["sen", "Sen's slope with the Mann-Kendall test", "Median-based. Not thrown by unusual years."], ...(pos ? [["growth", "Growth rate, percent a year", "For things that grow by a percentage, such as economies or new technologies."]] : [])] };
  }
  /* difference between groups */
  const by = st.groupby;
  if (!ent) return { ok: false, head: "Group comparisons need places", text: "This variable is a single series over time. Use a trend or a relationship instead." };
  if (by === "periods") {
    const [a0, a1] = st.pa.map(Number), [b0, b1] = st.pb.map(Number);
    if (!(a0 && a1 && b0 && b1)) return { ok: false, head: "Set the two periods", text: "Enter the years for the earlier and the later period." };
    const data = await assemble([y], { ...scope, from: Math.min(a0, b0), to: Math.max(a1, b1) }), m = new Map();
    data.rows.forEach(r => { const g = r.t >= a0 && r.t <= a1 ? 0 : r.t >= b0 && r.t <= b1 ? 1 : -1; if (g < 0) return; let e = m.get(r.e); if (!e) m.set(r.e, e = { label: r.label, s: [0, 0], n: [0, 0] }); e.s[g] += r.v[0]; e.n[g]++; });
    const pairs = [...m.values()].filter(e => e.n[0] && e.n[1]).map(e => ({ label: e.label, a: e.s[0] / e.n[0], b: e.s[1] / e.n[1] })), n = pairs.length;
    if (n < 6) return tooFew(n, "places with data in both periods", 6);
    const sk = Math.abs(Stats.skewness(pairs.map(p => p.b - p.a))), t = n >= 30 || sk < 1;
    return { ok: true, kind: "diff", data, ids: [y], F, structure: "paired", pairs, names: [`${a0} to ${a1}`, `${b0} to ${b1}`], logs: {}, rec: t ? "pairedT" : "wilcoxon", facts: [`${n} ${pw === "zone" ? "zones" : "countries"}`, "each compared with itself"],
      why: [`Each ${pw} appears in both periods, so it is compared with itself: its average for ${b0} to ${b1} minus its average for ${a0} to ${a1}. That removes lasting differences between ${pw === "zone" ? "zones" : "countries"}.`,
        t ? `With ${n} ${pw === "zone" ? "zones" : "countries"} and changes that are roughly symmetric, the paired t-test on the average change is appropriate.` : "The changes are skewed, so the Wilcoxon signed-rank test, which works on their ranks, is safer."],
      methods: [["pairedT", "Paired t-test", "Tests the average change."], ["wilcoxon", "Wilcoxon signed-rank test", "Rank-based. Safer when a few places changed far more than the rest."]] };
  }
  const data = await assemble([y], by === "sets" ? { ...scope, places: new Set([...st.a, ...st.b]), only: false } : scope), m = new Map();
  data.rows.forEach(r => { let e = m.get(r.e); if (!e) m.set(r.e, e = { code: r.e, label: r.label, s: 0, n: 0 }); e.s += r.v[0]; e.n++; });
  const units = [...m.values()].map(e => ({ code: e.code, label: e.label, v: e.s / e.n })), G = new Map();
  const put = (g, u) => (G.get(g) || G.set(g, []).get(g)).push(u);
  if (by === "sets") { if (!st.a.size || !st.b.size) return { ok: false, head: "Fill both groups", text: "Add places to group A and group B. Each place counts once." }; units.forEach(u => { if (st.a.has(u.code)) put("Group A", u); else if (st.b.has(u.code)) put("Group B", u); }); }
  else { if (!C) return { ok: false, head: "Country groups are not loaded yet", text: "Income groups and regions arrive with the next data refresh. Compare two sets of places or two periods for now." }; units.forEach(u => { const g = C[u.code] && C[u.code][by]; if (g) put(g, u); }); }
  const groups = [...G].filter(([, u]) => u.length >= 3).map(([name, u]) => ({ name, units: u, v: u.map(q => q.v) }));
  if (by === "income") { const order = ["Low income", "Lower middle income", "Upper middle income", "High income"]; groups.sort((a, b) => order.indexOf(a.name) - order.indexOf(b.name)); } else groups.sort((a, b) => Stats.median(b.v) - Stats.median(a.v));
  if (groups.length < 2) return tooFew(units.length, "places in at least two groups of 3 or more", 6);
  const sk = Math.max(...groups.map(g => Math.abs(Stats.skewness(g.v)))), small = Math.min(...groups.map(g => g.v.length)), sds = groups.map(g => Stats.sd(g.v)), spread = Math.max(...sds) / Math.max(1e-12, Math.min(...sds));
  const avg = `Each ${pw} counts once: its average for ${span(data.rows)}.`, two = groups.length === 2, mean = two ? (small >= 30 || (sk < 1 && small >= 8)) : (sk < 1 && spread < 3 && small >= 8);
  return { ok: true, kind: "diff", data, ids: [y], F, structure: two ? "two" : "many", groups, logs: {}, rec: two ? (mean ? "welch" : "mw") : (mean ? "anova" : "kw"), facts: [`${groups.reduce((s, g) => s + g.v.length, 0)} ${pw === "zone" ? "zones" : "countries"}`, `${groups.length} groups`, span(data.rows)],
    why: [avg, two ? (mean ? "The groups are large enough or roughly symmetric, so their means are compared with Welch's t-test, which does not assume the two groups have the same spread." : `The values are skewed or a group is small (the smallest has ${small}), so the Mann-Whitney test compares ranks instead of means.`)
      : (mean ? "The groups are roughly symmetric with similar spread, so one-way analysis of variance compares their means in a single test." : `The groups are skewed or differ a lot in spread (the widest is ${num(spread, 2)} times the narrowest), so the Kruskal-Wallis test compares their ranks in a single test.`),
      ...(two ? [] : ["One test for all groups avoids the false alarms that come from testing every pair separately."])],
    methods: two ? [["welch", "Welch's t-test", "Compares the two means. Does not need equal spread."], ["mw", "Mann-Whitney test", "Rank-based. Safer with skewed values or small groups."]]
      : [["anova", "One-way analysis of variance", "Compares all the means at once."], ["kw", "Kruskal-Wallis test", "Rank-based version. Safer with skewed values or unequal spread."]] };
}
const tooFew = (n, what, need) => ({ ok: false, head: "Not enough data for a test", text: `This selection leaves ${n} ${what}; a meaningful test needs at least ${need}. Widen the years or the places, or pick variables with better coverage.` });

/* ---------- step 2: run the chosen method ---------- */
function run(pl, method, logY, logX) {
  const rows = pl.data.rows, pw = placeWord(pl.F), y = pl.ids[0], Yt = title(y), checks = [], caveats = [];
  const note = (ok, text) => checks.push({ ok, text });
  if (pl.data.dropped) note(true, `${pl.data.dropped.toLocaleString()} rows were left out because a value was missing for at least one variable.`);
  if (pl.kind === "rel") {
    const x = pl.ids[1], Xt = title(x), k = pl.ids.length, ctl = pl.ids.slice(2), ty = v => (logY ? Math.log(v) : v), tx = v => (logX ? Math.log(v) : v);
    const names = [Xt, ...ctl.map(title)], lab = r => (r.label ? `${r.label}, ${when(r)}` : when(r));
    const yName = (logY ? "log of " : "") + low(Yt), xName = (logX ? "log of " : "") + low(Xt);
    let fit = null, pts, line = null, axes, lead, sp = null, n = rows.length;
    const cols = rs => [rs.map(r => tx(r.v[1])), ...ctl.map((_, j) => rs.map(r => r.v[j + 2]))];
    const partial = (yy, xx, cc, icpt) => (cc.length ? [Stats.ols(yy, cc, { intercept: icpt }).resid, Stats.ols(xx, cc, { intercept: icpt }).resid] : [yy, xx]);
    if (method === "rank") {
      sp = Stats.spearman(rows.map(r => r.v[1]), rows.map(r => r.v[0]));
      pts = rows.map(r => ({ x: r.v[1], y: r.v[0], l: lab(r) })); axes = { x: Xt, y: Yt, ux: unit(x), uy: unit(y), logX: pl.logs.x.suggest, logY: pl.logs.y.suggest };
      lead = `${cap(scopeText(pl))}, ${low(Yt)} and ${low(Xt)} ${sp.p < 0.05 ? (sp.rho > 0 ? "rise together" : "move in opposite directions") : "show no clear ordering"}: the rank correlation is ${strength(sp.rho)} (Spearman ρ = ${sp.rho.toFixed(2)}, ${pv(sp.p)}, ${n} observations). ${chance(sp.p)}.`;
      if (ctl.length) note(false, "A rank correlation cannot hold other variables constant, so the controls were not used.");
    } else if (method === "fe2" || method === "fe1") {
      const e = rows.map(r => r.e), t = rows.map(r => r.t);
      fit = Stats.fixedEffects(rows.map(r => ty(r.v[0])), cols(rows), e, method === "fe2" ? t : null, { names });
      const [py, px] = partial(fit.within.y, fit.within.X[0], fit.within.X.slice(1), false);
      pts = rows.map((r, i) => ({ x: px[i], y: py[i], l: lab(r) })); line = { a: 0, b: fit.coef[0].b };
      axes = { x: `${cap(xName)}: gap from the ${pw}'s own average`, y: `${cap(yName)}: gap from the ${pw}'s own average`, ux: "", uy: "" };
      lead = `Within the same ${pw} over time, ${slopeText(fit.coef[0], logY, logX, y, x)}.`;
      note(fit.entities >= 30, `${fit.entities} ${pw === "zone" ? "zones" : "countries"} form the clusters${fit.entities >= 30 ? "." : "; with fewer than 30 the confidence range can be too narrow."}`);
      caveats.push(`Fixed effects use only change within each ${pw}. They say nothing about why ${pw === "zone" ? "zones" : "countries"} differ from one another in the first place.`);
    } else if (method === "between") {
      const g = new Map(); rows.forEach(r => { let q = g.get(r.e); if (!q) g.set(r.e, q = { label: r.label, s: new Float64Array(k), n: 0 }); r.v.forEach((v, j) => q.s[j] += v); q.n++; });
      const mean = [...g.values()].map(q => ({ label: q.label, t: "", v: Float64Array.from(q.s, s => s / q.n) })); n = mean.length;
      fit = Stats.ols(mean.map(r => ty(r.v[0])), cols(mean), { cov: "HC1", names });
      ({ pts, line, axes } = scatterOf(mean, fit, r => `${r.label}, average`));
      lead = `Comparing ${n} ${pw === "zone" ? "zones" : "countries"} by their long-run averages, ${slopeText(fit.coef[1], logY, logX, y, x)}.`;
    } else if (method === "diff") {
      const d = (f) => rows.slice(1).map((r, i) => f(r) - f(rows[i]));
      fit = Stats.ols(d(r => ty(r.v[0])), [d(r => tx(r.v[1])), ...ctl.map((_, j) => d(r => r.v[j + 2]))], { cov: "HAC", names }); n = rows.length - 1;
      const [py, px] = partial(d(r => ty(r.v[0])), d(r => tx(r.v[1])), ctl.map((_, j) => d(r => r.v[j + 2])), true);
      pts = rows.slice(1).map((r, i) => ({ x: px[i], y: py[i], l: when(r) })); line = { a: ctl.length ? 0 : fit.coef[0].b, b: fit.coef[1].b };
      axes = { x: `Change in ${xName} from the period before`, y: `Change in ${yName}`, ux: "", uy: "" };
      lead = `From one period to the next, ${slopeText(fit.coef[1], logY, logX, y, x, true)}.`;
    } else {                                                    // ols, pooled, levels
      fit = Stats.ols(rows.map(r => ty(r.v[0])), cols(rows), method === "pooled" ? { cov: "cluster", groups: rows.map(r => r.e), names } : { cov: method === "levels" ? "HAC" : "HC1", names });
      ({ pts, line, axes } = scatterOf(rows, fit, lab));
      lead = `${cap(scopeText(pl))}, ${slopeText(fit.coef[1], logY, logX, y, x)}.`;
      if (method === "pooled") note(false, `Pooling treats a ${pw} that is always high on both as evidence. Fixed effects remove that.`);
      if (method === "levels") note(false, "Both series are in levels. If they share a trend, the relationship can look far stronger than it is; the regression on changes guards against that.");
    }
    function scatterOf(rs, f, label) {
      if (ctl.length) { const [py, px] = partial(rs.map(r => ty(r.v[0])), rs.map(r => tx(r.v[1])), ctl.map((_, j) => rs.map(r => r.v[j + 2])), true); return { pts: rs.map((r, i) => ({ x: px[i], y: py[i], l: label(r) })), line: { a: 0, b: f.coef[1].b }, axes: { x: `${cap(xName)}, after removing what the controls explain`, y: `${cap(yName)}, after removing what the controls explain`, ux: "", uy: "" } }; }
      return { pts: rs.map(r => ({ x: r.v[1], y: r.v[0], l: label(r) })), line: { a: f.coef[0].b, b: f.coef[1].b, tx, ty, inv: logY ? Math.exp : v => v }, axes: { x: Xt, y: Yt, ux: unit(x), uy: unit(y), logX, logY } };
    }
    let table = null, fig2 = null;
    if (fit) {
      const c = fit.coef.find(q => q.name === Xt), within = method.startsWith("fe");
      lead += ` ${chance(c.p)} (${pv(c.p)}). ${cap(xName)} ${ctl.length ? "and the controls account for" : "accounts for"} ${fit.r2 < 0.005 ? "under 1%" : Math.round(fit.r2 * 100) + "%"} of the ${within ? `movement in ${low(Yt)} within ${pw === "zone" ? "zones" : "countries"}` : method === "diff" ? "period-to-period changes" : `differences in ${low(Yt)}`}.`;
      table = { head: ["", "Estimate", "Standard error", "95% range", "p"], rows: fit.coef.map(q => [q.name === "(Intercept)" ? "Baseline (intercept)" : (q.name === Xt ? xName : low(q.name)), num(q.b, 4), num(q.se, 3), `${num(q.lo, 4)} to ${num(q.hi, 4)}`, pv(q.p).replace("p ", "").replace("= ", "")]), foot: `Outcome: ${yName}. ${n.toLocaleString()} observations. R² = ${fit.r2.toFixed(3)}${within ? " (within)" : ""}. ${{ HC1: "Robust (HC1) standard errors", cluster: `Standard errors clustered by ${pw}`, HAC: "Newey-West standard errors" }[fit.cov]}.` };
      const jb = Stats.jarqueBera(fit.resid);
      note(jb.p >= 0.05, jb.p >= 0.05 ? "Leftover errors look roughly bell-shaped (Jarque-Bera " + pv(jb.p) + ")." : `Leftover errors are not bell-shaped (Jarque-Bera ${pv(jb.p)}). With ${n.toLocaleString()} observations and robust errors the estimate stands, but treat the exact p-value as approximate.`);
      if (fit.cov === "HC1" && !ctl.length) { const bp = Stats.breuschPagan(fit.resid, [Array.from(fit.fitted)]); note(true, bp.p < 0.05 ? `The spread of the errors changes along the line (Breusch-Pagan ${pv(bp.p)}). Robust errors already allow for that.` : `The spread of the errors is even along the line (Breusch-Pagan ${pv(bp.p)}).`); }
      if (fit.cov === "HAC") { const dw = Stats.durbinWatson(fit.resid); note(dw > 1.5 && dw < 2.5, `Durbin-Watson is ${dw.toFixed(2)} (2 means neighbouring errors are unrelated). ${dw > 1.5 && dw < 2.5 ? "Little is left over." : "Neighbouring errors still resemble each other; Newey-West errors allow for it, but the confidence range is less certain."}`); }
      const z = Array.from(fit.resid, (e, i) => [Math.abs(e) / fit.sigma, i]).sort((a, b) => b[0] - a[0]).filter(q => q[0] > 3.5).slice(0, 3);
      if (z.length) note(false, `Furthest from the line: ${z.map(q => pts[q[1]].l).join("; ")}. Check that these are not driving the result.`);
      if (logX || logY) note(true, `Log scale used for ${[logY && low(Yt), logX && low(Xt)].filter(Boolean).join(" and ")}.`);
      fig2 = { pts: Array.from(fit.fitted, (f, i) => ({ x: f, y: fit.resid[i], l: pts[i].l })), line: { a: 0, b: 0 }, axes: { x: "Value the model predicts", y: "Error: actual minus predicted", ux: "", uy: "" }, cap: "A healthy fit shows a shapeless cloud around the line. A curve or a funnel means the straight line misses something." };
    }
    caveats.push("A relationship in observed data is not proof that one thing causes the other. Something else may drive both, or the cause may run the other way.",
      ctl.length ? "Holding variables constant only removes the influences you named. Unmeasured ones remain." : "Nothing else was held constant here. Add controls to see whether the relationship survives.",
      "Figures for different countries are not always measured the same way or with the same accuracy.");
    return { kind: "rel", lead, table, checks, caveats, figs: [{ pts, line, axes, cap: line ? "Each dot is one observation. The line is the fitted relationship." : "Each dot is one observation." }, fig2].filter(Boolean), rows, n };
  }
  if (pl.kind === "trend") {
    const out = pl.series.map(s => {
      const t = s.rows.map(r => r.t), v = s.rows.map(r => r.v[0]), t0 = t[0], tt = t.map(q => q - t0), lin = Stats.ols(v, [tt], { cov: "HAC" }), mk = Stats.mannKendall(v), sen = Stats.senSlope(t, v), o = { label: s.label, n: v.length, span: span(s.rows), t, v, lin, mk, sen };
      if (method === "growth") { const g = Stats.ols(v.map(Math.log), [tt], { cov: "HAC" }), c = g.coef[1], pc = b => 100 * (Math.exp(b) - 1); Object.assign(o, { est: pc(c.b), lo: pc(c.lo), hi: pc(c.hi), p: c.p, fitY: q => Math.exp(g.coef[0].b + c.b * (q - t0)), dw: Stats.durbinWatson(g.resid) }); }
      else if (method === "sen") Object.assign(o, { est: sen.slope, lo: sen.lo, hi: sen.hi, p: mk.p, fitY: q => sen.intercept + sen.slope * q, dw: Stats.durbinWatson(lin.resid) });
      else { const c = lin.coef[1]; Object.assign(o, { est: c.b, lo: c.lo, hi: c.hi, p: c.p, fitY: q => lin.coef[0].b + c.b * (q - t0), dw: Stats.durbinWatson(lin.resid) }); }
      return o;
    });
    const u = method === "growth" ? "% a year" : `${unit(y) || "units"} a year`, s = out[0], dir = s.est > 0 ? "risen" : "fallen", per = method === "growth" ? `${num(Math.abs(s.est), 3)}% a year` : `${num(Math.abs(s.est), 3)} ${unit(y) || "units"} a year`;
    let lead = `${s.label === Yt ? Yt : `${Yt} in ${s.label}`} has ${s.p < 0.05 ? dir : "shown no clear trend"}${s.p < 0.05 ? ` by about ${per}` : ""} over ${s.span} (95% range ${num(s.lo, 3)} to ${num(s.hi, 3)}${method === "growth" ? "%" : ""}). ${chance(s.p)} (${pv(s.p)}, ${s.n} points).`;
    if (out.length === 1) lead += method === "sen" ? ` Cross-check: a straight-line fit gives ${num(s.lin.coef[1].b, 3)} a year (${pv(s.lin.coef[1].p)}).` : method === "ols" ? ` Cross-check: Sen's slope gives ${num(s.sen.slope, 3)} a year (Mann-Kendall ${pv(s.mk.p)}).` : "";
    const total = s.fitY(s.t[s.t.length - 1]) - s.fitY(s.t[0]); if (out.length === 1 && s.p < 0.05) lead += ` Over the whole period that adds up to about ${num(Math.abs(total), 3)} ${unit(y) || "units"}.`;
    note(s.n >= 30, `${s.n} points over time${s.n >= 30 ? "." : "; with fewer than 30, ranges are wide."}`);
    note(s.dw > 1.2, `Durbin-Watson is ${s.dw.toFixed(2)} (2 means each year's departure from the trend is unrelated to the last). ${s.dw > 1.2 ? "" : "Years cluster above and below the line, so the trend may bend; the ranges here allow for it, but a single straight line is a simplification."}`);
    if (method === "sen") note(true, "Sen's slope is the median of all pairwise slopes; its p-value comes from the Mann-Kendall test, which assumes years are independent.");
    caveats.push("A trend describes the past. It is not a forecast, and it says nothing about what caused the change.", "The start and end years matter: a different window can give a different slope.", "One straight line (or one growth rate) cannot show a change of direction part-way through. Look at the chart.");
    return { kind: "trend", lead, checks, caveats, lines: out, unitText: u, method, n: s.n,
      table: { head: [pl.data.ent ? "Place" : "Series", "Points", "Period", `Change, ${u}`, "95% range", "p"], rows: out.map(o => [o.label, o.n, o.span, num(o.est, 4), `${num(o.lo, 4)} to ${num(o.hi, 4)}`, pv(o.p).replace("p ", "").replace("= ", "")]), foot: { ols: "Straight-line fit with Newey-West standard errors.", sen: "Sen's slope; p from the Mann-Kendall test.", growth: "Fit on the log scale, converted to percent a year; Newey-West standard errors." }[method] } };
  }
  /* differences */
  const uy = unit(y) || "units";
  if (pl.structure === "paired") {
    const d = pl.pairs.map(p => p.b - p.a), t = Stats.pairedT(d), w = Stats.wilcoxon(d), p = method === "pairedT" ? t.p : w.p, up = d.filter(q => q > 0).length;
    note(d.length >= 30, `${d.length} ${pw === "zone" ? "zones" : "countries"} with data in both periods.`);
    note(Math.abs(Stats.skewness(d)) < 1, Math.abs(Stats.skewness(d)) < 1 ? "The changes are roughly symmetric." : "The changes are skewed: a few places moved far more than the rest, so the rank-based test is the safer reading.");
    caveats.push("Comparing two periods shows that something changed, not what changed it.", `Only ${pw === "zone" ? "zones" : "countries"} with data in both periods are included, which may not be a typical set.`);
    return { kind: "diff", checks, caveats, n: d.length, groups: [{ name: pl.names[0], v: pl.pairs.map(q => q.a), units: pl.pairs.map(q => ({ label: q.label, v: q.a })) }, { name: pl.names[1], v: pl.pairs.map(q => q.b), units: pl.pairs.map(q => ({ label: q.label, v: q.b })) }],
      lead: `${Yt} ${p < 0.05 ? (t.diff > 0 ? "rose" : "fell") : "did not clearly change"} between ${pl.names[0]} and ${pl.names[1]}: the average ${pw} changed by ${num(t.diff, 3)} ${uy} (95% range ${num(t.lo, 3)} to ${num(t.hi, 3)}), and ${up} of ${d.length} went up. ${chance(p)} (${method === "pairedT" ? "paired t-test" : "Wilcoxon signed-rank"}, ${pv(p)}).`,
      table: { head: ["Test", "Statistic", "p"], rows: [["Paired t-test", `t = ${t.t.toFixed(2)}, ${t.df} degrees of freedom`, pv(t.p).replace("p ", "").replace("= ", "")], ["Wilcoxon signed-rank", `W = ${num(w.w, 4)}`, pv(w.p).replace("p ", "").replace("= ", "")]], foot: `Effect size: the average change is ${num(Math.abs(t.dz), 2)} standard deviations of the changes.` } };
  }
  const gs = pl.groups, desc = { head: ["Group", pw === "zone" ? "Zones" : "Countries", "Mean", "Median", "Standard deviation"], rows: gs.map(g => [g.name, g.v.length, num(Stats.mean(g.v), 4), num(Stats.median(g.v), 4), num(Stats.sd(g.v), 3)]) };
  gs.forEach(g => { if (g.v.length < 8) note(false, `${g.name} has only ${g.v.length} ${pw === "zone" ? "zones" : "countries"}; conclusions about it are fragile.`); });
  caveats.push("Groups differ in many ways at once. A difference between them does not show that the grouping itself is the cause.", `Every ${pw} counts the same here, whatever its size. Results weighted by population can differ.`);
  if (pl.structure === "two") {
    const [A, B] = gs, w = Stats.welch(A.v, B.v), u = Stats.mannWhitney(A.v, B.v), p = method === "welch" ? w.p : u.p;
    note(true, `Chance that a random ${pw} from ${A.name} is higher than one from ${B.name}: ${Math.round(u.superiority * 100)}%.`);
    return { kind: "diff", checks, caveats, groups: gs, n: A.v.length + B.v.length, desc,
      lead: `${Yt} is ${p < 0.05 ? (w.diff > 0 ? "higher" : "lower") : "not clearly different"} in ${A.name} than in ${B.name}: the means are ${num(w.meanA, 3)} and ${num(w.meanB, 3)} ${uy}, a gap of ${num(Math.abs(w.diff), 3)} (95% range ${num(Math.min(Math.abs(w.lo), Math.abs(w.hi)), 3)} to ${num(Math.max(Math.abs(w.lo), Math.abs(w.hi)), 3)}${w.lo * w.hi < 0 ? ", which includes no gap at all" : ""}). ${chance(p)} (${method === "welch" ? "Welch's t-test" : "Mann-Whitney test"}, ${pv(p)}).`,
      table: { head: ["Test", "Statistic", "p"], rows: [["Welch's t-test", `t = ${w.t.toFixed(2)}, ${w.df.toFixed(1)} degrees of freedom`, pv(w.p).replace("p ", "").replace("= ", "")], ["Mann-Whitney", `U = ${num(u.u, 5)}`, pv(u.p).replace("p ", "").replace("= ", "")]], foot: `Effect size: the gap is ${num(Math.abs(w.hedgesG), 2)} pooled standard deviations (Hedges' g), which is ${Math.abs(w.hedgesG) < 0.2 ? "very small" : Math.abs(w.hedgesG) < 0.5 ? "small" : Math.abs(w.hedgesG) < 0.8 ? "medium" : "large"}.` } };
  }
  const a = Stats.anova(gs.map(g => g.v)), kw = Stats.kruskal(gs.map(g => g.v)), p = method === "anova" ? a.p : kw.p, hi = gs.reduce((q, g) => (Stats.median(g.v) > Stats.median(q.v) ? g : q)), lo = gs.reduce((q, g) => (Stats.median(g.v) < Stats.median(q.v) ? g : q));
  return { kind: "diff", checks, caveats, groups: gs, n: gs.reduce((s, g) => s + g.v.length, 0), desc,
    lead: `${Yt} ${p < 0.05 ? "differs across" : "does not clearly differ across"} the ${gs.length} groups. The typical value is highest in ${hi.name} (median ${num(Stats.median(hi.v), 3)} ${uy}) and lowest in ${lo.name} (median ${num(Stats.median(lo.v), 3)}). ${chance(p)} (${method === "anova" ? "analysis of variance" : "Kruskal-Wallis test"}, ${pv(p)}). The grouping accounts for ${Math.round(a.eta2 * 100)}% of the differences between ${pw === "zone" ? "zones" : "countries"}.`,
    table: { head: ["Test", "Statistic", "p"], rows: [["Analysis of variance", `F = ${a.F.toFixed(2)}, ${a.df1} and ${a.df2} degrees of freedom`, pv(a.p).replace("p ", "").replace("= ", "")], ["Kruskal-Wallis", `H = ${kw.H.toFixed(2)}, ${kw.df} degrees of freedom`, pv(kw.p).replace("p ", "").replace("= ", "")]], foot: "These tests say that at least one group differs. They do not say which pairs differ." } };
}
const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
function scopeText(pl) { const d = pl.data, pw = placeWord(pl.F); return !d.ent ? `over ${span(d.rows)}` : d.times === 1 ? `across ${d.entities} ${pw === "zone" ? "zones" : "countries"} in ${span(d.rows)}` : d.entities === 1 ? `in ${d.rows[0].label} over ${span(d.rows)}` : `across ${d.entities} ${pw === "zone" ? "zones" : "countries"} and ${d.times} years`; }
function slopeText(c, logY, logX, y, x, change) {
  const Y = low(title(y)), X = low(title(x)), uy = unit(y) || "units", ux = unit(x), dir = v => (v > 0 ? "higher" : "lower"), rng = (f, s = "") => `95% range ${num(Math.min(f(c.lo), f(c.hi)), 3)}${s} to ${num(Math.max(f(c.lo), f(c.hi)), 3)}${s}`;
  if (logY && logX) return `${X} that is 1% higher goes with ${Y} that is ${num(Math.abs(c.b), 3)}% ${dir(c.b)} (${rng(v => v, "%")})`;
  if (logX) { const f = v => v * Math.LN2; return `a doubling of ${X} goes with ${Y} that is ${num(Math.abs(f(c.b)), 3)} ${uy} ${dir(c.b)} (${rng(f)})`; }
  if (logY) { const f = v => 100 * (Math.exp(v) - 1); return `each extra ${ux || "unit"} of ${X} goes with ${Y} that is ${num(Math.abs(f(c.b)), 3)}% ${dir(c.b)} (${rng(f, "%")})`; }
  return `each extra ${ux || "unit"} of ${X} goes with ${Y} that is ${num(Math.abs(c.b), 3)} ${uy} ${dir(c.b)} (${rng(v => v)})`;
}

/* ---------- charts ---------- */
const ticksLin = (a, b, n = 5) => { const raw = (b - a) / n, p = Math.pow(10, Math.floor(Math.log10(raw))), f = raw / p, st = (f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10) * p, out = []; for (let v = Math.ceil(a / st) * st; v <= b + st * 1e-9; v += st) out.push(Math.abs(v) < st * 1e-9 ? 0 : v); return out; };
const ticksLog = (a, b) => { const out = []; for (let e = Math.floor(Math.log10(a)); e <= Math.ceil(Math.log10(b)); e++) for (const m of (Math.log10(b / a) < 2.2 ? [1, 2, 5] : [1])) { const v = m * Math.pow(10, e); if (v >= a * 0.999 && v <= b * 1.001) out.push(v); } return out; };
const short = v => { const a = Math.abs(v); return a >= 1e9 ? +(v / 1e9).toPrecision(3) + "B" : a >= 1e6 ? +(v / 1e6).toPrecision(3) + "M" : a >= 1e4 ? +(v / 1e3).toPrecision(3) + "k" : String(+v.toPrecision(3)); };

function scatter(host, f) {                                    // canvas scatter with fit line; colours follow the theme
  const fig = el("figure", "fig"), cv = el("canvas"), tip = el("div", "tip"), capt = el("figcaption", "", f.cap); tip.hidden = true;
  cv.setAttribute("role", "img"); cv.setAttribute("aria-label", `Scatter plot. Horizontal: ${f.axes.x}. Vertical: ${f.axes.y}. ${f.pts.length} points. The numbers are in the table above.`);
  fig.append(cv, tip, capt); host.append(fig);
  const lx = !!f.axes.logX, ly = !!f.axes.logY, P = f.pts.filter(p => isFinite(p.x) && isFinite(p.y) && (!lx || p.x > 0) && (!ly || p.y > 0));
  let geo = null;
  function draw() {
    const W = fig.clientWidth || 560, H = Math.round(Math.min(440, Math.max(300, W * 0.72))), dpr = Math.min(2, devicePixelRatio || 1), m = { l: 58, r: 14, t: 12, b: 46 };
    cv.width = W * dpr; cv.height = H * dpr; cv.style.height = H + "px"; const g = cv.getContext("2d"); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, W, H);
    const ext = (k, lg) => { let a = Infinity, b = -Infinity; for (const p of P) { if (p[k] < a) a = p[k]; if (p[k] > b) b = p[k]; } if (a === b) { a -= 1; b += 1; } if (lg) return [a / 1.15, b * 1.15]; const pad = (b - a) * 0.05; return [a - pad, b + pad]; };
    const [x0, x1] = ext("x", lx), [y0, y1] = ext("y", ly), fx = v => (lx ? Math.log(v) : v), fy = v => (ly ? Math.log(v) : v);
    const sx = v => m.l + (fx(v) - fx(x0)) / (fx(x1) - fx(x0)) * (W - m.l - m.r), sy = v => H - m.b - (fy(v) - fy(y0)) / (fy(y1) - fy(y0)) * (H - m.t - m.b);
    const ink3 = cssVar("--ink3"), grid = cssVar("--grid"), ink = cssVar("--ink"), ink2 = cssVar("--ink2");
    g.font = `12px ${cssVar("--body") || "sans-serif"}`; g.lineWidth = 1;
    (ly ? ticksLog(y0, y1) : ticksLin(y0, y1)).forEach(v => { g.strokeStyle = !ly && v === 0 ? cssVar("--line2") : grid; g.beginPath(); g.moveTo(m.l, sy(v) + 0.5); g.lineTo(W - m.r, sy(v) + 0.5); g.stroke(); g.fillStyle = ink3; g.textAlign = "right"; g.fillText(short(v), m.l - 8, sy(v) + 4); });
    (lx ? ticksLog(x0, x1) : ticksLin(x0, x1, W < 480 ? 4 : 6)).forEach(v => { g.strokeStyle = !lx && v === 0 ? cssVar("--line2") : grid; g.beginPath(); g.moveTo(sx(v) + 0.5, m.t); g.lineTo(sx(v) + 0.5, H - m.b); g.stroke(); g.fillStyle = ink3; g.textAlign = "center"; g.fillText(short(v), sx(v), H - m.b + 16); });
    g.fillStyle = ink2; g.textAlign = "center"; g.fillText(clip(g, f.axes.x + (f.axes.ux ? `, ${f.axes.ux}` : "") + (lx ? " (log scale)" : ""), W - m.l - m.r), (m.l + W - m.r) / 2, H - 8);
    g.save(); g.translate(13, (m.t + H - m.b) / 2); g.rotate(-Math.PI / 2); g.fillText(clip(g, f.axes.y + (f.axes.uy ? `, ${f.axes.uy}` : "") + (ly ? " (log scale)" : ""), H - m.t - m.b), 0, 0); g.restore();
    g.fillStyle = cssVar("--s1"); g.globalAlpha = P.length > 3000 ? 0.28 : P.length > 600 ? 0.45 : 0.7; const r = P.length > 3000 ? 1.8 : P.length > 600 ? 2.4 : 3.4;
    for (const p of P) { g.beginPath(); g.arc(sx(p.x), sy(p.y), r, 0, 6.2832); g.fill(); }
    g.globalAlpha = 1;
    if (f.line) {
      g.strokeStyle = ink; g.lineWidth = 2; const L = f.line, tx = L.tx || (v => v), inv = L.inv || (v => v); let started = false;
      g.save(); g.beginPath(); g.rect(m.l, m.t, W - m.l - m.r, H - m.t - m.b); g.clip(); g.beginPath();
      for (let i = 0; i <= 60; i++) { const xv = lx ? Math.exp(fx(x0) + (fx(x1) - fx(x0)) * i / 60) : x0 + (x1 - x0) * i / 60, yv = inv(L.a + L.b * tx(xv)); if (ly && yv <= 0) continue; const X = sx(xv), Y = sy(yv); started ? g.lineTo(X, Y) : g.moveTo(X, Y); started = true; }
      g.stroke(); g.restore();
    }
    geo = { sx, sy };
  }
  const clip = (g, s, w) => { if (g.measureText(s).width <= w) return s; while (s.length > 8 && g.measureText(s + "…").width > w) s = s.slice(0, -1); return s + "…"; };
  cv.addEventListener("mousemove", e => {
    if (!geo) return; const rc = cv.getBoundingClientRect(), mx = e.clientX - rc.left, my = e.clientY - rc.top; let best = null, bd = 18 * 18;
    for (const p of P) { const dx = geo.sx(p.x) - mx, dy = geo.sy(p.y) - my, d = dx * dx + dy * dy; if (d < bd) { bd = d; best = p; } }
    if (!best) { tip.hidden = true; return; }
    tip.replaceChildren(el("strong", "", best.l), el("div", "nm", `${f.axes.x.split(":")[0]}: ${num(best.x, 4)}`), el("div", "nm", `${f.axes.y.split(":")[0]}: ${num(best.y, 4)}`));
    tip.hidden = false; tip.style.left = Math.min(rc.width - 220, Math.max(0, mx + 14)) + "px"; tip.style.top = (my + 12) + "px";
  });
  cv.addEventListener("mouseleave", () => { tip.hidden = true; });
  draw(); return draw;
}

function lineChart(host, res) {                                // series with fitted trend; SVG, classes follow the theme
  const fig = el("figure", "fig"); host.append(fig);
  function draw() {
    const W = fig.clientWidth || 800, H = Math.round(Math.min(440, Math.max(300, W * 0.5))), m = { l: 58, r: 16, t: 12, b: 30 }, all = res.lines.flatMap(s => s.t.map((t, i) => [t, s.v[i]]));
    const x0 = Math.min(...all.map(p => p[0])), x1 = Math.max(...all.map(p => p[0])); let y0 = Math.min(0, ...all.map(p => p[1])), y1 = Math.max(...all.map(p => p[1]));
    if (y0 === 0 && Math.min(...all.map(p => p[1])) > y1 * 0.5) y0 = Math.min(...all.map(p => p[1])) - (y1 - Math.min(...all.map(p => p[1]))) * 0.15;   // zoom when the series sits far from zero
    const ty = ticksLin(y0, y1); y0 = Math.min(y0, ty[0]); y1 = Math.max(y1, ty[ty.length - 1]);
    const sx = v => m.l + (v - x0) / (x1 - x0 || 1) * (W - m.l - m.r), sy = v => H - m.b - (v - y0) / (y1 - y0 || 1) * (H - m.t - m.b);
    let g = ty.map(v => `<line x1="${m.l}" x2="${W - m.r}" y1="${sy(v)}" y2="${sy(v)}" class="${v === 0 ? "g-zero" : "g-grid"}"/><text x="${m.l - 8}" y="${sy(v) + 4}" text-anchor="end" class="g-tick">${short(v)}</text>`).join("");
    const st = [1, 2, 5, 10, 20, 25, 50].find(s => (x1 - x0) / s <= (W < 520 ? 5 : 9)) || 50;
    for (let v = Math.ceil(x0 / st) * st; v <= x1 + 1e-9; v += st) g += `<line x1="${sx(v)}" x2="${sx(v)}" y1="${H - m.b}" y2="${H - m.b + 5}" class="g-zero"/><text x="${sx(v)}" y="${H - 8}" text-anchor="middle" class="g-tick">${v}</text>`;
    res.lines.forEach((s, i) => {
      const col = `var(--s${i + 1})`, a = s.t[0], b = s.t[s.t.length - 1];
      g += `<path d="${s.t.map((t, j) => (j ? "L" : "M") + sx(t).toFixed(1) + " " + sy(s.v[j]).toFixed(1)).join("")}" class="g-line" style="stroke:${col}"/>`;
      g += `<path d="${Array.from({ length: 41 }, (_, j) => { const t = a + (b - a) * j / 40; return (j ? "L" : "M") + sx(t).toFixed(1) + " " + sy(s.fitY(t)).toFixed(1); }).join("")}" class="g-fit" ${res.lines.length > 1 ? `style="stroke:${col};opacity:.55"` : ""}/>`;
      g += `<circle cx="${sx(b).toFixed(1)}" cy="${sy(s.v[s.v.length - 1]).toFixed(1)}" r="4.5" class="g-ring" style="fill:${col}"/>`;
    });
    fig.innerHTML = `<svg viewBox="0 0 ${W} ${H}" height="${H}" role="img" aria-label="Line chart of the values over time with the fitted trend. The numbers are in the table above.">${g}<line id="r-rule" y1="${m.t}" y2="${H - m.b}" class="g-rule" visibility="hidden"/></svg>
      <div class="legend chartleg">${res.lines.map((s, i) => `<span><b style="background:var(--s${i + 1})"></b>${esc(s.label)}</span>`).join("")}<span><b style="background:var(--ink)"></b>Fitted trend</span></div><div class="tip" hidden></div>`;
    const svg = $("svg", fig), tip = $(".tip", fig), rule = $("#r-rule", fig);
    svg.onmousemove = e => {
      const rc = svg.getBoundingClientRect(), xv = x0 + ((e.clientX - rc.left) / rc.width * W - m.l) / (W - m.l - m.r) * (x1 - x0); let best = all[0][0]; all.forEach(p => { if (Math.abs(p[0] - xv) < Math.abs(best - xv)) best = p[0]; });
      rule.setAttribute("x1", sx(best)); rule.setAttribute("x2", sx(best)); rule.setAttribute("visibility", "visible");
      tip.innerHTML = `<div class="nm">${Number.isInteger(best) ? best : best.toFixed(2)}</div>` + res.lines.map((s, i) => { const j = s.t.indexOf(best); return j < 0 ? "" : `<div class="row"><span class="key" style="background:var(--s${i + 1})"></span><strong>${num(s.v[j], 4)}</strong> <span class="nm">${esc(s.label)}</span></div>`; }).join("");
      tip.hidden = false; tip.style.left = Math.min(rc.width - 220, Math.max(0, e.clientX - rc.left + 14)) + "px"; tip.style.top = "8px";
    };
    svg.onmouseleave = () => { tip.hidden = true; rule.setAttribute("visibility", "hidden"); };
  }
  draw(); return draw;
}

function strip(host, res, unitText) {                          // one row per group: every place as a dot, box for the middle half, bar at the median
  const fig = el("figure", "fig"); host.append(fig);
  function draw() {
    const gs = res.groups, W = fig.clientWidth || 800, rowH = 54, m = { l: Math.min(230, Math.max(110, W * 0.26)), r: 18, t: 8, b: 34 }, H = m.t + m.b + rowH * gs.length, all = gs.flatMap(g => g.v);
    let x0 = Math.min(...all), x1 = Math.max(...all); const pad = (x1 - x0) * 0.04 || 1; x0 -= pad; x1 += pad;
    const sx = v => m.l + (v - x0) / (x1 - x0) * (W - m.l - m.r);
    let g = ticksLin(x0, x1, W < 520 ? 4 : 7).map(v => `<line x1="${sx(v)}" x2="${sx(v)}" y1="${m.t}" y2="${H - m.b}" class="${v === 0 ? "g-zero" : "g-grid"}"/><text x="${sx(v)}" y="${H - m.b + 16}" text-anchor="middle" class="g-tick">${short(v)}</text>`).join("");
    g += `<text x="${(m.l + W - m.r) / 2}" y="${H - 4}" text-anchor="middle" class="g-name">${esc(unitText)}</text>`;
    gs.forEach((gr, i) => {
      const cy = m.t + rowH * (i + 0.5), q1 = Stats.quantile(gr.v, 0.25), q3 = Stats.quantile(gr.v, 0.75), md = Stats.median(gr.v), name = gr.name.length > 30 ? gr.name.slice(0, 29) + "…" : gr.name;
      g += `<text x="${m.l - 12}" y="${cy - 2}" text-anchor="end" class="g-val" style="font-size:13.5px">${esc(name)}</text><text x="${m.l - 12}" y="${cy + 14}" text-anchor="end" class="g-name">${gr.v.length} places, median ${num(md, 3)}</text>`;
      gr.units.forEach((u, j) => { const jit = ((j * 9301 + 49297) % 233280) / 233280 - 0.5; g += `<circle cx="${sx(u.v).toFixed(1)}" cy="${(cy + jit * 26).toFixed(1)}" r="3.2" style="fill:var(--s1)" fill-opacity=".55" data-l="${esc(u.label)}" data-v="${u.v}"/>`; });
      g += `<rect x="${sx(q1)}" y="${cy - 17}" width="${Math.max(1, sx(q3) - sx(q1))}" height="34" class="g-box"/><line x1="${sx(md)}" x2="${sx(md)}" y1="${cy - 20}" y2="${cy + 20}" class="g-med"/>`;
    });
    fig.innerHTML = `<svg viewBox="0 0 ${W} ${H}" height="${H}" role="img" aria-label="Dot plot of each place by group, with the middle half boxed and the median marked. The numbers are in the table above.">${g}</svg><figcaption>Each dot is one place. The box holds the middle half of each group and the thick bar marks its median.</figcaption><div class="tip" hidden></div>`;
    const tip = $(".tip", fig), svg = $("svg", fig);
    svg.onmousemove = e => { const c = e.target.closest("circle"); if (!c) { tip.hidden = true; return; } const rc = fig.getBoundingClientRect(); tip.replaceChildren(el("strong", "", c.dataset.l), el("div", "nm", `${num(+c.dataset.v, 4)} ${unitText.split(",")[1] || ""}`)); tip.hidden = false; tip.style.left = Math.min(rc.width - 220, Math.max(0, e.clientX - rc.left + 14)) + "px"; tip.style.top = (e.clientY - rc.top + 12) + "px"; };
    svg.onmouseleave = () => { tip.hidden = true; };
  }
  draw(); return draw;
}

/* ---------- rendering ---------- */
let redraws = [];
function tableHTML(t) { return `<div class="tablewrap"><table><thead><tr>${t.head.map((h, i) => `<th class="${i && t.rows[0] && /^[-–+\d<.]/.test(String(t.rows[0][i])) ? "num" : ""}">${esc(h)}</th>`).join("")}</tr></thead><tbody>${t.rows.map(r => `<tr>${r.map((c, i) => `<td class="${i && /^[-–+\d<.]/.test(String(c)) ? "num" : ""}">${esc(c)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>${t.foot ? `<p class="cap">${esc(t.foot)}</p>` : ""}`; }

function renderPlan() {
  const box = $("#rec"); box.classList.toggle("blocked", !plan.ok);
  if (!plan.ok) { box.innerHTML = `<h2>${esc(plan.head)}</h2><p class="hint">${esc(plan.text)}</p>`; return; }
  if (!plan.methods.some(m => m[0] === st.method)) st.method = plan.rec;
  const recd = plan.methods.find(m => m[0] === plan.rec), L = plan.logs, logOn = k => (st[k === "y" ? "logY" : "logX"] ?? L[k].suggest);
  box.innerHTML = `<span class="up" style="color:var(--accent-text)">Recommended</span><h2>${esc(recd[1])}</h2>
    <ul class="why">${plan.why.map(w => `<li>${esc(w)}</li>`).join("")}</ul>
    <div class="facts2">${plan.facts.map(f => `<span>${esc(f)}</span>`).join("")}</div>
    <div class="alts" role="radiogroup" aria-label="Method">${plan.methods.map(m => `<label><input type="radio" name="method" value="${m[0]}" ${m[0] === st.method ? "checked" : ""}><span><b>${esc(m[1])}</b>${m[0] === plan.rec ? " (recommended)" : ""}. ${esc(m[2])}</span></label>`).join("")}</div>
    ${plan.kind === "rel" ? `<div class="alts">${["y", "x"].map(k => (L[k].can ? `<label><input type="checkbox" data-log="${k}" ${logOn(k) ? "checked" : ""}><span><b>Log scale for ${esc(low(title(plan.ids[k === "y" ? 0 : 1])))}</b>${L[k].suggest ? " (recommended)" : ""}. Reads the result in percentage terms.</span></label>` : "")).join("")}</div>` : ""}
    <div class="run"><button type="button" class="btn solid" id="run">Run the analysis</button><span class="hint" style="margin:0">Everything is computed in your browser. Nothing is uploaded.</span></div>`;
  box.onchange = e => { if (e.target.name === "method") st.method = e.target.value; else if (e.target.dataset.log) st[e.target.dataset.log === "y" ? "logY" : "logX"] = e.target.checked; saveHash(); };
  $("#run").onclick = () => doRun(true);
}

function doRun(scroll) {
  if (!plan || !plan.ok) return;
  const L = plan.logs, logY = !!(plan.kind === "rel" && L.y.can && (st.logY ?? L.y.suggest)), logX = !!(plan.kind === "rel" && L.x.can && (st.logX ?? L.x.suggest));
  const out = $("#out"); out.hidden = false; redraws = [];
  try { result = run(plan, st.method, logY, logX); } catch (e) { out.innerHTML = `<h2>The analysis could not run</h2><p class="note">${esc(e.message)}</p>`; return; }
  const r = result, mt = plan.methods.find(m => m[0] === st.method)[1];
  out.innerHTML = `<span class="up" style="color:var(--accent-text)">Result, ${esc(low(mt))}</span><p class="headline">${esc(r.lead)}</p>
    ${r.desc ? `<h3>The groups</h3>${tableHTML(r.desc)}` : ""}${r.table ? `<h3>The numbers</h3>${tableHTML(r.table)}` : ""}
    <h3>The picture</h3><div class="${r.figs && r.figs.length > 1 ? "two-up" : ""}" id="figs"></div>
    <h3>Checks</h3><ul class="checks">${r.checks.map(c => `<li class="${c.ok ? "c-ok" : "c-note"}"><b>${c.ok ? "Fine" : "Note"}</b><span>${esc(c.text)}</span></li>`).join("") || `<li class="c-ok"><b>Fine</b><span>Nothing unusual to report.</span></li>`}</ul>
    <h3>What this does not show</h3><ul class="caveats">${r.caveats.map(c => `<li>${esc(c)}</li>`).join("")}</ul>
    <div class="acts"><button type="button" class="btn get" id="get">Download the data used</button><button type="button" class="link" id="copy">Copy the result</button><button type="button" class="link" id="share">Copy link to this analysis</button></div>`;
  const figs = $("#figs");
  if (r.kind === "rel") r.figs.forEach(f => redraws.push(scatter(figs, f)));
  else if (r.kind === "trend") redraws.push(lineChart(figs, r));
  else redraws.push(strip(figs, r, `${title(plan.ids[0])}${unit(plan.ids[0]) ? ", " + unit(plan.ids[0]) : ""}`));
  $("#get").onclick = () => { const ids = plan.ids, head = [plan.data.ent ? "code" : null, plan.data.ent ? "place" : null, "time", ...ids.map(i => vm(i).c.name)].filter(Boolean), q = v => (/[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : v);
    const body = plan.data.rows.map(x => [...(plan.data.ent ? [x.e, x.label] : []), when(x), ...x.v].map(q).join(",")).join("\n"), a = el("a"); a.href = URL.createObjectURL(new Blob([head.join(",") + "\n" + body + "\n"], { type: "text/csv" })); a.download = `analysis-data_${new Date().toISOString().slice(0, 10)}.csv`; document.body.append(a); a.click(); a.remove(); };
  const say = async (btn, text, done) => { const old = btn.textContent; try { await navigator.clipboard.writeText(text); btn.textContent = done; } catch { btn.textContent = "Copying is blocked here"; } setTimeout(() => { btn.textContent = old; }, 1800); };
  $("#copy").onclick = e => say(e.target, [`Method: ${mt}`, r.lead, r.table ? r.table.head.join(" | ") + "\n" + r.table.rows.map(x => x.join(" | ")).join("\n") + (r.table.foot ? "\n" + r.table.foot : "") : "", "Checks:\n" + r.checks.map(c => `- ${c.text}`).join("\n"), "Limits:\n" + r.caveats.map(c => `- ${c}`).join("\n"), location.href].filter(Boolean).join("\n\n"), "Result copied");
  $("#share").onclick = e => { saveHash(true); say(e.target, location.href, "Link copied"); };
  saveHash(true);
  if (scroll) out.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
}

/* ---------- controls ---------- */
function schedule() {
  clearTimeout(timer); const mine = ++ticket;
  timer = setTimeout(async () => {
    const box = $("#rec"); if (one(st.y)) box.innerHTML = `<h2>Looking at the data</h2><p class="hint">Loading and checking the values.</p>`;
    try { const p = await makePlan(); if (mine !== ticket) return; plan = p; } catch (e) { if (mine !== ticket) return; console.error(e); plan = { ok: false, head: "The data did not load", text: "Reload the page to try again." }; }
    renderPlan(); $("#out").hidden = true; saveHash();
    if (pendingRun && plan.ok) { pendingRun = false; doRun(false); }
  }, 160);
}
let pendingRun = false;
const varItems = F => [...V.values()].filter(v => !F || fam(v.d) === F).map(v => ({ value: v.id, label: v.c.title, sub: `${v.c.unit ? v.c.unit + ", " : ""}${v.d.title}`, tip: v.c.description }));
const famOf = () => (one(st.y) ? fam(vm(one(st.y)).d) : null);

function syncControls() {
  const F = famOf(), d = one(st.y) ? vm(one(st.y)).d : null, ent = !!(d && d.entity), k = st.kind;
  $$("#kind button").forEach(b => b.setAttribute("aria-pressed", b.dataset.k === k));
  $("#x-box").hidden = k !== "rel"; $("#c-box").hidden = k !== "rel"; $("#row-groups").hidden = k !== "diff"; $("#n-scope").textContent = k === "diff" ? "4" : "3";
  $("#y-label").textContent = k === "rel" ? "Outcome" : k === "trend" ? "What to follow over time" : "What to compare";
  P.y = picker($("#p-y"), { items: varItems(null), set: st.y, add: "Search variables, for example life expectancy", none: "Nothing picked yet", max: 1, onChange: () => { const f = famOf(); [st.x, st.c].forEach(s => [...s].forEach(v => { if (fam(vm(v).d) !== f) s.delete(v); })); st.places.clear(); st.a.clear(); st.b.clear(); st.from = st.to = ""; st.logY = st.logX = null; syncControls(); schedule(); } });
  P.x = picker($("#p-x"), { items: varItems(F), set: st.x, add: "Search variables", none: "Nothing picked yet", max: 1, onChange: () => { st.logX = null; schedule(); } });
  P.c = picker($("#p-c"), { items: varItems(F), set: st.c, add: "Search variables", none: "No controls", max: 3, clearText: "Clear", onChange: schedule });
  const places = new Map(); M.filter(q => fam(q) === F).forEach(q => (q.places || []).forEach(([c, l]) => { if (!places.has(c)) places.set(c, l); }));
  const items = [...places].map(([value, label]) => ({ value, label, sub: value === label ? "" : value })).sort((a, b) => a.label.localeCompare(b.label));
  $("#place-box").hidden = !ent || (k === "diff" && st.groupby === "sets");
  $("#only-box").hidden = F !== "code+year" || k === "trend";
  if (ent) P.p = picker($("#p-places"), { items, set: st.places, add: k === "trend" ? "Add up to 8 places to follow" : "Limit to certain places (optional)", none: k === "trend" ? "The world, unless you pick places" : `All ${F === "code+year" ? "countries" : "zones"}`, max: k === "trend" ? 8 : 0, clearText: "Clear", onChange: schedule });
  // groups
  const gb = $("#groupby"), opts = [["income", "By income group (World Bank)", F === "code+year" && C], ["region", "By world region (World Bank)", F === "code+year" && C], ["sets", "Two sets of places that I choose", ent], ["periods", "Two periods, same places", ent]].filter(o => o[2]);
  if (!opts.some(o => o[0] === st.groupby)) st.groupby = opts.length ? opts[0][0] : "";
  gb.innerHTML = opts.map(o => `<option value="${o[0]}" ${o[0] === st.groupby ? "selected" : ""}>${o[1]}</option>`).join("") || `<option>Pick a variable that has places</option>`;
  $("#sets").hidden = st.groupby !== "sets"; $("#periods").hidden = st.groupby !== "periods";
  $("#group-hint").textContent = F === "code+year" && !C ? "Income groups and regions arrive with the next data refresh." : st.groupby === "periods" ? "Each place is compared with itself: its average in the later period against its average in the earlier one." : "Each place counts once, using its average over the years you set below.";
  if (ent && st.groupby === "sets") { picker($("#p-a"), { items: items.map(i => ({ ...i })), set: st.a, add: "Add places", none: "Empty", clearText: "Clear", onChange: schedule }); picker($("#p-b"), { items: items.map(i => ({ ...i })), set: st.b, add: "Add places", none: "Empty", clearText: "Clear", onChange: schedule }); }
  ["pa", "pb"].forEach(n => ["from", "to"].forEach((s, i) => { const e = $(`#${n}-${s}`); e.value = st[n][i]; e.oninput = () => { st[n][i] = e.value; schedule(); }; }));
  // time
  const yr = !d || d.time.type === "year", lo = d ? day(d.time.min) : "", hi = d ? day(d.time.max) : "";
  ["from", "to"].forEach(s => { const e = $("#t-" + s); e.type = yr ? "number" : "date"; e.min = lo; e.max = hi; e.placeholder = s === "from" ? lo : hi; e.value = st[s]; e.oninput = () => { st[s] = e.value; schedule(); }; });
  $("#yearly-box").hidden = yr; $("#yearly").checked = st.yearly; $("#only").checked = st.only;
  const pre = [["All years", "", ""]]; if (d && yr) { if (+lo < 2000) pre.push(["Since 2000", "2000", ""]); if (+lo < 1990) pre.push(["Since 1990", "1990", ""]); if (ent && k !== "trend") pre.push(["Best recent year", "best", ""]); }
  $("#presets").innerHTML = pre.map(p => `<button type="button" data-f="${p[1]}" data-t="${p[2]}">${p[0]}</button>`).join("");
}
async function bestYear() {                                     // the recent year in which the most places have every chosen variable
  const ids = [one(st.y), ...(st.kind === "rel" ? [one(st.x), ...st.c] : [])].filter(Boolean); if (!ids.length) return;
  const hi = +day(vm(ids[0]).d.time.max), data = await assemble(ids, { places: st.places, only: st.only, from: hi - 8, to: hi, yearly: true }), n = new Map();
  data.rows.forEach(r => n.set(r.t, (n.get(r.t) || 0) + 1)); const top = Math.max(...n.values());
  const y = [...n].filter(([, c]) => c >= top * 0.95).map(([t]) => t).sort((a, b) => b - a)[0]; if (y) { st.from = st.to = String(y); syncControls(); schedule(); }
}

/* ---------- reading a sentence ---------- */
/* CONCEPTS (words -> variable) lives in concepts.js, shared with the Ask page */
function readSentence(text) {
  let s = " " + text.toLowerCase().replace(/[^a-z0-9. ]+/g, " ").replace(/\s+/g, " ") + " "; const say = [];
  let group = ""; if (/rich(er)? and poor(er)?|poor(er)? and rich(er)?|income (group|level)|(high|low).income/.test(s)) { group = "income"; s = s.replace(/rich(er)? and poor(er)?( countries)?|poor(er)? and rich(er)?( countries)?|income (groups?|levels?)|(high|low).income( countries)?/g, " "); }
  else if (/regions?|continents?|parts of the world/.test(s)) { group = "region"; s = s.replace(/(world )?regions?|continents?|parts of the world/g, " "); }
  const found = []; CONCEPTS.forEach(([re, id]) => { if (!V.has(id)) return; const m = re.exec(s); if (m && !found.some(f => f.id === id || (m.index >= f.at && m.index < f.at + f.len))) { found.push({ id, at: m.index, len: m[0].length }); s = s.slice(0, m.index) + " ".repeat(m[0].length) + s.slice(m.index + m[0].length); } });
  found.sort((a, b) => a.at - b.at);
  if (!found.length) return { ok: false, text: "No variable matched that sentence. Pick the variables below; the search boxes take plain words such as income, mortality or solar." };
  const years = (text.match(/\b(1[89]\d\d|20\d\d)\b/g) || []).map(Number), flip = /depend|driven by|explained by|because of|due to|caused by|result of|thanks to/.test(s);
  st.x.clear(); st.c.clear(); st.y.clear(); st.places.clear(); st.a.clear(); st.b.clear(); st.from = st.to = ""; st.logY = st.logX = null; st.method = "";
  if (found.length >= 2 && !group) {
    const [a, b] = found, sameFam = fam(vm(a.id).d) === fam(vm(b.id).d);
    if (sameFam) { st.kind = "rel"; st.y.add(flip ? a.id : b.id); st.x.add(flip ? b.id : a.id); say.push(`a relationship: ${low(title(one(st.x)))} explaining ${low(title(one(st.y)))}`); }
    else { st.kind = "trend"; st.y.add(a.id); say.push(`a trend in ${low(title(a.id))} (the second variable is recorded on a different timetable, so the two cannot be matched)`); }
  } else if (group && vm(found[0].id).d.entity) { st.kind = "diff"; st.groupby = group; st.y.add(found[0].id); say.push(`a difference in ${low(title(found[0].id))} between ${group === "income" ? "income groups" : "world regions"}`); }
  else { st.kind = "trend"; st.y.add(found[0].id); say.push(`a trend in ${low(title(found[0].id))}`); }
  const F = famOf(), yr = vm(one(st.y)).d.time.type === "year";
  if (vm(one(st.y)).d.entity) { const pl = []; M.filter(q => fam(q) === F).forEach(q => (q.places || []).forEach(([c, l]) => { const n = " " + l.toLowerCase().replace(/[^a-z0-9 ]+/g, " ") + " "; if (n.trim().length > 3 && s.includes(n) && !pl.some(p => p[0] === c)) pl.push([c, l]); })); pl.slice(0, 8).forEach(p => st.places.add(p[0])); if (pl.length) say.push(`in ${pl.slice(0, 8).map(p => p[1]).join(", ")}`); }
  if (yr && years.length) { if (years.length >= 2) { st.from = String(Math.min(...years)); st.to = String(Math.max(...years)); say.push(`from ${st.from} to ${st.to}`); } else if (/since|after|from/.test(s)) { st.from = String(years[0]); say.push(`since ${years[0]}`); } else { st.from = st.to = String(years[0]); say.push(`in ${years[0]}`); } }
  else if (st.kind === "rel" && vm(one(st.y)).d.entity && !st.places.size) say.push("across countries");
  return { ok: true, text: `Read as ${say.join(", ")}. Check the choices below and change anything that is off.`, wantsYear: st.kind !== "trend" && yr && !years.length && !!vm(one(st.y)).d.entity && st.kind === "diff" };
}

/* ---------- link state ---------- */
function saveHash(ran) {
  const p = new URLSearchParams({ k: st.kind, y: [...st.y].join(","), x: [...st.x].join(","), c: [...st.c].join(","), p: [...st.places].join(","), o: st.only ? "1" : "0", f: st.from, t: st.to, yr: st.yearly ? "1" : "0", g: st.groupby, a: [...st.a].join(","), b: [...st.b].join(","), pa: st.pa.join("-"), pb: st.pb.join("-"), m: st.method });
  if (st.logY !== null) p.set("ly", st.logY ? "1" : "0"); if (st.logX !== null) p.set("lx", st.logX ? "1" : "0"); if (ran || (result && !$("#out").hidden)) p.set("run", "1");
  [...p].forEach(([k, v]) => { if (v === "") p.delete(k); }); history.replaceState(null, "", "#" + p.toString());
}
function loadHash() {
  const p = new URLSearchParams(location.hash.slice(1)), set = (s, k) => { s.clear(); (p.get(k) || "").split(",").filter(v => v).forEach(v => s.add(v)); };
  if (!p.has("y")) return false;
  st.kind = ["rel", "trend", "diff"].includes(p.get("k")) ? p.get("k") : "rel"; set(st.y, "y"); set(st.x, "x"); set(st.c, "c"); set(st.places, "p"); set(st.a, "a"); set(st.b, "b");
  [st.y, st.x, st.c].forEach(s => [...s].forEach(v => { if (!V.has(v)) s.delete(v); }));
  st.only = p.get("o") !== "0"; st.from = p.get("f") || ""; st.to = p.get("t") || ""; st.yearly = p.get("yr") !== "0"; st.groupby = p.get("g") || ""; st.method = p.get("m") || "";
  st.pa = (p.get("pa") || "-").split("-").slice(0, 2); st.pb = (p.get("pb") || "-").split("-").slice(0, 2); st.logY = p.has("ly") ? p.get("ly") === "1" : null; st.logX = p.has("lx") ? p.get("lx") === "1" : null;
  pendingRun = p.get("run") === "1"; return true;
}

const EXAMPLES = [
  ["Richer countries live longer", { kind: "rel", y: "world-bank-development::life_expectancy", x: "world-bank-development::gdp_per_capita", from: "2023", to: "2023" }],
  ["Growing economies emit more CO2", { kind: "rel", y: "co2-and-greenhouse-gases::co2_per_capita", x: "world-bank-development::gdp_per_capita", from: "1990", to: "2023" }],
  ["The planet is warming", { kind: "trend", y: "global-temperature::nasa_anomaly_c", from: "1970-01-01" }],
  ["More CO2 in the air, warmer planet", { kind: "rel", y: "global-temperature::nasa_anomaly_c", x: "atmospheric-co2::mauna_loa_ppm" }],
  ["Life expectancy differs by income group", { kind: "diff", y: "world-bank-development::life_expectancy", groupby: "income", from: "2023", to: "2023" }],
  ["Child mortality fell after 2000", { kind: "diff", y: "world-bank-development::under_5_mortality", groupby: "periods", pa: ["1995", "1999"], pb: ["2018", "2022"] }],
];
function applyExample(e) {
  if (!V.has(e.y) || (e.x && !V.has(e.x))) return;
  Object.assign(st, { kind: e.kind, from: e.from || "", to: e.to || "", groupby: e.groupby || "", pa: e.pa || ["", ""], pb: e.pb || ["", ""], method: "", logY: null, logX: null, only: true, yearly: true });
  st.y.clear(); st.y.add(e.y); st.x.clear(); if (e.x) st.x.add(e.x); st.c.clear(); st.places.clear(); st.a.clear(); st.b.clear();
  $("#reading").hidden = true; pendingRun = true; syncControls(); schedule();
}

(async () => {
  const get = u => fetch(u).then(r => { if (!r.ok) throw new Error(u); return r.json(); });
  const [sets, countries] = await Promise.all([get("data/datasets.json"), get("data/countries.json").catch(() => null)]);
  M = sets.datasets.filter(d => FAMILIES.has(fam(d))); C = countries && countries.countries;
  M.forEach(d => d.columns.filter(c => c.type === "num").forEach(c => V.set(`${d.id}::${c.name}`, { id: `${d.id}::${c.name}`, d, c })));
  EXAMPLES.forEach(([label, e]) => { if (!V.has(e.y) || (e.x && !V.has(e.x)) || (e.groupby === "income" && !C)) return; const b = el("button", "", label); b.type = "button"; b.onclick = () => applyExample(e); $("#examples").append(b); });
  $("#kind").onclick = e => { const b = e.target.closest("button"); if (!b) return; st.kind = b.dataset.k; st.method = ""; if (st.kind === "trend" && st.places.size > 8) st.places.clear(); syncControls(); schedule(); };
  $("#groupby").onchange = e => { st.groupby = e.target.value; st.method = ""; syncControls(); schedule(); };
  $("#only").onchange = e => { st.only = e.target.checked; schedule(); }; $("#yearly").onchange = e => { st.yearly = e.target.checked; schedule(); };
  $("#presets").onclick = e => { const b = e.target.closest("button"); if (!b) return; if (b.dataset.f === "best") { bestYear(); return; } st.from = b.dataset.f; st.to = b.dataset.t; $("#t-from").value = st.from; $("#t-to").value = st.to; schedule(); };
  const read = () => { const t = $("#hyp").value.trim(); if (!t) return; const r = readSentence(t), box = $("#reading"); box.hidden = false; box.textContent = r.text; if (r.ok) { syncControls(); if (r.wantsYear) bestYear(); else schedule(); } };
  $("#read").onclick = read; $("#hyp").addEventListener("keydown", e => { if (e.key === "Enter") read(); });
  let rs = 0; addEventListener("resize", () => { clearTimeout(rs); rs = setTimeout(() => redraws.forEach(f => f()), 150); });
  document.addEventListener("themechange", () => redraws.forEach(f => f()));
  loadHash(); syncControls(); schedule();
})().catch(e => { console.error(e); $("#rec").innerHTML = `<h2>This page could not load its data</h2><p class="hint">Reload to try again.</p>`; });
