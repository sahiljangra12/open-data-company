/* Home page: live earthquake globe, value ticker, running counters, self-drawing charts, dataset tiles. */
const $ = (s, r = document) => r.querySelector(s);
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
const svg = (tag, attrs = {}) => { const e = document.createElementNS("http://www.w3.org/2000/svg", tag); for (const k in attrs) e.setAttribute(k, attrs[k]); return e; };
const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
const FEED = "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_day.geojson";
const DARK = ["#3987e5", "#d95926", "#199e70", "#c98500", "#d55181", "#0ca30c", "#9085e9", "#e66767"];   // chart series on black, fixed order
const ago = ms => { const m = Math.max(0, Math.round((Date.now() - ms) / 60000)); return m < 1 ? "just now" : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`; };
const onScreen = (node, cb) => new IntersectionObserver(es => cb(es[0].isIntersecting), { rootMargin: "80px" }).observe(node);

/* ---------- globe ---------- */
function makeGlobe(box, land) {
  const cv = $("canvas", box), ctx = cv.getContext("2d"), tip = $("#gtip"), RAD = Math.PI / 180;
  const vec = (lon, lat) => [Math.cos(lat * RAD) * Math.sin(lon * RAD), Math.sin(lat * RAD), Math.cos(lat * RAD) * Math.cos(lon * RAD)];
  const L = new Float32Array(land.length / 2 * 3);
  for (let i = 0; i < land.length; i += 2) L.set(vec(land[i], land[i + 1]), i / 2 * 3);
  let rot = 100 * RAD, tilt = 20 * RAD, quakes = [], dpr = 1, visible = true, drag = null, last = 0, raf = 0, first = true;
  const seen = new Set();

  function size() {
    dpr = Math.min(2, devicePixelRatio || 1);
    const w = Math.round(box.clientWidth * dpr);
    if (w && cv.width !== w) { cv.width = w; cv.height = w; }
    draw(performance.now());
  }

  function draw(now) {
    const w = cv.width, R = w * 0.44, cx = w / 2, cy = w / 2;
    if (!w) return;
    ctx.clearRect(0, 0, w, w);
    let g = ctx.createRadialGradient(cx, cy, R * 0.92, cx, cy, R * 1.13);
    g.addColorStop(0, "rgba(70,140,255,.30)"); g.addColorStop(1, "rgba(70,140,255,0)");
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cx, cy, R * 1.13, 0, 7); ctx.fill();
    g = ctx.createRadialGradient(cx - R * 0.35, cy - R * 0.42, R * 0.05, cx, cy, R);
    g.addColorStop(0, "#17263f"); g.addColorStop(1, "#04060b");
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cx, cy, R, 0, 7); ctx.fill();
    ctx.strokeStyle = "rgba(150,190,255,.28)"; ctx.lineWidth = dpr; ctx.stroke();

    const ca = Math.cos(rot), sa = Math.sin(rot), ct = Math.cos(tilt), st = Math.sin(tilt), s = Math.max(1, R / 300);
    const bucket = [[], [], [], []];
    for (let i = 0; i < L.length; i += 3) {
      const z1 = L[i + 2] * ca - L[i] * sa, z = L[i + 1] * st + z1 * ct;
      if (z <= 0) continue;
      bucket[Math.min(3, (z * 4) | 0)].push(cx + R * (L[i] * ca + L[i + 2] * sa), cy - R * (L[i + 1] * ct - z1 * st));
    }
    bucket.forEach((b, k) => {
      ctx.fillStyle = `rgba(186,206,238,${0.2 + k * 0.2})`; ctx.beginPath();
      for (let i = 0; i < b.length; i += 2) { ctx.moveTo(b[i] + s, b[i + 1]); ctx.arc(b[i], b[i + 1], s, 0, 6.2832); }
      ctx.fill();
    });

    const t = Date.now(), u = Math.max(0.75 * dpr, R / 330);     // marker unit: scales with the globe
    for (const q of quakes) {
      const z1 = q.v[2] * ca - q.v[0] * sa, z = q.v[1] * st + z1 * ct;
      q.x = cx + R * (q.v[0] * ca + q.v[2] * sa); q.y = cy - R * (q.v[1] * ct - z1 * st); q.front = z > 0.03;
      if (!q.front) continue;
      const k = Math.min(1, Math.max(0, (q.mag - 0.5) / 5.5)), r = (1.2 + k * 6.2) * u * (0.55 + 0.45 * z);
      q.r = r;
      const fresh = t - q.time < 3600e3, isNew = now - q.born < 9000;
      if (fresh || isNew || q.mag >= 4.5) {
        const ph = reduce ? 0.45 : ((now + q.phase) % 2600) / 2600, reach = (isNew ? 36 : 13) * u;
        ctx.strokeStyle = `rgba(255,176,84,${(1 - ph) * (isNew ? 0.95 : 0.55)})`; ctx.lineWidth = u * (isNew ? 2 : 1.1);
        ctx.beginPath(); ctx.arc(q.x, q.y, r + ph * reach, 0, 7); ctx.stroke();
      }
      ctx.fillStyle = `rgba(255,150,46,${0.08 + k * 0.2})`; ctx.beginPath(); ctx.arc(q.x, q.y, r * 1.9, 0, 7); ctx.fill();
      ctx.fillStyle = `hsla(${30 + k * 16},100%,${50 + k * 34}%,${0.72 + k * 0.28})`; ctx.beginPath(); ctx.arc(q.x, q.y, r, 0, 7); ctx.fill();
    }
  }

  function loop(now) {
    raf = 0;
    if (!visible || document.hidden) return;
    if (!drag && !reduce) rot += Math.min(64, now - last) / 1000 * 4.2 * RAD;
    last = now; draw(now);
    if (!reduce) raf = requestAnimationFrame(loop);
  }
  const kick = () => { if (reduce) draw(performance.now()); else if (!raf) { last = performance.now(); raf = requestAnimationFrame(loop); } };

  cv.addEventListener("pointerdown", e => { drag = { x: e.clientX, y: e.clientY }; cv.setPointerCapture(e.pointerId); tip.hidden = true; });
  cv.addEventListener("pointermove", e => {
    if (drag) {
      rot += (e.clientX - drag.x) * 0.006; tilt = Math.max(-1.1, Math.min(1.1, tilt + (e.clientY - drag.y) * 0.004));
      drag = { x: e.clientX, y: e.clientY }; if (reduce) draw(performance.now()); return;
    }
    const rc = cv.getBoundingClientRect(), k = cv.width / rc.width, px = (e.clientX - rc.left) * k, py = (e.clientY - rc.top) * k;
    let best = null, bd = 16 * dpr;                      // nearest marker edge within 16px wins
    for (const q of quakes) { if (!q.front) continue; const d = Math.hypot(q.x - px, q.y - py) - q.r; if (d < bd) { bd = d; best = q; } }
    if (!best) { tip.hidden = true; return; }
    tip.replaceChildren(el("strong", "", `Magnitude ${best.mag.toFixed(1)}`), el("div", "", best.place), el("div", "nm", ago(best.time)));
    tip.hidden = false;
    tip.style.left = Math.min(rc.width - 190, Math.max(0, e.clientX - rc.left + 14)) + "px"; tip.style.top = (e.clientY - rc.top + 14) + "px";
  });
  const end = () => { drag = null; };
  cv.addEventListener("pointerup", end); cv.addEventListener("pointercancel", end);
  cv.addEventListener("pointerleave", () => { tip.hidden = true; });
  new ResizeObserver(size).observe(box);
  onScreen(box, v => { visible = v; if (v) kick(); });
  document.addEventListener("visibilitychange", kick);
  size(); kick();

  return {
    set(list) {
      const now = performance.now();
      quakes = list.map(q => ({ ...q, v: vec(q.lon, q.lat), phase: (q.time % 2600), born: first || seen.has(q.id) ? -1e9 : now })).sort((a, b) => a.mag - b.mag);
      list.forEach(q => seen.add(q.id)); first = false;
      if (reduce) draw(now);
    },
  };
}

/* ---------- live feed ---------- */
function liveFeed(globe, snapshot) {
  const dot = $("#live-dot"), text = $("#live-text");
  let list = [], mode = "";
  const put = (id, a, b) => { $(id).textContent = a; $(id + "-s").textContent = b; };
  function readouts() {
    if (!list.length) return;
    const strong = list.reduce((a, b) => (b.mag > a.mag ? b : a)), recent = list.reduce((a, b) => (b.time > a.time ? b : a));
    const big = list.filter(q => q.mag >= 2.5).length;
    put("#q-count", list.length.toLocaleString("en-US"), mode === "live" ? `${big} of them magnitude 2.5 or stronger` : "Magnitude 2.5 and stronger only");
    put("#q-max", `M ${strong.mag.toFixed(1)}`, `${strong.place}, ${ago(strong.time)}`);
    put("#q-last", `M ${recent.mag.toFixed(1)}`, `${recent.place}, ${ago(recent.time)}`);
  }
  function show(qs, how, label) { list = qs; mode = how; globe.set(qs); dot.classList.toggle("on", how === "live"); text.textContent = label; readouts(); }
  async function poll() {
    if (document.hidden) return;
    try {
      const r = await fetch(FEED, { cache: "no-store" });
      if (!r.ok) throw new Error(r.status);
      const j = await r.json();
      const qs = j.features.filter(f => f.geometry && f.properties && typeof f.properties.mag === "number" && f.properties.time)
        .map(f => ({ id: f.id, lon: f.geometry.coordinates[0], lat: f.geometry.coordinates[1], mag: f.properties.mag, time: f.properties.time, place: f.properties.place || "Location not named" }));
      show(qs, "live", `Live from the US Geological Survey. Updated ${new Date().toLocaleTimeString()}, and again every minute.`);
    } catch (e) {
      if (mode === "live") { dot.classList.remove("on"); text.textContent = "The live feed did not answer just now. Showing the last update and trying again each minute."; return; }
      if (snapshot && snapshot.events && snapshot.events.length) {
        const qs = snapshot.events.map((q, i) => ({ id: "s" + i, lon: q[0], lat: q[1], mag: q[2], time: Date.parse(q[3]), place: q[4] || "Location not named" }));
        show(qs, "saved", `The live feed is not reachable from this network. Showing the 24 hours up to ${new Date(snapshot.asof).toLocaleString()}.`);
      } else text.textContent = "The live earthquake feed is not reachable from this network right now.";
    }
  }
  poll(); setInterval(poll, 60000); setInterval(readouts, 30000);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) poll(); });
}

/* ---------- ticker ---------- */
function ticker(items) {
  const track = $("#track");
  if (!items.length) { $("#ticker").hidden = true; return; }
  const one = (t, copy) => {
    const a = el("a", "tk"); a.href = t.href;
    if (copy) { a.tabIndex = -1; a.setAttribute("aria-hidden", "true"); }
    const dir = t.change > 0 ? "▲" : t.change < 0 ? "▼" : "•", amt = Math.abs(t.change).toFixed(2).replace(/\.?0+$/, "") + (t.change_unit === "%" ? "%" : " points");
    a.append(el("span", "l", t.label), el("strong", "", t.display), el("span", "l", t.unit), el("span", "d", `${dir} ${amt} from ${t.versus === "previous trading day" ? "the day before" : t.versus}`), el("span", "d", t.asof));
    return a;
  };
  items.forEach(t => track.append(one(t, false)));
  if (!reduce) items.forEach(t => track.append(one(t, true)));
  requestAnimationFrame(() => track.style.setProperty("--dur", Math.round(track.scrollWidth / 2 / 55) + "s"));
}

/* ---------- running counters ---------- */
function counters(c) {
  const box = $("#counters"), YEAR = 365.25 * 864e5, start = Date.UTC(new Date().getUTCFullYear(), 0, 1), rows = [];
  const add = (f, label) => { const d = el("div", "counter"), n = el("strong"); d.append(n, el("span", "", label)); box.append(d); rows.push([n, f]); };
  if (c.co2) add(now => c.co2.per_year * (now - start) / YEAR, `tonnes of CO2 from fossil fuels and industry, at ${c.co2.year}'s pace`);
  if (c.electricity) add(now => c.electricity.per_year * (now - start) / YEAR, `megawatt-hours of electricity generated worldwide, at ${c.electricity.year}'s pace`);
  if (c.population) add(now => c.population.value * Math.pow(1 + c.population.growth, (now - Date.UTC(c.population.year, 6, 1)) / YEAR), `people in the world, projected from the World Bank's ${c.population.year} count`);
  if (!rows.length) { $("#now").hidden = true; return; }
  let on = true;
  const tickAll = () => { if (!on || document.hidden) return; const now = Date.now(); rows.forEach(([n, f]) => n.textContent = Math.floor(f(now)).toLocaleString("en-US")); };
  onScreen(box, v => { on = v; }); on = true; tickAll();
  setInterval(tickAll, reduce ? 5000 : 110);
}

