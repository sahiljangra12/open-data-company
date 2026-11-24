"""Checks docs/assets/stats.js against scipy, statsmodels and pymannkendall.
   python tests/check_stats.py   (needs node, numpy, scipy, statsmodels, pymannkendall)"""
import json, subprocess, sys
from pathlib import Path
import numpy as np
from scipy import stats as st
import statsmodels.api as sm
from statsmodels.stats.diagnostic import het_breuschpagan
from statsmodels.stats.stattools import durbin_watson
import pymannkendall as mk

rng = np.random.default_rng(7)
cases, ref = {}, {}
L = lambda a: np.asarray(a, dtype=float).tolist()

# --- distributions ---
tt = [(0.1, 3), (1.5, 8), (2.2, 30), (4.5, 12), (12.0, 200), (40.0, 5), (0.0, 10), (3.3, 1.7), (8.0, 1e6)]
ff = [(0.5, 2, 10), (3.1, 3, 40), (15.0, 1, 200), (1.0, 6, 6), (80.0, 5, 1000), (2.5, 12, 3.5)]
cc = [(0.2, 1), (3.0, 2), (15.5, 4), (60.0, 10), (0.01, 7), (250.0, 3), (40.0, 80)]
nn = [0.0, 0.3, 1.0, 1.96, 3.5, 6.0, 12.0, 30.0]
dfs = [1, 2, 5, 12, 30, 120, 2000, 7.5]
cases["dist"] = dict(kind="dist", t=tt, f=ff, chi=cc, norm=nn, tinv=dfs)
ref["dist"] = dict(t=[2 * st.t.sf(abs(t), d) for t, d in tt], f=[st.f.sf(F, a, b) for F, a, b in ff], chi=[st.chi2.sf(x, d) for x, d in cc],
                   norm=[2 * st.norm.sf(abs(z)) for z in nn], tinv=[st.t.ppf(0.975, d) for d in dfs])

def series(n, kind):
    x = rng.normal(0, 1, n) if kind == "normal" else rng.lognormal(1, 1.2, n) if kind == "skew" else np.round(rng.normal(5, 2, n))   # "ties"
    return x

# --- descriptives, association ---
for i, (n, kind) in enumerate([(12, "normal"), (200, "skew"), (60, "ties"), (5000, "skew"), (7, "ties")]):
    x = series(n, kind); y = 0.6 * x + series(n, kind) * (0.5 + i)
    cases[f"desc{i}"] = dict(kind="desc", x=L(x))
    ref[f"desc{i}"] = dict(mean=x.mean(), var=x.var(ddof=1), median=np.median(x), q25=np.quantile(x, 0.25), skew=st.skew(x), kurt=st.kurtosis(x), ranks=L(st.rankdata(x)))
    cases[f"assoc{i}"] = dict(kind="assoc", x=L(x), y=L(y))
    pr = st.pearsonr(x, y); ci = pr.confidence_interval(0.95); sp = st.spearmanr(x, y)
    ref[f"assoc{i}"] = dict(pearson=dict(r=pr.statistic, p=pr.pvalue, lo=ci.low, hi=ci.high), spearman=dict(rho=sp.statistic, p=sp.pvalue))

