/* Statistics for Researcher Mode. Plain JavaScript, no dependencies.
   Every function here is checked against scipy / statsmodels / pymannkendall in tests/check_stats.py. */
(function (root) {
  "use strict";
  const S = {};

  /* ---------- special functions ---------- */
  S.lgamma = function (x) {                                   // Lanczos approximation
    const c = [76.18009172947146, -86.50532032941677, 24.01409824083091, -1.231739572450155, 0.1208650973866179e-2, -0.5395239384953e-5];
    let y = x, t = x + 5.5; t -= (x + 0.5) * Math.log(t);
    let s = 1.000000000190015;
    for (let j = 0; j < 6; j++) s += c[j] / ++y;
    return -t + Math.log(2.5066282746310005 * s / x);
  };
  function betacf(a, b, x) {                                  // continued fraction for the incomplete beta
    const FP = 1e-300; let qab = a + b, qap = a + 1, qam = a - 1, c = 1, d = 1 - qab * x / qap;
    if (Math.abs(d) < FP) d = FP; d = 1 / d; let h = d;
    for (let m = 1; m <= 400; m++) {
      const m2 = 2 * m; let aa = m * (b - m) * x / ((qam + m2) * (a + m2));
      d = 1 + aa * d; if (Math.abs(d) < FP) d = FP; c = 1 + aa / c; if (Math.abs(c) < FP) c = FP; d = 1 / d; h *= d * c;
      aa = -(a + m) * (qab + m) * x / ((a + m2) * (qap + m2));
      d = 1 + aa * d; if (Math.abs(d) < FP) d = FP; c = 1 + aa / c; if (Math.abs(c) < FP) c = FP; d = 1 / d;
      const del = d * c; h *= del; if (Math.abs(del - 1) < 3e-16) break;
    }
    return h;
  }
  S.betai = function (a, b, x) {                              // regularized incomplete beta I_x(a, b)
    if (x <= 0) return 0; if (x >= 1) return 1;
    const bt = Math.exp(S.lgamma(a + b) - S.lgamma(a) - S.lgamma(b) + a * Math.log(x) + b * Math.log(1 - x));
    return x < (a + 1) / (a + b + 2) ? bt * betacf(a, b, x) / a : 1 - bt * betacf(b, a, 1 - x) / b;
  };
  S.gammq = function (a, x) {                                 // upper regularized incomplete gamma Q(a, x)
    if (x <= 0) return 1;
    if (x < a + 1) {                                          // series for P, then Q = 1 - P
      let ap = a, sum = 1 / a, del = sum;
      for (let n = 0; n < 1000; n++) { ap++; del *= x / ap; sum += del; if (Math.abs(del) < Math.abs(sum) * 3e-16) break; }
      return 1 - sum * Math.exp(-x + a * Math.log(x) - S.lgamma(a));
    }
    const FP = 1e-300; let b = x + 1 - a, c = 1 / FP, d = 1 / b, h = d;
    for (let i = 1; i < 1000; i++) {
      const an = -i * (i - a); b += 2; d = an * d + b; if (Math.abs(d) < FP) d = FP; c = b + an / c; if (Math.abs(c) < FP) c = FP;
      d = 1 / d; const del = d * c; h *= del; if (Math.abs(del - 1) < 3e-16) break;
    }
    return Math.exp(-x + a * Math.log(x) - S.lgamma(a)) * h;
  };
  S.normSf2 = z => S.gammq(0.5, z * z / 2);                    // two-sided normal tail: P(|Z| > |z|)
  S.tSf2 = (t, df) => S.betai(df / 2, 0.5, df / (df + t * t)); // two-sided Student t tail
  S.fSf = (F, d1, d2) => F <= 0 ? 1 : S.betai(d2 / 2, d1 / 2, d2 / (d2 + d1 * F));
  S.chi2Sf = (x, k) => S.gammq(k / 2, x / 2);
  S.tInv = function (p, df) {                                  // upper quantile: P(T > q) = (1 - p), e.g. p = 0.975
    let lo = 0, hi = 1e3; const target = 2 * (1 - p);
    for (let i = 0; i < 200; i++) { const mid = (lo + hi) / 2; if (S.tSf2(mid, df) > target) lo = mid; else hi = mid; }
    return (lo + hi) / 2;
  };
  const Z975 = 1.959963984540054;

  /* ---------- descriptives ---------- */
  S.sum = a => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i]; return s; };
  S.mean = a => S.sum(a) / a.length;
  S.variance = a => { const m = S.mean(a); let s = 0; for (const v of a) s += (v - m) * (v - m); return s / (a.length - 1); };
  S.sd = a => Math.sqrt(S.variance(a));
  S.quantile = function (a, q) {                               // linear interpolation (the numpy default)
    const s = Float64Array.from(a).sort(), h = (s.length - 1) * q, lo = Math.floor(h), hi = Math.ceil(h);
    return s[lo] + (s[hi] - s[lo]) * (h - lo);
  };
  S.median = a => S.quantile(a, 0.5);
  S.skewness = a => { const m = S.mean(a), n = a.length; let m2 = 0, m3 = 0; for (const v of a) { const d = v - m; m2 += d * d; m3 += d * d * d; } m2 /= n; m3 /= n; return m2 ? m3 / Math.pow(m2, 1.5) : 0; };
  S.kurtosis = a => { const m = S.mean(a), n = a.length; let m2 = 0, m4 = 0; for (const v of a) { const d = v - m; m2 += d * d; m4 += d * d * d * d; } m2 /= n; m4 /= n; return m2 ? m4 / (m2 * m2) - 3 : 0; };
  S.ranks = function (a) {                                     // average ranks for ties; also returns the tie-group sizes
    const idx = Array.from(a.keys()).sort((i, j) => a[i] - a[j]), r = new Float64Array(a.length), ties = [];
    for (let i = 0; i < idx.length;) {
      let j = i; while (j + 1 < idx.length && a[idx[j + 1]] === a[idx[i]]) j++;
      const rank = (i + j) / 2 + 1; for (let k = i; k <= j; k++) r[idx[k]] = rank;
      if (j > i) ties.push(j - i + 1); i = j + 1;
    }
    return { r, ties };
  };

  /* ---------- association ---------- */
  S.pearson = function (x, y) {
    const n = x.length, mx = S.mean(x), my = S.mean(y); let sxy = 0, sxx = 0, syy = 0;
    for (let i = 0; i < n; i++) { const a = x[i] - mx, b = y[i] - my; sxy += a * b; sxx += a * a; syy += b * b; }
    const r = sxy / Math.sqrt(sxx * syy), df = n - 2, t = r * Math.sqrt(df / (1 - r * r)), z = Math.atanh(r), se = 1 / Math.sqrt(n - 3);
    return { r, n, df, t, p: Math.abs(r) >= 1 ? 0 : S.tSf2(t, df), lo: Math.tanh(z - Z975 * se), hi: Math.tanh(z + Z975 * se) };
  };
  S.spearman = function (x, y) { const o = S.pearson(S.ranks(x).r, S.ranks(y).r); return { rho: o.r, n: o.n, p: o.p }; };

  /* ---------- linear algebra for small systems ---------- */
  function invert(A) {                                         // Gauss-Jordan with partial pivoting
    const n = A.length, M = A.map((r, i) => [...r, ...Array.from({ length: n }, (_, j) => (i === j ? 1 : 0))]);
    for (let c = 0; c < n; c++) {
      let p = c; for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
      if (Math.abs(M[p][c]) < 1e-12) throw new Error("The explanatory variables are perfectly related to each other, so their effects cannot be separated.");
      [M[c], M[p]] = [M[p], M[c]];
      const d = M[c][c]; for (let j = 0; j < 2 * n; j++) M[c][j] /= d;
      for (let r = 0; r < n; r++) if (r !== c) { const f = M[r][c]; if (f) for (let j = 0; j < 2 * n; j++) M[r][j] -= f * M[c][j]; }
    }
    return M.map(r => r.slice(n));
  }
  const matmul = (A, B) => A.map(r => B[0].map((_, j) => r.reduce((s, v, k) => s + v * B[k][j], 0)));

  /* ---------- regression ----------
     y: values. X: array of columns. opt.intercept (default true).
     opt.cov: "classic" | "HC1" | "cluster" (opt.groups) | "HAC" (opt.maxlags).
     opt.dfAbsorbed: degrees of freedom already used by fixed effects (classic errors only). */
  S.ols = function (y, X, opt = {}) {
    const n = y.length, cols = (opt.intercept === false ? [] : [new Float64Array(n).fill(1)]).concat(X), k = cols.length;
    const names = (opt.intercept === false ? [] : ["(Intercept)"]).concat(opt.names || X.map((_, i) => "x" + (i + 1)));
    const XtX = cols.map(a => cols.map(b => { let s = 0; for (let i = 0; i < n; i++) s += a[i] * b[i]; return s; }));
    const Xty = cols.map(a => { let s = 0; for (let i = 0; i < n; i++) s += a[i] * y[i]; return s; });
    const XtXi = invert(XtX), beta = XtXi.map(r => r.reduce((s, v, j) => s + v * Xty[j], 0));
    const fitted = new Float64Array(n), resid = new Float64Array(n); let ssr = 0;
    for (let i = 0; i < n; i++) { let f = 0; for (let j = 0; j < k; j++) f += cols[j][i] * beta[j]; fitted[i] = f; resid[i] = y[i] - f; ssr += resid[i] * resid[i]; }
    const my = opt.intercept === false ? 0 : S.mean(y); let sst = 0; for (let i = 0; i < n; i++) sst += (y[i] - my) * (y[i] - my);
    const dfRes = n - k - (opt.dfAbsorbed || 0), cov = opt.cov || "classic";
    let V, dfT = dfRes;
    if (cov === "classic") { const s2 = ssr / dfRes; V = XtXi.map(r => r.map(v => v * s2)); }
    else {
      const meat = Array.from({ length: k }, () => new Float64Array(k)); let scale = 1;
      if (cov === "HC1") {
        for (let i = 0; i < n; i++) { const e2 = resid[i] * resid[i]; for (let a = 0; a < k; a++) for (let b = a; b < k; b++) meat[a][b] += cols[a][i] * cols[b][i] * e2; }
        scale = n / (n - k);
      } else if (cov === "cluster") {
        const sums = new Map();
        for (let i = 0; i < n; i++) { let g = sums.get(opt.groups[i]); if (!g) sums.set(opt.groups[i], g = new Float64Array(k)); for (let a = 0; a < k; a++) g[a] += cols[a][i] * resid[i]; }
        sums.forEach(g => { for (let a = 0; a < k; a++) for (let b = a; b < k; b++) meat[a][b] += g[a] * g[b]; });
        const G = sums.size; scale = G / (G - 1) * (n - 1) / (n - k); dfT = G - 1;
      } else if (cov === "HAC") {                               // Newey-West, Bartlett kernel
        const L = opt.maxlags ?? Math.floor(4 * Math.pow(n / 100, 2 / 9)), xe = cols.map(c => { const v = new Float64Array(n); for (let i = 0; i < n; i++) v[i] = c[i] * resid[i]; return v; });
        for (let a = 0; a < k; a++) for (let b = 0; b < k; b++) {
          let s = 0; for (let i = 0; i < n; i++) s += xe[a][i] * xe[b][i];
          for (let l = 1; l <= L; l++) { const w = 1 - l / (L + 1); let g = 0; for (let i = l; i < n; i++) g += xe[a][i] * xe[b][i - l] + xe[a][i - l] * xe[b][i]; s += w * g; }
          meat[a][b] = s;
        }
        scale = n / (n - k);
      }
      if (cov !== "HAC") for (let a = 0; a < k; a++) for (let b = 0; b < a; b++) meat[a][b] = meat[b][a];
      V = matmul(matmul(XtXi, meat.map(r => Array.from(r))), XtXi).map(r => r.map(v => v * scale));
    }
    const tc = S.tInv(0.975, dfT);
    const coef = beta.map((b, j) => { const se = Math.sqrt(V[j][j]), t = b / se; return { name: names[j], b, se, t, p: S.tSf2(t, dfT), lo: b - tc * se, hi: b + tc * se }; });
    return { coef, n, k, dfRes, dfT, r2: 1 - ssr / sst, adjR2: 1 - (ssr / dfRes) / (sst / (n - 1)), ssr, sst, sigma: Math.sqrt(ssr / dfRes), resid, fitted, cov };
  };

  /* Remove group means (one-way) or group and time means (two-way, alternating until stable; works for unbalanced panels). */
  S.demean = function (columns, g1, g2) {
    const sweep = (v, ids) => { const s = new Map(); for (let i = 0; i < v.length; i++) { const e = s.get(ids[i]); if (e) { e[0] += v[i]; e[1]++; } else s.set(ids[i], [v[i], 1]); } let d = 0; for (let i = 0; i < v.length; i++) { const e = s.get(ids[i]), m = e[0] / e[1]; v[i] -= m; d = Math.max(d, Math.abs(m)); } return d; };
    return columns.map(c => {
      const v = Float64Array.from(c), scale = Math.max(1e-300, S.sd(v) || 1);
      for (let it = 0; it < 500; it++) { let d = sweep(v, g1); if (g2) d = Math.max(d, sweep(v, g2)); else break; if (d < 1e-11 * scale) break; }
      return v;
    });
  };
  /* Fixed-effects (within) regression. Errors clustered by entity. */
  S.fixedEffects = function (y, X, entity, time, opt = {}) {
    const d = S.demean([y, ...X], entity, time || null);
    const fit = S.ols(d[0], d.slice(1), { intercept: false, cov: "cluster", groups: entity, names: opt.names });
    fit.entities = new Set(entity).size; fit.periods = time ? new Set(time).size : null; fit.within = { y: d[0], X: d.slice(1) };
    return fit;
  };

  /* ---------- diagnostics ---------- */
  S.durbinWatson = e => { let a = 0, b = 0; for (let i = 0; i < e.length; i++) { b += e[i] * e[i]; if (i) a += (e[i] - e[i - 1]) * (e[i] - e[i - 1]); } return a / b; };
  S.jarqueBera = function (x) { const n = x.length, s = S.skewness(x), k = S.kurtosis(x), jb = n / 6 * (s * s + k * k / 4); return { jb, p: S.chi2Sf(jb, 2), skew: s, kurt: k }; };
  S.breuschPagan = function (resid, X) {                       // Koenker's studentized version: n * R2 of squared residuals on X
    const e2 = Float64Array.from(resid, v => v * v), aux = S.ols(e2, X), lm = resid.length * aux.r2;
    return { lm, df: X.length, p: S.chi2Sf(lm, X.length) };
  };

  /* ---------- two groups ---------- */
  S.welch = function (a, b) {
    const na = a.length, nb = b.length, ma = S.mean(a), mb = S.mean(b), va = S.variance(a), vb = S.variance(b), se = Math.sqrt(va / na + vb / nb);
    const df = Math.pow(va / na + vb / nb, 2) / (Math.pow(va / na, 2) / (na - 1) + Math.pow(vb / nb, 2) / (nb - 1)), t = (ma - mb) / se, tc = S.tInv(0.975, df);
    const sp = Math.sqrt(((na - 1) * va + (nb - 1) * vb) / (na + nb - 2)), d = (ma - mb) / sp, g = d * (1 - 3 / (4 * (na + nb) - 9));
    return { t, df, p: S.tSf2(t, df), diff: ma - mb, lo: ma - mb - tc * se, hi: ma - mb + tc * se, meanA: ma, meanB: mb, cohenD: d, hedgesG: g };
  };
  S.mannWhitney = function (a, b) {                            // normal approximation with tie and continuity corrections
    const na = a.length, nb = b.length, all = Float64Array.from([...a, ...b]), { r, ties } = S.ranks(all);
    let ra = 0; for (let i = 0; i < na; i++) ra += r[i];
    const u1 = ra - na * (na + 1) / 2, u2 = na * nb - u1, N = na + nb, tie = ties.reduce((s, t) => s + t * t * t - t, 0);
    const sd = Math.sqrt(na * nb / 12 * (N + 1 - tie / (N * (N - 1)))), z = (Math.max(u1, u2) - na * nb / 2 - 0.5) / sd;
    return { u: u1, z, p: Math.min(1, S.normSf2(z)), superiority: u1 / (na * nb) };
  };
  S.pairedT = function (d) { const n = d.length, m = S.mean(d), se = S.sd(d) / Math.sqrt(n), t = m / se, df = n - 1, tc = S.tInv(0.975, df); return { t, df, p: S.tSf2(t, df), diff: m, lo: m - tc * se, hi: m + tc * se, dz: m / S.sd(d) }; };
  S.wilcoxon = function (d) {                                  // signed-rank; zeros dropped; normal approximation with corrections
    const x = Array.from(d).filter(v => v !== 0), n = x.length, { r, ties } = S.ranks(Float64Array.from(x, Math.abs));
    let wp = 0, wm = 0; for (let i = 0; i < n; i++) (x[i] > 0 ? (wp += r[i]) : (wm += r[i]));
    const mn = n * (n + 1) / 4, tie = ties.reduce((s, t) => s + t * t * t - t, 0), sd = Math.sqrt(n * (n + 1) * (2 * n + 1) / 24 - tie / 48), w = Math.min(wp, wm);
    const z = (w - mn + 0.5) / sd;
    return { w, n, z, p: Math.min(1, S.normSf2(z)) };
  };

  /* ---------- several groups ---------- */
  S.anova = function (groups) {
    const all = groups.flat(), N = all.length, k = groups.length, gm = S.mean(all); let ssb = 0, ssw = 0;
    groups.forEach(g => { const m = S.mean(g); ssb += g.length * (m - gm) * (m - gm); for (const v of g) ssw += (v - m) * (v - m); });
    const F = (ssb / (k - 1)) / (ssw / (N - k));
    return { F, df1: k - 1, df2: N - k, p: S.fSf(F, k - 1, N - k), eta2: ssb / (ssb + ssw) };
  };
  S.kruskal = function (groups) {
    const all = Float64Array.from(groups.flat()), N = all.length, { r, ties } = S.ranks(all); let h = 0, pos = 0;
    groups.forEach(g => { let s = 0; for (let i = 0; i < g.length; i++) s += r[pos + i]; pos += g.length; h += s * s / g.length; });
    h = 12 / (N * (N + 1)) * h - 3 * (N + 1);
    h /= 1 - ties.reduce((s, t) => s + t * t * t - t, 0) / (N * N * N - N);
    return { H: h, df: groups.length - 1, p: S.chi2Sf(h, groups.length - 1) };
  };

  /* ---------- trend ---------- */
  S.mannKendall = function (y) {                               // values in time order
    const n = y.length; let s = 0;
    for (let i = 0; i < n - 1; i++) for (let j = i + 1; j < n; j++) s += Math.sign(y[j] - y[i]);
    const { ties } = S.ranks(Float64Array.from(y)), v = (n * (n - 1) * (2 * n + 5) - ties.reduce((a, t) => a + t * (t - 1) * (2 * t + 5), 0)) / 18;
    const z = s > 0 ? (s - 1) / Math.sqrt(v) : s < 0 ? (s + 1) / Math.sqrt(v) : 0;
    return { s, varS: v, z, p: Math.min(1, S.normSf2(z)), tau: s / (n * (n - 1) / 2) };
  };
  S.senSlope = function (t, y) {                               // Theil-Sen median slope with a 95% interval
    const n = y.length, sl = [];
    for (let i = 0; i < n - 1; i++) for (let j = i + 1; j < n; j++) if (t[j] !== t[i]) sl.push((y[j] - y[i]) / (t[j] - t[i]));
    const s = Float64Array.from(sl).sort(), slope = S.quantile(s, 0.5), nt = s.length;
    const tie = a => S.ranks(Float64Array.from(a)).ties.reduce((q, k) => q + k * (k - 1) * (2 * k + 5), 0);
    const sigma = Math.sqrt((n * (n - 1) * (2 * n + 5) - tie(t) - tie(y)) / 18);
    const ru = Math.min(Math.round((nt + Z975 * sigma) / 2), nt - 1), rl = Math.max(Math.round((nt - Z975 * sigma) / 2) - 1, 0);
    return { slope, intercept: S.median(y) - slope * S.median(t), lo: s[rl], hi: s[ru] };
  };

  root.Stats = S;
  if (typeof module !== "undefined" && module.exports) module.exports = S;
})(typeof globalThis !== "undefined" ? globalThis : this);
