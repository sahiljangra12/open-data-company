/* Home page: the live Earth, value ticker, running counters, self-drawing charts, dataset list, world map, update clock. */
/* needs core.js and earth.js */
const svg = svgEl;
const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
const FEED = "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_day.geojson";
const SERIES = [1, 2, 3, 4, 5, 6, 7, 8].map(i => `var(--s${i})`);   // chart series, fixed order; the theme supplies the values
const ago = ms => { const m = Math.max(0, Math.round((Date.now() - ms) / 60000)); return m < 1 ? "just now" : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`; };
const onScreen = (node, cb) => new IntersectionObserver(es => cb(es[0].isIntersecting), { rootMargin: "80px" }).observe(node);

/* ---------- globe ---------- */
function makeGlobe(box, land) {
  const cv = $("canvas.marks", box), ctx = cv.getContext("2d"), tip = $("#gtip"), RAD = Math.PI / 180;
  const ecv = $("canvas.earth", box), earth = makeEarth(ecv);       // the photo Earth; if it cannot start, the dotted globe below is drawn instead
  const vec = (lon, lat) => [Math.cos(lat * RAD) * Math.sin(lon * RAD), Math.sin(lat * RAD), Math.cos(lat * RAD) * Math.cos(lon * RAD)];
  const L = new Float32Array(land.length / 2 * 3);
  for (let i = 0; i < land.length; i += 2) L.set(vec(land[i], land[i + 1]), i / 2 * 3);
  let rot = -(sunNow().lon + 38) * RAD, tilt = 18 * RAD, quakes = [], dpr = 1, visible = true, drag = null, last = 0, raf = 0, first = true;   // starts on the sunlit side, with dusk and the first city lights at the right edge
  const seen = new Set();

  function size() {
    dpr = Math.min(2, devicePixelRatio || 1);
    const w = Math.round(box.clientWidth * dpr);
    if (w && cv.width !== w) { cv.width = w; cv.height = w; ecv.width = w; ecv.height = w; }
    draw(performance.now());
  }

  function draw(now) {
    const w = cv.width, R = w * 0.44, cx = w / 2, cy = w / 2;
    if (!w) return;
    ctx.clearRect(0, 0, w, w);
    const photo = earth.ready; ecv.hidden = !photo;
    if (photo) earth.draw(w, R, rot, tilt); else dots(w, R, cx, cy);
    marks(now, R, cx, cy, photo);
  }

  function dots(w, R, cx, cy) {
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
  }

  function marks(now, R, cx, cy, photo) {
    const ca = Math.cos(rot), sa = Math.sin(rot), ct = Math.cos(tilt), st = Math.sin(tilt);
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
      if (photo) { ctx.strokeStyle = "rgba(60,20,0,.75)"; ctx.lineWidth = Math.max(1, u * 0.7); ctx.stroke(); }      // an edge, so a dot reads over bright cloud and desert too
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
  earth.onready = () => { if (reduce) draw(performance.now()); };
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
  function readouts() {
    if (!list.length) return;
    const strong = list.reduce((a, b) => (b.mag > a.mag ? b : a));
    $("#q-count").textContent = list.length.toLocaleString("en-US");
    $("#q-max").textContent = `M ${strong.mag.toFixed(1)}`; $("#q-max-s").textContent = `strongest: ${strong.place}, ${ago(strong.time)}`;
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
      show(qs, "live", `Live from the US Geological Survey, updated ${new Date().toLocaleTimeString()}`);
    } catch (e) {
      if (mode === "live") { dot.classList.remove("on"); text.textContent = "The live feed did not answer just now. Trying again each minute."; return; }
      if (snapshot && snapshot.events && snapshot.events.length) {
        const qs = snapshot.events.map((q, i) => ({ id: "s" + i, lon: q[0], lat: q[1], mag: q[2], time: Date.parse(q[3]), place: q[4] || "Location not named" }));
        show(qs, "saved", `Live feed not reachable here. Showing magnitude 2.5 and up for the 24 hours to ${new Date(snapshot.asof).toLocaleString()}`);
      } else text.textContent = "The live earthquake feed is not reachable from this network right now";
    }
  }
  const sun = () => { $("#sun-note").textContent = `Day and night shown as they are now, ${new Date().toISOString().slice(11, 16)} UTC. Photos: NASA.`; };
  sun(); setInterval(sun, 30000);
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
    const dir = t.change > 0 ? "▲" : t.change < 0 ? "▼" : "•", amt = Math.abs(t.change).toFixed(2).replace(/\.?0+$/, "") + t.change_unit;
    a.append(el("span", "l", t.label), el("strong", "", t.display), el("span", "l", t.unit), el("span", "d", `${dir} ${amt} from ${t.versus}`), el("span", "d", t.asof));
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
    const S = st.series.map((s, i) => ({ name: s.name, color: SERIES[i], pts: s.pts.map(p => [X(st, p[0]), p[1], p[0]]) }));
    const all = S.flatMap(s => s.pts), x0 = Math.min(...all.map(p => p[0])), x1 = Math.max(...all.map(p => p[0]));
    let y1 = Math.max(...all.map(p => p[1])), y0 = Math.min(0, ...all.map(p => p[1]));
    const raw = (y1 - y0) / 4, pw = Math.pow(10, Math.floor(Math.log10(raw))), f = raw / pw, step = (f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10) * pw;
    y1 = Math.ceil(y1 / step) * step; y0 = Math.floor(y0 / step) * step;
    const sx = v => m.l + (v - x0) / (x1 - x0) * (W - m.l - m.r), sy = v => H - m.b - (v - y0) / (y1 - y0) * (H - m.t - m.b);
    const root = svg("svg", { viewBox: `0 0 ${W} ${H}`, height: H, tabindex: 0, role: "img",
      "aria-label": `${st.title}. ${S.map(s => `${s.name}: ${withUnit(st, s.pts[s.pts.length - 1][1])} in ${xText(st, s.pts[s.pts.length - 1][2])}`).join(". ")}. Use the left and right arrow keys to read values.` });
    for (let k = Math.round(y0 / step); k * step <= y1 + step / 2; k++) {
      const v = k * step;
      root.append(svg("line", { x1: m.l, x2: W - m.r, y1: sy(v), y2: sy(v), class: k ? "g-grid" : "g-zero" }));
      const tx = svg("text", { x: m.l, y: sy(v) - 6, class: "g-tick" }); tx.textContent = val({ ...st, decimals: step < 1 ? 1 : 0 }, v); if (k || y0 < 0) root.append(tx);
    }
    const yr = v => st.x === "year" ? v : new Date(v).getUTCFullYear() + (v - Date.UTC(new Date(v).getUTCFullYear(), 0, 1)) / 31557600000;
    const span = yr(x1) - yr(x0), ys = [1, 2, 5, 10, 20, 25, 50].find(s => span / s <= (small ? 4 : 8)) || 50;
    for (let y = Math.ceil(yr(x0) / ys) * ys; y <= yr(x1) + 1e-9; y += ys) {
      const px = sx(st.x === "year" ? y : Date.UTC(y, 0, 1));
      root.append(svg("line", { x1: px, x2: px, y1: H - m.b, y2: H - m.b + 5, class: "g-zero" }));
      const tx = svg("text", { x: px, y: H - 8, class: "g-tick", "text-anchor": px < 24 ? "start" : "middle" }); tx.textContent = y; root.append(tx);
    }
    const ends = S.map(s => sy(s.pts[s.pts.length - 1][1])), sorted = [...ends].sort((a, b) => a - b);
    const clash = sorted.some((y, i) => i && y - sorted[i - 1] < 34);
    const late = [];
    S.forEach((s, i) => {
      const d = s.pts.map((p, j) => (j ? "L" : "M") + sx(p[0]).toFixed(1) + " " + sy(p[1]).toFixed(1)).join("");
      const path = svg("path", { d, class: "g-line", style: `stroke:${s.color}` });
      root.append(path);
      const lastP = s.pts[s.pts.length - 1], ex = sx(lastP[0]), ey = ends[i];
      const g = svg("g"); g.append(svg("circle", { cx: ex, cy: ey, r: 5, class: "g-ring", style: `fill:${s.color}` }));
      if (!clash) {
        const v = svg("text", { x: ex + 12, y: ey + (S.length > 1 && !small ? -1 : 5), class: "g-val" }); v.textContent = val(st, lastP[1]); g.append(v);
        if (S.length > 1 && !small) { const n = svg("text", { x: ex + 12, y: ey + 15, class: "g-name" }); n.textContent = s.name; g.append(n); }
      }
      root.append(g); late.push(g);
      if (animate) { path.dataset.anim = "1"; g.style.opacity = 0; }
    });
    const rule = svg("line", { y1: m.t - 8, y2: H - m.b, class: "g-rule", visibility: "hidden" }); root.append(rule);
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

/* ---------- dataset list ---------- */
const DOMAIN = { "Economy and development": "var(--s1)", "Energy": "var(--s4)", "Climate and emissions": "var(--s3)", "Natural hazards": "var(--s8)" };   // identity colours for the four topics
const TOPIC = { "Climate and emissions": ["topic-climate.svg", "Factory chimneys sending smoke into a hot sky"], "Energy": ["topic-energy.svg", "Wind turbines and solar panels on green hills"],
  "Economy and development": ["topic-economy.svg", "A city skyline with a construction crane and a rising line"], "Natural hazards": ["topic-hazards.svg", "An earthquake: waves spreading from a crack in the ground, and the trace it leaves on a seismograph"] };
function rows(D, sparks) {
  const box = $("#rows"), topics = $("#topics"); let region = "", topic = "";
  Object.keys(TOPIC).forEach(name => {
    const mine = D.filter(d => d.domain === name); if (!mine.length) return;
    const b = el("button"), img = new Image(), cap = el("span"); b.type = "button"; b.dataset.t = name; b.setAttribute("aria-pressed", "false");
    img.src = "img/" + TOPIC[name][0]; img.alt = TOPIC[name][1]; img.loading = "lazy"; img.width = 720; img.height = 480;
    cap.append(el("b", "", name), el("small", "", `${mine.length} dataset${mine.length > 1 ? "s" : ""}, ${mine.reduce((n, d) => n + d.columns.length, 0)} variables`));
    b.append(img, cap); topics.append(b);
  });
  topics.onclick = e => { const b = e.target.closest("button"); if (!b) return; topic = topic === b.dataset.t ? "" : b.dataset.t; [...topics.children].forEach(x => x.setAttribute("aria-pressed", x.dataset.t === topic)); draw(); };
  const spark = sp => {
    const w = el("div", "spark"), lo = Math.min(...sp.pts), hi = Math.max(...sp.pts), n = sp.pts.length, y = v => 6 + (1 - (v - lo) / (hi - lo || 1)) * 88;
    const sv = svg("svg", { viewBox: "0 0 100 100", preserveAspectRatio: "none", role: "img", "aria-label": sp.label });
    sv.append(svg("path", { d: sp.pts.map((v, i) => (i ? "L" : "M") + (i / (n - 1) * 100).toFixed(2) + " " + y(v).toFixed(2)).join(""), fill: "none", style: "stroke:var(--ink3)", "stroke-width": 1.5, "vector-effect": "non-scaling-stroke", "stroke-linejoin": "round" }));
    const dot = el("b"); dot.style.left = "100%"; dot.style.top = y(sp.pts[n - 1]) + "%"; w.title = sp.label;
    w.append(sv, dot); return w;
  };
  function draw() {
    const list = D.filter(d => (!region || d.region === region) && (!topic || d.domain === topic));
    box.replaceChildren(...list.map(d => {
      const row = el("article", "ds"), main = el("div"), h = el("h3"), a = el("a", "", d.title), href = `explore.html#d=${encodeURIComponent(d.id)}`;
      a.href = href; h.append(a);
      const where = el("div", "where up", `${d.region === "US" ? "United States" : "World"}, ${d.domain}`);
      where.style.setProperty("--dc", DOMAIN[d.domain] || "var(--ink3)");
      main.append(where, h, el("p", "", d.description));
      const dl = el("dl", "facts");
      [["Variables", d.columns.length], ["Rows", d.rows.toLocaleString("en-US")], ["Coverage", d.coverage || `${String(d.time.min).slice(0, 4)} to ${String(d.time.max).slice(0, 4)}`]]
        .forEach(([k, v]) => { const x = el("div"); x.append(el("dt", "", k), el("dd", "", v)); dl.append(x); });
      const go = el("div", "go"), c = el("a", "btn solid", "Customize"), f = el("a", "btn get", "Download CSV");
      c.href = href; f.href = d.file; f.setAttribute("download", ""); f.append(el("small", "", d.bytes < 1e6 ? `${Math.max(1, Math.round(d.bytes / 1e3))} KB` : `${(d.bytes / 1e6).toFixed(1)} MB`));
      c.setAttribute("aria-label", `Customize ${d.title}`); f.setAttribute("aria-label", `Download all of ${d.title} as CSV`);
      go.append(c, f);
      row.append(main, dl, sparks[d.id] ? spark(sparks[d.id]) : el("div", "spark"), go);
      return row;
    }));
    if (!list.length) box.append(el("p", "empty", "No datasets match both choices yet. Clear one of them."));
  }
  $("#regions").onclick = e => { const b = e.target.closest("button"); if (!b) return; region = b.dataset.r; [...$("#regions").children].forEach(x => x.setAttribute("aria-pressed", x === b)); draw(); };
  draw();
}