# --- regression with every error type, and diagnostics ---
for i, (n, k, G) in enumerate([(40, 1, 8), (300, 3, 25), (2000, 2, 60), (25, 2, 5)]):
    X = rng.normal(0, 1, (n, k)) * np.arange(1, k + 1); g = rng.integers(0, G, n)
    u = rng.normal(0, 1, G)[g] + rng.normal(0, 1, n) * (1 + 0.5 * np.abs(X[:, 0]))
    e = np.zeros(n); e[0] = u[0]
    for j in range(1, n): e[j] = 0.6 * e[j - 1] + u[j]                      # autocorrelated, heteroskedastic, clustered
    y = 1.5 + X @ np.linspace(0.8, -0.4, k) + e
    Lg = int(np.floor(4 * (n / 100) ** (2 / 9)))
    cases[f"ols{i}"] = dict(kind="ols", y=L(y), X=[L(X[:, j]) for j in range(k)], g=g.tolist(), L=Lg)
    Xc = sm.add_constant(X); m = sm.OLS(y, Xc)
    def pack(r): ci = r.conf_int(); return dict(b=L(r.params), se=L(r.bse), p=L(r.pvalues), lo=L(ci[:, 0]), hi=L(ci[:, 1]), r2=r.rsquared, adjR2=r.rsquared_adj)
    base = m.fit(); bp = het_breuschpagan(base.resid, Xc); jb = st.jarque_bera(base.resid)
    ref[f"ols{i}"] = dict(classic=pack(base), hc1=pack(m.fit(cov_type="HC1", use_t=True)), cluster=pack(m.fit(cov_type="cluster", cov_kwds=dict(groups=g), use_t=True)),
                          hac=pack(m.fit(cov_type="HAC", cov_kwds=dict(maxlags=Lg, use_correction=True), use_t=True)),
                          dw=durbin_watson(base.resid), jb=dict(jb=jb.statistic, p=jb.pvalue), bp=dict(lm=bp[0], p=bp[1]), clusterDf=len(np.unique(g)) - 1)

# --- fixed effects on unbalanced panels: reference by regressing out dummies exactly ---
for i, (G, T, k, drop) in enumerate([(30, 12, 1, 0.0), (80, 25, 2, 0.3), (15, 40, 3, 0.15)]):
    e = np.repeat(np.arange(G), T); t = np.tile(np.arange(T), G); keep = rng.random(G * T) > drop; e, t = e[keep], t[keep]; n = len(e)
    a, d = rng.normal(0, 2, G)[e], rng.normal(0, 1, T)[t]
    X = rng.normal(0, 1, (n, k)) + a[:, None] * 0.5 + d[:, None] * 0.3
    y = a + d + X @ np.linspace(1.2, -0.7, k) + rng.normal(0, 1, G)[e] * 0.5 * X[:, 0] + rng.normal(0, 1, n)
    cases[f"fe{i}"] = dict(kind="fe", y=L(y), X=[L(X[:, j]) for j in range(k)], e=e.tolist(), t=t.tolist())
    def within(dummies):
        D = np.column_stack(dummies); res = lambda v: v - D @ np.linalg.lstsq(D, v, rcond=None)[0]
        yd, Xd = res(y), np.column_stack([res(X[:, j]) for j in range(k)])
        r = sm.OLS(yd, Xd).fit(cov_type="cluster", cov_kwds=dict(groups=e), use_t=True); ci = r.conf_int()
        return dict(b=L(r.params), se=L(r.bse), p=L(r.pvalues), lo=L(ci[:, 0]), hi=L(ci[:, 1]), r2=r.rsquared)
    De = (e[:, None] == np.unique(e)[None, :]).astype(float); Dt = (t[:, None] == np.unique(t)[None, :]).astype(float)
    ref[f"fe{i}"] = dict(one=within([De]), two=within([De, Dt[:, 1:]]))

