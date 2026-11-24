// Runs the browser statistics code on cases read from stdin; used by check_stats.py.
const S = require("../docs/assets/stats.js");
const cases = JSON.parse(require("fs").readFileSync(0, "utf8")), out = {};
const pick = (o, keys) => Object.fromEntries(keys.map(k => [k, o[k]]));
const coef = f => ({ b: f.coef.map(c => c.b), se: f.coef.map(c => c.se), p: f.coef.map(c => c.p), lo: f.coef.map(c => c.lo), hi: f.coef.map(c => c.hi), r2: f.r2, adjR2: f.adjR2, dfT: f.dfT });
for (const [name, c] of Object.entries(cases)) {
  const k = c.kind;
  if (k === "dist") out[name] = { t: c.t.map(([t, df]) => S.tSf2(t, df)), f: c.f.map(([F, a, b]) => S.fSf(F, a, b)), chi: c.chi.map(([x, d]) => S.chi2Sf(x, d)), norm: c.norm.map(z => S.normSf2(z)), tinv: c.tinv.map(df => S.tInv(0.975, df)) };
  else if (k === "desc") out[name] = { mean: S.mean(c.x), var: S.variance(c.x), median: S.median(c.x), q25: S.quantile(c.x, 0.25), skew: S.skewness(c.x), kurt: S.kurtosis(c.x), ranks: Array.from(S.ranks(c.x).r) };
  else if (k === "assoc") out[name] = { pearson: S.pearson(c.x, c.y), spearman: S.spearman(c.x, c.y) };
  else if (k === "ols") out[name] = { classic: coef(S.ols(c.y, c.X)), hc1: coef(S.ols(c.y, c.X, { cov: "HC1" })), cluster: coef(S.ols(c.y, c.X, { cov: "cluster", groups: c.g })), hac: coef(S.ols(c.y, c.X, { cov: "HAC", maxlags: c.L })),
    dw: S.durbinWatson(S.ols(c.y, c.X).resid), jb: S.jarqueBera(S.ols(c.y, c.X).resid), bp: S.breuschPagan(S.ols(c.y, c.X).resid, c.X) };
  else if (k === "fe") { const one = S.fixedEffects(c.y, c.X, c.e, null), two = S.fixedEffects(c.y, c.X, c.e, c.t); out[name] = { one: coef(one), two: coef(two), G: one.entities }; }
  else if (k === "two") out[name] = { welch: S.welch(c.a, c.b), mw: S.mannWhitney(c.a, c.b) };
  else if (k === "paired") out[name] = { t: S.pairedT(c.d), w: S.wilcoxon(c.d) };
  else if (k === "groups") out[name] = { anova: S.anova(c.g), kw: S.kruskal(c.g) };
  else if (k === "trend") out[name] = { mk: S.mannKendall(c.y), sen: S.senSlope(c.t, c.y) };
  else if (k === "table") out[name] = pick(S.chiSquare(c.table), ["chi2", "df", "p", "cramersV", "expected"]);
}
process.stdout.write(JSON.stringify(out));