/* ---------- search across datasets, variables and places ---------- */
function search(D) {
  const input = $("#sq"), box = $("#sres");
  const norm = t => String(t).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9%]+/g, " ").trim();
  const ALIAS = { usa: "united states", us: "united states", america: "united states", uk: "united kingdom", britain: "united kingdom", uae: "united arab emirates", global: "world", worldwide: "world" };
  const places = [], vars = [];
  D.forEach(d => {
    (d.places || []).forEach(([code, label]) => places.push({ code, label, n: norm(label), d }));
    d.columns.forEach(c => vars.push({ c, d, q: norm(`${c.title} ${c.name} ${c.unit || ""}`), t: norm(c.title), n: norm(c.name) }));
  });
  const link = (d, v, code) => `explore.html#d=${encodeURIComponent(d.id)}${v ? "&v=" + encodeURIComponent(v) : ""}${code ? "&e=" + encodeURIComponent(code) : ""}`;
  function find(text) {
    let q = ` ${norm(text)} `;
    for (const a in ALIAS) q = q.replace(` ${a} `, ` ${ALIAS[a]} `);
    let place = null;
    for (const p of places) if (p.n && q.includes(` ${p.n} `) && (!place || p.n.length > place.n.length)) place = p;
    const words = (place ? q.replace(` ${place.n} `, " ") : q).trim().split(" ").filter(Boolean), out = [];
    const codeIn = d => place && (d.places || []).find(p => norm(p[1]) === place.n)?.[0];
    const ok = d => !place || codeIn(d);
    if (words.length) {
      D.forEach(d => { if (ok(d) && words.every(w => norm(`${d.title} ${d.domain}`).includes(w))) out.push({ rank: 0, main: d.title, side: place ? place.label : "Dataset", href: link(d, null, codeIn(d)) }); });
      vars.forEach(v => { if (ok(v.d) && words.every(w => v.q.includes(w))) out.push({ rank: v.n === words.join(" ") ? 0.5 : v.t.startsWith(words[0]) ? 1 : 2, main: v.c.title + (v.c.unit ? `, ${v.c.unit}` : ""), side: (place ? `${place.label}, ` : "") + v.d.title, href: link(v.d, v.c.name, codeIn(v.d)) }); });
    } else if (place) D.forEach(d => { if (ok(d)) out.push({ rank: 0, main: `${place.label}: ${d.title}`, side: `${d.columns.length} variables`, href: link(d, null, codeIn(d)) }); });
    return out.sort((a, b) => a.rank - b.rank || a.main.length - b.main.length).slice(0, 9);
  }
  let act = -1, list = [];
  const close = () => { box.hidden = true; input.setAttribute("aria-expanded", "false"); };
  const askUrl = t => `ask.html?q=${encodeURIComponent(t.trim()).replace(/%20/g, "+")}`;
  function draw() {
    const text = input.value.trim();
    if (!text) { close(); return; }
    list = [{ main: `Answer: ${text}`, side: "The number, its year and its source", href: askUrl(text), ask: true }, ...find(text).map(r => ({ ...r, side: `Open the data: ${r.side}` }))];
    act = Math.min(act, list.length - 1);
    box.replaceChildren(...list.map((r, i) => { const a = el("a", "res" + (i === act ? " act" : "") + (r.ask ? " ask" : "")); a.href = r.href; a.setAttribute("role", "option"); a.append(el("b", "", r.main), el("small", "", r.side)); return a; }));
    box.hidden = false; input.setAttribute("aria-expanded", "true");
  }
  input.addEventListener("input", () => { act = -1; draw(); });
  input.addEventListener("focus", draw);
  input.addEventListener("keydown", e => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") { act = Math.max(0, Math.min(list.length - 1, act + (e.key === "ArrowDown" ? 1 : -1))); draw(); $(".res.act", box)?.scrollIntoView({ block: "nearest" }); e.preventDefault(); }
    else if (e.key === "Enter") { const r = list[act < 0 ? 0 : act]; if (r && input.value.trim()) location.href = r.href; e.preventDefault(); }       // no row picked: the first row is the answer
    else if (e.key === "Escape") { close(); }
  });
  document.addEventListener("mousedown", e => { if (!e.target.closest(".search")) close(); });

  $("#askform").addEventListener("submit", e => { if (!input.value.trim()) e.preventDefault(); });
  ["India life expectancy", "Top CO2 emitters", "China vs India solar power", "World population", "Oil price", "Which country is richest?", "Earthquakes today"]
    .forEach(q => { const a = el("a", "", q); a.href = askUrl(q); $("#quick").append(a); });
  const nv = D.reduce((n, d) => n + d.columns.length, 0), nr = D.reduce((n, d) => n + d.rows, 0);
  $("#scope").textContent = `Answers come from ${D.length} datasets with ${nv} variables and ${nr.toLocaleString("en-US")} rows, checked every day.`;
}

