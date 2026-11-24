/* A small chart kit shared by Ask, Your data and Updates. Needs core.js.
   Every chart is drawn to the width of its host, takes its colours from the theme, and answers the pointer with a readout.
   Charts.line / bars / hist / scatter / strip / heat.  Hosts should be position:relative (class "fig"). */
const Charts = (() => {
  const S = i => `var(--s${(i % 8) + 1})`;
  const compact = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 });
  const short = v => (Math.abs(v) >= 10000 ? compact.format(v) : String(+(+v).toPrecision(4)));
  const live = new Map();                                               // host -> redraw, so charts follow the window width
  let timer = 0;
  addEventListener("resize", () => { clearTimeout(timer); timer = setTimeout(() => live.forEach((f, h) => { if (h.isConnected) f(); else live.delete(h); }), 160); });
  const keep = (host, draw) => { live.set(host, draw); draw(); };

  /* round axis limits and a step that gives about n intervals */
  function scale(lo, hi, n = 5) {
    if (!(hi > lo)) { const pad = Math.abs(lo) * 0.1 || 1; lo -= pad; hi += pad; }
    const raw = (hi - lo) / n, p = Math.pow(10, Math.floor(Math.log10(raw))), f = raw / p, step = (f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10) * p;
    return { lo: Math.floor(lo / step + 1e-9) * step, hi: Math.ceil(hi / step - 1e-9) * step, step };
  }
  const ticks = s => { const out = []; for (let k = Math.round(s.lo / s.step); k * s.step <= s.hi + s.step / 2; k++) out.push(+(k * s.step).toPrecision(12)); return out; };
  function stage(host, H, label) {
    const W = Math.max(280, host.clientWidth || 720), root = svgEl("svg", { viewBox: `0 0 ${W} ${H}`, height: H, role: "img", "aria-label": label || "Chart" });
    const tip = el("div", "tip"); tip.hidden = true;
    host.replaceChildren(root, tip);
    return { W, root, tip };
  }
  const place = (tip, host, x, y) => { tip.hidden = false; const w = host.clientWidth; tip.style.left = Math.max(0, Math.min(w - tip.offsetWidth - 2, x + 14)) + "px"; tip.style.top = Math.max(0, y) + "px"; };
  const text = (root, x, y, t, cls, anchor) => { const e = svgEl("text", { x, y, class: cls }); if (anchor) e.setAttribute("text-anchor", anchor); e.textContent = t; root.append(e); return e; };
  const legend = (host, names) => { const l = el("div", "chartleg"); names.forEach((n, i) => { const s = el("span"), b = el("b"); b.style.background = S(i); s.append(b, document.createTextNode(n)); l.append(s); }); host.prepend(l); };

  /* ---- lines over time or over a number.  o: { series:[{name, pts:[[x,y]]}], x:"year"|"date"|"num", fmt, zero, fit:[[x,y],[x,y]], label } ---- */
  function line(host, o) {
    keep(host, () => {
      const fmt = o.fmt || short, X = v => (o.x === "date" ? (typeof v === "number" ? v : Date.parse(v)) : +v);
      const ser = o.series.map((s, i) => ({ name: s.name, color: S(i), pts: s.pts.map(p => [X(p[0]), p[1], p[0]]).filter(p => isFinite(p[0]) && isFinite(p[1])).sort((a, b) => a[0] - b[0]) })).filter(s => s.pts.length);
      if (!ser.length) { host.replaceChildren(el("p", "hint", "No values to draw.")); return; }
      const all = ser.flatMap(s => s.pts), x0 = Math.min(...all.map(p => p[0])), x1 = Math.max(...all.map(p => p[0]));
      let lo = Math.min(...all.map(p => p[1])), hi = Math.max(...all.map(p => p[1]));
      if (o.zero !== false && lo >= 0) lo = 0;
      const ys = scale(lo, hi), small = (host.clientWidth || 720) < 560, direct = ser.length <= 4 && !small;
      const H = Math.round(Math.max(260, Math.min(420, (host.clientWidth || 720) * 0.46))), m = { l: 4, r: direct ? 118 : 16, t: 22, b: 30 };
      const { W, root, tip } = stage(host, H, o.label);
      const sx = v => m.l + (x1 > x0 ? (v - x0) / (x1 - x0) : 0.5) * (W - m.l - m.r), sy = v => H - m.b - (v - ys.lo) / (ys.hi - ys.lo) * (H - m.t - m.b);
      ticks(ys).forEach(v => { root.append(svgEl("line", { x1: m.l, x2: W - m.r, y1: sy(v), y2: sy(v), class: v === 0 ? "g-zero" : "g-grid" })); text(root, m.l, sy(v) - 6, fmt(v), "g-tick"); });
      const xText = v => (o.x === "date" ? new Date(v).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" }) : o.x === "year" ? String(v) : short(v));
      if (o.x === "date") {
        const y0 = new Date(x0).getUTCFullYear(), y1 = new Date(x1).getUTCFullYear(), st = [1, 2, 5, 10, 20, 25, 50].find(s => (y1 - y0) / s <= (small ? 4 : 8)) || 50;
        if (y1 - y0 >= 2) for (let y = Math.ceil((y0 + 0.01) / st) * st; y <= y1; y += st) { const px = sx(Date.UTC(y, 0, 1)); root.append(svgEl("line", { x1: px, x2: px, y1: H - m.b, y2: H - m.b + 5, class: "g-zero" })); text(root, px, H - 8, y, "g-tick", "middle"); }
        else [x0, x1].forEach((v, i) => text(root, sx(v), H - 8, xText(v), "g-tick", i ? "end" : "start"));
      } else {
        const xs = scale(x0, x1, small ? 4 : 8); if (o.x === "year") xs.step = Math.max(1, Math.round(xs.step));
        ticks(xs).filter(v => v >= x0 && v <= x1).forEach(v => { const px = sx(v); root.append(svgEl("line", { x1: px, x2: px, y1: H - m.b, y2: H - m.b + 5, class: "g-zero" })); text(root, px, H - 8, o.x === "year" ? v : short(v), "g-tick", px < 26 ? "start" : "middle"); });
      }
      if (o.fit) root.append(svgEl("line", { x1: sx(X(o.fit[0][0])), y1: sy(o.fit[0][1]), x2: sx(X(o.fit[1][0])), y2: sy(o.fit[1][1]), class: "g-fit" }));
      const ends = ser.map(s => sy(s.pts[s.pts.length - 1][1])), order = [...ends].sort((a, b) => a - b), clash = order.some((y, i) => i && y - order[i - 1] < 30);
      ser.forEach((s, i) => {
        root.append(svgEl("path", { d: s.pts.map((p, j) => (j ? "L" : "M") + sx(p[0]).toFixed(1) + " " + sy(p[1]).toFixed(1)).join(""), class: "g-line", style: `stroke:${s.color}` }));
        const last = s.pts[s.pts.length - 1];
        root.append(svgEl("circle", { cx: sx(last[0]), cy: ends[i], r: 4.5, class: "g-ring", style: `fill:${s.color}` }));
        if (direct && !clash) { text(root, sx(last[0]) + 11, ends[i] + (ser.length > 1 ? -1 : 5), fmt(last[1]), "g-val"); if (ser.length > 1) text(root, sx(last[0]) + 11, ends[i] + 14, s.name.length > 17 ? s.name.slice(0, 16) + "…" : s.name, "g-name"); }
      });
      if (ser.length > 1) legend(host, ser.map(s => s.name));
      const rule = svgEl("line", { y1: m.t - 8, y2: H - m.b, class: "g-rule", visibility: "hidden" }); root.append(rule);
      const xsAll = [...new Set(all.map(p => p[0]))].sort((a, b) => a - b);
      root.addEventListener("pointermove", e => {
        const rc = root.getBoundingClientRect(), xv = x0 + ((e.clientX - rc.left) / rc.width * W - m.l) / (W - m.l - m.r) * (x1 - x0);
        const at = xsAll.reduce((a, b) => (Math.abs(b - xv) < Math.abs(a - xv) ? b : a)), px = sx(at), tol = (x1 - x0) / 100;
        rule.setAttribute("x1", px); rule.setAttribute("x2", px); rule.setAttribute("visibility", "visible");
        const rows = []; ser.forEach(s => { const p = s.pts.reduce((a, b) => (Math.abs(b[0] - at) < Math.abs(a[0] - at) ? b : a)); if (Math.abs(p[0] - at) <= tol) rows.push([p[1], s]); });
        tip.replaceChildren(el("div", "nm", xText(at)));
        rows.sort((a, b) => b[0] - a[0]).forEach(([v, s]) => { const r = el("div", "row"), k = el("span", "key"); k.style.background = s.color; r.append(k, el("strong", "", fmt(v) + (o.unit ? " " + o.unit : "")), el("span", "nm", ser.length > 1 ? " " + s.name : "")); tip.append(r); });
        place(tip, host, px / W * rc.width, root.getBoundingClientRect().top - host.getBoundingClientRect().top + 6);
      });
      root.addEventListener("pointerleave", () => { tip.hidden = true; rule.setAttribute("visibility", "hidden"); });
    });
  }

  /* ---- ranked horizontal bars.  o: { rows:[{label, value, sub, href, mark}], fmt, unit } ---- */
  function bars(host, o) {
    const fmt = o.fmt || short, vals = o.rows.map(r => r.value), hi = Math.max(0, ...vals), lo = Math.min(0, ...vals), span = hi - lo || 1;
    const box = el("div", "bars"); box.setAttribute("role", "list");
    o.rows.forEach(r => {
      const row = el(r.href ? "a" : "div", "barrow" + (r.mark ? " mark" : "")); row.setAttribute("role", "listitem"); if (r.href) row.href = r.href;
      const track = el("span", "rail"), fill = el("i");      // "rail", not "track": the home page ticker owns that class
      const a = (Math.min(0, r.value) - lo) / span * 100, w = Math.abs(r.value) / span * 100;
      fill.style.left = a + "%"; fill.style.width = Math.max(0.4, w) + "%"; if (r.value < 0) fill.classList.add("neg");
      if (lo < 0) { const z = el("b"); z.style.left = (-lo / span * 100) + "%"; track.append(z); }
      track.append(fill);
      const name = el("span", "name", r.label); if (r.sub) name.append(el("small", "", r.sub));
      row.append(name, track, el("span", "val", fmt(r.value) + (o.unit ? " " + o.unit : "")));
      row.title = `${r.label}: ${fmt(r.value)}${o.unit ? " " + o.unit : ""}${r.sub ? " (" + r.sub + ")" : ""}`;
      box.append(row);
    });
    host.replaceChildren(box);
  }

  /* ---- histogram.  o: { values, fmt, label, marks:[{at, name}] } ---- */
  function hist(host, o) {
    keep(host, () => {
      const v = o.values.filter(isFinite), fmt = o.fmt || short;
      if (v.length < 2) { host.replaceChildren(el("p", "hint", "Not enough values to draw.")); return; }
      const lo = Math.min(...v), hi = Math.max(...v), want = Math.max(6, Math.min(40, Math.ceil(Math.log2(v.length) + 1) * 2));
      const xs = scale(lo, hi, want), n = Math.max(1, Math.round((xs.hi - xs.lo) / xs.step)), counts = new Array(n).fill(0);
      v.forEach(x => counts[Math.min(n - 1, Math.max(0, Math.floor((x - xs.lo) / xs.step)))]++);
      const H = o.height || 250, m = { l: 4, r: 8, t: 20, b: 30 }, { W, root, tip } = stage(host, H, o.label);
      const ys = scale(0, Math.max(...counts), 4), sx = x => m.l + (x - xs.lo) / (xs.hi - xs.lo) * (W - m.l - m.r), sy = c => H - m.b - c / ys.hi * (H - m.t - m.b);
      ticks(ys).forEach(c => { root.append(svgEl("line", { x1: m.l, x2: W - m.r, y1: sy(c), y2: sy(c), class: c ? "g-grid" : "g-zero" })); if (c) text(root, m.l, sy(c) - 5, short(c), "g-tick"); });
      counts.forEach((c, i) => {
        const x = sx(xs.lo + i * xs.step) + 1, w = Math.max(1, sx(xs.lo + (i + 1) * xs.step) - sx(xs.lo + i * xs.step) - 2), y = sy(c), r = Math.min(4, w / 2, (H - m.b - y));
        const bar = svgEl("path", { d: c ? `M${x} ${H - m.b}V${y + r}q0 ${-r} ${r} ${-r}h${w - 2 * r}q${r} 0 ${r} ${r}V${H - m.b}Z` : "", style: "fill:var(--s1)" });
        const hitbox = svgEl("rect", { x: x - 1, y: m.t, width: w + 2, height: H - m.t - m.b, fill: "transparent" });
        hitbox.addEventListener("pointermove", e => { tip.replaceChildren(el("div", "nm", `${fmt(xs.lo + i * xs.step)} to ${fmt(xs.lo + (i + 1) * xs.step)}`), el("strong", "", plural(c, "row"))); const rc = host.getBoundingClientRect(); place(tip, host, e.clientX - rc.left, e.clientY - rc.top + 12); });
        root.append(bar, hitbox);
      });
      root.addEventListener("pointerleave", () => { tip.hidden = true; });
      const every = Math.max(1, Math.ceil(n / ((W < 520) ? 4 : 8)));
      for (let i = 0; i <= n; i += every) text(root, sx(xs.lo + i * xs.step), H - 8, fmt(+(xs.lo + i * xs.step).toPrecision(12)), "g-tick", i === 0 ? "start" : i >= n ? "end" : "middle");
      (o.marks || []).forEach(k => { if (!isFinite(k.at)) return; const px = sx(k.at); root.append(svgEl("line", { x1: px, x2: px, y1: m.t - 6, y2: H - m.b, class: "g-rule" })); text(root, px + 5, m.t + 2, k.name, "g-name", px > W - 120 ? "end" : "start").setAttribute("x", px > W - 120 ? px - 5 : px + 5); });
    });
  }

  /* ---- scatter.  o: { pts:[{x,y,label}], xLabel, yLabel, fit:{a,b}, logX, logY, fmtX, fmtY } ---- */
  function scatter(host, o) {
    keep(host, () => {
      const tx = v => (o.logX ? Math.log10(v) : v), ty = v => (o.logY ? Math.log10(v) : v);
      let pts = o.pts.filter(p => isFinite(tx(p.x)) && isFinite(ty(p.y)));
      const total = pts.length, CAP = 4000;
      if (total > CAP) { const step = total / CAP; pts = Array.from({ length: CAP }, (_, i) => pts[Math.floor(i * step)]); }
      if (!pts.length) { host.replaceChildren(el("p", "hint", "No rows have both values.")); return; }
      const H = Math.round(Math.max(300, Math.min(460, (host.clientWidth || 720) * 0.6))), m = { l: 8, r: 14, t: 40, b: 46 }, { W, root, tip } = stage(host, H, o.label);
      const xs = scale(Math.min(...pts.map(p => tx(p.x))), Math.max(...pts.map(p => tx(p.x))), W < 520 ? 4 : 7), ys = scale(Math.min(...pts.map(p => ty(p.y))), Math.max(...pts.map(p => ty(p.y))));
      const sx = v => m.l + (tx(v) - xs.lo) / (xs.hi - xs.lo) * (W - m.l - m.r), sy = v => H - m.b - (ty(v) - ys.lo) / (ys.hi - ys.lo) * (H - m.t - m.b);
      const fx = o.fmtX || short, fy = o.fmtY || short, un = (log, v) => (log ? Math.pow(10, v) : v);
      ticks(ys).forEach(v => { const y = H - m.b - (v - ys.lo) / (ys.hi - ys.lo) * (H - m.t - m.b); root.append(svgEl("line", { x1: m.l, x2: W - m.r, y1: y, y2: y, class: "g-grid" })); text(root, m.l, y - 5, fy(+un(o.logY, v).toPrecision(3)), "g-tick"); });
      ticks(xs).forEach(v => { const x = m.l + (v - xs.lo) / (xs.hi - xs.lo) * (W - m.l - m.r); root.append(svgEl("line", { x1: x, x2: x, y1: H - m.b, y2: H - m.b + 5, class: "g-zero" })); text(root, x, H - m.b + 19, fx(+un(o.logX, v).toPrecision(3)), "g-tick", x < 26 ? "start" : x > W - 30 ? "end" : "middle"); });
      root.append(svgEl("line", { x1: m.l, x2: W - m.r, y1: H - m.b, y2: H - m.b, class: "g-zero" }));
      text(root, (W + m.l - m.r) / 2, H - 6, (o.xLabel || "") + (o.logX ? " (log scale)" : ""), "g-name", "middle"); text(root, m.l, 12, (o.yLabel || "") + (o.logY ? " (log scale)" : ""), "g-name");
      const g = svgEl("g", { style: "fill:var(--s1)", "fill-opacity": total > 800 ? 0.35 : 0.62 });
      pts.forEach(p => g.append(svgEl("circle", { cx: sx(p.x).toFixed(1), cy: sy(p.y).toFixed(1), r: total > 800 ? 2.5 : 4, class: total > 800 ? "" : "g-ring" })));
      root.append(g);
      if (o.fit) { const X0 = xs.lo, X1 = xs.hi, yy = X => H - m.b - ((o.fit.a + o.fit.b * X) - ys.lo) / (ys.hi - ys.lo) * (H - m.t - m.b), xx = X => m.l + (X - xs.lo) / (xs.hi - xs.lo) * (W - m.l - m.r); const clip = svgEl("clipPath", { id: "c" + Math.random().toString(36).slice(2) }); clip.append(svgEl("rect", { x: m.l, y: m.t, width: W - m.l - m.r, height: H - m.t - m.b })); root.append(clip); root.append(svgEl("line", { x1: xx(X0), y1: yy(X0), x2: xx(X1), y2: yy(X1), class: "g-fit", "clip-path": `url(#${clip.id})` })); }
      const ring = svgEl("circle", { r: 7, fill: "none", class: "g-rule", visibility: "hidden" }); root.append(ring);
      root.addEventListener("pointermove", e => {
        const rc = root.getBoundingClientRect(), k = W / rc.width, px = (e.clientX - rc.left) * k, py = (e.clientY - rc.top) * k; let best = null, bd = 22;
        for (const p of pts) { const d = Math.hypot(sx(p.x) - px, sy(p.y) - py); if (d < bd) { bd = d; best = p; } }
        if (!best) { tip.hidden = true; ring.setAttribute("visibility", "hidden"); return; }
        ring.setAttribute("cx", sx(best.x)); ring.setAttribute("cy", sy(best.y)); ring.setAttribute("visibility", "visible");
        tip.replaceChildren(...(best.label ? [el("strong", "", best.label)] : []), el("div", "nm", `${o.xLabel || "x"}: ${fx(best.x)}`), el("div", "nm", `${o.yLabel || "y"}: ${fy(best.y)}`));
        const hc = host.getBoundingClientRect(); place(tip, host, e.clientX - hc.left, e.clientY - hc.top + 12);
      });
      root.addEventListener("pointerleave", () => { tip.hidden = true; ring.setAttribute("visibility", "hidden"); });
      if (total > CAP) host.append(el("p", "cap", `Showing ${CAP.toLocaleString("en-US")} evenly spaced rows of ${total.toLocaleString("en-US")}. The numbers above use all of them.`));
    });
  }

  /* ---- one row per group: every value as a dot, a box for the middle half, a bar at the median.  o: { groups:[{name, values}], fmt, label } ---- */
  function strip(host, o) {
    keep(host, () => {
      const G = o.groups.filter(g => g.values.length), fmt = o.fmt || short;
      if (!G.length) { host.replaceChildren(el("p", "hint", "No values to draw.")); return; }
      const small = (host.clientWidth || 720) < 560, rowH = 50, m = { l: small ? 8 : 210, r: 14, t: small ? 8 : 10, b: 34 }, H = m.t + m.b + G.length * (rowH + (small ? 22 : 0));
      const { W, root, tip } = stage(host, H, o.label), all = G.flatMap(g => g.values), xs = scale(Math.min(...all), Math.max(...all), small ? 4 : 7);
      const sx = v => m.l + (v - xs.lo) / (xs.hi - xs.lo) * (W - m.l - m.r), q = (a, p) => { const i = (a.length - 1) * p, f = Math.floor(i); return a[f] + (a[Math.min(a.length - 1, f + 1)] - a[f]) * (i - f); };
      ticks(xs).forEach(v => { root.append(svgEl("line", { x1: sx(v), x2: sx(v), y1: m.t, y2: H - m.b, class: "g-grid" })); text(root, sx(v), H - 12, fmt(v), "g-tick", "middle"); });
      G.forEach((g, i) => {
        const top = m.t + i * (rowH + (small ? 22 : 0)) + (small ? 22 : 0), cy = top + rowH / 2, s = [...g.values].sort((a, b) => a - b), med = q(s, 0.5), q1 = q(s, 0.25), q3 = q(s, 0.75);
        if (small) text(root, m.l, top - 6, `${g.name}  (${s.length}, median ${fmt(med)})`, "g-name");
        else { text(root, m.l - 14, cy - 2, g.name.length > 26 ? g.name.slice(0, 25) + "…" : g.name, "g-val", "end").style.fontSize = "14px"; text(root, m.l - 14, cy + 14, `${plural(s.length, "row")}, median ${fmt(med)}`, "g-name", "end"); }
        const step = Math.max(1, s.length / 320), dots = svgEl("g", { style: `fill:${S(0)}`, "fill-opacity": 0.5 });
        for (let k = 0; k < s.length; k += step) { const v = s[Math.floor(k)], j = ((Math.sin((Math.floor(k) + 1) * 12.9898 + i * 78.233) * 43758.5453) % 1); dots.append(svgEl("circle", { cx: sx(v).toFixed(1), cy: (cy + j * (rowH * 0.3)).toFixed(1), r: 3 })); }
        root.append(dots, svgEl("rect", { x: sx(q1), y: cy - 15, width: Math.max(1, sx(q3) - sx(q1)), height: 30, class: "g-box" }), svgEl("line", { x1: sx(med), x2: sx(med), y1: cy - 18, y2: cy + 18, class: "g-med" }));
        const hitbox = svgEl("rect", { x: m.l, y: top, width: W - m.l - m.r, height: rowH, fill: "transparent" });
        hitbox.addEventListener("pointermove", e => { tip.replaceChildren(el("strong", "", g.name), el("div", "nm", `${plural(s.length, "row")}`), el("div", "nm", `Median ${fmt(med)}; middle half ${fmt(q1)} to ${fmt(q3)}`), el("div", "nm", `Lowest ${fmt(s[0])}, highest ${fmt(s[s.length - 1])}`)); const hc = host.getBoundingClientRect(); place(tip, host, e.clientX - hc.left, e.clientY - hc.top + 12); });
        root.append(hitbox);
      });
      root.addEventListener("pointerleave", () => { tip.hidden = true; });
    });
  }

  /* ---- correlation grid: blue for moving together, orange for moving apart, blank near zero.  o: { labels, m:[[r]], n:[[count]] } ---- */
  function heat(host, o) {
    const t = el("table", "heat"), head = el("tr"); head.append(el("th"));
    o.labels.forEach((l, j) => { const th = el("th", "", String(j + 1)); th.title = l; head.append(th); });
    t.append(head);
    o.labels.forEach((l, i) => {
      const tr = el("tr"); tr.append(el("th", "", `${i + 1}. ${l}`));
      o.labels.forEach((l2, j) => {
        const r = o.m[i][j], td = el("td", "", i === j ? "" : isFinite(r) ? r.toFixed(2) : "–");
        if (i !== j && isFinite(r)) { td.style.background = `color-mix(in srgb, var(${r >= 0 ? "--s1" : "--s2"}) ${Math.round(Math.min(1, Math.abs(r)) * 62)}%, var(--bg))`; td.title = `${l} and ${l2}: r = ${r.toFixed(3)}${o.n ? `, ${o.n[i][j].toLocaleString("en-US")} rows` : ""}`; }
        tr.append(td);
      });
      t.append(tr);
    });
    const key = el("p", "cap"); key.append(document.createTextNode("Blue: the two rise together. Orange: one rises as the other falls. The deeper the colour, the tighter the link. Numbers are Pearson correlations."));
    const wrap = el("div", "tablewrap"); wrap.append(t); host.replaceChildren(wrap, key);
  }

  return { line, bars, hist, scatter, strip, heat, short, scale };
})();