/* ---------- featured charts ---------- */
function stories(list) {
  if (!list.length) { $("#stories").hidden = true; return; }
  const pills = $("#pills"), plot = $("#st-plot"), panel = $("#story");
  let cur = 0, auto = !reduce, elapsed = 0, prev = performance.now(), held = false, seenOnce = false, vis = false;
  const DWELL = 9000;
  const val = (st, v) => (st.unit === "$" ? "$" : "") + v.toFixed(st.decimals) + (st.unit === "%" ? "%" : "");
  const withUnit = (st, v) => val(st, v) + (st.unit === "$" || st.unit === "%" ? "" : " " + st.unit);
  const X = (st, x) => st.x === "year" ? +x : Date.parse(x);
  const xText = (st, x) => st.x === "year" ? String(x) : new Date(x).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" });

  list.forEach((st, i) => {
    const b = el("button", "pill", st.tab); b.type = "button"; b.setAttribute("role", "tab"); b.append(el("i"));
    b.onclick = () => { auto = false; pick(i, true); };
    pills.append(b);
  });

  function draw(st, animate) {
    const W = plot.clientWidth || 900, small = W < 600, H = Math.round(Math.max(280, Math.min(460, W * 0.5)));
    const m = { l: 4, r: small ? 58 : 124, t: 22, b: 30 };
    const S = st.series.map((s, i) => ({ name: s.name, color: DARK[i], pts: s.pts.map(p => [X(st, p[0]), p[1], p[0]]) }));
    const all = S.flatMap(s => s.pts), x0 = Math.min(...all.map(p => p[0])), x1 = Math.max(...all.map(p => p[0]));
    let y1 = Math.max(...all.map(p => p[1]));
    const raw = y1 / 4, pw = Math.pow(10, Math.floor(Math.log10(raw))), f = raw / pw, step = (f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10) * pw;
    y1 = Math.ceil(y1 / step) * step;
    const sx = v => m.l + (v - x0) / (x1 - x0) * (W - m.l - m.r), sy = v => H - m.b - v / y1 * (H - m.t - m.b);
    const root = svg("svg", { viewBox: `0 0 ${W} ${H}`, height: H, tabindex: 0, role: "img",
      "aria-label": `${st.title}. ${S.map(s => `${s.name}: ${withUnit(st, s.pts[s.pts.length - 1][1])} in ${xText(st, s.pts[s.pts.length - 1][2])}`).join(". ")}. Use the left and right arrow keys to read values.` });
    for (let v = 0; v <= y1 + step / 2; v += step) {
      root.append(svg("line", { x1: m.l, x2: W - m.r, y1: sy(v), y2: sy(v), stroke: v ? "rgba(255,255,255,.12)" : "rgba(255,255,255,.3)" }));
      const tx = svg("text", { x: m.l, y: sy(v) - 6, fill: "#86868b", "font-size": 12 }); tx.textContent = val({ ...st, decimals: step < 1 ? 1 : 0 }, v); if (v) root.append(tx);
    }
    const yr = v => st.x === "year" ? v : new Date(v).getUTCFullYear() + (v - Date.UTC(new Date(v).getUTCFullYear(), 0, 1)) / 31557600000;
    const span = yr(x1) - yr(x0), ys = [1, 2, 5, 10, 20, 25, 50].find(s => span / s <= (small ? 4 : 8)) || 50;
    for (let y = Math.ceil(yr(x0) / ys) * ys; y <= yr(x1) + 1e-9; y += ys) {
      const px = sx(st.x === "year" ? y : Date.UTC(y, 0, 1));
      root.append(svg("line", { x1: px, x2: px, y1: H - m.b, y2: H - m.b + 5, stroke: "rgba(255,255,255,.3)" }));
      const tx = svg("text", { x: px, y: H - 8, fill: "#86868b", "font-size": 12, "text-anchor": px < 24 ? "start" : "middle" }); tx.textContent = y; root.append(tx);
    }
    const ends = S.map(s => sy(s.pts[s.pts.length - 1][1])), sorted = [...ends].sort((a, b) => a - b);
    const clash = sorted.some((y, i) => i && y - sorted[i - 1] < 34);
    const late = [];
    S.forEach((s, i) => {
      const d = s.pts.map((p, j) => (j ? "L" : "M") + sx(p[0]).toFixed(1) + " " + sy(p[1]).toFixed(1)).join("");
      const path = svg("path", { d, fill: "none", stroke: s.color, "stroke-width": 2, "stroke-linejoin": "round", "stroke-linecap": "round" });
      root.append(path);
      const lastP = s.pts[s.pts.length - 1], ex = sx(lastP[0]), ey = ends[i];
      const g = svg("g"); g.append(svg("circle", { cx: ex, cy: ey, r: 5, fill: s.color, stroke: "#000", "stroke-width": 2 }));
      if (!clash) {
        const v = svg("text", { x: ex + 12, y: ey + (S.length > 1 && !small ? -1 : 5), fill: "#f5f5f7", "font-size": 15, "font-weight": 600 }); v.textContent = val(st, lastP[1]); g.append(v);
        if (S.length > 1 && !small) { const n = svg("text", { x: ex + 12, y: ey + 15, fill: "#a1a1a6", "font-size": 12 }); n.textContent = s.name; g.append(n); }
      }
      root.append(g); late.push(g);
      if (animate) { path.dataset.anim = "1"; g.style.opacity = 0; }
    });
    const rule = svg("line", { y1: m.t - 8, y2: H - m.b, stroke: "rgba(255,255,255,.55)", visibility: "hidden" }); root.append(rule);
    const tip = el("div", "tip"); tip.hidden = true;
    plot.replaceChildren(root, tip);
    if (animate) {
      root.querySelectorAll("path[data-anim]").forEach(p => {
        const len = p.getTotalLength(); p.style.strokeDasharray = len; p.style.strokeDashoffset = len; p.getBoundingClientRect();
        p.style.transition = "stroke-dashoffset 1.9s cubic-bezier(.45,0,.2,1)"; p.style.strokeDashoffset = 0;
      });
      late.forEach(g => { g.style.transition = "opacity .5s ease 1.7s"; requestAnimationFrame(() => { g.style.opacity = 1; }); });
    }
    // crosshair and readout, by pointer or arrow keys
    const xs = [...new Set(all.map(p => p[0]))].sort((a, b) => a - b);
    let idx = xs.length - 1;
    const at = i => {
      idx = Math.max(0, Math.min(xs.length - 1, i)); const xv = xs[idx], px = sx(xv), tol = (x1 - x0) / 120;
      rule.setAttribute("x1", px); rule.setAttribute("x2", px); rule.setAttribute("visibility", "visible");
      const rows = [], near = S.map(s => s.pts.reduce((a, b) => (Math.abs(b[0] - xv) < Math.abs(a[0] - xv) ? b : a)));
      tip.replaceChildren(el("div", "nm", xText(st, near[0][2])));
      S.forEach((s, k) => { if (Math.abs(near[k][0] - xv) > tol) return; const r = el("div", "row"), key = el("span", "key"); key.style.background = s.color; r.append(key, el("strong", "", withUnit(st, near[k][1])), el("span", "nm", " " + s.name)); rows.push([near[k][1], r]); });
      rows.sort((a, b) => b[0] - a[0]).forEach(r => tip.append(r[1]));
      tip.hidden = false; tip.style.left = Math.max(0, Math.min(W - 210, px + 14)) + "px"; tip.style.top = "8px";
    };
    const hide = () => { tip.hidden = true; rule.setAttribute("visibility", "hidden"); };
    root.addEventListener("pointermove", e => { const rc = root.getBoundingClientRect(), xv = x0 + ((e.clientX - rc.left) / rc.width * W - m.l) / (W - m.l - m.r) * (x1 - x0); let b = 0; xs.forEach((x, i) => { if (Math.abs(x - xv) < Math.abs(xs[b] - xv)) b = i; }); at(b); });
    root.addEventListener("pointerleave", hide); root.addEventListener("blur", hide);
    root.addEventListener("keydown", e => { if (e.key === "ArrowLeft") { at(idx - 1); e.preventDefault(); } else if (e.key === "ArrowRight") { at(idx + 1); e.preventDefault(); } else if (e.key === "Escape") hide(); });
    root.addEventListener("focus", () => { if (root.matches(":focus-visible")) at(xs.length - 1); });

    const keys = $("#st-keys"); keys.replaceChildren();
    if (S.length > 1) S.forEach(s => { const k = el("span"), sw = el("i"); sw.style.background = s.color; k.append(sw, document.createTextNode(s.name), el("strong", "", withUnit(st, s.pts[s.pts.length - 1][1]))); keys.append(k); });
    else { const lastP = S[0].pts[S[0].pts.length - 1], k = el("span", "", `Latest, ${xText(st, lastP[2])}`); k.append(el("strong", "", withUnit(st, lastP[1]))); keys.append(k); }
  }

  function pick(i, animate) {
    cur = (i + list.length) % list.length; const st = list[cur];
    [...pills.children].forEach((b, k) => { b.setAttribute("aria-selected", k === cur); $("i", b).style.width = "0"; });
    $("#st-title").textContent = st.title; $("#st-note").textContent = st.note; $("#st-link").href = st.href;
    draw(st, animate && !reduce); elapsed = 0;
  }
  function frame(now) {
    const dt = Math.min(100, now - prev); prev = now;
    if (auto && vis && !held && !document.hidden) {
      elapsed += dt;
      if (elapsed >= DWELL) pick(cur + 1, true); else $("i", pills.children[cur]).style.width = (elapsed / DWELL * 100).toFixed(1) + "%";
    }
    requestAnimationFrame(frame);
  }
  panel.addEventListener("pointerenter", () => { held = true; }); panel.addEventListener("pointerleave", () => { held = false; });
  panel.addEventListener("focusin", () => { held = true; }); panel.addEventListener("focusout", () => { held = false; });
  onScreen(panel, v => { vis = v; if (v && !seenOnce) { seenOnce = true; pick(cur, true); } });
  let rs = 0; addEventListener("resize", () => { clearTimeout(rs); rs = setTimeout(() => draw(list[cur], false), 150); });
  pick(0, false);
  if (!reduce) requestAnimationFrame(frame);
}