/* ---------- world map ---------- */
function worldMap(shape, layers, D) {
  if (!shape || !layers.length) { $("#map").hidden = true; return; }
  const box = $("#mapbox"), seg = $("#layers"), tip = el("div", "tip"); tip.hidden = true;
  const names = new Map(); D.forEach(d => (d.places || []).forEach(([c, l]) => { if (!names.has(c)) names.set(c, l); }));
  const root = svgEl("svg", { viewBox: `0 0 ${shape.w} ${shape.h}`, role: "img" });
  root.append(svgEl("path", { d: shape.sphere, class: "sphere" }));
  const paths = shape.countries.map(c => { const p = svgEl("path", { d: c.d }); p.dataset.code = c.code; p.dataset.name = names.get(c.code) || c.name; root.append(p); return p; });
  box.append(root, tip);
  let cur = layers[0];
  const show = v => (cur.decimals ? v.toFixed(cur.decimals) : Math.round(v).toLocaleString("en-US"));
  function draw() {
    const vals = Object.values(cur.values).sort((a, b) => a - b), cut = [1, 2, 3, 4, 5].map(i => vals[Math.floor(vals.length * i / 6)]);   // six equal-count classes
    const cls = v => cut.findIndex(c => v < c) + 1 || 6;
    paths.forEach(p => { const v = cur.values[p.dataset.code]; if (v === undefined) { p.setAttribute("class", "none"); p.style.fill = ""; } else { p.removeAttribute("class"); p.style.fill = `var(--q${cls(v)})`; } });
    [...seg.children].forEach(b => b.setAttribute("aria-pressed", b.dataset.id === cur.id));
    $("#map-title").textContent = `${cur.title}, ${cur.year}`; $("#map-note").textContent = `Measured in ${cur.unit}. ${vals.length} countries have data. The colours split them into six equal-sized groups.`;
    $("#map-table").href = `explore.html#d=${encodeURIComponent(cur.dataset)}&v=${encodeURIComponent(cur.id)}&e=&f=${cur.year}&t=${cur.year}`;
    root.setAttribute("aria-label", `World map of ${cur.title.toLowerCase()} in ${cur.year}. Lowest ${show(vals[0])}, median ${show(vals[vals.length >> 1])}, highest ${show(vals[vals.length - 1])} ${cur.unit}. The link above the map opens the values as a table.`);
    const edges = [vals[0], ...cut, vals[vals.length - 1]], lg = $("#maplegend"); lg.replaceChildren();
    for (let i = 0; i < 6; i++) { const s = el("span"), sw = el("i"); sw.style.background = `var(--q${i + 1})`; s.append(sw, document.createTextNode(`${show(edges[i])} to ${show(edges[i + 1])}`)); lg.append(s); }
    const nd = el("span"), sw = el("i"); sw.style.background = "var(--nodata)"; nd.append(sw, document.createTextNode("No data")); lg.append(nd);
  }
  layers.forEach(l => { const b = el("button", "", l.title); b.type = "button"; b.dataset.id = l.id; b.onclick = () => { cur = l; draw(); }; seg.append(b); });
  root.addEventListener("pointermove", e => {
    const p = e.target.closest("path[data-code]"); if (!p) { tip.hidden = true; return; }
    const v = cur.values[p.dataset.code], rc = box.getBoundingClientRect();
    tip.replaceChildren(el("strong", "", p.dataset.name), el("div", "nm", v === undefined ? "No data" : `${show(v)} ${cur.unit}`));
    tip.hidden = false; tip.style.left = Math.min(rc.width - 200, Math.max(0, e.clientX - rc.left + 14)) + "px"; tip.style.top = (e.clientY - rc.top + 14) + "px";
  });
  root.addEventListener("pointerleave", () => { tip.hidden = true; });
  root.addEventListener("click", e => { const p = e.target.closest("path[data-code]"); if (p && p.dataset.code && cur.values[p.dataset.code] !== undefined) location.href = `explore.html#d=${encodeURIComponent(cur.dataset)}&v=${encodeURIComponent(cur.id)}&e=${encodeURIComponent(p.dataset.code)}`; });
  draw();
}