# --- group tests ---
for i, (na, nb, kind) in enumerate([(8, 11, "normal"), (60, 45, "skew"), (30, 30, "ties"), (400, 250, "skew")]):
    a, b = series(na, kind), series(nb, kind) + 0.4
    cases[f"two{i}"] = dict(kind="two", a=L(a), b=L(b))
    w = st.ttest_ind(a, b, equal_var=False); ci = w.confidence_interval(0.95); u = st.mannwhitneyu(a, b, alternative="two-sided", method="asymptotic", use_continuity=True)
    ref[f"two{i}"] = dict(welch=dict(t=w.statistic, df=w.df, p=w.pvalue, lo=ci.low, hi=ci.high), mw=dict(u=u.statistic, p=u.pvalue))
    d = (series(na + 20, kind) - series(na + 20, kind) + 0.3) if kind != "ties" else np.round(rng.normal(0.5, 2, na + 20))
    cases[f"paired{i}"] = dict(kind="paired", d=L(d))
    p1 = st.ttest_1samp(d, 0); c1 = p1.confidence_interval(0.95); wx = st.wilcoxon(d, zero_method="wilcox", correction=True, method="asymptotic")
    ref[f"paired{i}"] = dict(t=dict(t=p1.statistic, p=p1.pvalue, lo=c1.low, hi=c1.high), w=dict(w=wx.statistic, p=wx.pvalue))
    gs = [series(int(n), kind) + s for n, s in zip(rng.integers(6, 60, 4), (0, 0.3, 0.1, 0.8))]
    cases[f"groups{i}"] = dict(kind="groups", g=[L(g) for g in gs])
    an = st.f_oneway(*gs); kw = st.kruskal(*gs)
    ref[f"groups{i}"] = dict(anova=dict(F=an.statistic, p=an.pvalue), kw=dict(H=kw.statistic, p=kw.pvalue))

# --- trend ---
for i, (n, kind) in enumerate([(15, "normal"), (60, "ties"), (146, "normal"), (400, "skew")]):
    t = np.arange(1950, 1950 + n, dtype=float); y = 0.02 * (t - 1950) + series(n, kind) * 0.4
    if kind == "ties": y = np.round(y, 1)
    cases[f"trend{i}"] = dict(kind="trend", t=L(t), y=L(y))
    r = mk.original_test(y); ts = st.theilslopes(y, t, 0.95, method="separate")
    ref[f"trend{i}"] = dict(mk=dict(s=r.s, varS=r.var_s, z=r.z, p=r.p, tau=r.Tau), sen=dict(slope=ts.slope, intercept=ts.intercept, lo=ts.low_slope, hi=ts.high_slope))

# --- two-way tables of counts ---
from scipy.stats.contingency import association
for i, (r, c, scale) in enumerate([(2, 2, 40), (3, 4, 25), (5, 2, 8), (6, 6, 300), (2, 7, 3)]):
    tb = rng.poisson(scale, (r, c)) + 1 + (np.arange(r)[:, None] * np.arange(c)[None, :]) * (scale // 6)
    cases[f"table{i}"] = dict(kind="table", table=tb.tolist())
    ch = st.chi2_contingency(tb, correction=False)
    ref[f"table{i}"] = dict(chi2=ch.statistic, df=ch.dof, p=ch.pvalue, cramersV=association(tb, method="cramer"), expected=ch.expected_freq.tolist())

out = json.loads(subprocess.run(["node", str(Path(__file__).with_name("run_stats.js"))], input=json.dumps(cases), capture_output=True, text=True, check=True).stdout)

worst, bad, checked = 0.0, [], 0
def cmp(path, got, want, tol=1e-7):
    global worst, checked
    if isinstance(want, dict):
        for k in want:
            if k == "clusterDf": continue
            cmp(f"{path}.{k}", got[k], want[k], tol)
    elif isinstance(want, (list, tuple)):
        assert len(got) == len(want), path
        for j, (g, w) in enumerate(zip(got, want)): cmp(f"{path}[{j}]", g, w, tol)
    else:
        checked += 1
        w, g = float(want), float(got)
        err = abs(g - w) / max(abs(w), 1e-12) if abs(w) > 1e-9 else abs(g - w)     # relative, absolute near zero
        if w != 0 and abs(w) < 1e-250: err = 0 if g < 1e-200 else err              # p-values too small for double precision
        worst = max(worst, err)
        if err > tol: bad.append((path, g, w, err))
for name in ref:
    cmp(name, out[name], ref[name], 2e-6 if name == "dist" else 1e-7)
print(f"{checked} numbers compared across {len(ref)} cases; worst relative difference {worst:.2e}")
for b in bad[:25]: print("  MISMATCH", b)
sys.exit(1 if bad else 0)