/* ---------- dataset tiles ---------- */
function tiles(D, sparks) {
  const box = $("#tiles");
  const spark = s => {
    const w = el("div", "spark"), lo = Math.min(...s.pts), hi = Math.max(...s.pts), n = s.pts.length, y = v => 4 + (1 - (v - lo) / (hi - lo || 1)) * 92;
    const sv = svg("svg", { viewBox: "0 0 100 100", preserveAspectRatio: "none", "aria-hidden": "true" });
    sv.append(svg("path", { d: s.pts.map((v, i) => (i ? "L" : "M") + (i / (n - 1) * 100).toFixed(2) + " " + y(v).toFixed(2)).join(""), fill: "none", stroke: "#86868b", "stroke-width": 1.6, "vector-effect": "non-scaling-stroke", "stroke-linejoin": "round" }));
    const dot = el("b"); dot.style.left = "100%"; dot.style.top = y(s.pts[n - 1]) + "%";
    w.append(sv, dot); return w;
  };
  function draw() {
    const q = $("#q").value.trim().toLowerCase(), r = $("#f-region").value;
    const rows = D.filter(s => (!r || s.region === r) && (!q || (s.title + " " + s.description + " " + s.domain + " " + s.source + " " + s.columns.map(c => c.title + " " + c.name).join(" ")).toLowerCase().includes(q)));
    box.replaceChildren(...rows.map(s => {
      const a = el("a", "tile"); a.href = `explore.html#d=${encodeURIComponent(s.id)}`;
      a.append(el("span", "where", `${s.region === "US" ? "United States" : "World"}, ${s.domain.toLowerCase()}`), el("h3", "", s.title), el("p", "", s.description));
      const dl = el("dl", "facts");
      [["Variables", s.columns.length], ["Rows", s.rows.toLocaleString("en-US")], ["Coverage", s.coverage || `${String(s.time.min).slice(0, 4)} to ${String(s.time.max).slice(0, 4)}`]]
        .forEach(([k, v]) => { const d = el("div"); d.append(el("dt", "", k), el("dd", "", v)); dl.append(d); });
      a.append(dl);
      if (sparks[s.id]) a.append(spark(sparks[s.id]), el("span", "sl", sparks[s.id].label));
      a.append(el("span", "src", `${s.source}. ${s.licence.split("(")[0].split(";")[0].trim()}.`));
      return a;
    }));
    if (!rows.length) box.append(el("p", "empty", "No datasets match that search. Try a broader word, or clear the box to see them all."));
  }
  ["q", "f-region"].forEach(id => $("#" + id).addEventListener("input", draw));
  draw();
}

/* ---------- start ---------- */
(async () => {
  const get = u => fetch(u).then(r => { if (!r.ok) throw new Error(u); return r.json(); });
  const [land, pulse, sets, cat] = await Promise.all([get("data/land.json"), get("data/pulse.json").catch(() => ({})), get("data/datasets.json"), get("data/catalog.json").catch(() => null)]);
  liveFeed(makeGlobe($("#globe"), land), pulse.quakes);
  ticker(pulse.tickers || []);
  counters(pulse.counters || {});
  stories(pulse.stories || []);
  tiles(sets.datasets, pulse.sparks || {});
  if (cat) $("#n-src").textContent = cat.count;
})().catch(e => { console.error(e); $("#live-text").textContent = "This page could not load its data. Reload to try again."; });