/* ---------- the "Ask" picture carries the real, current figure and its recent history ---------- */
function askArt(list) {
  const st = (list || []).find(s => s.id === "life"), india = st && st.series.find(s => s.name === "India");
  if (!india || india.pts.length < 4) return;
  const pts = india.pts.slice(-18), last = pts[pts.length - 1], lo = Math.min(...pts.map(p => p[1])), hi = Math.max(...pts.map(p => p[1]));
  const xy = pts.map((p, i) => [188 + i / (pts.length - 1) * 108, 136 - (p[1] - lo) / (hi - lo || 1) * 40]);
  $("#art-ask-n").textContent = last[1].toFixed(1); $("#art-ask-y").textContent = last[0];
  $("#art-ask-line").setAttribute("points", xy.map(p => p.map(v => v.toFixed(1)).join(",")).join(" "));
  $("#art-ask-dot").setAttribute("cx", xy[xy.length - 1][0]); $("#art-ask-dot").setAttribute("cy", xy[xy.length - 1][1]);
  $("#art-ask-u").setAttribute("x", 24 + $("#art-ask-n").getComputedTextLength() + 8);
}

/* ---------- photo band: one fact that belongs to the picture ---------- */
function band(b) {
  if (!b) return;
  $("#band-text").textContent = `Every light is electricity reaching someone. In ${b.year}, ${b.value}% of the world's people had it at home, up from ${b.before}% in ${b.before_year}. The dark stretches are oceans, deserts and the places still waiting.`;
  $("#band").hidden = false;
}

/* ---------- update clock ---------- */
function fresh(man, log) {
  if (!man.checked) return;
  const last = Date.parse(man.checked), list = $("#f-list"), run = (log && log.runs || [])[0];
  const local = t => new Date(t).toLocaleString([], { weekday: "short", hour: "numeric", minute: "2-digit" });
  function tick() {
    const next = nextRun(man.cron), left = Math.max(0, next - Date.now()), h = Math.floor(left / 36e5), m = Math.floor(left % 36e5 / 6e4);
    $("#f-last").textContent = timeAgo(last); $("#f-last-s").textContent = `${local(last)}, your time`;
    $("#f-next").textContent = h ? `in ${h} h ${m} min` : `in ${m} min`; $("#f-next-s").textContent = `${local(next)}, your time. It can start a few minutes late.`;
  }
  tick(); setInterval(tick, 30000);
  if (run) {
    run.changed.slice(0, 4).forEach(c => { const li = el("li"), a = el("a", "", c.title); a.href = `updates.html#${c.id}`; li.append(a, document.createTextNode(`: ${changeLine(c)}`)); list.append(li); });
    if (!run.changed.length) list.append(el("li", "", "Nothing changed at the sources since the check before."));
    if (run.unchanged.length && run.changed.length) list.append(el("li", "same", `${run.unchanged.length} other dataset${run.unchanged.length > 1 ? "s" : ""} checked, no change.`));
  }
  $("#fresh").hidden = false;
}

/* ---------- start ---------- */
(async () => {
  const get = getJSON;
  const [land, pulse, sets, log, shape] = await Promise.all([get("data/land.json"), get("data/pulse.json").catch(() => ({})), get("data/datasets.json"), get("data/changelog.json").catch(() => null), get("data/worldmap.json").catch(() => null)]);
  liveFeed(makeGlobe($("#globe"), land), pulse.quakes);
  ticker(pulse.tickers || []);
  counters(pulse.counters || {});
  stories(pulse.stories || []); askArt(pulse.stories);
  rows(sets.datasets, pulse.sparks || {});
  search(sets.datasets);
  worldMap(shape, pulse.maps || [], sets.datasets);
  band(pulse.band); fresh(sets, log);
})().catch(e => { console.error(e); $("#live-text").textContent = "This page could not load its data. Reload to try again."; });
